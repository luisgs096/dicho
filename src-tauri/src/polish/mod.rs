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
/// # Una sola pasada, y el reemplazo ya escrito no se toca
///
/// Todos los términos van en **un solo patrón**, del más largo al más corto: en
/// cada sitio gana el término más largo («cloud code» antes que «cloud»), y lo
/// que escribe un reemplazo no lo vuelve a leer nadie. Con una pasada por
/// término, «node → Node.js» seguido de «js → JavaScript» daba
/// «Node.JavaScript».
///
/// Y el reemplazo **ya escrito** también está en el patrón, para dejarlo como
/// está. Sin eso, un reemplazo que contiene a su término se aplicaba otra vez
/// encima: «Tailwind CSS» salía «Tailwind CSS CSS» cada vez que el modelo ya lo
/// había escrito bien — y el prompt le pide justo eso — o cuando el escribano
/// corregía un texto que ya lo traía.
///
/// Si lo que había empezaba en mayúscula y el reemplazo va todo en minúsculas,
/// se le respeta la mayúscula: «Clode» al principio de una frase se vuelve
/// «Claude», no «claude».
pub fn aplicar_diccionario(texto: &str, dict: &[(String, Option<String>)]) -> String {
    let Some(dic) = Diccionario::nuevo(dict) else {
        return texto.to_string();
    };
    dic.re
        .replace_all(texto, |c: &regex::Captures| match dic.pieza(&c[0]) {
            Some(Pieza::Termino(i)) => respeta_mayuscula(&c[0], &dic.pares[i].1),
            // Ya estaba escrito como lo quiere el usuario, o no se reconoce:
            // se deja como está.
            _ => c[0].to_string(),
        })
        .into_owned()
}

/// Qué es cada cosa que el patrón puede encontrar.
#[derive(Clone, Copy)]
enum Pieza {
    /// El término de la entrada `i`: se cambia por su reemplazo.
    Termino(usize),
    /// Un reemplazo, ya escrito: se deja en paz.
    Hecho,
}

/// El diccionario compilado en un solo patrón.
struct Diccionario {
    re: Regex,
    /// Clave de lo encontrado → qué es.
    piezas: std::collections::HashMap<String, Pieza>,
    /// (término, reemplazo), recortados y sin entradas vacías.
    pares: Vec<(String, String)>,
}

impl Diccionario {
    fn nuevo(dict: &[(String, Option<String>)]) -> Option<Self> {
        let pares: Vec<(String, String)> = dict
            .iter()
            .filter_map(|(t, r)| Some((t.trim(), r.as_deref()?.trim())))
            .filter(|(t, r)| !t.is_empty() && !r.is_empty())
            .map(|(t, r)| (t.to_string(), r.to_string()))
            .collect();
        let mut piezas = std::collections::HashMap::new();
        let mut formas: Vec<&str> = Vec::new();
        // Primero los reemplazos y luego los términos: si una palabra es a la
        // vez reemplazo de una entrada y término de otra, manda el término.
        for (_, r) in &pares {
            if piezas.insert(clave(r), Pieza::Hecho).is_none() {
                formas.push(r);
            }
        }
        for (i, (t, _)) in pares.iter().enumerate() {
            match piezas.get(&clave(t)) {
                // El mismo término dos veces con otra caja («Cloud» y «cloud»):
                // gana el primero, como antes.
                Some(Pieza::Termino(_)) => {}
                Some(Pieza::Hecho) => {
                    piezas.insert(clave(t), Pieza::Termino(i));
                }
                None => {
                    piezas.insert(clave(t), Pieza::Termino(i));
                    formas.push(t);
                }
            }
        }
        if formas.is_empty() {
            return None;
        }
        formas.sort_by_key(|f| std::cmp::Reverse(f.chars().count()));
        let alternativas: Vec<String> = formas.iter().map(|f| patron(f)).collect();
        // Un solo patrón: si no compila (un diccionario enorme puede pasarse del
        // tope del motor), no se aplica nada — y eso tiene que quedar escrito.
        let re = match Regex::new(&format!("(?i)(?:{})", alternativas.join("|"))) {
            Ok(re) => re,
            Err(e) => {
                log::warn!("Diccionario: el patrón no compila ({e}); no se aplica");
                return None;
            }
        };
        Some(Self { re, piezas, pares })
    }

    fn pieza(&self, encontrado: &str) -> Option<Pieza> {
        self.piezas.get(&clave(encontrado)).copied()
    }
}

/// Cómo se reconoce un término venga como venga escrito: en minúsculas y con
/// los espacios de dentro colapsados.
fn clave(s: &str) -> String {
    s.split_whitespace().collect::<Vec<_>>().join(" ").to_lowercase()
}

