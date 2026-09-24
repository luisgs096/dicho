use super::PolishCtx;
use regex::Regex;
use std::sync::LazyLock;

/// Muletillas inequívocas (nunca son palabras con contenido) en es/en.
/// Deliberadamente conservador: "este", "pues", "o sea" o "like" pueden ser
/// legítimas, así que esas se dejan al pulido LLM opcional.
static FILLER: LazyLock<Regex> = LazyLock::new(|| {
    Regex::new(r"(?i)^(?:e+h+|e+m+m*|m+h?m+|hm+|u+m+m*|u+h+|erm+|a+h+m+)$").unwrap()
});

static MULTI_SPACE: LazyLock<Regex> = LazyLock::new(|| Regex::new(r"\s{2,}").unwrap());
static SPACE_BEFORE_PUNCT: LazyLock<Regex> =
    LazyLock::new(|| Regex::new(r"\s+([,.;:!?])").unwrap());
static DUP_PUNCT: LazyLock<Regex> = LazyLock::new(|| Regex::new(r"([,.;:]){2,}").unwrap());

/// Limpieza local instantánea: quita muletillas y normaliza espacios y
/// puntuación. Determinista y sin red.
///
/// **El diccionario no se aplica aquí**, y es a propósito: lo aplica
/// `polish::aplicar_diccionario` después de pulir, en todos los modos
/// (pipeline.rs). Aplicarlo también aquí lo hacía dos veces en Tal cual —
/// «Tailwind CSS CSS» —, en orden alfabético en vez de del más largo al más
/// corto, y con un `replace_all` de `&str`, que lee `$` como grupo de captura:
/// «$PATH» desaparecía del texto.
pub fn polish(text: &str, _ctx: &PolishCtx) -> String {
    // 1. Filtra tokens que son pura muletilla, conservando su puntuación colgante.
    let mut kept: Vec<String> = Vec::new();
    for token in text.split_whitespace() {
        let word = token.trim_matches(|c: char| !c.is_alphanumeric());
        if !word.is_empty() && FILLER.is_match(word) {
            // Conserva puntuación de cierre del token descartado ("eh," → ",")
            // solo si el token anterior no termina ya en puntuación.
            let trailing: String = token
                .chars()
                .rev()
                .take_while(|c| ",.;:!?".contains(*c))
                .collect::<Vec<_>>()
                .into_iter()
                .rev()
                .collect();
            if !trailing.is_empty() {
                if let Some(prev) = kept.last_mut() {
                    if !prev.ends_with(|c: char| ",.;:!?".contains(c)) {
                        prev.push_str(&trailing);
                    }
                }
            }
            continue;
        }
        kept.push(token.to_string());
    }
    let mut out = kept.join(" ");

    // 2. Normalización.
    out = SPACE_BEFORE_PUNCT.replace_all(&out, "$1").into_owned();
    out = DUP_PUNCT.replace_all(&out, "$1").into_owned();
    out = MULTI_SPACE.replace_all(&out, " ").into_owned();
    let mut out = out.trim().to_string();

    // 3. Primera letra en mayúscula.
    if let Some(first) = out.chars().next() {
        if first.is_lowercase() {
            let upper: String = first.to_uppercase().collect();
            out.replace_range(..first.len_utf8(), &upper);
        }
    }
    out
}

#[cfg(test)]
mod tests {
    use super::*;

    fn ctx() -> PolishCtx {
        PolishCtx {
            language: "es".into(),
            dictionary: vec![("wispr".into(), Some("Wispr".into()))],
        }
    }

    #[test]
    fn quita_muletillas() {
        let r = polish("hola, eh, quiero um decir algo, mmm, importante", &ctx());
        assert_eq!(r, "Hola, quiero decir algo, importante");
    }

    /// El diccionario lo pone el pipeline después de pulir, no esto: aquí
    /// sólo se comprueba que las dos cosas juntas dan lo de siempre.
    #[test]
    fn aplica_diccionario() {
        let c = ctx();
        let r = crate::polish::aplicar_diccionario(&polish("me gusta wispr flow", &c), &c.dictionary);
        assert_eq!(r, "Me gusta Wispr flow");
    }

    #[test]
    fn no_toca_palabras_reales() {
        let r = polish("Este documento es de emma", &ctx());
        assert_eq!(r, "Este documento es de emma");
    }

    #[test]
    fn capitaliza_inicio() {
        assert_eq!(polish("hola mundo", &ctx()), "Hola mundo");
    }
}
