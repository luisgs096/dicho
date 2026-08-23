//! Lista los modelos disponibles en la cuenta de Groq del usuario.

fn main() -> Result<(), Box<dyn std::error::Error>> {
    let key = keyring::Entry::new("mike-dictado", "groq_api_key")?.get_password()?;
    let body: serde_json::Value = tauri::async_runtime::block_on(async {
        reqwest::Client::new()
            .get("https://api.groq.com/openai/v1/models")
            .bearer_auth(&key)
            .send()
            .await?
            .json()
            .await
    })?;
    if let Some(models) = body["data"].as_array() {
        for m in models {
            println!("{}", m["id"].as_str().unwrap_or("?"));
        }
    } else {
        println!("{body}");
    }
    Ok(())
}
