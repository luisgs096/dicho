use crate::audio::{resample_to_16k, AudioRecorder};
use crate::inject::inject_text;
use crate::models::{self, ModelStatus};
use crate::polish::{self, PolishCtx};
use crate::settings::{EngineKind, PolishKind, SettingsState};
use crate::store::Store;
use crate::stt::{groq::GroqStt, parakeet::ParakeetStt, Stt};
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::mpsc::{Receiver, RecvTimeoutError};
use std::sync::{Arc, Mutex};
use std::time::{Duration, Instant};
use tauri::{AppHandle, Emitter, Manager};

pub enum Cmd {
    Start,
    Stop,
    /// El modelo terminó de descargarse; se cargará al dictar.
    ModelReady,
}

/// Frases que los modelos STT "alucinan" sobre audio casi mudo: vienen de
/// los subtítulos de video de sus datos de entrenamiento.
const STT_HALLUCINATIONS: &[&str] = &[
    "subtítulos realizados",
    "subtitulado por",
    "subtítulos por",
    "traducido por",
    "traducción de",
    "traducir del inglés",
    "amara.org",
    "gracias por ver",
    "suscríbete",
    "subtitles by",
    "thanks for watching",
    "www.youtube",
];

/// RMS máximo por ventana: la energía del tramo más fuerte de la grabación.
fn max_window_rms(samples: &[f32], window: usize) -> f32 {
    samples
        .chunks(window)
        .map(|w| (w.iter().map(|s| s * s).sum::<f32>() / w.len() as f32).sqrt())
        .fold(0.0f32, f32::max)
}

/// Incorpora una carga de Parakeet terminada (o la espera, si `block`).
fn absorb_load(
    parakeet: &mut Option<ParakeetStt>,
    loading: &mut Option<std::thread::JoinHandle<anyhow::Result<ParakeetStt>>>,
    block: bool,
) -> anyhow::Result<()> {
    if !block && !loading.as_ref().is_some_and(|h| h.is_finished()) {
        return Ok(());
    }
    if let Some(handle) = loading.take() {
        match handle.join() {
            Ok(Ok(m)) => *parakeet = Some(m),
            Ok(Err(e)) => return Err(e.context("No se pudo cargar el modelo local")),
            Err(_) => anyhow::bail!("El hilo de carga del modelo falló"),
        }
    }
    Ok(())
}

fn emit_state(app: &AppHandle, state: &str, extra: Option<serde_json::Value>) {
    let mut payload = serde_json::json!({ "state": state });
    if let Some(serde_json::Value::Object(map)) = extra {
        for (k, v) in map {
            payload[k] = v;
        }
    }
    let _ = app.emit("recording-state", payload);
}

/// Log de diagnóstico que sobrevive en builds release (sin consola):
/// escribe a %APPDATA%/<identifier>/dicho.log además del logger normal.
pub(crate) fn diag(app: &AppHandle, msg: &str) {
    log::info!("{msg}");
    if let Ok(dir) = app.path().app_data_dir() {
        let ts = std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .map(|d| d.as_secs())
            .unwrap_or(0);
        if let Ok(mut f) = std::fs::OpenOptions::new()
            .create(true)
            .append(true)
            .open(dir.join("dicho.log"))
        {
            use std::io::Write;
            let _ = writeln!(f, "[{ts}] {msg}");
        }
    }
}

