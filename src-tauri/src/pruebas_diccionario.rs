//! Pruebas del diccionario de punta a punta.
//!
//! Cada camino por el que pasa un dictado hasta que el diccionario lo toca, y
//! cada forma rara que puede tener un término. Lo que depende de la red (Groq)
//! o de Windows se cubre llamando a la función pura que hace el trabajo: el
//! texto que devolvería el modelo se escribe a mano, y el resto del camino es
//! el mismo código que corre en `pipeline.rs`.
//!
//! Nacieron en la auditoría del 24/09/2026, escritas con lo que **debería**
//! pasar: 29 de 42 fallaban entonces («Tailwind CSS CSS», «$PATH» que
//! desaparecía, «IPhone», chips de más, una sincronización que resucitaba lo
//! borrado). Ahora son la red que impide que vuelva.
//!
//! Ojo con `procesar` y `escribano`: son **espejos** de `pipeline.rs`. Si allí
//! cambia el orden de pulir, aplicar el diccionario y contar los chips, hay que
//! cambiarlo también aquí, o estas pruebas seguirán en verde mintiendo.

use crate::polish::*;
use crate::store::{DictadoRemoto, Store, TerminoRemoto};

/// Lo que baja de un respaldo sin horas (anterior al arreglo): `updated_ms` 0.
fn sin_horas(dict: &Dict) -> Vec<TerminoRemoto> {
    dict.iter()
        .map(|(t, r)| TerminoRemoto {
            term: t.clone(),
            replacement: r.clone(),
            updated_ms: 0,
        })
        .collect()
}

type Dict = Vec<(String, Option<String>)>;

fn d(pares: &[(&str, Option<&str>)]) -> Dict {
    pares
        .iter()
        .map(|(t, r)| (t.to_string(), r.map(str::to_string)))
        .collect()
}

fn ctx(dict: &Dict) -> PolishCtx {
    PolishCtx {
        language: "es".into(),
        dictionary: dict.clone(),
    }
}

/// Espejo de `procesar` (pipeline.rs:907-951): el pulido y, después, el
/// diccionario y los chips. `modelo` es lo que devolvió `groq::polish` (red);
/// `None` es Tal cual (`rules::polish`), que es también donde caen el Editor y
/// el Estándar cuando fallan.
fn procesar(raw: &str, modelo: Option<&str>, dict: &Dict) -> (String, Vec<Correction>) {
    let ctx = ctx(dict);
    let pulido = match modelo {
        None => rules::polish(raw, &ctx),
        Some(m) => m.to_string(),
    };
    let pulido = aplicar_diccionario(&pulido, &ctx.dictionary);
    let corr = corrections(raw, &pulido, &ctx);
    (pulido, corr)
}

/// Espejo de `corregir_seleccion` (pipeline.rs:360-363): el escribano.
fn escribano(modelo: &str, dict: &Dict) -> String {
    aplicar_diccionario(modelo, dict)
}

/// Espejo de `EnVivo::esperar` (pipeline.rs:672-681) y de
/// `parakeet_por_trozos`: cada trozo recortado, unidos con un espacio.
fn unir_trozos(trozos: &[&str]) -> String {
    trozos
        .iter()
        .map(|s| s.trim())
        .filter(|s| !s.is_empty())
        .collect::<Vec<_>>()
        .join(" ")
}

fn base(nombre: &str) -> Store {
    // Un contador: los tests corren en paralelo y `dicc_real()` se pide desde
    // varios a la vez; con la misma carpeta uno borraría la base del otro.
    static N: std::sync::atomic::AtomicUsize = std::sync::atomic::AtomicUsize::new(0);
    let n = N.fetch_add(1, std::sync::atomic::Ordering::SeqCst);
    let carpeta = std::env::temp_dir().join(format!(
        "mike-pruebas-dicc-{nombre}-{}-{n}",
        std::process::id()
    ));
    let _ = std::fs::remove_dir_all(&carpeta);
    Store::init_en(&carpeta).unwrap()
}

