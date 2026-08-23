//! Benchmark del cuello de botella reportado: remuestrear un dictado largo.
//! `cargo run --example bench_resample` — simula 60 s de audio a 48 kHz.

use rubato::{
    Resampler, SincFixedIn, SincInterpolationParameters, SincInterpolationType, WindowFunction,
};
use std::time::Instant;

fn main() {
    let rate = 48_000u32;
    let secs = 60usize;
    let samples: Vec<f32> = (0..rate as usize * secs)
        .map(|i| (i as f32 * 0.01).sin() * 0.3)
        .collect();

    let params = SincInterpolationParameters {
        sinc_len: 64,
        f_cutoff: 0.95,
        interpolation: SincInterpolationType::Linear,
        oversampling_factor: 128,
        window: WindowFunction::BlackmanHarris2,
    };
    const CHUNK: usize = 1024;
    let mut resampler =
        SincFixedIn::<f32>::new(16_000.0 / rate as f64, 2.0, params, CHUNK, 1).unwrap();

    let t0 = Instant::now();
    let mut out: Vec<f32> = Vec::new();
    let mut chunks = samples.chunks_exact(CHUNK);
    for chunk in &mut chunks {
        let res = resampler.process(&[chunk], None).unwrap();
        out.extend_from_slice(&res[0]);
    }
    let rest = chunks.remainder();
    if !rest.is_empty() {
        let res = resampler.process_partial(Some(&[rest]), None).unwrap();
        out.extend_from_slice(&res[0]);
    }
    let elapsed = t0.elapsed();
    println!(
        "{secs} s de audio 48k→16k en {} ms ({} muestras out)",
        elapsed.as_millis(),
        out.len()
    );
}