fn show_hud(app: &AppHandle) {
    let Some(hud) = app.get_webview_window("hud") else {
        diag(app, "HUD: ventana 'hud' NO EXISTE");
        return;
    };
    match app.primary_monitor() {
        Ok(Some(monitor)) => {
            let msize = monitor.size();
            let mpos = monitor.position();
            let wsize = hud.outer_size().unwrap_or(tauri::PhysicalSize {
                width: 360,
                height: 96,
            });
            let x = mpos.x + ((msize.width as i32 - wsize.width as i32) / 2);
            let y = mpos.y + msize.height as i32
                - wsize.height as i32
                - (64.0 * monitor.scale_factor()) as i32;
            let pos_result = hud.set_position(tauri::PhysicalPosition { x, y });
            diag(
                app,
                &format!(
                    "HUD: monitor {}x{} escala {:.2}, ventana {}x{}, pos ({x},{y}) → {pos_result:?}",
                    msize.width,
                    msize.height,
                    monitor.scale_factor(),
                    wsize.width,
                    wsize.height
                ),
            );
        }
        other => diag(app, &format!("HUD: primary_monitor raro: {other:?}")),
    }
    let show1 = hud.show();
    let vis1 = hud.is_visible();
    diag(app, &format!("HUD: show()={show1:?}, visible={vis1:?}"));
    if !matches!(vis1, Ok(true)) {
        // Reintento defensivo: algunos estados de Windows ignoran el primer show.
        let _ = hud.unminimize();
        let show2 = hud.show();
        let _ = hud.set_always_on_top(true);
        diag(
            app,
            &format!(
                "HUD: reintento show()={show2:?}, visible={:?}",
                hud.is_visible()
            ),
        );
    }
}

fn hide_hud_later(app: &AppHandle, gen: &Arc<AtomicU64>, delay_ms: u64) {
    let expected = gen.load(Ordering::SeqCst);
    let app = app.clone();
    let gen = gen.clone();
    std::thread::spawn(move || {
        std::thread::sleep(Duration::from_millis(delay_ms));
        if gen.load(Ordering::SeqCst) == expected {
            if let Some(hud) = app.get_webview_window("hud") {
                let _ = hud.hide();
            }
        }
    });
}

