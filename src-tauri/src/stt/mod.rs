pub mod groq;
pub mod parakeet;

/// Ajustes de una transcripción.
#[derive(Debug, Clone, Default)]
pub struct SttOpts {
    /// ISO-639-1 o `None` para que el motor decida. Con "no traducir" siempre
    /// es `None`: fijar idioma es justo lo que hace que Whisper traduzca lo
    /// que venga en el otro.
    pub language: Option<String>,
    /// Contexto previo para el motor: la cola del trozo anterior o, en el
    /// primer trozo, una muestra de estilo. Whisper lo usa para ortografía y
    /// registro, no como instrucción.
    pub prompt: Option<String>,
}

/// Motor de voz a texto. Entrada: muestras f32 [-1,1] a 16 kHz mono.
pub trait Stt: Send {
    fn transcribe(&mut self, samples: &[f32], opts: &SttOpts) -> anyhow::Result<String>;
    #[allow(dead_code)]
    fn name(&self) -> &'static str;
}
