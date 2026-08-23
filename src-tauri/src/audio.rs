use anyhow::{anyhow, Context};
use cpal::traits::{DeviceTrait, HostTrait, StreamTrait};
use cpal::SampleFormat;
use rubato::{
    Resampler, SincFixedIn, SincInterpolationParameters, SincInterpolationType, WindowFunction,
};
use std::sync::atomic::{AtomicBool, AtomicU32, Ordering};
use std::sync::{Arc, Mutex};
use std::thread::JoinHandle;
use std::time::Duration;

/// Máximo de audio retenido: 5 minutos (a la tasa nativa del dispositivo).
const MAX_SECONDS: usize = 300;

pub struct AudioRecorder {
    stop: Arc<AtomicBool>,
    buffer: Arc<Mutex<Vec<f32>>>,
    sample_rate: Arc<AtomicU32>,
    handle: Option<JoinHandle<()>>,
    error: Arc<Mutex<Option<String>>>,
}

impl AudioRecorder {
    /// Inicia la captura del micrófono por defecto en un hilo dedicado.
    /// `level_cb` recibe el RMS (0.0-1.0 aprox) de cada bloque para animar el HUD.
    pub fn start(level_cb: impl Fn(f32) + Send + 'static) -> anyhow::Result<Self> {
        let stop = Arc::new(AtomicBool::new(false));
        let buffer = Arc::new(Mutex::new(Vec::<f32>::new()));
        let sample_rate = Arc::new(AtomicU32::new(0));
        let error = Arc::new(Mutex::new(None::<String>));
        let ready = Arc::new(AtomicBool::new(false));

        let t_stop = stop.clone();
        let t_buffer = buffer.clone();
        let t_rate = sample_rate.clone();
        let t_error = error.clone();
        let t_ready = ready.clone();

        let handle = std::thread::spawn(move || {
            let result = (|| -> anyhow::Result<()> {
                let host = cpal::default_host();
                let device = host
                    .default_input_device()
                    .ok_or_else(|| anyhow!("No se encontró micrófono"))?;
                let supported = device
                    .default_input_config()
                    .context("No se pudo leer la configuración del micrófono")?;
                let channels = supported.channels() as usize;
                let rate = supported.config().sample_rate;
                t_rate.store(rate, Ordering::SeqCst);
                let max_samples = rate as usize * MAX_SECONDS;

                let buf = t_buffer.clone();
                let cb = level_cb;
                let push = move |mono: &[f32]| {
                    let mut sum = 0.0f32;
                    for s in mono {
                        sum += s * s;
                    }
                    let rms = (sum / mono.len().max(1) as f32).sqrt();
                    cb(rms);
                    let mut b = buf.lock().unwrap();
                    if b.len() < max_samples {
                        b.extend_from_slice(mono);
                    }
                };

                let err_fn = |e| log::error!("Error de stream de audio: {e}");
                let config = supported.config();
                let stream = match supported.sample_format() {
                    SampleFormat::F32 => device.build_input_stream(
                        config,
                        move |data: &[f32], _| {
                            let mono = downmix(data, channels);
                            push(&mono);
                        },
                        err_fn,
                        None,
                    )?,
                    SampleFormat::I16 => device.build_input_stream(
                        config,
                        move |data: &[i16], _| {
                            let f: Vec<f32> =
                                data.iter().map(|s| *s as f32 / 32768.0).collect();
                            let mono = downmix(&f, channels);
                            push(&mono);
                        },
                        err_fn,
                        None,
                    )?,
                    SampleFormat::U16 => device.build_input_stream(
                        config,
                        move |data: &[u16], _| {
                            let f: Vec<f32> = data
                                .iter()
                                .map(|s| (*s as f32 - 32768.0) / 32768.0)
                                .collect();
                            let mono = downmix(&f, channels);
                            push(&mono);
                        },
                        err_fn,
                        None,
                    )?,
                    other => return Err(anyhow!("Formato de audio no soportado: {other:?}")),
                };
                stream.play().context("No se pudo iniciar la captura")?;
                t_ready.store(true, Ordering::SeqCst);
                while !t_stop.load(Ordering::SeqCst) {
                    std::thread::sleep(Duration::from_millis(20));
                }
                drop(stream);
                Ok(())
            })();
            if let Err(e) = result {
                *t_error.lock().unwrap() = Some(e.to_string());
                t_ready.store(true, Ordering::SeqCst);
            }
        });

        // Espera breve a que el stream arranque o falle, para reportar errores de inmediato.
        for _ in 0..100 {
            if ready.load(Ordering::SeqCst) {
                break;
            }
            std::thread::sleep(Duration::from_millis(10));
        }
        if let Some(e) = error.lock().unwrap().take() {
            return Err(anyhow!(e));
        }

        Ok(Self {
            stop,
            buffer,
            sample_rate,
            handle: Some(handle),
            error,
        })
    }

    /// Detiene la captura y devuelve (muestras mono, sample_rate nativo).
    pub fn stop(mut self) -> anyhow::Result<(Vec<f32>, u32)> {
        self.stop.store(true, Ordering::SeqCst);
        if let Some(h) = self.handle.take() {
            let _ = h.join();
        }
        if let Some(e) = self.error.lock().unwrap().take() {
            return Err(anyhow!(e));
        }
        let samples = std::mem::take(&mut *self.buffer.lock().unwrap());
        let rate = self.sample_rate.load(Ordering::SeqCst);
        Ok((samples, rate))
    }
}

fn downmix(data: &[f32], channels: usize) -> Vec<f32> {
    if channels <= 1 {
        return data.to_vec();
    }
    data.chunks_exact(channels)
        .map(|frame| frame.iter().sum::<f32>() / channels as f32)
        .collect()
}

/// Remuestrea a los 16 kHz mono que exigen los motores STT.
pub fn resample_to_16k(samples: Vec<f32>, rate: u32) -> anyhow::Result<Vec<f32>> {
    if rate == 16_000 || samples.is_empty() {
        return Ok(samples);
    }
    let params = SincInterpolationParameters {
        sinc_len: 64,
        f_cutoff: 0.95,
        interpolation: SincInterpolationType::Linear,
        oversampling_factor: 128,
        window: WindowFunction::BlackmanHarris2,
    };
    const CHUNK: usize = 1024;
    let mut resampler =
        SincFixedIn::<f32>::new(16_000.0 / rate as f64, 2.0, params, CHUNK, 1)
            .context("No se pudo crear el resampler")?;
    let mut out = Vec::with_capacity(samples.len() * 16_000 / rate as usize + CHUNK);
    let mut chunks = samples.chunks_exact(CHUNK);
    for chunk in &mut chunks {
        let res = resampler.process(&[chunk], None)?;
        out.extend_from_slice(&res[0]);
    }
    let rest = chunks.remainder();
    if !rest.is_empty() {
        let res = resampler.process_partial(Some(&[rest]), None)?;
        out.extend_from_slice(&res[0]);
    }
    // Vacía las colas internas del filtro.
    let res = resampler.process_partial::<&[f32]>(None, None)?;
    out.extend_from_slice(&res[0]);
    Ok(out)
}
