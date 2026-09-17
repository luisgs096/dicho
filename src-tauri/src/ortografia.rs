//! Qué palabra está mal escrita y cuál es la buena.
//!
//! # La regla que hace esto seguro
//!
//! La tabla de aquí dentro **sólo puede poner tildes**. Nunca cambia una letra
//! por otra, nunca parte una palabra en dos y nunca la sustituye por otra
//! distinta. Hay un test que lo comprueba entrada por entrada: si le quitas los
//! acentos a la corrección, tiene que salir exactamente lo que se tecleó.
//!
//! No es una limitación que se nos haya quedado corta, es el punto. Corregir
//! «qeu» por «que» obliga a adivinar qué quisiste escribir, y adivinar mal
//! mientras escribes es peor que no corregir: te cambia el texto por algo que
//! no dijiste. Poner una tilde, en cambio, no puede equivocarse de palabra —y
//! resulta que en castellano las tildes **son** el problema de ortografía.
//!
//! Para lo demás está el diccionario del propio usuario, que sí admite cambiar
//! una cosa por otra porque lo escribió él sabiendo lo que quería.
//!
//! # Lo que no entra, y por qué
//!
//! Faltan a propósito los monosílabos con tilde diacrítica —tu/tú, el/él,
//! mas/más, si/sí, mi/mí, se/sé, de/dé, te/té— y palabras como «publico»,
//! «practica» o «esta». En todas ellas **las dos formas son correctas** y cuál
//! toca depende de la frase. Sin entender la frase, acertar es imposible, y
//! fallar significa escribirle al usuario una palabra que él no puso.

/// Palabras a las que sólo les falta la tilde.
///
/// Criterio para añadir una: la forma sin tilde **no puede ser también una
/// palabra válida**. Por eso está «tambien» y no está «publico».
///
/// Es más fácil equivocarse de lo que parece, y casi se cuelan seis: «hacia»
/// (preposición), «sabia» y «seria» (adjetivos), «cuando» (sin tilde en una
/// afirmación), y «titulo», «articulo» o «liquido», que son primera persona del
/// presente. En todas ellas la forma sin tilde existe, así que poner la tilde
/// sería cambiarle la palabra al usuario. Ante la duda, fuera: una corrección
/// que no se hace no molesta a nadie.
const TILDES: &[(&str, &str)] = &[
    // Adverbios y conectores, que son los que más se escriben
    ("aqui", "aquí"),
    ("alli", "allí"),
    ("ahi", "ahí"),
    ("asi", "así"),
    ("tambien", "también"),
    ("despues", "después"),
    ("ademas", "además"),
    ("segun", "según"),
    ("quiza", "quizá"),
    ("jamas", "jamás"),
    ("atras", "atrás"),
    ("detras", "detrás"),
    ("demas", "demás"),
    ("adios", "adiós"),
    // Verbos en pasado, el otro gran grupo
    ("habia", "había"),
    ("habian", "habían"),
    ("tenia", "tenía"),
    ("tenian", "tenían"),
    ("podia", "podía"),
    ("podian", "podían"),
    ("queria", "quería"),
    ("querian", "querían"),
    ("decia", "decía"),
    ("veia", "veía"),
    ("serian", "serían"),
    ("estaria", "estaría"),
    ("habria", "habría"),
    ("iria", "iría"),
    // Sustantivos de diario
    ("dia", "día"),
    ("dias", "días"),
    ("mio", "mío"),
    ("mia", "mía"),
    ("jardin", "jardín"),
    ("jovenes", "jóvenes"),
    ("examenes", "exámenes"),
    ("imagenes", "imágenes"),
    ("margenes", "márgenes"),
    ("resumenes", "resúmenes"),
    ("origenes", "orígenes"),
    ("volumenes", "volúmenes"),
    ("caracter", "carácter"),
    ("dificil", "difícil"),
    ("facil", "fácil"),
    ("util", "útil"),
    ("inutil", "inútil"),
    ("debil", "débil"),
    ("movil", "móvil"),
    ("arbol", "árbol"),
    ("azucar", "azúcar"),
    ("lapiz", "lápiz"),
    ("cesped", "césped"),
    ("huesped", "huésped"),
    ("angel", "ángel"),
    ("credito", "crédito"),
    ("debito", "débito"),
    ("telefono", "teléfono"),
    ("numero", "número"),
    ("numeros", "números"),
    ("codigo", "código"),
    ("musica", "música"),
    ("camara", "cámara"),
    // Adjetivos esdrújulos
    ("rapido", "rápido"),
    ("rapida", "rápida"),
    ("ultimo", "último"),
    ("ultima", "última"),
    ("unico", "único"),
    ("unica", "única"),
    ("basico", "básico"),
    ("basica", "básica"),
    ("tipico", "típico"),
    ("logico", "lógico"),
    ("logica", "lógica"),
    ("magico", "mágico"),
    ("tragico", "trágico"),
    ("fisico", "físico"),
    ("quimico", "químico"),
    ("tecnico", "técnico"),
    ("tecnica", "técnica"),
    ("electrico", "eléctrico"),
    ("automatico", "automático"),
    ("automatica", "automática"),
    ("informatica", "informática"),
    ("matematicas", "matemáticas"),
    ("politica", "política"),
    ("economico", "económico"),
    ("economica", "económica"),
    ("proximo", "próximo"),
    ("proxima", "próxima"),
    ("minimo", "mínimo"),
    ("maximo", "máximo"),
    ("optimo", "óptimo"),
    ("comodo", "cómodo"),
    ("solido", "sólido"),
    ("higado", "hígado"),
    ("estomago", "estómago"),
    // Interrogativos: en una pregunta siempre llevan tilde, y sin ella tampoco
    // son palabra suelta válida en este orden. Van los inequívocos nada más.
];

