pub mod groq;
pub mod rules;

/// Entrada compartida por las capas de limpieza.
pub struct PolishCtx {
    /// Idioma detectado/configurado ("auto", "es", "en"...).
    #[allow(dead_code)]
    pub language: String,
    /// Diccionario personal: (término, reemplazo opcional).
    /// Con reemplazo → sustitución literal; sin él → palabra protegida (hint para el LLM).
    pub dictionary: Vec<(String, Option<String>)>,
}