/// El diccionario real de luisg que sale en los tests del 17/09, en el orden
/// en que lo devuelve `dict_pairs` (ORDER BY term, binario: mayúsculas antes).
fn dicc_real() -> Dict {
    let s = base("real");
    s.dict_add("cloud code", Some("Claude code")).unwrap();
    s.dict_add("Cloud", Some("Claude")).unwrap();
    s.dict_add("Jimmy Knight", Some("Gemini")).unwrap();
    s.dict_pairs()
}

// ─── Caminos ────────────────────────────────────────────────────────────────

#[test]
fn camino_tal_cual_motor_local() {
    let (fin, _) = procesar(
        "le pedí a jimmy knight que revise cloud code",
        None,
        &dicc_real(),
    );
    assert_eq!(fin, "Le pedí a Gemini que revise Claude code");
}

#[test]
fn camino_estandar_con_groq() {
    let (fin, _) = procesar(
        "desde dónde debería iniciar cloud code",
        Some("¿Desde dónde debería iniciar Cloud Code?"),
        &dicc_real(),
    );
    assert_eq!(fin, "¿Desde dónde debería iniciar Claude code?");
}

#[test]
fn camino_editor_con_groq() {
    let (fin, _) = procesar(
        "o sea que jimmy knight haga las imágenes y cloud el código",
        Some("Que Jimmy Knight haga las imágenes y Cloud, el código."),
        &dicc_real(),
    );
    assert_eq!(fin, "Que Gemini haga las imágenes y Claude, el código.");
}

#[test]
fn camino_dictado_largo_troceado() {
    // Los dos términos de varias palabras quedan partidos entre trozos: el
    // diccionario corre sobre el texto ya unido, así que tiene que verlos.
    let raw = unir_trozos(&[
        " primero abre el cloud ",
        "code y luego que jimmy",
        "knight haga las imágenes ",
    ]);
    let (fin, _) = procesar(&raw, None, &dicc_real());
    assert_eq!(
        fin,
        "Primero abre el Claude code y luego que Gemini haga las imágenes"
    );
    let (fin, _) = procesar(
        &raw,
        Some("Primero abre el Cloud Code y luego que Jimmy Knight haga las imágenes."),
        &dicc_real(),
    );
    assert_eq!(
        fin,
        "Primero abre el Claude code y luego que Gemini haga las imágenes."
    );
}

#[test]
fn camino_escribano() {
    assert_eq!(
        escribano("Pásaselo a Jimmy Knight y a Cloud Code.", &dicc_real()),
        "Pásaselo a Gemini y a Claude code."
    );
}

// ─── Mayúsculas ─────────────────────────────────────────────────────────────

#[test]
fn todo_en_mayusculas_tambien_se_corrige() {
    let dict = d(&[("cloud code", Some("Claude code"))]);
    let fin = aplicar_diccionario("ABRE CLOUD CODE YA", &dict);
    assert!(!fin.contains("CLOUD"), "{fin}");
    assert!(fin.to_lowercase().contains("claude code"), "{fin}");
}

/// Marcas con mayúscula interna: el usuario las escribió así a propósito.
#[test]
fn la_grafia_del_usuario_con_mayuscula_interna_no_se_toca() {
    let dict = d(&[
        ("mac os", Some("macOS")),
        ("ai phone", Some("iPhone")),
        ("i bey", Some("eBay")),
    ]);
    // Lo que devuelve el modelo: capitaliza al empezar frase, o porque cree
    // que es nombre propio.
    let fin = escribano("Mac OS va bien. Ai phone también. Lo vendo en I bey.", &dict);
    assert_eq!(fin, "macOS va bien. iPhone también. Lo vendo en eBay.");
}

#[test]
fn tal_cual_con_marca_en_minuscula_al_principio() {
    let dict = d(&[("iphone", Some("iPhone"))]);
    let (fin, _) = procesar("iphone es caro", None, &dict);
    assert_eq!(fin, "iPhone es caro");
}

