use super::{Stt, SttOpts};
use anyhow::{anyhow, Context};
use std::io::Cursor;
use std::time::Duration;

pub const KEYRING_SERVICE: &str = "mike-dictado";
pub const KEYRING_USER: &str = "groq_api_key";
const TRANSCRIPTION_URL: &str = "https://api.groq.com/openai/v1/audio/transcriptions";
const MODEL: &str = "whisper-large-v3";

/// Muestra de estilo para el primer trozo de audio.
///
/// El `prompt` de Whisper no es una instrucción: el modelo lo trata como
/// "lo que se dijo justo antes" y de ahí saca registro y ortografía. Pedirle
/// "no traduzcas" no sirve de nada; darle un párrafo de spanglish real sí
/// empuja la salida hacia la mezcla en vez de aplanarla a un solo idioma.
pub const PRIME_SPANGLISH: &str = "Ayer tuve un meeting con el team para revisar el deployment. \
     The client wants a demo first, así que hay que preparar el pitch. Le dije okay, let's do it, \
     pero necesito el feedback del PM antes del viernes.";


/// Cuántos caracteres puede ocupar el prompt entero.
///
/// Whisper corta el `prompt` a **224 tokens** y, como es texto natural en
/// español, un token anda por los tres caracteres. 600 deja margen de sobra por
/// debajo del corte, y el margen importa: **lo que se pierde al cortar es el
/// principio**, o sea la muestra de spanglish, que es exactamente lo que evita
/// que Whisper te traduzca. Un prompt demasiado largo no da un error — da
/// traducciones, y el día que pase nadie lo va a atribuir a esto.
const TOPE_PROMPT: usize = 600;

/// El oído de Whisper: la muestra de estilo más los términos del usuario.
///
/// # Por qué el diccionario también va aquí
///
/// Hasta ahora el diccionario sólo actuaba **después**, arreglando lo que
/// Whisper ya había oído mal. Eso deja el texto crudo con la falta puesta y
/// obliga a acertar la grafía exacta del error. Metiendo los términos en el
/// prompt, Whisper los escribe bien **de entrada**: es corregir el oído en vez
/// de la transcripción.
///
/// # Por qué van al final y no al principio
///
/// El `prompt` no es una instrucción, es «lo que se dijo justo antes». Lo último
/// pesa más, igual que en una conversación. La muestra de spanglish abre —marca
/// el registro— y los términos cierran, que es donde se agarran.
///
/// # La guarda
///
/// La muestra de spanglish **nunca se recorta**. Si los términos no caben, se
/// quedan fuera los que sobren; jamás al revés. Sacrificar la muestra para meter
/// una palabra más sería cambiar un fallo de ortografía por uno de idioma.
pub fn prime_con_terminos(terminos: &[String]) -> String {
    // Una frase, no una lista: el prompt se trata como habla anterior, y una
    // enumeración suelta se parece menos a alguien hablando.
    const CIERRE: &str = " Hablamos de ";
    // El punto final cuenta, y el cierre también: si no se reservan desde el
    // principio, el último término cabe por los pelos y el remate se pasa.
    let mut usado = PRIME_SPANGLISH.chars().count() + CIERRE.chars().count() + 1;
    let mut caben: Vec<&str> = Vec::new();
    for t in terminos {
        let t = t.trim();
        if t.is_empty() {
            continue;
        }
        // Del segundo en adelante, cada término trae su ", " delante.
        let coste = t.chars().count() + if caben.is_empty() { 0 } else { 2 };
        if usado + coste > TOPE_PROMPT {
            break;
        }
        usado += coste;
        caben.push(t);
    }
    if caben.is_empty() {
        return PRIME_SPANGLISH.to_string();
    }
    format!("{PRIME_SPANGLISH}{CIERRE}{}.", caben.join(", "))
}

pub fn get_api_key() -> anyhow::Result<String> {
    keyring::Entry::new(KEYRING_SERVICE, KEYRING_USER)
        .context("No se pudo abrir el almacén de credenciales")?
        .get_password()
        .map_err(|_| anyhow!("No hay API key de Groq guardada"))
}

/// Motor cloud opcional: Whisper large-v3 servido por Groq.
pub struct GroqStt {
    client: reqwest::Client,
}

impl GroqStt {
    pub fn new() -> Self {
        Self {
            client: cliente(),
        }
    }

    /// Cliente HTTP clonable para transcribir trozos en paralelo.
    pub fn client(&self) -> reqwest::Client {
        self.client.clone()
    }
}

/// El timeout se pone por petición (`transcribe_blocking`), no en el cliente:
/// un trozo de 20 s y un audio completo de 10 min no esperan lo mismo.
fn cliente() -> reqwest::Client {
    reqwest::Client::builder()
        .build()
        .expect("no se pudo crear el cliente HTTP")
}

