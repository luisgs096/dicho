use crate::settings::{self, AppSettings, HudPos, SettingsState};
use crate::store::{DictItem, HistoryItem, Store};
use crate::stt::groq::{KEYRING_SERVICE, KEYRING_USER};
use crate::{models, pipeline, PipelineTx};
use std::sync::atomic::Ordering;
use std::sync::Arc;
use tauri::{AppHandle, Emitter, Manager, State};
use tauri_plugin_autostart::ManagerExt;

#[tauri::command]
pub fn get_settings(state: State<'_, SettingsState>) -> AppSettings {
    state.read().unwrap().clone()
}

#[tauri::command]
pub fn save_settings(
    app: AppHandle,
    state: State<'_, SettingsState>,
    mut new_settings: AppSettings,
) -> Result<(), String> {
    // La posición del HUD no sale de este formulario, sino de arrastrarlo. Si
    // se guardara la que trae el front, mover el HUD y luego tocar cualquier
    // ajuste con la ventana abierta desde antes lo devolvería a su sitio viejo.
    new_settings.hud_posiciones = state
        .read()
        .map(|s| s.hud_posiciones.clone())
        .unwrap_or_default();
    // Tampoco la versión vista: la apunta el arranque, y Ajustes puede haber
    // leído los ajustes antes (su ventana nace visible y le gana la carrera al
    // setup, que además no avisa con settings-changed). Guardar su copia vieja
    // haría celebrar otra vez la misma actualización en el siguiente arranque.
    new_settings.ultima_version_vista = state
        .read()
        .map(|s| s.ultima_version_vista.clone())
        .unwrap_or_default();
    // Encender el escribano deja la onda clavada: el gesto es copiar y darle un
    // clic. Sólo **al encenderlo**, no en cada guardado: si luego la desclavas
    // desde su menú, tocar cualquier otro ajuste no puede volver a clavarla a
    // tus espaldas — y una instalación nueva, que ya trae el escribano puesto,
    // no amanece con la onda clavada por marcar una casilla. Sin clavar, la
    // onda se queda a la vista mientras se ofrece (ver `hud_encima`).
    let encendiendo =
        new_settings.escribano && state.read().map(|s| !s.escribano).unwrap_or(false);
    if encendiendo {
        new_settings.hud_pin = true;
    }
    settings::save(&app, &new_settings).map_err(|e| e.to_string())?;
    let arrastrable = new_settings.hud_arrastrable;
    let visible = new_settings.hud_enabled;

    // Solo release toca la entrada Run: un build dev registraría target/debug/mike.exe,
    // que al arrancar Windows abre consola y busca un dev server que no existe.
    if cfg!(debug_assertions) {
        log::info!("autostart: ignorado en build debug (no se toca el registro)");
    } else {
        let autolaunch = app.autolaunch();
        // Si el registro de Windows no deja tocarlo, la casilla se guardaría
        // marcada y Dicho no arrancaría solo: el usuario creería que sí. No hay
        // dónde enseñarlo desde aquí, pero al menos queda en el log en vez de
        // desaparecer.
        let r = if new_settings.autostart {
            autolaunch.enable()
        } else {
            autolaunch.disable()
        };
        if let Err(e) = r {
            log::warn!("No se pudo cambiar el arranque automático: {e}");
        }
    }
    *state.write().unwrap() = new_settings;
    // Después de escribir el estado, no antes: `aplicar_raton_hud` lee de ahí
    // si está clavada, y con el estado viejo decidía con el pin de antes.
    aplicar_raton_hud(&app, arrastrable);
    // Apagar la onda con ella a la vista —clavada— la esconde ya, no al
    // siguiente dictado.
    if !visible {
        if let Some(hud) = app.get_webview_window("hud") {
            pipeline::ocultar_ventana(&hud);
        }
    }
    // El HUD (webview aparte) escucha esto para refrescar su estilo.
    let _ = app.emit("settings-changed", ());
    Ok(())
}

#[tauri::command]
pub fn model_status(app: AppHandle) -> models::ModelStatus {
    models::status(&app)
}