// ─── Tildes, eñe y bordes de palabra Unicode ────────────────────────────────

#[test]
fn tildes_y_enie() {
    let dict = d(&[
        ("camara", Some("cámara")),
        ("anio", Some("año")),
        ("ñandú", Some("Ñandú")),
    ]);
    assert_eq!(
        aplicar_diccionario("la camara del anio y el ÑANDÚ", &dict),
        "la cámara del año y el Ñandú"
    );
}

#[test]
fn borde_de_palabra_unicode() {
    let dict = d(&[("camara", Some("cámara")), ("mara", Some("MARA"))]);
    // Ni dentro de un plural ni pegado a una letra acentuada: con un \b de sólo
    // ASCII, «á» sería un borde y «mara» casaría dentro de «cámara».
    assert_eq!(aplicar_diccionario("las camaras", &dict), "las camaras");
    assert_eq!(aplicar_diccionario("la cámara", &dict), "la cámara");
    // Y sí pegado a signos.
    assert_eq!(
        aplicar_diccionario("camara, ¿camara? (camara) «camara» —camara.", &dict),
        "cámara, ¿cámara? (cámara) «cámara» —cámara."
    );
}

// ─── Forma del término ──────────────────────────────────────────────────────

#[test]
fn termino_de_varias_palabras() {
    let dict = d(&[("jimmy knight", Some("Gemini"))]);
    assert_eq!(
        aplicar_diccionario("que Jimmy Knight lo haga", &dict),
        "que Gemini lo haga"
    );
}

#[test]
fn espacios_internos_del_termino() {
    // Tecleado con dos espacios en la casilla: `dict_add` sólo recorta los
    // extremos, así que se guarda tal cual.
    let dict = d(&[("cloud  code", Some("Claude code"))]);
    assert_eq!(
        aplicar_diccionario("abre cloud code", &dict),
        "abre Claude code"
    );
    // Y un salto de línea del Editor entre las dos palabras.
    let dict = d(&[("cloud code", Some("Claude code"))]);
    assert_eq!(
        aplicar_diccionario("abre cloud\ncode", &dict),
        "abre Claude code"
    );
}

#[test]
fn caracteres_especiales_node_js() {
    let dict = d(&[("node.js", Some("Node.js"))]);
    assert_eq!(aplicar_diccionario("uso node.js hoy", &dict), "uso Node.js hoy");
    // El punto va escapado: no es «cualquier carácter».
    assert_eq!(aplicar_diccionario("uso nodexjs hoy", &dict), "uso nodexjs hoy");
}

#[test]
fn caracteres_especiales_c_mas_mas() {
    let dict = d(&[("c++", Some("C++"))]);
    assert_eq!(aplicar_diccionario("uso c++ a diario", &dict), "uso C++ a diario");
}

#[test]
fn caracteres_especiales_c_sharp_y_net() {
    let dict = d(&[("c#", Some("C#")), (".net", Some(".NET"))]);
    assert_eq!(
        aplicar_diccionario("programo en c# con .net", &dict),
        "programo en C# con .NET"
    );
}

#[test]
fn caracteres_especiales_parentesis() {
    let dict = d(&[("(algo)", Some("(ALGO)"))]);
    assert_eq!(aplicar_diccionario("dice (algo) aquí", &dict), "dice (ALGO) aquí");
}

// ─── Solapes y dobles aplicaciones ──────────────────────────────────────────

#[test]
fn solapados_el_mas_largo_primero_con_ia() {
    let dict = d(&[
        ("cloud", Some("Claude")),
        ("cloud code", Some("Claude Code")),
    ]);
    let (fin, _) = procesar("abre cloud code", Some("Abre cloud code."), &dict);
    assert_eq!(fin, "Abre Claude Code.");
}

