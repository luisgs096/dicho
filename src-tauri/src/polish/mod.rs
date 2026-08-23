pub mod groq;
pub mod rules;

use regex::Regex;
use serde::Serialize;

/// Entrada compartida por las capas de limpieza.
pub struct PolishCtx {
    /// Idioma detectado/configurado ("auto", "es", "en"...).
    #[allow(dead_code)]
    pub language: String,
    /// Diccionario personal: (término, reemplazo opcional).
    /// Con reemplazo → sustitución literal; sin él → palabra protegida (hint para el LLM).
    pub dictionary: Vec<(String, Option<String>)>,
}

/// Una corrección del diccionario aplicada a un dictado, para el historial.
#[derive(Debug, Clone, Serialize)]
pub struct Correction {
    pub term: String,
    pub replacement: String,
    pub count: u32,
}

/// Detecta qué reemplazos del diccionario aplican sobre el texto crudo.
/// Cuenta solo ocurrencias que difieren del reemplazo: si ya venía bien
/// escrito, no es corrección.
pub fn corrections(raw: &str, ctx: &PolishCtx) -> Vec<Correction> {
    let mut out = Vec::new();
    for (term, replacement) in &ctx.dictionary {
        let Some(to) = replacement else { continue };
        let Ok(re) = Regex::new(&format!(r"(?i)\b{}\b", regex::escape(term))) else {
            continue;
        };
        let count = re.find_iter(raw).filter(|m| m.as_str() != to).count() as u32;
        if count > 0 {
            out.push(Correction {
                term: term.clone(),
                replacement: to.clone(),
                count,
            });
        }
    }
    out
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn detecta_correcciones_con_conteo() {
        let ctx = PolishCtx {
            language: "es".into(),
            dictionary: vec![
                ("wispr".into(), Some("Wispr".into())),
                ("tauri".into(), Some("Tauri".into())),
                ("protegida".into(), None),
            ],
        };
        let c = corrections("me gusta wispr y wispr flow con tauri", &ctx);
        assert_eq!(c.len(), 2);
        assert_eq!(c[0].term, "wispr");
        assert_eq!(c[0].count, 2);
        assert_eq!(c[1].replacement, "Tauri");
    }

    #[test]
    fn ya_correcto_no_cuenta() {
        let ctx = PolishCtx {
            language: "es".into(),
            dictionary: vec![("wispr".into(), Some("Wispr".into()))],
        };
        assert!(corrections("uso Wispr a diario", &ctx).is_empty());
    }
}