pub fn spawn(app: AppHandle, rx: Receiver<Cmd>, settings: SettingsState, store: Arc<Store>) {
    std::thread::spawn(move || {
        // El modelo local ocupa ~670 MB en RAM: se carga bajo demanda al
        // dictar (en paralelo al habla, que suele durar más que la carga)
        // y se libera a los pocos segundos de terminar el dictado.
        const IDLE_UNLOAD: Duration = Duration::from_secs(10);
        const IDLE_TICK: Duration = Duration::from_secs(5);

        let mut recorder: Option<AudioRecorder> = None;
        let mut started_at = Instant::now();
        let mut parakeet: Option<ParakeetStt> = None;
        let mut parakeet_loading: Option<
            std::thread::JoinHandle<anyhow::Result<ParakeetStt>>,
        > = None;
        let mut last_use = Instant::now();
        let mut groq = GroqStt::new();
        // Generación de sesión HUD: invalida ocultados diferidos si llega una nueva.
        let hud_gen = Arc::new(AtomicU64::new(0));

        loop {
            let cmd = match rx.recv_timeout(IDLE_TICK) {
                Ok(cmd) => cmd,
                Err(RecvTimeoutError::Timeout) => {
                    // Integra cargas que quedaron sin usar y libera por inactividad.
                    if let Err(e) = absorb_load(&mut parakeet, &mut parakeet_loading, false) {
                        log::error!("{e:#}");
                    }
                    if recorder.is_none()
                        && parakeet.is_some()
                        && last_use.elapsed() >= IDLE_UNLOAD
                    {
                        parakeet = None;
                        log::info!(
                            "Parakeet liberado de RAM tras {} s sin dictar",
                            IDLE_UNLOAD.as_secs()
                        );
                    }
                    continue;
                }
                Err(RecvTimeoutError::Disconnected) => break,
            };
            match cmd {
                Cmd::ModelReady => {
                    log::info!("Modelo local disponible; se cargará al dictar");
                }
                Cmd::Start => {
                    if recorder.is_some() {
                        continue;
                    }
                    let engine = settings.read().map(|s| s.engine).unwrap_or(EngineKind::Parakeet);
                    if engine == EngineKind::Parakeet && parakeet.is_none() {
                        if matches!(models::status(&app), ModelStatus::Ready) {
                            // Arranca la carga ya, en paralelo al habla; se
                            // espera (si hace falta) justo antes de transcribir.
                            if parakeet_loading.is_none() {
                                let dir = models::model_dir(&app);
                                parakeet_loading = Some(std::thread::spawn(move || {
                                    let t = Instant::now();
                                    let m = ParakeetStt::load(&dir);
                                    if m.is_ok() {
                                        log::info!(
                                            "Parakeet cargado en {} ms",
                                            t.elapsed().as_millis()
                                        );
                                    }
                                    m
                                }));
                            }
                        } else {
                            // Sin modelo local descargado → guía al usuario.
                            let msg = match models::status(&app) {
                                ModelStatus::Downloading => {
                                    "Descargando el modelo de voz… abre Configuración para ver el progreso"
                                }
                                _ => "Falta el modelo de voz: ábreme desde la bandeja y descárgalo",
                            };
                            hud_gen.fetch_add(1, Ordering::SeqCst);
                            show_hud(&app);
                            emit_state(&app, "error", Some(serde_json::json!({ "message": msg })));
                            hide_hud_later(&app, &hud_gen, 3200);
                            continue;
                        }
                    }
                    last_use = Instant::now();
                    hud_gen.fetch_add(1, Ordering::SeqCst);
                    let hud_enabled = settings.read().map(|s| s.hud_enabled).unwrap_or(true);
                    if hud_enabled {
                        show_hud(&app);
                    }
                    emit_state(&app, "recording", None);
                    let level_app = app.clone();
                    // Máximo ~30 eventos/s hacia el HUD para no saturar el IPC.
                    let last_emit = Arc::new(Mutex::new(Instant::now() - Duration::from_secs(1)));
                    match AudioRecorder::start(move |rms| {
                        let mut last = last_emit.lock().unwrap();
                        if last.elapsed() >= Duration::from_millis(33) {
                            *last = Instant::now();
                            drop(last);
                            let _ = level_app
                                .emit("audio-level", serde_json::json!({ "level": rms }));
                        }
                    }) {
                        Ok(r) => {
                            recorder = Some(r);
                            started_at = Instant::now();
                        }
                        Err(e) => {
                            emit_state(
                                &app,
                                "error",
                                Some(serde_json::json!({ "message": e.to_string() })),
                            );
                            hide_hud_later(&app, &hud_gen, 3200);
                        }
                    }
                }
                Cmd::Stop => {
                    let Some(rec) = recorder.take() else { continue };
                    let held = started_at.elapsed();
                    emit_state(&app, "processing", None);

                    enum StopResult {
                        Done(String, String, &'static str, i64, Vec<polish::Correction>),
                        /// Hubo grabación pero no se entendió nada: carita en el HUD.
                        Empty,
                        /// Toque accidental: sin feedback.
                        Tap,
                    }
                    let outcome = (|| -> anyhow::Result<StopResult> {
                        let (samples, rate) = rec.stop()?;
                        // Toques accidentales: menos de 350 ms no se procesan.
                        if held < Duration::from_millis(350) {
                            return Ok(StopResult::Tap);
                        }
                        let t_rs = Instant::now();
                        let samples = resample_to_16k(samples, rate)?;
                        log::info!(
                            "Resample {}Hz→16k: {} ms ({:.1} s de audio)",
                            rate,
                            t_rs.elapsed().as_millis(),
                            samples.len() as f32 / 16_000.0
                        );
                        if samples.len() < 16_000 / 4 {
                            return Ok(StopResult::Empty);
                        }
                        // Compuerta de silencio: sin energía de voz no se
                        // transcribe — los modelos STT alucinan frases sobre
                        // silencio en lugar de devolver vacío. El umbral es
                        // deliberadamente bajo: la ganancia de mic varía mucho
                        // entre equipos y un umbral alto se traga voz real.
                        let voice_rms = max_window_rms(&samples, 1600);
                        diag(&app, &format!("Dictado: rms máx {voice_rms:.5}"));
                        if voice_rms < 0.0012 {
                            return Ok(StopResult::Empty);
                        }
                        let (engine, polish_kind, language) = {
                            let s = settings.read().unwrap();
                            (s.engine, s.polish, s.language.clone())
                        };
                        let lang = match language.as_str() {
                            "auto" | "" => None,
                            other => Some(other.to_string()),
                        };

                        // El usuario ya habló: si la carga del modelo sigue en
                        // curso, aquí se espera lo poco que le falte.
                        if engine == EngineKind::Parakeet && parakeet.is_none() {
                            absorb_load(&mut parakeet, &mut parakeet_loading, true)?;
                        }

                        let t0 = Instant::now();
                        let (raw, engine_name) = match engine {
                            EngineKind::Groq => {
                                match groq.transcribe(&samples, lang.as_deref()) {
                                    Ok(t) => (t, "groq"),
                                    Err(e) => {
                                        // Fallback transparente al motor local.
                                        if let Some(p) = parakeet.as_mut() {
                                            log::warn!("Groq falló ({e}), usando Parakeet local");
                                            (p.transcribe(&samples, lang.as_deref())?, "parakeet")
                                        } else {
                                            return Err(e);
                                        }
                                    }
                                }
                            }
                            EngineKind::Parakeet => {
                                let p = parakeet
                                    .as_mut()
                                    .ok_or_else(|| anyhow::anyhow!("Modelo local no cargado"))?;
                                (p.transcribe(&samples, lang.as_deref())?, "parakeet")
                            }
                        };
                        let stt_ms = t0.elapsed().as_millis() as i64;
                        log::info!("STT [{engine_name}] {stt_ms} ms: {raw}");
                        if raw.trim().is_empty() {
                            return Ok(StopResult::Empty);
                        }
                        // Segunda barrera: si la energía fue baja y el texto es
                        // una frase típica de alucinación, se descarta.
                        let raw_lc = raw.to_lowercase();
                        if voice_rms < 0.006
                            && STT_HALLUCINATIONS.iter().any(|h| raw_lc.contains(h))
                        {
                            diag(
                                &app,
                                &format!("Alucinación descartada (rms {voice_rms:.5}): {raw}"),
                            );
                            return Ok(StopResult::Empty);
                        }

                        let ctx = PolishCtx {
                            language,
                            dictionary: store.dict_pairs(),
                        };
                        let corrections = polish::corrections(&raw, &ctx);
                        let polished = match polish_kind {
                            PolishKind::Rules => polish::rules::polish(&raw, &ctx),
                            PolishKind::GroqLlm => match polish::groq::polish(&raw, &ctx) {
                                Ok(t) => t,
                                Err(e) => {
                                    log::warn!("Pulido LLM falló ({e}), usando reglas locales");
                                    polish::rules::polish(&raw, &ctx)
                                }
                            },
                        };
                        Ok(StopResult::Done(raw, polished, engine_name, stt_ms, corrections))
                    })();

                    match outcome {
                        Ok(StopResult::Done(raw, polished, engine_name, stt_ms, corrections)) => {
                            if let Err(e) = inject_text(&polished) {
                                emit_state(
                                    &app,
                                    "error",
                                    Some(serde_json::json!({ "message": e.to_string() })),
                                );
                                hide_hud_later(&app, &hud_gen, 3200);
                                continue;
                            }
                            let corrections_json = (!corrections.is_empty())
                                .then(|| serde_json::to_string(&corrections).ok())
                                .flatten();
                            let _ = store.add_history(
                                &raw,
                                &polished,
                                engine_name,
                                held.as_millis() as i64,
                                corrections_json.as_deref(),
                            );
                            log::info!(
                                "Dictado listo: {} ms grabación, {} ms STT",
                                held.as_millis(),
                                stt_ms
                            );
                            emit_state(
                                &app,
                                "done",
                                Some(serde_json::json!({ "text": polished })),
                            );
                            let _ = app.emit("history-changed", ());
                            // Tiempo para que la carita de celebración se aprecie.
                            hide_hud_later(&app, &hud_gen, 2400);
                        }
                        Ok(StopResult::Empty) => {
                            // Tiempo suficiente para la animación de la carita.
                            emit_state(&app, "empty", None);
                            hide_hud_later(&app, &hud_gen, 2600);
                        }
                        Ok(StopResult::Tap) => {
                            emit_state(&app, "idle", None);
                            hide_hud_later(&app, &hud_gen, 150);
                        }
                        Err(e) => {
                            emit_state(
                                &app,
                                "error",
                                Some(serde_json::json!({ "message": e.to_string() })),
                            );
                            hide_hud_later(&app, &hud_gen, 3200);
                        }
                    }
                    last_use = Instant::now();
                }
            }
        }
    });
}
