//! Verificación E2E del camino Groq sin micrófono:
//! lee la API key del Administrador de credenciales (igual que la app),
//! transcribe un WAV con whisper-large-v3-turbo y pule con llama-3.1-8b-instant.
//! `cargo run --example test_groq -- <archivo.wav>`

use std::time::Instant;

fn main() -> Result<(), Box<dyn std::error::Error>> {
    let wav_path = std::env::args()
        .nth(1)
        .expect("uso: test_groq <archivo.wav>");

    let key = keyring::Entry::new("mike-dictado", "groq_api_key")?
        .get_password()
        .map_err(|_| "SIN_KEY: no hay API key de Groq guardada todavía")?;
    println!("API key encontrada ({} chars)", key.len());

    let wav_bytes = std::fs::read(&wav_path)?;
    let client = reqwest::Client::new();

    // 1. Transcripción
    let t0 = Instant::now();
    let (status, body) = tauri::async_runtime::block_on(async {
        let form = reqwest::multipart::Form::new()
            .part(
                "file",
                reqwest::multipart::Part::bytes(wav_bytes)
                    .file_name("audio.wav")
                    .mime_str("audio/wav")?,
            )
            .text("model", "whisper-large-v3-turbo")
            .text("response_format", "json");
        let resp = client
            .post("https://api.groq.com/openai/v1/audio/transcriptions")
            .bearer_auth(&key)
            .multipart(form)
            .send()
            .await?;
        let status = resp.status();
        let body: serde_json::Value = resp.json().await?;
        Ok::<_, Box<dyn std::error::Error>>((status, body))
    })?;
    if !status.is_success() {
        println!("STT ERROR {status}: {body}");
        return Err("groq stt fallo".into());
    }
    let raw = body["text"].as_str().unwrap_or_default().trim().to_string();
    println!("STT en {} ms: {raw}", t0.elapsed().as_millis());

    // 2. Pulido LLM (mismo prompt que la app, resumido)
    let t1 = Instant::now();
    let (status, body) = tauri::async_runtime::block_on(async {
        let payload = serde_json::json!({
            "model": "openai/gpt-oss-20b",
            "temperature": 0.2,
            "reasoning_effort": "low",
            "messages": [
                {"role": "system", "content": "Eres el post-procesador de un dictado por voz. Devuelve ÚNICAMENTE el texto final corregido: sin muletillas, con puntuación y mayúsculas correctas, mismo idioma (respeta mezclas español/inglés), sin comentarios."},
                {"role": "user", "content": raw}
            ]
        });
        let resp = client
            .post("https://api.groq.com/openai/v1/chat/completions")
            .bearer_auth(&key)
            .json(&payload)
            .send()
            .await?;
        let status = resp.status();
        let body: serde_json::Value = resp.json().await?;
        Ok::<_, Box<dyn std::error::Error>>((status, body))
    })?;
    if !status.is_success() {
        println!("LLM ERROR {status}: {body}");
        return Err("groq llm fallo".into());
    }
    let polished = body["choices"][0]["message"]["content"]
        .as_str()
        .unwrap_or_default()
        .trim()
        .to_string();
    println!("LLM en {} ms: {polished}", t1.elapsed().as_millis());
    println!("GROQ_OK");
    Ok(())
}