/// Tal cual, con el orden real de `dict_pairs` (alfabético): «cloud» va antes
/// que «cloud code».
#[test]
fn solapados_el_mas_largo_primero_en_tal_cual() {
    let s = base("solape-reglas");
    s.dict_add("cloud code", Some("Claude Code")).unwrap();
    s.dict_add("cloud", Some("Claude")).unwrap();
    let (fin, _) = procesar("abre cloud code", None, &s.dict_pairs());
    assert_eq!(fin, "Abre Claude Code");
}

#[test]
fn reemplazo_que_contiene_al_termino_con_ia() {
    let dict = d(&[("tailwind", Some("Tailwind CSS"))]);
    // El prompt le pide al modelo «respeta esta ortografía exacta: Tailwind
    // CSS», así que es normal que ya lo devuelva escrito.
    let (fin, _) = procesar(
        "uso tailwind en el front",
        Some("Uso Tailwind CSS en el front."),
        &dict,
    );
    assert_eq!(fin, "Uso Tailwind CSS en el front.");
}

#[test]
fn reemplazo_que_contiene_al_termino_en_tal_cual() {
    let dict = d(&[("tailwind", Some("Tailwind CSS"))]);
    let (fin, _) = procesar("uso tailwind en el front", None, &dict);
    assert_eq!(fin, "Uso Tailwind CSS en el front");
}

#[test]
fn reemplazo_que_contiene_al_termino_en_el_escribano() {
    // El escribano corrige texto que el usuario ya escribió: es donde más fácil
    // es que el reemplazo ya esté puesto.
    let dict = d(&[("node", Some("Node.js"))]);
    assert_eq!(
        escribano("El backend va en Node.js.", &dict),
        "El backend va en Node.js."
    );
}

#[test]
fn aplicar_dos_veces_es_lo_mismo_que_una() {
    let dict = d(&[
        ("tailwind", Some("Tailwind CSS")),
        ("node", Some("Node.js")),
        ("claude", Some("Claude Code")),
    ]);
    let una = aplicar_diccionario("uso tailwind, node y claude", &dict);
    let dos = aplicar_diccionario(&una, &dict);
    assert_eq!(una, dos);
}

#[test]
fn un_reemplazo_no_lo_reescribe_otro_termino() {
    let dict = d(&[("node", Some("Node.js")), ("js", Some("JavaScript"))]);
    assert_eq!(aplicar_diccionario("uso node", &dict), "uso Node.js");
}

/// En Tal cual el diccionario se aplica dos veces (rules.rs:48-55 y otra vez
/// en pipeline.rs:950) y la primera usa `replace_all` con un `&str`, que
/// interpreta `$` como grupo de captura.
#[test]
fn un_dolar_en_el_reemplazo_se_escribe_tal_cual() {
    let dict = d(&[
        ("variable path", Some("$PATH")),
        ("asap rocky", Some("A$AP Rocky")),
    ]);
    let (fin, _) = procesar("añade la variable path y pon asap rocky", None, &dict);
    assert_eq!(fin, "Añade la $PATH y pon A$AP Rocky");
}

// ─── Entradas raras ─────────────────────────────────────────────────────────

#[test]
fn termino_con_espacios_de_mas() {
    // No entra por la interfaz (`dict_add` recorta), pero sí por la fusión de
    // sincronización, que no recorta nada.
    let dict = d(&[(" cloud ", Some("Claude"))]);
    assert_eq!(aplicar_diccionario("abre cloud code", &dict), "abre Claude code");
}

#[test]
fn termino_vacio_en_tal_cual() {
    let dict = d(&[("", Some("X"))]);
    let (fin, _) = procesar("hola mundo", None, &dict);
    assert_eq!(fin, "Hola mundo");
}

#[test]
fn termino_o_reemplazo_vacio_no_da_chips() {
    let dict = d(&[("", Some("X")), ("hola", Some(""))]);
    let c = corrections("hola mundo", "Hola mundo.", &ctx(&dict));
    assert!(c.is_empty(), "{c:?}");
}

