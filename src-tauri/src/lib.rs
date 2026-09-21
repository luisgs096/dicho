mod audio;
mod autotype;
mod escribano;
mod chunker;
mod commands;
mod hotkey;
mod inject;
mod models;
mod ortografia;
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

/// Dónde viven la base y los ajustes del usuario.
///
/// Se calcula a mano, sin `AppHandle`, porque hace falta **antes** de que Tauri
/// exista. Es la misma carpeta que devuelve `app_data_dir()`: en Windows,
/// `%APPDATA%\<identificador>`, y el identificador sale de la propia
/// configuración para que no haya dos sitios donde pueda cambiar. Dicho sólo
/// corre en Windows (hook global de rdev, Win32 para el HUD, instalador NSIS).
fn carpeta_datos(identificador: &str) -> std::path::PathBuf {
    std::env::var_os("APPDATA")
        .map(std::path::PathBuf::from)
        .unwrap_or_else(std::env::temp_dir)
        .join(identificador)
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    // La base y los ajustes se registran ANTES de construir la aplicación, y eso
    // no es una preferencia de estilo: es la única forma de que no se caiga.
    //
    // La ventana de Ajustes nace visible, así que su webview empieza a cargar en
    // cuanto Tauri la crea —antes de que corra el `setup`— y llama a comandos
    // nada más montarse. Si el estado se registra dentro del `setup`, hay una
    // ventana de unos milisegundos en la que esas llamadas llegan primero. Y
    // `state()` no devuelve un error cuando el estado no está: **aborta el
    // proceso**. El síntoma es de los peores posibles — la app se cierra sola,
    // a veces sí y a veces no, y sin dejar una línea en el log porque muere
    // antes de escribirla. Costó un backtrace con símbolos encontrarlo (16/09).
    //
    // Registrándolos en el Builder el problema desaparece de raíz: cuando existe
    // la primera ventana, el estado ya lleva rato ahí.
    let ctx = tauri::generate_context!();
    let datos = carpeta_datos(&ctx.config().identifier);
    let store = match store::Store::init_en(&datos) {
        Ok(s) => Arc::new(s),
        Err(e) => {
            // Sin base no hay historial ni diccionario: seguir sería fingir que
            // la app funciona. Se dice por qué y se para.
            eprintln!("Dicho no pudo abrir su base de datos en {datos:?}: {e}");
            std::process::exit(1);
        }
    };
    let settings_state: settings::SettingsState =
        Arc::new(RwLock::new(settings::cargar_de(&datos.join("settings.json"))));

    tauri::Builder::default()
        .manage(store.clone())
        .manage(settings_state.clone())
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
        .setup(move |app| {
            let _ = env_logger::Builder::from_env(
                env_logger::Env::default().default_filter_or("info"),
            )
            .try_init();
            let handle = app.handle().clone();


            // HUD: nunca roba el foco. Que atrape o no los clics depende de si
            // el usuario quiere poder arrastrarlo (ver `aplicar_raton_hud`).
            if let Some(hud) = app.get_webview_window("hud") {
                let _ = hud.set_focusable(false);
            }
            let (arrastrable, clavado) = settings_state
                .read()
                .map(|s| (s.hud_arrastrable, s.hud_pin && s.hud_enabled))
                .unwrap_or((true, false));
            // Clavada atrapa el ratón sí o sí: si no, su propio menú sería un
            // dibujo y los clics la atravesarían.
            commands::aplicar_raton_hud(&handle, arrastrable || clavado);
            if clavado {
                // Al arrancar, la onda vuelve sola a donde la dejaste.
                let h = handle.clone();
                std::thread::spawn(move || {
                    // Un respiro para que el webview del HUD esté montado: si se
                    // coloca antes, WebView2 aún no sabe de qué tamaño es.
                    std::thread::sleep(std::time::Duration::from_millis(900));
                    pipeline::recolocar_hud(&h);
                    if let Some(hud) = h.get_webview_window("hud") {
                        let _ = hud.show();
                    }
                });
            }

            // ¿Acabamos de actualizar? Se compara la versión de ahora con la
            // que quedó apuntada la última vez. Si cambió, la onda lo celebra
            // **una sola vez**; si el apunte está vacío es una instalación
            // nueva, que no ha actualizado nada y no tiene qué celebrar.
            {
                let ahora = app.package_info().version.to_string();
                let antes = settings_state
                    .read()
                    .map(|s| s.ultima_version_vista.clone())
                    .unwrap_or_default();
                if antes != ahora {
                    if let Ok(mut s) = settings_state.write() {
                        s.ultima_version_vista = ahora.clone();
                        let copia = s.clone();
                        drop(s);
                        let _ = settings::save(&handle, &copia);
                    }
                    if !antes.is_empty() {
                        let h = handle.clone();
                        std::thread::spawn(move || {
                            // El mismo respiro que el HUD clavado: antes de esto
                            // el webview aún no sabe de qué tamaño es.
                            std::thread::sleep(std::time::Duration::from_millis(1400));
                            pipeline::celebrar_actualizacion(&h, &ahora);
                        });
                    }
                }
            }

            build_tray(app)?;

            let (tx, rx) = mpsc::channel();
            pipeline::spawn(handle.clone(), rx, settings_state.clone(), store.clone());
            hotkey::spawn(tx.clone(), settings_state.clone(), store.clone());
            app.manage(PipelineTx(Mutex::new(tx.clone())));
            // El vigilante del portapapeles: cuando el usuario copia algo, la
            // onda se ofrece a corregirlo.
            escribano::vigilar(handle.clone(), settings_state.clone());

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
            commands::listas_analisis,
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
            commands::hud_cursor,
            commands::hud_pos_reset,
            commands::hud_pin,
            commands::hud_corregir,
            commands::escribano_sustituir,
            commands::hud_encima,
            commands::hud_nivel,
            commands::programar_relanzamiento,
        ])
        .run(ctx)
        .expect("error while running tauri application");
}
