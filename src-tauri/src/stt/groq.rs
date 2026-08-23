use super::Stt;
use anyhow::{anyhow, Context};
use std::io::Cursor;
use std::time::Duration;

pub const KEYRING_SERVICE: &str = "mike-dictado";
pub const KEYRING_USER: &str = "groq_api_key";
const TRANSCRIPTION_URL: &str = "https://api.groq.com/openai/v1/audio/transcriptions";
const MODEL: &str = "whisper-large-v3-turbo";

pub fn get_api_key() -> anyhow::Result<String> {
    keyring::Entry::new(KEYRING_SERVICE, KEYRING_USER)
        .context("No se pudo abrir el almacén de credenciales")?
        .get_password()
        .map_err(|_| anyhow!("No hay API key de Groq guardada"))
}

/// Motor cloud opcional: Whisper large-v3-turbo servido por Groq.
pub struct GroqStt {
    client: reqwest::Client,
}

impl GroqStt {
    pub fn new() -> Self {
        Self {
            client: reqwest::Client::builder()
                .timeout(Duration::from_secs(60))
                .build()
                .expect("no se pudo crear el cliente HTTP"),
        }
    }
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

impl Stt for GroqStt {
    fn transcribe(&mut self, samples: &[f32], lang: Option<&str>) -> anyhow::Result<String> {
        let key = get_api_key()?;
        let wav = wav_bytes(samples)?;
        let client = self.client.clone();
        let lang = lang.map(String::from);
        let text = tauri::async_runtime::block_on(async move {
            let mut form = reqwest::multipart::Form::new()
                .part(
                    "file",
                    reqwest::multipart::Part::bytes(wav)
                        .file_name("audio.wav")
                        .mime_str("audio/wav")?,
                )
                .text("model", MODEL)
                .text("response_format", "json");
            if let Some(l) = lang {
                form = form.text("language", l);
            }
            let resp = client
                .post(TRANSCRIPTION_URL)
                .bearer_auth(key)
                .multipart(form)
                .send()
                .await
                .context("No se pudo contactar a Groq (¿sin internet?)")?;
            let status = resp.status();
            let body: serde_json::Value = resp
                .json()
                .await
                .context("Respuesta inválida de Groq")?;
            if !status.is_success() {
                let msg = body["error"]["message"].as_str().unwrap_or("error desconocido");
                return Err(anyhow!("Groq respondió {status}: {msg}"));
            }
            Ok(body["text"].as_str().unwrap_or_default().trim().to_string())
        })?;
        Ok(text)
    }

    fn name(&self) -> &'static str {
        "groq"
    }
}