#[test]
fn la_fusion_no_mete_terminos_sin_recortar() {
    let s = base("merge-espacios");
    s.merge_dict(&sin_horas(&d(&[(" cloud ", Some(" Claude "))]))).unwrap();
    let pares = s.dict_pairs();
    assert_eq!(pares, d(&[("cloud", Some("Claude"))]));
}

#[test]
fn mismo_termino_con_dos_reemplazos() {
    // El usuario añadió «Cloud → Claude» y más tarde «cloud → Claude Code».
    // Para el diccionario son el mismo término (casa sin distinguir
    // mayúsculas), pero la tabla los guarda como dos.
    let s = base("dos-reemplazos");
    s.dict_add("Cloud", Some("Claude")).unwrap();
    s.dict_add("cloud", Some("Claude Code")).unwrap();
    let pares = s.dict_pairs();
    assert_eq!(pares.len(), 1, "dos filas para el mismo término: {pares:?}");
    // Y gana la última que escribió.
    assert_eq!(
        aplicar_diccionario("abre cloud", &pares),
        "abre Claude Code"
    );
}

// ─── Chips del historial ────────────────────────────────────────────────────

/// Con el diccionario real: un solo «cloud code» corregido.
#[test]
fn chips_un_solape_es_una_correccion() {
    let (fin, c) = procesar(
        "desde dónde debería iniciar cloud code",
        Some("¿Desde dónde debería iniciar Cloud Code?"),
        &dicc_real(),
    );
    assert_eq!(fin, "¿Desde dónde debería iniciar Claude code?");
    let resumen: Vec<_> = c
        .iter()
        .map(|c| format!("{}→{} ×{} (aplicadas {})", c.term, c.replacement, c.count, c.aplicadas))
        .collect();
    assert_eq!(c.len(), 1, "{resumen:?}");
}

/// La tarjeta enseña «la ignoró» cuando `aplicadas == 0`. Aquí el diccionario
/// sí lo aplicó — sólo que la primera letra salió en mayúscula.
#[test]
fn chips_la_mayuscula_no_es_ignorarla_en_tal_cual() {
    let dict = d(&[("clode", Some("claude"))]);
    let (fin, c) = procesar("clode me dijo que sí", None, &dict);
    assert_eq!(fin, "Claude me dijo que sí");
    assert_eq!(c.len(), 1);
    assert!(c[0].aplicadas >= 1, "{c:?}");
}

#[test]
fn chips_la_mayuscula_no_es_ignorarla_con_ia() {
    let dict = d(&[("clode", Some("claude"))]);
    let (fin, c) = procesar(
        "bueno clode me dijo que sí",
        Some("Clode me dijo que sí."),
        &dict,
    );
    assert_eq!(fin, "Claude me dijo que sí.");
    assert!(c[0].aplicadas >= 1, "{c:?}");
}

#[test]
fn chips_cuentan_palabras_enteras() {
    // El modelo convirtió «guit» en «GitHub»: el diccionario no llegó a actuar
    // y en el texto final no hay ni un «Git» suelto.
    let dict = d(&[("guit", Some("Git"))]);
    let (fin, c) = procesar("súbelo a guit", Some("Súbelo a GitHub."), &dict);
    assert_eq!(fin, "Súbelo a GitHub.");
    assert_eq!(c[0].aplicadas, 0, "{c:?}");
}

// ─── Sincronización ─────────────────────────────────────────────────────────

fn remoto_de(s: &Store) -> Vec<TerminoRemoto> {
    // Lo que sube `export_local` y baja el otro equipo.
    s.dict_export().unwrap()
}

#[test]
fn sync_no_duplica_terminos_iguales() {
    let s = base("sync-iguales");
    s.dict_add("cloud", Some("Claude")).unwrap();
    s.merge_dict(&sin_horas(&d(&[("cloud", Some("Claude"))]))).unwrap();
    assert_eq!(s.dict_pairs().len(), 1);
}