/// El patrón de un término: literal, palabra entera, y cualquier espacio entre
/// sus palabras (dos espacios tecleados en la casilla, o un salto de línea del
/// Editor en medio, no pueden hacer que deje de casar).
///
/// El borde de palabra se pone **sólo donde el término empieza o acaba en letra
/// o número**. `\b` es la frontera entre una letra y lo que no lo es: detrás
/// de «c++» o delante de «(algo)» exigía una letra pegada al signo, y esos
/// términos no casaban nunca.
fn patron(t: &str) -> String {
    let letra = |c: Option<char>| c.is_some_and(|c| c.is_alphanumeric() || c == '_');
    let cuerpo = t
        .split_whitespace()
        .map(regex::escape)
        .collect::<Vec<_>>()
        .join(r"\s+");
    format!(
        "{}{cuerpo}{}",
        if letra(t.chars().next()) { r"\b" } else { "" },
        if letra(t.chars().last()) { r"\b" } else { "" },
    )
}

/// Si lo encontrado empezaba en mayúscula y el reemplazo va **todo** en
/// minúsculas, se la pone.
///
/// Todo, y no sólo la primera letra: si el reemplazo trae alguna mayúscula
/// —«iPhone», «macOS», «eBay»— es la grafía que eligió el usuario, y subirle
/// la primera letra la rompía («IPhone») cada vez que el término caía al
/// principio de una frase.
pub(crate) fn respeta_mayuscula(encontrado: &str, bueno: &str) -> String {
    let empieza_alto = encontrado
        .chars()
        .next()
        .is_some_and(|c| c.is_uppercase());
    let todo_bajo = !bueno.chars().any(|c| c.is_uppercase());
    if !(empieza_alto && todo_bajo) {
        return bueno.to_string();
    }
    let mut cs = bueno.chars();
    match cs.next() {
        Some(c) => c.to_uppercase().collect::<String>() + cs.as_str(),
        None => bueno.to_string(),
    }
}

/// Qué correcciones del diccionario pedía el dictado, y cuáles están de verdad
/// en el texto final.
///
/// `count` se cuenta sobre el crudo con **la misma pasada** que corrige: un
/// «cloud code» cuenta para «cloud code» y no también para «cloud». Con una
/// búsqueda por término, el diccionario real del usuario («Cloud» y «cloud
/// code») enseñaba dos chips por cada «cloud code» dictado.
///
/// `aplicadas` busca el reemplazo como palabra entera y **sin distinguir
/// mayúsculas**. Distinguirlas tenía sentido cuando el diccionario era una
/// sugerencia y el término podía sobrevivir con otra caja; desde que se aplica
/// después de pulir, el término ya no sobrevive nunca, y distinguirlas sólo
/// daba por no aplicado lo que `respeta_mayuscula` subió al principio de
/// frase: la tarjeta decía «la ignoró» de algo que sí se corrigió. Y sin borde
/// de palabra, un «Git» contaba dentro de «GitHub».
///
/// Por lo mismo, `aplicadas == 0` ya no significa que el modelo lo ignorara:
/// significa que el término **ya no estaba** cuando el diccionario pasó — el
/// modelo lo reescribió, lo quitó o lo tradujo.
pub fn corrections(raw: &str, polished: &str, ctx: &PolishCtx) -> Vec<Correction> {
    let Some(dic) = Diccionario::nuevo(&ctx.dictionary) else {
        return Vec::new();
    };
    let mut count = vec![0u32; dic.pares.len()];
    for m in dic.re.find_iter(raw) {
        if let Some(Pieza::Termino(i)) = dic.pieza(m.as_str()) {
            if m.as_str() != dic.pares[i].1 {
                count[i] += 1;
            }
        }
    }
    let mut out = Vec::new();
    for (i, (term, to)) in dic.pares.iter().enumerate() {
        if count[i] == 0 {
            continue;
        }
        let aplicadas = Regex::new(&format!("(?i){}", patron(to)))
            .map(|r| r.find_iter(polished).count() as u32)
            .unwrap_or(0);
        out.push(Correction {
            term: term.clone(),
            replacement: to.clone(),
            count: count[i],
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
        // El caso real de mike.db (dictado 654, antes de la 0.12): el
        // diccionario pedía cambiar "cloud code" por "Claude code", el
        // historial lo daba por hecho, y el texto que recibió el usuario seguía
        // diciendo "Cloud Code". Hoy el diccionario corre después de pulir y
        // ese texto ya no llega así; `corrections` se prueba aquí sola, con un
        // final en el que el reemplazo no está.
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
