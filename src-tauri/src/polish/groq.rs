use super::PolishCtx;
use crate::stt::groq::get_api_key;
use anyhow::{anyhow, Context};
use std::time::Duration;

const CHAT_URL: &str = "https://api.groq.com/openai/v1/chat/completions";
const MODEL: &str = "openai/gpt-oss-20b";

/// Pulido con LLM (opcional): la "magia" estilo Wispr — quita muletillas con
/// criterio, corrige puntuación, formatea listas dictadas y aplica
/// autocorrecciones del hablante. Requiere API key de Groq.
pub fn polish(text: &str, ctx: &PolishCtx) -> anyhow::Result<String> {
    let key = get_api_key()?;
    let dict_words: Vec<&str> = ctx
        .dictionary
        .iter()
        .map(|(term, repl)| repl.as_deref().unwrap_or(term.as_str()))
        .collect();
    let dict_note = if dict_words.is_empty() {
        String::new()
    } else {
        format!(
            "\nPalabras del diccionario personal del usuario (respeta esta ortografía exacta): {}.",
            dict_words.join(", ")
        )
    };
    let system = format!(
        "Eres el post-procesador de un dictado por voz. Recibes una transcripción cruda y \
         devuelves ÚNICAMENTE el texto final, sin comentarios ni comillas.\n\
         Reglas:\n\
         - Elimina muletillas (este..., o sea, eh, um, like) solo cuando no aportan significado.\n\
         - Corrige puntuación, acentos y mayúsculas.\n\
         - Mantén el idioma original y el registro del hablante; no resumas ni agregues contenido.\n\
         - Si el hablante se corrige ('mejor dicho', 'no, espera, pon...'), aplica la corrección final.\n\
         - Si el hablante enumera elementos, formatea como lista con guiones.\n\
         - Números, fechas y cantidades en el formato natural del idioma.{dict_note}"
    );

    let body = serde_json::json!({
        "model": MODEL,
        "temperature": 0.2,
        "reasoning_effort": "low",
        "max_tokens": 4096,
        "messages": [
            {"role": "system", "content": system},
            {"role": "user", "content": text}
        ]
    });

    let client = reqwest::Client::builder()
        .timeout(Duration::from_secs(30))
        .build()?;
    let out = tauri::async_runtime::block_on(async move {
        let resp = client
            .post(CHAT_URL)
            .bearer_auth(key)
            .json(&body)
            .send()
            .await
            .context("No se pudo contactar a Groq")?;
        let status = resp.status();
        let json: serde_json::Value = resp.json().await.context("Respuesta inválida de Groq")?;
        if !status.is_success() {
            let msg = json["error"]["message"].as_str().unwrap_or("error desconocido");
            return Err(anyhow!("Groq respondió {status}: {msg}"));
        }
        Ok(json["choices"][0]["message"]["content"]
            .as_str()
            .unwrap_or_default()
            .trim()
            .to_string())
    })?;
    if out.is_empty() {
        return Err(anyhow!("Groq devolvió texto vacío"));
    }
    Ok(out)
}
