//! Dónde partir el audio para mandarlo a transcribir por trozos.
//!
//! Se corta **en las pausas del hablante**, nunca en seco: un corte a mitad de
//! palabra se nota en la transcripción. Además cada trozo va en su propia
//! petición, y eso hace que el motor vuelva a decidir el idioma en cada uno —
//! que es justo lo que evita que un párrafo en inglés arrastre todo el dictado
//! (Whisper fija un solo idioma por ventana de 30 s).

/// Ventana de análisis: 100 ms a 16 kHz.
const VENTANA: usize = 1_600;
/// Una pausa son 4 ventanas seguidas por debajo del umbral (400 ms).
const VENTANAS_PAUSA: usize = 4;

fn rms(x: &[f32]) -> f32 {
    if x.is_empty() {
        return 0.0;
    }
    (x.iter().map(|s| s * s).sum::<f32>() / x.len() as f32).sqrt()
}

/// Umbral de "pausa" relativo al volumen del propio hablante: la ganancia del
/// micro varía muchísimo entre equipos, un umbral fijo sobra o se queda corto.
fn umbral(pcm: &[f32]) -> f32 {
    let pico = pcm
        .chunks(VENTANA)
        .map(rms)
        .fold(0.0f32, f32::max);
    (pico * 0.12).max(0.0025)
}

/// Punto de corte dentro de `pcm[desde..]`, en muestras absolutas:
/// - con `max` muestras o más acumuladas, corta ahí aunque no haya pausa;
/// - a partir de `min`, corta en la primera pausa que encuentre;
/// - si no llega a `min`, todavía no toca cortar.
pub fn punto_de_corte(pcm: &[f32], desde: usize, min: usize, max: usize) -> Option<usize> {
    let disponible = pcm.len().saturating_sub(desde);
    if disponible >= max {
        return Some(desde + max);
    }
    if disponible < min {
        return None;
    }
    let umbral = umbral(&pcm[desde..]);
    let mut seguidas = 0usize;
    let mut inicio = 0usize;
    let mut i = desde + min;
    while i + VENTANA <= pcm.len() {
        if rms(&pcm[i..i + VENTANA]) < umbral {
            if seguidas == 0 {
                inicio = i;
            }
            seguidas += 1;
            if seguidas >= VENTANAS_PAUSA {
                // En medio de la pausa: así ninguno de los dos trozos se come
                // el arranque de la frase siguiente.
                return Some(inicio + seguidas * VENTANA / 2);
            }
        } else {
            seguidas = 0;
        }
        i += VENTANA;
    }
    None
}

/// Trocea un audio ya completo. Para el motor local y para el plan B.
pub fn cortes(pcm: &[f32], min: usize, max: usize) -> Vec<std::ops::Range<usize>> {
    let mut out = Vec::new();
    let mut cursor = 0usize;
    while let Some(corte) = punto_de_corte(pcm, cursor, min, max) {
        out.push(cursor..corte);
        cursor = corte;
    }
    if cursor < pcm.len() {
        out.push(cursor..pcm.len());
    }
    out
}

#[cfg(test)]
mod tests {
    use super::*;

    /// Ruido a volumen `nivel` durante `segundos`.
    fn tono(segundos: f32, nivel: f32) -> Vec<f32> {
        let n = (segundos * 16_000.0) as usize;
        (0..n)
            .map(|i| (i as f32 * 0.05).sin() * nivel)
            .collect()
    }

    #[test]
    fn corta_en_la_pausa() {
        let mut pcm = tono(25.0, 0.2);
        pcm.extend(tono(0.6, 0.0)); // pausa
        pcm.extend(tono(10.0, 0.2));
        let corte = punto_de_corte(&pcm, 0, 20 * 16_000, 55 * 16_000).unwrap();
        let seg = corte as f32 / 16_000.0;
        assert!((25.0..25.7).contains(&seg), "cortó en {seg} s");
    }

    #[test]
    fn sin_material_suficiente_no_corta() {
        let pcm = tono(8.0, 0.2);
        assert!(punto_de_corte(&pcm, 0, 20 * 16_000, 55 * 16_000).is_none());
    }

    #[test]
    fn sin_pausa_corta_al_maximo() {
        let pcm = tono(60.0, 0.2);
        let corte = punto_de_corte(&pcm, 0, 20 * 16_000, 55 * 16_000).unwrap();
        assert_eq!(corte, 55 * 16_000);
    }

    #[test]
    fn trocea_audio_completo_sin_perder_muestras() {
        let mut pcm = tono(25.0, 0.2);
        pcm.extend(tono(0.6, 0.0));
        pcm.extend(tono(24.0, 0.2));
        pcm.extend(tono(0.6, 0.0));
        pcm.extend(tono(5.0, 0.2));
        let cortes = cortes(&pcm, 20 * 16_000, 55 * 16_000);
        assert!(cortes.len() >= 2, "salieron {} trozos", cortes.len());
        assert_eq!(cortes[0].start, 0);
        assert_eq!(cortes.last().unwrap().end, pcm.len());
        for par in cortes.windows(2) {
            assert_eq!(par[0].end, par[1].start, "hay un hueco entre trozos");
        }
    }
}
