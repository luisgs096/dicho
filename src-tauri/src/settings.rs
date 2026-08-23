use rdev::Key;
use serde::{Deserialize, Serialize};
use std::{fs, path::PathBuf, sync::{Arc, RwLock}};
use tauri::{AppHandle, Manager};

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum EngineKind {
    Parakeet,
    Groq,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum PolishKind {
    Rules,
    GroqLlm,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum HudStyle {
    /// Caritas pixel estilo tamagotchi (5 variaciones por estado).
    Tamagotchi,
    /// Barras que crecen con la intensidad de la voz, fondo claro.
    Classic,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(default)]
pub struct AppSettings {
    /// Combinación push-to-talk: todas las teclas deben estar presionadas a la vez.
    pub hotkey: Vec<Key>,
    pub engine: EngineKind,
    pub polish: PolishKind,
    /// "auto" o código ISO-639-1 ("es", "en", ...)
    pub language: String,
    pub hud_enabled: bool,
    pub hud_style: HudStyle,
    pub autostart: bool,
    /// Cliente OAuth "Desktop" de Google para la sincronización vía Drive.
    /// En apps instaladas el client_secret no es confidencial por diseño.
    pub google_client_id: String,
    pub google_client_secret: String,
}

impl Default for AppSettings {
    fn default() -> Self {
        Self {
            hotkey: vec![Key::ControlLeft, Key::MetaLeft],
            engine: EngineKind::Parakeet,
            polish: PolishKind::Rules,
            language: "auto".into(),
            hud_enabled: true,
            hud_style: HudStyle::Tamagotchi,
            autostart: false,
            google_client_id: String::new(),
            google_client_secret: String::new(),
        }
    }
}

pub type SettingsState = Arc<RwLock<AppSettings>>;

fn settings_path(app: &AppHandle) -> PathBuf {
    app.path()
        .app_config_dir()
        .expect("app_config_dir no disponible")
        .join("settings.json")
}

pub fn load(app: &AppHandle) -> AppSettings {
    let path = settings_path(app);
    match fs::read_to_string(&path) {
        Ok(raw) => serde_json::from_str(&raw).unwrap_or_else(|e| {
            log::warn!("settings.json inválido ({e}), usando defaults");
            AppSettings::default()
        }),
        Err(_) => AppSettings::default(),
    }
}

pub fn save(app: &AppHandle, settings: &AppSettings) -> anyhow::Result<()> {
    let path = settings_path(app);
    if let Some(dir) = path.parent() {
        fs::create_dir_all(dir)?;
    }
    fs::write(&path, serde_json::to_string_pretty(settings)?)?;
    Ok(())
}
