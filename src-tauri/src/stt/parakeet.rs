use super::Stt;
use anyhow::anyhow;
use std::path::Path;
use transcribe_rs::onnx::parakeet::ParakeetModel;
use transcribe_rs::onnx::Quantization;
use transcribe_rs::{SpeechModel, TranscribeOptions};

/// Motor local: NVIDIA Parakeet TDT 0.6B v3 (int8, ONNX) — 25 idiomas,
/// puntuación y mayúsculas nativas, corre en CPU.
pub struct ParakeetStt {
    model: ParakeetModel,
}

impl ParakeetStt {
    pub fn load(model_dir: &Path) -> anyhow::Result<Self> {
        let model = ParakeetModel::load(model_dir, &Quantization::Int8)
            .map_err(|e| anyhow!("No se pudo cargar Parakeet: {e}"))?;
        Ok(Self { model })
    }
}

impl Stt for ParakeetStt {
    fn transcribe(&mut self, samples: &[f32], lang: Option<&str>) -> anyhow::Result<String> {
        let options = TranscribeOptions {
            language: lang.map(String::from),
            ..Default::default()
        };
        let result = self
            .model
            .transcribe(samples, &options)
            .map_err(|e| anyhow!("Error de transcripción: {e}"))?;
        Ok(result.text.trim().to_string())
    }

    fn name(&self) -> &'static str {
        "parakeet"
    }
}
