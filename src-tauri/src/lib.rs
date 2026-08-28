mod audio;
mod chunker;
mod commands;
mod hotkey;
mod inject;
mod models;
mod overlay;
mod pipeline;
mod polish;
mod settings;
mod store;
mod stt;
mod sync;

use std::sync::{mpsc, Arc, Mutex, RwLock};
use tauri::Manager;

/// Canal hacia el hilo del pipeline, disponible para los comandos.
pub struct PipelineTx(pub Mutex<mpsc::Sender<pipeline::Cmd>>);

fn focus_main(app: &tauri::AppHandle) {
    if let Some(w) = app.get_webview_window("main") {
        let _ = w.show();
        let _ = w.unminimize();
        let _ = w.set_focus();
    }
}

fn build_tray(app: &tauri::App) -> tauri::Result<()> {
    use tauri::menu::{Menu, MenuItem};
    use tauri::tray::TrayIconBuilder;
    let open = MenuItem::with_id(app, "open", "Abrir configuración", true, None::<&str>)?;
    let quit = MenuItem::with_id(app, "quit", "Salir", true, None::<&str>)?;
    let menu = Menu::with_items(app, &[&open, &quit])?;
    let mut builder = TrayIconBuilder::with_id("tray")
        .menu(&menu)
        .show_menu_on_left_click(true)
        .tooltip("Dicho — mantén Ctrl+Win y habla")
        .on_menu_event(|app, event| match event.id.as_ref() {
            "open" => focus_main(app),
            "quit" => app.exit(0),
            _ => {}
        });
    if let Some(icon) = app.default_window_icon() {
        builder = builder.icon(icon.clone());
    }
    builder.build(app)?;
    Ok(())
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_single_instance::init(|app, _argv, _cwd| {
            focus_main(app);
        }))
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_updater::Builder::new().build())
        .plugin(tauri_plugin_process::init())
        .plugin(tauri_plugin_autostart::init(
            tauri_plugin_autostart::MacosLauncher::LaunchAgent,
            None,
        ))
        .setup(|app| {
            let _ = env_logger::Builder::from_env(
                env_logger::Env::default().default_filter_or("info"),
            )
            .try_init();
            let handle = app.handle().clone();

            let loaded = settings::load(&handle);
            let settings_state: settings::SettingsState = Arc::new(RwLock::new(loaded));
            app.manage(settings_state.clone());

            let store = Arc::new(store::Store::init(&handle)?);
            app.manage(store.clone());

            // HUD: nunca roba el foco. Que atrape o no los clics depende de si
            // el usuario quiere poder arrastrarlo (ver `aplicar_raton_hud`).
            if let Some(hud) = app.get_webview_window("hud") {
                let _ = hud.set_focusable(false);
            }
            let arrastrable = settings_state
                .read()
                .map(|s| s.hud_arrastrable)
                .unwrap_or(true);
            commands::aplicar_raton_hud(&handle, arrastrable);

            build_tray(app)?;

            let (tx, rx) = mpsc::channel();
            pipeline::spawn(handle.clone(), rx, settings_state.clone(), store.clone());
            hotkey::spawn(tx.clone(), settings_state.clone());
            app.manage(PipelineTx(Mutex::new(tx.clone())));

            // Primer arranque: descarga automática del modelo local con progreso.
            let dl_handle = handle.clone();
            let dl_tx = tx;
            tauri::async_runtime::spawn(async move {
                if matches!(
                    models::status(&dl_handle),
                    models::ModelStatus::Missing { .. }
                ) {
                    match models::download(dl_handle.clone()).await {
                        Ok(()) => {
                            let _ = dl_tx.send(pipeline::Cmd::ModelReady);
                        }
                        Err(e) => log::error!("Auto-descarga del modelo falló: {e}"),
                    }
                }
            });

            // Sincronización con Google al arrancar, si hay sesión iniciada.
            let sync_handle = handle.clone();
            tauri::async_runtime::spawn(async move {
                if sync::has_session() {
                    if let Err(e) = sync::sync_now(sync_handle).await {
                        log::warn!("Sync al arrancar falló: {e}");
                    }
                }
            });
            Ok(())
        })
        .on_window_event(|window, event| {
            // Cerrar la ventana principal la oculta: la app vive en la bandeja.
            if let tauri::WindowEvent::CloseRequested { api, .. } = event {
                if window.label() == "main" {
                    // Cerrar Ajustes cancela la colocación del HUD: si no, se
                    // quedaría clavado en pantalla sin nada que lo apagara.
                    pipeline::modo_colocar(window.app_handle(), false);
                    let _ = window.hide();
                    api.prevent_close();
                }
            }
        })
        .invoke_handler(tauri::generate_handler![
            commands::get_settings,
            commands::save_settings,
            commands::model_status,
            commands::download_model,
            commands::get_history,
            commands::delete_history,
            commands::dict_list,
            commands::dict_add,
            commands::dict_remove,
            commands::set_groq_key,
            commands::has_groq_key,
            commands::delete_groq_key,
            commands::google_status,
            commands::google_login,
            commands::google_sync_now,
            commands::google_logout,
            commands::hud_log,
            commands::hud_arrastrar,
            commands::hud_colocar,
            commands::hud_pos_reset,
            commands::programar_relanzamiento,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
