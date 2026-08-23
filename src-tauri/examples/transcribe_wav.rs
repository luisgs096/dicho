//! Arnés de verificación del motor local sin micrófono:
//! `cargo run --release --example transcribe_wav -- <archivo.wav> [idioma]`
//! El WAV debe ser 16 kHz mono (i16 o f32).

use std::path::PathBuf;
use std::time::Instant;
use transcribe_rs::onnx::parakeet::ParakeetModel;
use transcribe_rs::onnx::Quantization;
use transcribe_rs::{SpeechModel, TranscribeOptions};

fn main() -> Result<(), Box<dyn std::error::Error>> {
    let mut args = std::env::args().skip(1);
    let wav_path = args.next().expect("uso: transcribe_wav <archivo.wav> [idioma]");
    let lang = args.next();

    let mut reader = hound::WavReader::open(&wav_path)?;
    let spec = reader.spec();
    assert_eq!(spec.sample_rate, 16_000, "el WAV debe ser de 16 kHz");
    assert_eq!(spec.channels, 1, "el WAV debe ser mono");
    let samples: Vec<f32> = match spec.sample_format {
        hound::SampleFormat::Int => reader
            .samples::<i16>()
            .map(|s| s.unwrap() as f32 / 32768.0)
            .collect(),
        hound::SampleFormat::Float => reader.samples::<f32>().map(|s| s.unwrap()).collect(),
    };
    let secs = samples.len() as f32 / 16_000.0;
    println!("Audio: {secs:.1} s ({})", wav_path);

    let model_dir = PathBuf::from(std::env::var("APPDATA")?)
        .join("dev.mike.app")
        .join("models")
        .join("parakeet-tdt-0.6b-v3-int8");
    println!("Cargando Parakeet desde {}...", model_dir.display());
    let t0 = Instant::now();
    let mut model = ParakeetModel::load(&model_dir, &Quantization::Int8)?;
    println!("Modelo cargado en {:.1} s", t0.elapsed().as_secs_f32());

    let options = TranscribeOptions {
        language: lang,
        ..Default::default()
    };
    let t1 = Instant::now();
    let result = model.transcribe(&samples, &options)?;
    let infer = t1.elapsed().as_secs_f32();
    println!(
        "Transcrito en {infer:.2} s ({:.1}x tiempo real)",
        secs / infer
    );
    println!("--- TEXTO ---");
    println!("{}", result.text.trim());
    Ok(())
}
