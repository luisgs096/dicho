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

/// Las muletillas que el Editor tiene el encargo de quitar **y** las que cuenta
/// el historial. Una sola lista para las dos cosas a propósito: con dos, el
/// contador acabaría contando cosas que el prompt no pide quitar, o al revés, y
/// nadie se enteraría hasta que los números no cuadraran.
///
/// Ojo: no es la lista de `rules::FILLER`. Aquélla son **sonidos** (eh, mmm,
/// erm) y los quita un regex local; éstas son muletillas de verdad, las que sólo
/// sabe quitar el modelo.
pub const MULETILLAS: &[&str] = &[
    "o sea", "más bien", "digamos", "este", "pues", "a ver", "y bueno",
    "la verdad", "por así decirlo", "¿sabes?", "¿no?",
];

/// Anglicismos que Dicho reconoce. Es una lista a mano y por eso incompleta por
/// construcción — medido sobre 671 dictados reales, marca el 19 % —, así que la
/// interfaz tiene que decir "los que conozco" y no "todos".
///
/// Se busca palabra completa, nunca prefijo: probándolo, `tip` pillaba "tipo" y
/// `mode` pillaba "modelo".
pub const ANGLICISMOS: &[&str] = &[
    "deploy", "meeting", "commit", "push", "pull", "build", "release", "update",
    "feature", "bug", "fix", "toggle", "slider", "hover", "scroll", "layout",
    "prompt", "key", "api", "log", "test", "debug", "default", "match", "review",
    "merge", "branch", "repo", "paste", "preview", "tag", "label", "target",
    "link", "share", "sync", "backup", "design", "skill", "pixel", "checkpoint",
    "dashboard", "workflow", "framework", "insight", "feedback", "mockup",
    "onboarding", "roadmap", "sprint", "deadline", "brief", "pitch", "demo",
];

/// Una corrección del diccionario en un dictado, para el historial.
#[derive(Debug, Clone, Serialize)]
pub struct Correction {
    pub term: String,
    pub replacement: String,
    /// Cuántas veces hacía falta corregir, contadas sobre el texto crudo.
    pub count: u32,
    /// Cuántas veces está el reemplazo en el texto final. **No siempre coincide
    /// con `count`**, y ése es justo el dato que faltaba.
    pub aplicadas: u32,
}

/// Qué correcciones del diccionario pedía el dictado, y cuáles llegaron de
/// verdad al texto final.
///
/// Antes esto sólo miraba el crudo y era una **predicción**: decía lo que el
/// diccionario haría, no lo que pasó. Y mentía bastante — medido sobre
/// `mike.db`, 10 de 21 reemplazos anunciados no estaban en el texto. El caso
/// claro es el dictado 654: el historial decía "Cloud → Claude ×2" y lo que el
/// usuario recibió decía "Cloud Code".
///
/// La causa es que la sustitución literal sólo ocurre en modo Reglas
/// (`rules::polish`); con Estándar o Editor el diccionario viaja como simple
/// sugerencia dentro del prompt, y el modelo puede ignorarla. Así que ahora se
/// cuenta también en la salida: `aplicadas == 0` significa que la ignoró, y eso
/// vale la pena enseñarlo en vez de esconderlo.
/// Aplica el diccionario del usuario **al texto ya redactado**, literalmente.
///
/// # Por qué existe
///
/// Hasta hoy el diccionario sólo viajaba **dentro del prompt**, como una lista
/// de sugerencias, y la sustitución literal ocurría nada más en modo Reglas. En
/// los modos con IA el modelo era libre de ignorarla, y la ignoraba: medido
/// sobre el historial real, **13 de 400 dictados conservaban un término que el
/// diccionario tenía que haber cambiado** — «Cloud Code» seguía saliendo
/// «Cloud», y «Jimmy Knight» no se convertía en «Gemini».
///
/// Un diccionario que el usuario se molestó en escribir no puede ser una
/// sugerencia. Si él dice que «cloud code» se escribe «Claude code», se escribe
/// así. Por eso esto corre **después** de pulir y en todos los modos: lo último
/// que toca el texto es su diccionario, no el modelo.
///
/// # Dos detalles que no son adorno
///
/// Los términos se aplican **de más largo a más corto**. Con «Cloud» y «cloud
/// code» los dos en la lista, aplicar primero el corto dejaría «Claude code»
/// convertido en un destrozo a medias.
///
/// Y si lo que había empezaba en mayúscula y el reemplazo no, se le respeta la
/// mayúscula: «Clode» al principio de una frase se vuelve «Claude», no «claude».
pub fn aplicar_diccionario(texto: &str, dict: &[(String, Option<String>)]) -> String {
    let mut pares: Vec<(&str, &str)> = dict
        .iter()
        .filter_map(|(t, r)| r.as_deref().map(|r| (t.as_str(), r)))
        .filter(|(t, r)| !t.trim().is_empty() && !r.trim().is_empty())
        .collect();
    pares.sort_by_key(|(t, _)| std::cmp::Reverse(t.chars().count()));

    let mut out = texto.to_string();
    for (term, bueno) in pares {
        let Ok(re) = Regex::new(&format!(r"(?i)\b{}\b", regex::escape(term))) else {
            continue;
        };
        out = re
            .replace_all(&out, |c: &regex::Captures| {
                respeta_mayuscula(&c[0], bueno)
            })
            .into_owned();
    }
    out
}