/// «Sustituir»: devuelve el foco a donde estabas y pega encima de tu selección.
///
/// Aquí **sí** se sintetiza un Ctrl+V, y es la única excepción a la regla de no
/// sintetizar atajos — porque el usuario acaba de pulsar un botón que dice
/// exactamente eso. Aun así respeta la lista de apps vetadas: en una terminal
/// Ctrl+V no siempre pega, así que ahí se le dice que pegue él.
#[tauri::command]
pub fn escribano_sustituir(app: AppHandle, state: State<'_, SettingsState>) -> Result<(), String> {
    let vetadas = state
        .read()
        .map(|s| s.apps_sin_correccion.clone())
        .unwrap_or_default();

    // Lo que se pega es la corrección y en la ventana de la corrección, las dos
    // cosas guardadas al abrir la revisión. El portapapeles y el foco apuntado
    // por el vigilante pueden haber cambiado mientras leías: copiar otra cosa
    // en otra ventana hacía pegar esa otra cosa en esa otra ventana.
    let revision = pipeline::REVISION.lock().ok().and_then(|r| r.clone());
    let corregido = revision
        .as_ref()
        .and_then(|r| r["corregido"].as_str())
        .ok_or("No hay ninguna corrección que sustituir.")?
        .to_string();
    let hwnd = revision
        .as_ref()
        .and_then(|r| r["destino"].as_i64())
        .unwrap_or(0) as isize;
    crate::escribano::ya_visto(&corregido);
    crate::inject::copiar(&corregido).map_err(|e| e.to_string())?;
    if !crate::overlay::devolver_foco(hwnd) {
        return Err("No pude volver a la ventana donde estabas. El texto sigue copiado: pégalo tú.".into());
    }
    // El foco tarda un poco en asentarse; pegar antes lo manda al vacío.
    std::thread::sleep(std::time::Duration::from_millis(120));

    if let Some(exe) = crate::overlay::proceso_al_frente() {
        if vetadas.iter().any(|v| v.to_lowercase() == exe) {
            return Err(format!(
                "En {exe} no pego yo: ahí Ctrl+V no siempre es pegar. El texto está copiado."
            ));
        }
    }
    crate::inject::pegar().map_err(|e| e.to_string())?;
    pipeline::cerrar_revision(&app);
    Ok(())
}

/// El globo ya se midió: se ajusta a su contenido y se pega a la onda. Devuelve
/// hacia dónde tiene que apuntar su pico.
#[tauri::command]
pub fn revision_colocar(app: AppHandle, alto: f64) -> String {
    pipeline::colocar_revision(&app, alto).to_string()
}

#[tauri::command]
pub fn revision_cerrar(app: AppHandle) {
    pipeline::cerrar_revision(&app);
}

/// Lo que la ventana de revisión tiene que enseñar al abrirse.
#[tauri::command]
pub fn revision_pendiente() -> Option<serde_json::Value> {
    pipeline::REVISION.lock().ok().and_then(|r| r.clone())
}