#[test]
fn sync_no_duplica_variantes_de_mayuscula() {
    let s = base("sync-mayus");
    s.dict_add("cloud", Some("Claude")).unwrap();
    // El otro equipo lo tecleó con mayúscula.
    s.merge_dict(&sin_horas(&d(&[("Cloud", Some("Claude"))]))).unwrap();
    assert_eq!(s.dict_pairs().len(), 1, "{:?}", s.dict_pairs());
}

#[test]
fn sync_no_resucita_un_termino_borrado() {
    let s = base("sync-borrado");
    s.dict_add("cloud", Some("Claude")).unwrap();
    let remoto = remoto_de(&s); // subido en una sincronización anterior
    let id = s.dict_list().unwrap()[0].id;
    s.dict_remove(id).unwrap(); // el usuario lo borra
    s.aplicar_borrados(&[]).unwrap(); // el remoto no trae lápidas
    s.merge_dict(&remoto).unwrap(); // siguiente sincronización
    assert!(s.dict_pairs().is_empty(), "volvió: {:?}", s.dict_pairs());
}

#[test]
fn sync_no_pierde_una_edicion() {
    // Equipo B tiene la versión vieja; equipo A la editó después y subió.
    let b = base("sync-edicion-b");
    b.dict_add("cloud", Some("Claude")).unwrap();
    let a = base("sync-edicion-a");
    a.dict_add("cloud", Some("Claude")).unwrap();
    std::thread::sleep(std::time::Duration::from_millis(5));
    a.dict_add("cloud", Some("Claude Code")).unwrap(); // la edición
    b.merge_dict(&remoto_de(&a)).unwrap();
    assert_eq!(
        b.dict_pairs(),
        d(&[("cloud", Some("Claude Code"))]),
        "la edición no llegó al otro equipo"
    );
}

#[test]
fn sync_no_resucita_un_dictado_borrado() {
    let s = base("sync-hist-borrado");
    let fila = || DictadoRemoto {
        ts: 1_700_000_000_000,
        raw: "algo que dije".into(),
        polished: "Algo que dije.".into(),
        engine: "groq".into(),
        duration_ms: 1000,
        corrections_json: None,
        polish_mode: Some("estandar".into()),
        stt_ms: Some(300),
        polish_ms: Some(700),
    };
    s.merge_history(&[fila()]).unwrap();
    let id = s.list_history(None, 10).unwrap()[0].id;
    s.delete_history(id).unwrap();
    s.merge_history(&[fila()]).unwrap(); // el archivo remoto aún lo tiene
    assert!(
        s.list_history(None, 10).unwrap().is_empty(),
        "el dictado borrado volvió"
    );
}

/// El borrado viaja: lo que se borra en un equipo desaparece del otro.
#[test]
fn sync_un_borrado_llega_al_otro_equipo() {
    let a = base("sync-viaja-a");
    let b = base("sync-viaja-b");
    b.dict_add("cloud", Some("Claude")).unwrap();
    a.merge_dict(&remoto_de(&b)).unwrap();
    std::thread::sleep(std::time::Duration::from_millis(5));
    let id = a.dict_list().unwrap()[0].id;
    a.dict_remove(id).unwrap();
    b.aplicar_borrados(&a.borrados().unwrap()).unwrap();
    b.merge_dict(&remoto_de(&a)).unwrap();
    assert!(b.dict_pairs().is_empty(), "{:?}", b.dict_pairs());
}