/// Si lo encontrado empezaba en mayúscula y el reemplazo no, se la pone.
fn respeta_mayuscula(encontrado: &str, bueno: &str) -> String {
    let empieza_alto = encontrado
        .chars()
        .next()
        .is_some_and(|c| c.is_uppercase());
    let bueno_bajo = bueno.chars().next().is_some_and(|c| c.is_lowercase());
    if !(empieza_alto && bueno_bajo) {
        return bueno.to_string();
    }
    let mut cs = bueno.chars();
    match cs.next() {
        Some(c) => c.to_uppercase().collect::<String>() + cs.as_str(),
        None => bueno.to_string(),
    }
}

pub fn corrections(raw: &str, polished: &str, ctx: &PolishCtx) -> Vec<Correction> {
    let mut out = Vec::new();
    for (term, replacement) in &ctx.dictionary {
        let Some(to) = replacement else { continue };
        let Ok(re) = Regex::new(&format!(r"(?i)\b{}\b", regex::escape(term))) else {
            continue;
        };
        let count = re.find_iter(raw).filter(|m| m.as_str() != to).count() as u32;
        if count == 0 {
            continue;
        }
        // Distinguiendo mayúsculas a propósito: media corrección del diccionario
        // es justamente de capitalización ("cloud code" → "Claude code"), y
        // buscar sin distinguir las daría todas por buenas.
        let aplicadas = Regex::new(&regex::escape(to))
            .map(|r| r.find_iter(polished).count() as u32)
            .unwrap_or(0);
        out.push(Correction {
            term: term.clone(),
            replacement: to.clone(),
            count,
            aplicadas,
        });
    }
    out
}

#[cfg(test)]
mod tests {
    use super::*;

    /// El fallo que lo motivó, con los términos reales del usuario.
    #[test]
    fn el_diccionario_se_aplica_aunque_el_modelo_lo_ignore() {
        let dict = vec![
            ("cloud code".to_string(), Some("Claude code".to_string())),
            ("Cloud".to_string(), Some("Claude".to_string())),
            ("Jimmy Knight".to_string(), Some("Gemini".to_string())),
        ];
        let salido_del_modelo =
            "¿Desde dónde debería iniciar Cloud Code? Y que Jimmy Knight haga las imágenes.";
        let arreglado = aplicar_diccionario(salido_del_modelo, &dict);
        assert!(arreglado.contains("Claude code"), "{arreglado}");
        assert!(arreglado.contains("Gemini"), "{arreglado}");
        assert!(!arreglado.contains("Cloud"), "{arreglado}");
        assert!(!arreglado.contains("Jimmy"), "{arreglado}");
    }

    /// Lo más largo primero. Al revés, «Cloud» se comería la primera palabra de
    /// «cloud code» y dejaría el resto colgando.
    #[test]
    fn el_termino_largo_gana_al_corto() {
        let dict = vec![
            ("Cloud".to_string(), Some("Claude".to_string())),
            ("cloud code".to_string(), Some("Claude code".to_string())),
        ];
        assert_eq!(
            aplicar_diccionario("abre cloud code ya", &dict),
            "abre Claude code ya"
        );
    }

    #[test]
    fn respeta_la_mayuscula_de_principio_de_frase() {
        let dict = vec![("clode".to_string(), Some("claude".to_string()))];
        assert_eq!(aplicar_diccionario("Clode me dijo.", &dict), "Claude me dijo.");
        assert_eq!(aplicar_diccionario("con clode", &dict), "con claude");
    }

    /// Sólo palabras enteras: un término dentro de otra palabra no se toca.
    #[test]
    fn no_se_mete_dentro_de_otra_palabra() {
        let dict = vec![("mac".to_string(), Some("Mac".to_string()))];
        assert_eq!(aplicar_diccionario("una macarena", &dict), "una macarena");
    }

    /// Las entradas sin reemplazo son «palabras protegidas», no sustituciones.
    #[test]
    fn una_entrada_sin_reemplazo_no_cambia_nada() {
        let dict = vec![("Brío".to_string(), None)];
        assert_eq!(aplicar_diccionario("somos Brío", &dict), "somos Brío");
    }

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
        let crudo = "me gusta wispr y wispr flow con tauri";
        let pulido = "Me gusta Wispr y Wispr Flow con Tauri.";
        let c = corrections(crudo, pulido, &ctx);
        assert_eq!(c.len(), 2);
        assert_eq!(c[0].term, "wispr");
        assert_eq!(c[0].count, 2);
        assert_eq!(c[0].aplicadas, 2, "las dos llegaron al texto final");
        assert_eq!(c[1].replacement, "Tauri");
    }

    #[test]
    fn la_correccion_que_el_modelo_ignoro_se_ve() {
        // El caso real de mike.db (dictado 654): el diccionario pedía cambiar
        // "cloud code" por "Claude code", el historial lo daba por hecho, y el
        // texto que recibió el usuario seguía diciendo "Cloud Code". Pasa porque
        // con los modos de IA el diccionario es sólo una sugerencia del prompt.
        let ctx = PolishCtx {
            language: "es".into(),
            dictionary: vec![("cloud code".into(), Some("Claude code".into()))],
        };
        let c = corrections(
            "¿desde dónde debería iniciar cloud code?",
            "¿Desde dónde debería iniciar Cloud Code?",
            &ctx,
        );
        assert_eq!(c.len(), 1, "la corrección hacía falta");
        assert_eq!(c[0].count, 1);
        assert_eq!(c[0].aplicadas, 0, "el modelo la ignoró, y hay que decirlo");
    }

    #[test]
    fn ya_correcto_no_cuenta() {
        let ctx = PolishCtx {
            language: "es".into(),
            dictionary: vec![("wispr".into(), Some("Wispr".into()))],
        };
        assert!(corrections("uso Wispr a diario", "Uso Wispr a diario.", &ctx).is_empty());
    }
}
