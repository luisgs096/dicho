use crate::settings::{self, AppSettings, SettingsState};
use crate::store::{DictItem, HistoryItem, Store};
use crate::stt::groq::{KEYRING_SERVICE, KEYRING_USER};
use crate::{models, pipeline, PipelineTx};
use std::sync::Arc;
use tauri::{AppHandle, State};
use tauri_plugin_autostart::ManagerExt;

#[tauri::command]
pub fn get_settings(state: State<'_, SettingsState>) -> AppSettings {
    state.read().unwrap().clone()
}

#[tauri::command]
pub fn save_settings(
    app: AppHandle,
    state: State<'_, SettingsState>,
    new_settings: AppSettings,
) -> Result<(), String> {
    settings::save(&app, &new_settings).map_err(|e| e.to_string())?;
    // Solo release toca la entrada Run: un build dev registraría target/debug/mike.exe,
    // que al arrancar Windows abre consola y busca un dev server que no existe.
    if cfg!(debug_assertions) {
        log::info!("autostart: ignorado en build debug (no se toca el registro)");
    } else {
        let autolaunch = app.autolaunch();
        if new_settings.autostart {
            let _ = autolaunch.enable();
        } else {
            let _ = autolaunch.disable();
        }
    }
    *state.write().unwrap() = new_settings;
    Ok(())
}

#[tauri::command]
pub fn model_status(app: AppHandle) -> models::ModelStatus {
    models::status(&app)
}

#[tauri::command]
pub fn download_model(app: AppHandle, tx: State<'_, PipelineTx>) {
    let sender = tx.0.lock().unwrap().clone();
    tauri::async_runtime::spawn(async move {
        if models::download(app).await.is_ok() {
            let _ = sender.send(pipeline::Cmd::ModelReady);
        }
    });
}

#[tauri::command]
pub fn get_history(
    store: State<'_, Arc<Store>>,
    search: Option<String>,
    limit: Option<u32>,
) -> Result<Vec<HistoryItem>, String> {
    store
        .list_history(search.as_deref(), limit.unwrap_or(100))
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub fn delete_history(store: State<'_, Arc<Store>>, id: i64) -> Result<(), String> {
    store.delete_history(id).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn dict_list(store: State<'_, Arc<Store>>) -> Result<Vec<DictItem>, String> {
    store.dict_list().map_err(|e| e.to_string())
}

#[tauri::command]
pub fn dict_add(
    store: State<'_, Arc<Store>>,
    term: String,
    replacement: Option<String>,
) -> Result<(), String> {
    if term.trim().is_empty() {
        return Err("El término no puede estar vacío".into());
    }
    store
        .dict_add(&term, replacement.as_deref().filter(|r| !r.trim().is_empty()))
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub fn dict_remove(store: State<'_, Arc<Store>>, id: i64) -> Result<(), String> {
    store.dict_remove(id).map_err(|e| e.to_string())
}

fn keyring_entry() -> Result<keyring::Entry, String> {
    keyring::Entry::new(KEYRING_SERVICE, KEYRING_USER).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn set_groq_key(key: String) -> Result<(), String> {
    let key = key.trim();
    if key.is_empty() {
        return Err("La API key no puede estar vacía".into());
    }
    keyring_entry()?.set_password(key).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn has_groq_key() -> bool {
    keyring_entry()
        .and_then(|e| e.get_password().map_err(|e| e.to_string()))
        .is_ok()
}

#[tauri::command]
pub fn delete_groq_key() -> Result<(), String> {
    keyring_entry()?.delete_credential().map_err(|e| e.to_string())
}

/// Diagnóstico desde el webview del HUD (visible incluso en builds release).
#[tauri::command]
pub fn hud_log(app: AppHandle, msg: String) {
    pipeline::diag(&app, &format!("HUD-JS: {msg}"));
}