/// Y un respaldo de antes del arreglo, sin horas ni lápidas, entra igual.
#[test]
fn sync_un_respaldo_sin_horas_se_lee() {
    let t: TerminoRemoto =
        serde_json::from_str(r#"{"term":"cloud","replacement":"Claude"}"#).unwrap();
    assert_eq!(t.updated_ms, 0);
}

/// Una palabra protegida (término sin reemplazo) sólo viaja como pista: al
/// prompt de Whisper (con «no traducir») y al del modelo. En Tal cual con el
/// motor local —lo que trae la app al instalarla— no hay ni lo uno ni lo otro,
/// así que no hace nada. Documenta el comportamiento; el hallazgo es el texto
/// de la interfaz, que promete otra cosa.
#[test]
fn una_palabra_protegida_no_hace_nada_en_tal_cual() {
    let dict = d(&[("Wispr", None)]);
    let (fin, c) = procesar("me gusta wispr flow", None, &dict);
    assert_eq!(fin, "Me gusta wispr flow");
    assert!(c.is_empty());
}

/// Coste por dictado: el pulido viejo (una regex por término, tres veces:
/// reglas, aplicar y chips) contra el nuevo (un patrón). `-- --ignored`.
#[test]
#[ignore]
fn banco_coste_por_dictado() {
    fn viejo_aplicar(texto: &str, dict: &Dict) -> String {
        let mut pares: Vec<(&str, &str)> = dict
            .iter()
            .filter_map(|(t, r)| r.as_deref().map(|r| (t.as_str(), r)))
            .collect();
        pares.sort_by_key(|(t, _)| std::cmp::Reverse(t.chars().count()));
        let mut out = texto.to_string();
        for (term, bueno) in pares {
            let re = regex::Regex::new(&format!(r"(?i)\b{}\b", regex::escape(term))).unwrap();
            out = re.replace_all(&out, bueno).into_owned();
        }
        out
    }
    let texto = "le dije a cloud code que revise el deploy con jimmy knight y luego ".repeat(120);
    for n in [10usize, 50, 200] {
        let mut dict: Dict = (0..n)
            .map(|i| (format!("terminillo{i}"), Some(format!("Terminillo{i}"))))
            .collect();
        dict.extend(dicc_real());
        let ctx = ctx(&dict);
        let t = std::time::Instant::now();
        for _ in 0..20 {
            let a = viejo_aplicar(&texto, &dict); // rules::polish paso 2
            let b = viejo_aplicar(&a, &dict); // aplicar_diccionario
            std::hint::black_box(viejo_aplicar(&b, &dict)); // corrections (compila otra vez N)
        }
        let viejo = t.elapsed() / 20;
        let t = std::time::Instant::now();
        for _ in 0..20 {
            let a = aplicar_diccionario(&texto, &dict);
            std::hint::black_box(corrections(&texto, &a, &ctx));
        }
        let nuevo = t.elapsed() / 20;
        eprintln!("{} palabras, {n} términos: viejo {viejo:?}, nuevo {nuevo:?}", texto.split_whitespace().count());
    }
}

/// Un dictado borrado se borra también en el otro equipo, y la lápida que viaja
/// a Drive no lleva el texto: lleva su huella.
#[test]
fn sync_un_dictado_borrado_viaja_sin_su_texto() {
    let a = base("sync-hist-a");
    let b = base("sync-hist-b");
    let fila = || DictadoRemoto {
        ts: 1_700_000_000_123,
        raw: "la clave del wifi es hunter2".into(),
        polished: "La clave del wifi es hunter2.".into(),
        engine: "groq".into(),
        duration_ms: 1000,
        corrections_json: None,
        polish_mode: None,
        stt_ms: None,
        polish_ms: None,
    };
    a.merge_history(&[fila()]).unwrap();
    b.merge_history(&[fila()]).unwrap();
    let id = a.list_history(None, 10).unwrap()[0].id;
    a.delete_history(id).unwrap();
    let lapidas = a.borrados().unwrap();
    assert_eq!(lapidas.len(), 1);
    assert!(!lapidas[0].clave.contains("hunter2"), "{:?}", lapidas);
    b.aplicar_borrados(&lapidas).unwrap();
    assert!(b.list_history(None, 10).unwrap().is_empty());
}