fn wav_bytes(samples: &[f32]) -> anyhow::Result<Vec<u8>> {
    let spec = hound::WavSpec {
        channels: 1,
        sample_rate: 16_000,
        bits_per_sample: 16,
        sample_format: hound::SampleFormat::Int,
    };
    let mut cursor = Cursor::new(Vec::new());
    {
        let mut writer = hound::WavWriter::new(&mut cursor, spec)?;
        for s in samples {
            writer.write_sample((s.clamp(-1.0, 1.0) * 32767.0) as i16)?;
        }
        writer.finalize()?;
    }
    Ok(cursor.into_inner())
}

/// Timeout holgado según la duración del audio: subir el archivo domina en
/// audios largos, y Groq cobra por segundo de audio, no por espera.
pub fn timeout_para(samples: usize) -> Duration {
    let segundos = samples as f64 / 16_000.0;
    Duration::from_secs_f64((30.0 + segundos * 0.6).min(180.0))
}

/// Transcribe un bloque de audio. Bloquea el hilo llamante.
pub fn transcribe_blocking(
    client: &reqwest::Client,
    key: &str,
    samples: &[f32],
    opts: &SttOpts,
) -> anyhow::Result<String> {
    let wav = wav_bytes(samples)?;
    let client = client.clone();
    let key = key.to_string();
    let opts = opts.clone();
    let timeout = timeout_para(samples.len());
    tauri::async_runtime::block_on(async move {
        let mut form = reqwest::multipart::Form::new()
            .part(
                "file",
                reqwest::multipart::Part::bytes(wav)
                    .file_name("audio.wav")
                    .mime_str("audio/wav")?,
            )
            .text("model", MODEL)
            .text("temperature", "0")
            .text("response_format", "json");
        if let Some(p) = opts.prompt.clone() {
            form = form.text("prompt", p);
        }
        if let Some(l) = opts.language.clone() {
            form = form.text("language", l);
        }
        let resp = client
            .post(TRANSCRIPTION_URL)
            .bearer_auth(key)
            .timeout(timeout)
            .multipart(form)
            .send()
            .await
            .context("No se pudo contactar a Groq (¿sin internet?)")?;
        let status = resp.status();
        let body: serde_json::Value = resp.json().await.context("Respuesta inválida de Groq")?;
        if !status.is_success() {
            let msg = body["error"]["message"]
                .as_str()
                .unwrap_or("error desconocido");
            return Err(anyhow!("Groq respondió {status}: {msg}"));
        }
        Ok(body["text"].as_str().unwrap_or_default().trim().to_string())
    })
}

impl Stt for GroqStt {
    fn transcribe(&mut self, samples: &[f32], opts: &SttOpts) -> anyhow::Result<String> {
        let key = get_api_key()?;
        transcribe_blocking(&self.client, &key, samples, opts)
    }

    fn name(&self) -> &'static str {
        "groq"
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn terminos(n: usize) -> Vec<String> {
        (0..n).map(|i| format!("Terminolargo{i}")).collect()
    }

    /// La guarda de la que cuelga todo: por muchos términos que tenga el
    /// usuario, la muestra de spanglish sale entera. Es lo que evita que
    /// Whisper traduzca, y perderla costaría mucho más de lo que aporta una
    /// palabra bien escrita.
    #[test]
    fn la_muestra_de_spanglish_nunca_se_recorta() {
        for n in [0, 1, 5, 50, 500] {
            let p = prime_con_terminos(&terminos(n));
            assert!(
                p.starts_with(PRIME_SPANGLISH),
                "con {n} términos se perdió la muestra"
            );
        }
    }

    /// Y nunca se pasa del presupuesto: lo que se corta al pasarse es el
    /// principio, o sea la muestra.
    #[test]
    fn nunca_se_pasa_del_tope() {
        for n in [0, 1, 5, 50, 500] {
            let p = prime_con_terminos(&terminos(n));
            assert!(
                p.chars().count() <= TOPE_PROMPT,
                "con {n} términos el prompt mide {}",
                p.chars().count()
            );
        }
    }

    #[test]
    fn los_terminos_entran_en_una_frase() {
        let p = prime_con_terminos(&["Claude code".into(), "Groq".into()]);
        assert!(p.contains("Hablamos de Claude code, Groq."), "{p}");
    }

    #[test]
    fn sin_terminos_queda_la_muestra_tal_cual() {
        assert_eq!(prime_con_terminos(&[]), PRIME_SPANGLISH);
    }

    /// Un diccionario con entradas vacías no puede colar comas sueltas.
    #[test]
    fn las_entradas_vacias_se_ignoran() {
        let p = prime_con_terminos(&["".into(), "   ".into(), "Dicho".into()]);
        assert!(p.contains("Hablamos de Dicho."), "{p}");
    }
}
