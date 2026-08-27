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
