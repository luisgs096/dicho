pub mod groq;
pub mod parakeet;

/// Motor de voz a texto. Entrada: muestras f32 [-1,1] a 16 kHz mono.
pub trait Stt: Send {
    fn transcribe(&mut self, samples: &[f32], lang: Option<&str>) -> anyhow::Result<String>;
    #[allow(dead_code)]
    fn name(&self) -> &'static str;
}