/// Corrige una palabra suelta, o devuelve `None` si no hay nada que corregir.
///
/// Respeta cómo la escribiste: si empieza en mayúscula, la corrección también.
pub fn corrige(palabra: &str) -> Option<String> {
    if palabra.len() < 3 {
        return None;
    }
    // Ya lleva tilde: el usuario sabe lo que hace.
    if palabra.chars().any(|c| "áéíóúÁÉÍÓÚ".contains(c)) {
        return None;
    }
    let baja = palabra.to_lowercase();
    let buena = TILDES
        .iter()
        .find(|(mal, _)| *mal == baja)
        .map(|(_, bien)| (*bien).to_string())
        .or_else(|| por_terminacion(&baja))?;
    if buena == baja {
        return None;
    }
    Some(con_la_misma_caja(palabra, &buena))
}

/// Las terminaciones que en castellano llevan tilde siempre.
///
/// `-ción` y `-sión` son el caso más común de tilde olvidada y no hacen falta
/// en la tabla una por una: la regla las cubre todas, incluidas las que nadie
/// habría pensado en escribir.
///
/// **Sólo cuando la palabra acaba justo ahí.** En plural la tilde desaparece
/// —«informaciones», «decisiones»— así que ponerla sería introducir una falta
/// donde no había ninguna.
fn por_terminacion(baja: &str) -> Option<String> {
    for (fin, bueno) in [("cion", "ción"), ("sion", "sión")] {
        if baja.len() > fin.len() + 2 && baja.ends_with(fin) {
            return Some(format!("{}{bueno}", &baja[..baja.len() - fin.len()]));
        }
    }
    None
}

/// Devuelve la corrección con la misma caja que traía lo tecleado.
fn con_la_misma_caja(original: &str, bueno: &str) -> String {
    let Some(primera) = original.chars().next() else {
        return bueno.to_string();
    };
    if !primera.is_uppercase() {
        return bueno.to_string();
    }
    let mut cs = bueno.chars();
    match cs.next() {
        Some(c) => c.to_uppercase().collect::<String>() + cs.as_str(),
        None => bueno.to_string(),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn sin_tildes(s: &str) -> String {
        s.chars()
            .map(|c| match c {
                'á' => 'a',
                'é' => 'e',
                'í' => 'i',
                'ó' => 'o',
                'ú' => 'u',
                'ü' => 'u',
                otro => otro,
            })
            .collect()
    }

    /// La invariante de la que cuelga toda la seguridad de esta función: la
    /// tabla **sólo pone tildes**. Si alguna entrada cambiara una letra, la
    /// corrección al vuelo podría escribirle al usuario una palabra que no
    /// quiso, y eso es peor que no corregir nada.
    #[test]
    fn la_tabla_solo_pone_tildes() {
        for (mal, bien) in TILDES {
            assert_eq!(
                &sin_tildes(bien),
                mal,
                "«{mal}» → «{bien}» cambia letras, no sólo tildes"
            );
        }
    }

    #[test]
    fn no_hay_entradas_repetidas() {
        let mut vistas = std::collections::HashSet::new();
        for (mal, _) in TILDES {
            assert!(vistas.insert(*mal), "«{mal}» está dos veces en la tabla");
        }
    }

    #[test]
    fn pone_la_tilde_que_falta() {
        assert_eq!(corrige("tambien").as_deref(), Some("también"));
        assert_eq!(corrige("aqui").as_deref(), Some("aquí"));
        assert_eq!(corrige("rapido").as_deref(), Some("rápido"));
    }

    #[test]
    fn la_regla_de_cion_cubre_lo_que_no_esta_en_la_tabla() {
        assert_eq!(corrige("informacion").as_deref(), Some("información"));
        assert_eq!(corrige("cancion").as_deref(), Some("canción"));
        assert_eq!(corrige("decision").as_deref(), Some("decisión"));
    }

    /// En plural la tilde se va. Corregir aquí sería meter una falta.
    #[test]
    fn en_plural_no_toca_nada() {
        assert_eq!(corrige("informaciones"), None);
        assert_eq!(corrige("decisiones"), None);
        assert_eq!(corrige("canciones"), None);
    }

    /// Las dos formas son correctas y cuál toca depende de la frase. Sin
    /// entender la frase no se puede acertar, así que no se toca.
    #[test]
    fn los_monosilabos_y_ambiguos_se_dejan_en_paz() {
        for p in [
            // Monosílabos con tilde diacrítica
            "tu", "el", "mas", "si", "mi", "se", "de", "te",
            // Primera persona del presente, que se confunde con el sustantivo
            "publico", "practica", "titulo", "articulo", "capitulo", "liquido",
            // Adjetivos y preposiciones que existen sin tilde
            "hacia", "sabia", "seria", "esta", "cuando",
        ] {
            assert_eq!(corrige(p), None, "«{p}» no se debería tocar");
        }
    }

    #[test]
    fn respeta_la_mayuscula() {
        assert_eq!(corrige("Tambien").as_deref(), Some("También"));
        assert_eq!(corrige("Informacion").as_deref(), Some("Información"));
    }

    #[test]
    fn si_ya_lleva_tilde_no_se_mete() {
        assert_eq!(corrige("también"), None);
        assert_eq!(corrige("información"), None);
    }
}