/// Clic en la onda cuando está en modo escribano: corrige lo copiado.
///
/// Se comprueba que esté armado de verdad. Sin eso, cualquier clic en la
/// cápsula —y se hacen muchos, que también es el asa para arrastrarla— mandaría
/// el texto a la API.
#[tauri::command]
pub fn hud_corregir(tx: State<'_, PipelineTx>) {
    if !crate::escribano::ARMADO.load(Ordering::SeqCst) {
        return;
    }
    let sender = tx.0.lock().unwrap().clone();
    let _ = sender.send(pipeline::Cmd::Corregir);
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

/// Las listas con las que el historial analiza un dictado.
///
/// Se mandan una vez y el contaje lo hace la interfaz: hacerlo en Rust
/// significaría una llamada por tarjeta, y en el historial hay cien. Lo que no
/// se duplica es la lista — vive en `polish` y de ahí sale también el prompt
/// del Editor, con un test que vigila que no se separen.
#[tauri::command]
pub fn listas_analisis() -> serde_json::Value {
    serde_json::json!({
        "muletillas": crate::polish::MULETILLAS,
        "anglicismos": crate::polish::ANGLICISMOS,
    })
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

#[tauri::command]
pub fn google_status(app: AppHandle) -> crate::sync::GoogleStatus {
    crate::sync::status(&app)
}

#[tauri::command]
pub async fn google_login(app: AppHandle) -> Result<crate::sync::GoogleStatus, String> {
    crate::sync::login(app).await.map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn google_sync_now(app: AppHandle) -> Result<crate::sync::GoogleStatus, String> {
    crate::sync::sync_now(app).await.map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn google_logout(app: AppHandle) -> Result<(), String> {
    crate::sync::logout(app).await.map_err(|e| e.to_string())
}

/// Decide si el HUD atrapa el ratón o lo deja pasar.
///
/// El HUD nació siendo un cristal (`ignore_cursor_events`) para no comerse los
/// clics de lo que hubiera debajo. Para poder arrastrarlo hay que dejar que los
/// atrape, y es todo o nada: no hay forma de hacer transparente sólo una parte
/// de la ventana. Por eso es un ajuste y no una decisión nuestra.
///
/// La regla de que **clavada lo atrapa sí o sí** vive aquí dentro y no en cada
/// llamada, que es de donde venía el fallo: cuatro sitios la decidían y dos se
/// olvidaban del pin. Con la onda clavada y el arrastre apagado, guardar
/// cualquier ajuste la convertía en cristal y su propio menú dejaba de recibir
/// clics — no había forma de desclavarla sin reiniciar. Al reiniciar volvía a
/// funcionar, porque el arranque sí sumaba el pin: la misma configuración se
/// comportaba de dos maneras.
pub fn aplicar_raton_hud(app: &AppHandle, arrastrable: bool) {
    let clavada = app
        .try_state::<SettingsState>()
        .and_then(|s| s.read().ok().map(|s| s.hud_pin && s.hud_enabled))
        .unwrap_or(false);
    if let Some(hud) = app.get_webview_window("hud") {
        let _ = hud.set_ignore_cursor_events(!(arrastrable || clavada));
    }
}

/// Dónde está el cursor **respecto al centro de la onda**, en unidades de
/// 600 px lógicos: 1 es un palmo a la derecha (o abajo), -1 un palmo a la
/// izquierda (o arriba).
///
/// Lo pregunta la carita de los ojos que te siguen, unas quince veces por
/// segundo y **sólo mientras esa carita está a la vista**. Un hilo en Rust
/// emitiendo eventos todo el rato saldría más caro: la mayor parte del tiempo no
/// hay nadie mirando. Con la onda escondida contesta `None`, y el HUD pregunta
/// más despacio hasta que vuelve a verse.
///
/// El divisor no es el tamaño de la pantalla sino una distancia de referencia
/// fija: así los ojos llegan al tope del recorrido a un palmo de la onda, que es
/// donde estás cuando la miras. Y va en píxeles **lógicos**: Windows da el
/// cursor en físicos, y con 600 a secas el palmo medía 240 px de verdad en una
/// 4K al 250 %, así que ahí la pupila se iba al tope casi sin mover el ratón.
///
/// No se recorta a ±1: la pupila recorta por su cuenta, y el gesto de marearla
/// —darle vueltas— necesita el ángulo de verdad, también de lejos.
#[tauri::command]
pub fn hud_cursor(app: AppHandle) -> Option<(f32, f32)> {
    let hud = app.get_webview_window("hud")?;
    if !hud.is_visible().unwrap_or(false) {
        return None;
    }
    let pos = hud.outer_position().ok()?;
    let tam = hud.outer_size().ok()?;
    let palmo = 600.0 * hud.scale_factor().unwrap_or(1.0) as f32;
    let (cx, cy) = crate::overlay::cursor_pos()?;
    let dx = (cx as f32 - (pos.x as f32 + tam.width as f32 / 2.0)) / palmo;
    let dy = (cy as f32 - (pos.y as f32 + tam.height as f32 / 2.0)) / palmo;
    Some((dx, dy))
}

/// Empieza a arrastrar el HUD: lo llama el propio HUD al recibir el ratón.
///
/// El seguimiento del cursor se va a un hilo aparte porque dura lo que dure el
/// gesto —segundos— y no puede quedarse ocupando el hilo de comandos.
#[tauri::command]
pub fn hud_arrastrar(app: AppHandle, state: State<'_, SettingsState>) {
    let Some(hud) = app.get_webview_window("hud") else {
        return;
    };
    let Some(hwnd) = crate::overlay::hwnd_of(&hud) else {
        return;
    };
    let settings = state.inner().clone();
    std::thread::spawn(move || {
        pipeline::ARRASTRANDO.store(true, Ordering::SeqCst);
        // Cada meneo del ratón avisa al HUD; él lleva la cuenta de por cuál de
        // las tres caritas del mareo va. La escalada vive en el webview porque
        // es presentación pura, y así aquí no hay estado que reiniciar.
        let app_meneo = app.clone();
        let app_arranque = app.clone();
        let fin = crate::overlay::arrastrar_con_cursor(
            hwnd,
            // Sólo al cruzar el umbral: un clic en el menú no es un arrastre y
            // no tiene que sacar ni el aro punteado ni la montaña rusa.
            move || {
                let _ = app_arranque.emit("hud-arrastre", true);
            },
            move || {
                let _ = app_meneo.emit("hud-meneo", ());
            },
        );
        let _ = app.emit("hud-arrastre", false);
        pipeline::ARRASTRANDO.store(false, Ordering::SeqCst);

        // Dónde quedó, medido contra la pantalla en la que quedó: se puede
        // arrastrar al otro monitor sin que cambie la ventana activa.
        let (Some((x, y, w, h)), Some((ax, ay, aw, ah))) =
            (fin, crate::overlay::work_area_of(hwnd))
        else {
            return;
        };
        let area = (ax, ay, aw, ah);
        let clave = HudPos::clave(area);
        let pos = HudPos::desde_pixeles((x, y, w, h), area);
        let copia = {
            let Ok(mut s) = settings.write() else {
                return;
            };
            s.hud_posiciones.insert(clave.clone(), pos);
            s.clone()
        };
        if let Err(e) = settings::save(&app, &copia) {
            pipeline::diag(&app, &format!("HUD: no se pudo guardar la posición: {e}"));
            return;
        }
        pipeline::diag(
            &app,
            &format!(
                "HUD movido a ({x},{y}) en la pantalla {clave} → fx={:.3} fy={:.3}",
                pos.fx, pos.fy
            ),
        );
    });
}

/// Cambia el nivel de redacción desde la cinta de la onda.
///
/// Vive aquí y no en `save_settings` porque el HUD es una ventana aparte con su
/// propia copia de los ajustes: mandar el objeto entero desde ahí pisaría
/// cualquier cosa que el usuario estuviera tocando en Ajustes al mismo tiempo.
#[tauri::command]
pub fn hud_nivel(
    app: AppHandle,
    state: State<'_, SettingsState>,
    nivel: settings::PolishKind,
) -> Result<(), String> {
    let copia = {
        let mut s = state.write().map_err(|e| e.to_string())?;
        s.polish = nivel;
        s.clone()
    };
    settings::save(&app, &copia).map_err(|e| e.to_string())?;
    let _ = app.emit("settings-changed", ());
    Ok(())
}

/// El ratón entró o salió de la onda. Lo avisa el propio HUD.
///
/// Mientras está encima no se esconde aunque el dictado haya terminado: si se
/// fuera bajo el cursor, llegar a su menú sería una carrera contra el
/// cronómetro. Al salir se va sola, salvo que esté clavada o en plena faena.
#[tauri::command]
pub fn hud_encima(app: AppHandle, on: bool) {
    pipeline::RATON_ENCIMA.store(on, Ordering::SeqCst);
    if on {
        return;
    }
    // Un respiro antes de irse: rozarla de pasada no debe hacerla desaparecer
    // de golpe, y da margen a volver si el cursor se salió sin querer.
    //
    // Las guardas de abajo son las de `hide_hud_later` y por la misma razón:
    // durante esos 700 ms puede pasar cualquier cosa —que empieces a dictar,
    // que la claves, que la muevas, que el escribano se ofrezca— y esconderla
    // entonces sería quitarte de delante algo que sí querías ver.
    std::thread::spawn(move || {
        std::thread::sleep(std::time::Duration::from_millis(700));
        if pipeline::RATON_ENCIMA.load(Ordering::SeqCst)
            || pipeline::grabando()
            || pipeline::hud_clavado(&app)
            || pipeline::ARRASTRANDO.load(Ordering::SeqCst)
            // Ofreciéndose se queda sus 8 s aunque no esté clavada: si se
            // fuera al pasarle el ratón, el clic que pide no llegaría nunca.
            || crate::escribano::ARMADO.load(Ordering::SeqCst)
        {
            return;
        }
        if let Some(hud) = app.get_webview_window("hud") {
            pipeline::ocultar_ventana(&hud);
        }
    });
}

/// Clava o desclava la onda en pantalla, desde su propio menú.
///
/// Clavada no se esconde al acabar el dictado: vuelve a reposo y se queda ahí
/// —el "modo mascota"—. Y atrapa el ratón sí o sí mientras esté clavada, que si
/// no, su menú sería un dibujo: los clics la atravesarían.
#[tauri::command]
pub fn hud_pin(app: AppHandle, state: State<'_, SettingsState>, on: bool) -> Result<(), String> {
    let (copia, arrastrable) = {
        let mut s = state.write().map_err(|e| e.to_string())?;
        s.hud_pin = on;
        (s.clone(), s.hud_arrastrable)
    };
    settings::save(&app, &copia).map_err(|e| e.to_string())?;
    aplicar_raton_hud(&app, on || arrastrable);
    let _ = app.emit("settings-changed", ());
    if let Some(hud) = app.get_webview_window("hud") {
        if on {
            pipeline::recolocar_hud(&app);
            pipeline::mostrar_ventana(&hud);
        } else if !pipeline::grabando() {
            pipeline::ocultar_ventana(&hud);
        }
    }
    Ok(())
}

/// Devuelve el HUD a su sitio de siempre —abajo, al centro— en **todas** las
/// pantallas: si sólo borrara el rincón de ésta, el botón parecería no hacer
/// nada al volver al otro monitor.
#[tauri::command]
pub fn hud_pos_reset(app: AppHandle, state: State<'_, SettingsState>) -> Result<(), String> {
    let copia = {
        let mut s = state.write().map_err(|e| e.to_string())?;
        s.hud_posiciones.clear();
        s.clone()
    };
    settings::save(&app, &copia).map_err(|e| e.to_string())?;
    pipeline::recolocar_hud(&app);
    Ok(())
}

/// Diagnóstico desde el webview del HUD (visible incluso en builds release).
#[tauri::command]
pub fn hud_log(app: AppHandle, msg: String) {
    pipeline::diag(&app, &format!("HUD-JS: {msg}"));
}

/// El script vigilante, en su propia función para poder probarlo sin lanzar nada.
fn script_relanzador(exe: &str) -> String {
    // Con BOM: un .ps1 sin él se lee como ANSI y los acentos rompen el parseo.
    format!(
        "\u{feff}$exe = '{exe}'
# 1) Esperar a que Dicho se cierre. Si no se cierra, la actualización no siguió
#    adelante (cancelada o fallida) y aquí no hay nada que hacer.
$limite = (Get-Date).AddSeconds(120)
while ((Get-Process mike -ErrorAction SilentlyContinue) -and (Get-Date) -lt $limite) {{
  Start-Sleep -Milliseconds 500
}}
if (Get-Process mike -ErrorAction SilentlyContinue) {{ exit }}

# 2) Reintentar: mientras el instalador termina de escribir el .exe, Start-Process
#    falla, así que se vuelve a probar hasta que arranque.
Start-Sleep -Seconds 3
for ($i = 0; $i -lt 20; $i++) {{
  if (Get-Process mike -ErrorAction SilentlyContinue) {{ break }}
  try {{ Start-Process $exe }} catch {{}}
  Start-Sleep -Seconds 2
}}
Remove-Item $MyInvocation.MyCommand.Path -Force -ErrorAction SilentlyContinue
"
    )
}

/// Ajustes está a media actualización: cerrarla ahora la esconde en vez de
/// destruirla (ver `on_window_event` en lib.rs), porque la descarga vive en
/// su webview y se cortaría.
pub static AJUSTES_OCUPADA: std::sync::atomic::AtomicBool =
    std::sync::atomic::AtomicBool::new(false);

/// Lo avisa el updater al empezar a descargar, y al fallar para soltarlo.
#[tauri::command]
pub fn ajustes_ocupada(on: bool) {
    AJUSTES_OCUPADA.store(on, Ordering::SeqCst);
}

/// Deja programado el relanzamiento de Dicho tras una actualización.
///
/// El instalador NSIS trae su propio `/R` para volver a abrir la app, y el
/// plugin del updater se lo pasa. Pero sólo funciona si Dicho ya está cerrado
/// cuando arranca el instalador: si lo encuentra abierto entra por
/// `CheckIfAppIsRunning`, lo mata, y por ese camino el relanzamiento nunca
/// llega. Que es justo lo que pasa al actualizar desde dentro de la app.
///
/// Así que el relanzamiento lo programa la app antes de empezar: un PowerShell
/// suelto que espera a que el proceso desaparezca y lo vuelve a abrir. Es
/// inofensivo aunque el `/R` funcione — la guardia de instancia única hace que
/// el segundo arranque enfoque al primero y se cierre.
#[tauri::command]
pub fn programar_relanzamiento(app: AppHandle) -> Result<(), String> {
    let exe = std::env::current_exe().map_err(|e| e.to_string())?;
    let script = std::env::temp_dir().join("dicho-relanzar.ps1");
    let contenido = script_relanzador(&exe.display().to_string());
    std::fs::write(&script, contenido).map_err(|e| e.to_string())?;

    let mut relanzador = std::process::Command::new("powershell");
    relanzador.args([
        "-NoProfile",
        "-ExecutionPolicy",
        "Bypass",
        "-File",
        &script.to_string_lossy(),
    ]);
    // Sin ventana y desacoplado del padre: si no, muere con la app. Va tras su
    // propio cfg para que el crate compile —y sus tests corran— fuera de Windows.
    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        const DETACHED_PROCESS: u32 = 0x0000_0008;
        const CREATE_NO_WINDOW: u32 = 0x0800_0000;
        relanzador.creation_flags(DETACHED_PROCESS | CREATE_NO_WINDOW);
    }
    relanzador.spawn().map_err(|e| e.to_string())?;

    pipeline::diag(&app, "Updater: relanzamiento programado");
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    /// El script se arma con `format!`, donde una llave mal escapada no se nota
    /// hasta que falla en producción. Además lo vuelca a disco para poder
    /// validarlo con el parser de PowerShell.
    #[test]
    fn el_script_relanzador_sale_entero() {
        let s = script_relanzador(r"C:\Users\x\AppData\Local\Dicho\mike.exe");
        assert!(s.starts_with('\u{feff}'), "falta el BOM");
        assert!(s.contains(r"$exe = 'C:\Users\x\AppData\Local\Dicho\mike.exe'"));
        assert!(s.contains("while ((Get-Process mike"), "falta la espera");
        assert!(
            s.contains("try { Start-Process $exe } catch {}"),
            "llaves mal escapadas por format!"
        );
        assert!(!s.contains("{{"), "quedaron llaves dobles de format!");
        let ruta = std::env::temp_dir().join("dicho-relanzar-test.ps1");
        std::fs::write(&ruta, &s).unwrap();
        eprintln!("script volcado en {}", ruta.display());
    }
}
