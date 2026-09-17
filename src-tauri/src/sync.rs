//! Sincronización de diccionario e historial entre dispositivos vía la
//! cuenta de Google del usuario: OAuth de escritorio (PKCE + loopback) y un
//! archivo JSON en el appDataFolder privado de su Drive. Sin servidor propio.

use anyhow::{anyhow, bail, Context};
use base64::engine::general_purpose::URL_SAFE_NO_PAD;
use base64::Engine as _;
use rand::RngCore;
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use std::io::{Read, Write};
use std::net::TcpListener;
use std::sync::Arc;
use std::time::{Duration, Instant, SystemTime, UNIX_EPOCH};
use tauri::{AppHandle, Emitter, Manager};
use tauri_plugin_opener::OpenerExt;

use crate::settings::SettingsState;
use crate::store::Store;
use crate::stt::groq::KEYRING_SERVICE;

const KEYRING_GOOGLE: &str = "google_refresh_token";
const AUTH_URL: &str = "https://accounts.google.com/o/oauth2/v2/auth";
const TOKEN_URL: &str = "https://oauth2.googleapis.com/token";
const REVOKE_URL: &str = "https://oauth2.googleapis.com/revoke";
const DRIVE_FILES: &str = "https://www.googleapis.com/drive/v3/files";
const DRIVE_UPLOAD: &str = "https://www.googleapis.com/upload/drive/v3/files";
const SCOPE: &str = "openid email https://www.googleapis.com/auth/drive.appdata";
const SYNC_FILE: &str = "dicho-sync.json";
const META_EMAIL: &str = "google_email";
const META_LAST_SYNC: &str = "last_sync_ms";
/// Tope de dictados que viajan en el archivo de sync.
const SYNC_HISTORY_LIMIT: u32 = 2000;

#[derive(Debug, Serialize)]
pub struct GoogleStatus {
    pub configured: bool,
    pub email: Option<String>,
    pub last_sync_ms: Option<i64>,
}

#[derive(Serialize, Deserialize, Default)]
struct SyncData {
    #[serde(default)]
    dictionary: Vec<SyncDict>,
    #[serde(default)]
    history: Vec<SyncHist>,
}

#[derive(Serialize, Deserialize)]
struct SyncDict {
    term: String,
    replacement: Option<String>,
}

#[derive(Serialize, Deserialize)]
struct SyncHist {
    ts: i64,
    raw: String,
    polished: String,
    engine: String,
    duration_ms: i64,
    #[serde(default)]
    corrections: serde_json::Value,
}

#[derive(Deserialize)]
struct TokenResponse {
    access_token: String,
    #[serde(default)]
    refresh_token: Option<String>,
    #[serde(default)]
    id_token: Option<String>,
}

fn keyring_entry() -> anyhow::Result<keyring::Entry> {
    keyring::Entry::new(KEYRING_SERVICE, KEYRING_GOOGLE)
        .context("No se pudo abrir el almacén de credenciales")
}

pub fn has_session() -> bool {
    keyring_entry().and_then(|e| e.get_password().map_err(Into::into)).is_ok()
}

fn credentials(app: &AppHandle) -> anyhow::Result<(String, String)> {
    // `try_state` por lo mismo que en `status`: a esto se llega desde el
    // frontend, y `state()` no devuelve un error cuando el estado aún no está
    // — aborta el proceso. Hoy los ajustes se registran antes de que exista la
    // primera ventana (ver `run()`), así que no debería pasar nunca; esto es el
    // cinturón además del tirante, porque el precio de equivocarse es que la
    // app no abra y no deje ni una línea en el log.
    let Some(state) = app.try_state::<SettingsState>() else {
        bail!("Los ajustes todavía no están listos");
    };
    let s = state.read().unwrap();
    let id = s.google_client_id.trim().to_string();
    let secret = s.google_client_secret.trim().to_string();
    if id.is_empty() || secret.is_empty() {
        bail!("Falta configurar el cliente OAuth de Google (Ajustes → Cuenta de Google)");
    }
    Ok((id, secret))
}

pub fn status(app: &AppHandle) -> GoogleStatus {
    let configured = credentials(app).is_ok();
    // `try_state` y no `state`: éste es de los poquísimos sitios a los que se
    // puede llegar **antes** de que el arranque registre la base de datos, y
    // `state` en ese caso no devuelve un error, revienta el proceso entero.
    //
    // Pasó de verdad y costó encontrarlo (16/09, la 0.11.2). La ventana de
    // Ajustes nace visible, así que su webview carga en paralelo al arranque y
    // llama a `google_status` nada más montarse. Normalmente llega tarde y no
    // se nota; en el primer arranque después de actualizar, el relanzador y el
    // instalador levantan dos instancias, el plugin de instancia única hace
    // `focus_main` en la que sobrevive, ese `show()` acelera el webview y la
    // llamada adelanta al registro. Resultado: la app no abría, y sin una sola
    // línea en el log porque moría antes de escribir.
    //
    // Sin base de datos todavía, lo honesto es contestar lo que se sabe: si el
    // cliente OAuth está configurado. El correo y la última sincronización
    // salen en cuanto el frontend vuelva a preguntar.
    let store = app.try_state::<Arc<Store>>();
    GoogleStatus {
        configured,
        email: match (&store, has_session()) {
            (Some(s), true) => s.meta_get(META_EMAIL),
            _ => None,
        },
        last_sync_ms: store
            .as_ref()
            .and_then(|s| s.meta_get(META_LAST_SYNC))
            .and_then(|v| v.parse().ok()),
    }
}

fn b64url_random(bytes: usize) -> String {
    let mut buf = vec![0u8; bytes];
    rand::thread_rng().fill_bytes(&mut buf);
    URL_SAFE_NO_PAD.encode(buf)
}

/// El payload del id_token viene directo de Google por TLS: se decodifica
/// sin verificar firma porque solo se usa para mostrar el email.
fn email_from_id_token(id_token: &str) -> Option<String> {
    let payload = id_token.split('.').nth(1)?;
    let json: serde_json::Value =
        serde_json::from_slice(&URL_SAFE_NO_PAD.decode(payload).ok()?).ok()?;
    json["email"].as_str().map(String::from)
}

/// Espera el redirect del navegador en el puerto loopback y extrae el code.
/// Ignora peticiones ajenas (favicon, preconnect) hasta 5 minutos.
fn wait_for_code(listener: TcpListener, expected_state: String) -> anyhow::Result<String> {
    listener.set_nonblocking(true)?;
    let deadline = Instant::now() + Duration::from_secs(300);
    loop {
        let (mut stream, _) = match listener.accept() {
            Ok(pair) => pair,
            Err(ref e) if e.kind() == std::io::ErrorKind::WouldBlock => {
                if Instant::now() > deadline {
                    bail!("Se agotó el tiempo de espera del login en el navegador");
                }
                std::thread::sleep(Duration::from_millis(200));
                continue;
            }
            Err(e) => return Err(e.into()),
        };
        stream.set_nonblocking(false)?;
        stream.set_read_timeout(Some(Duration::from_secs(10)))?;
        let mut buf = [0u8; 4096];
        let n = stream.read(&mut buf).unwrap_or(0);
        let req = String::from_utf8_lossy(&buf[..n]);
        let path = req
            .lines()
            .next()
            .and_then(|l| l.split_whitespace().nth(1))
            .unwrap_or("/")
            .to_string();
        let url = match reqwest::Url::parse(&format!("http://127.0.0.1{path}")) {
            Ok(u) => u,
            Err(_) => continue,
        };
        let mut code = None;
        let mut got_state = None;
        let mut oauth_err = None;
        for (k, v) in url.query_pairs() {
            match k.as_ref() {
                "code" => code = Some(v.into_owned()),
                "state" => got_state = Some(v.into_owned()),
                "error" => oauth_err = Some(v.into_owned()),
                _ => {}
            }
        }
        if code.is_none() && oauth_err.is_none() {
            // Petición ajena al OAuth: respóndele algo y sigue esperando.
            let _ = stream.write_all(b"HTTP/1.1 404 Not Found\r\nConnection: close\r\n\r\n");
            continue;
        }
        let ok = code.is_some() && got_state.as_deref() == Some(expected_state.as_str());
        let body = if ok {
            "<html><body style=\"font-family:sans-serif;text-align:center;padding-top:4rem\"><h2>Listo &#10003;</h2><p>Ya puedes cerrar esta pesta&ntilde;a y volver a Dicho.</p></body></html>"
        } else {
            "<html><body style=\"font-family:sans-serif;text-align:center;padding-top:4rem\"><h2>Algo fall&oacute;</h2><p>Vuelve a Dicho e int&eacute;ntalo de nuevo.</p></body></html>"
        };
        let resp = format!(
            "HTTP/1.1 200 OK\r\nContent-Type: text/html; charset=utf-8\r\nContent-Length: {}\r\nConnection: close\r\n\r\n{}",
            body.len(),
            body
        );
        let _ = stream.write_all(resp.as_bytes());
        if let Some(e) = oauth_err {
            bail!("Google devolvió un error: {e}");
        }
        if !ok {
            bail!("La respuesta OAuth no coincide con esta sesión (state inválido)");
        }
        return Ok(code.unwrap());
    }
}

pub async fn login(app: AppHandle) -> anyhow::Result<GoogleStatus> {
    let (client_id, client_secret) = credentials(&app)?;

    let verifier = b64url_random(48);
    let challenge = URL_SAFE_NO_PAD.encode(Sha256::digest(verifier.as_bytes()));
    let state = b64url_random(16);

    let listener =
        TcpListener::bind("127.0.0.1:0").context("No se pudo abrir el puerto local")?;
    let redirect = format!("http://127.0.0.1:{}", listener.local_addr()?.port());

    let url = reqwest::Url::parse_with_params(
        AUTH_URL,
        &[
            ("client_id", client_id.as_str()),
            ("redirect_uri", redirect.as_str()),
            ("response_type", "code"),
            ("scope", SCOPE),
            ("code_challenge", challenge.as_str()),
            ("code_challenge_method", "S256"),
            ("access_type", "offline"),
            ("prompt", "consent"),
            ("state", state.as_str()),
        ],
    )?;
    app.opener()
        .open_url(url.as_str(), None::<&str>)
        .context("No se pudo abrir el navegador")?;

    let code =
        tauri::async_runtime::spawn_blocking(move || wait_for_code(listener, state)).await??;

    let client = reqwest::Client::new();
    let resp = client
        .post(TOKEN_URL)
        .form(&[
            ("code", code.as_str()),
            ("client_id", client_id.as_str()),
            ("client_secret", client_secret.as_str()),
            ("redirect_uri", redirect.as_str()),
            ("grant_type", "authorization_code"),
            ("code_verifier", verifier.as_str()),
        ])
        .send()
        .await?;
    if !resp.status().is_success() {
        let detail = resp.text().await.unwrap_or_default();
        bail!("Google rechazó el intercambio de tokens: {detail}");
    }
    let token: TokenResponse = resp.json().await?;
    let refresh = token
        .refresh_token
        .ok_or_else(|| anyhow!("Google no entregó refresh token"))?;
    keyring_entry()?
        .set_password(&refresh)
        .context("No se pudo guardar la sesión")?;

    if let Some(email) = token.id_token.as_deref().and_then(email_from_id_token) {
        app.state::<Arc<Store>>().meta_set(META_EMAIL, &email)?;
    }

    if let Err(e) = sync_now(app.clone()).await {
        log::warn!("La sincronización inicial falló: {e}");
    }
    Ok(status(&app))
}

async fn access_token(client: &reqwest::Client, app: &AppHandle) -> anyhow::Result<String> {
    let (client_id, client_secret) = credentials(app)?;
    let entry = keyring_entry()?;
    let refresh = entry
        .get_password()
        .map_err(|_| anyhow!("No hay sesión de Google iniciada"))?;
    let resp = client
        .post(TOKEN_URL)
        .form(&[
            ("refresh_token", refresh.as_str()),
            ("client_id", client_id.as_str()),
            ("client_secret", client_secret.as_str()),
            ("grant_type", "refresh_token"),
        ])
        .send()
        .await?;
    if !resp.status().is_success() {
        let detail = resp.text().await.unwrap_or_default();
        if detail.contains("invalid_grant") {
            let _ = entry.delete_credential();
            bail!("La sesión de Google expiró; vuelve a iniciar sesión");
        }
        bail!("No se pudo refrescar la sesión de Google: {detail}");
    }
    Ok(resp.json::<TokenResponse>().await?.access_token)
}

fn export_local(store: &Store) -> anyhow::Result<SyncData> {
    let dictionary = store
        .dict_list()?
        .into_iter()
        .map(|d| SyncDict {
            term: d.term,
            replacement: d.replacement,
        })
        .collect();
    let history = store
        .list_history(None, SYNC_HISTORY_LIMIT)?
        .into_iter()
        .map(|h| SyncHist {
            ts: h.ts,
            raw: h.raw,
            polished: h.polished,
            engine: h.engine,
            duration_ms: h.duration_ms,
            corrections: h.corrections,
        })
        .collect();
    Ok(SyncData {
        dictionary,
        history,
    })
}

fn corrections_to_json(v: &serde_json::Value) -> Option<String> {
    match v {
        serde_json::Value::Array(a) if !a.is_empty() => serde_json::to_string(v).ok(),
        _ => None,
    }
}

/// Fusión bidireccional: baja lo remoto, lo integra al SQLite local
/// (sin duplicar) y sube el estado combinado completo.
pub async fn sync_now(app: AppHandle) -> anyhow::Result<GoogleStatus> {
    let client = reqwest::Client::new();
    let token = access_token(&client, &app).await?;
    let auth = format!("Bearer {token}");
    let store = app.state::<Arc<Store>>().inner().clone();

    let list: serde_json::Value = client
        .get(DRIVE_FILES)
        .header("Authorization", &auth)
        .query(&[
            ("spaces", "appDataFolder"),
            ("q", "name = 'dicho-sync.json'"),
            ("fields", "files(id)"),
        ])
        .send()
        .await?
        .error_for_status()
        .context("No se pudo consultar Drive")?
        .json()
        .await?;
    let file_id = list["files"]
        .as_array()
        .and_then(|a| a.first())
        .and_then(|f| f["id"].as_str())
        .map(String::from);

    if let Some(id) = &file_id {
        let remote: SyncData = client
            .get(format!("{DRIVE_FILES}/{id}"))
            .header("Authorization", &auth)
            .query(&[("alt", "media")])
            .send()
            .await?
            .error_for_status()
            .context("No se pudo descargar el archivo de sincronización")?
            .json()
            .await
            .unwrap_or_default();
        let dict_pairs: Vec<_> = remote
            .dictionary
            .iter()
            .map(|d| (d.term.clone(), d.replacement.clone()))
            .collect();
        let added_dict = store.merge_dict(&dict_pairs)?;
        let hist_rows: Vec<_> = remote
            .history
            .iter()
            .map(|h| {
                (
                    h.ts,
                    h.raw.clone(),
                    h.polished.clone(),
                    h.engine.clone(),
                    h.duration_ms,
                    corrections_to_json(&h.corrections),
                )
            })
            .collect();
        let added_hist = store.merge_history(&hist_rows)?;
        if added_dict > 0 {
            let _ = app.emit("dict-changed", ());
        }
        if added_hist > 0 {
            let _ = app.emit("history-changed", ());
        }
        log::info!("Sync: +{added_dict} términos y +{added_hist} dictados desde remoto");
    }

    let body = serde_json::to_vec(&export_local(&store)?)?;
    if let Some(id) = &file_id {
        client
            .patch(format!("{DRIVE_UPLOAD}/{id}?uploadType=media"))
            .header("Authorization", &auth)
            .header("Content-Type", "application/json")
            .body(body)
            .send()
            .await?
            .error_for_status()
            .context("No se pudo subir el archivo de sincronización")?;
    } else {
        // Alta inicial: multipart/related con metadatos + contenido.
        let boundary = "dicho_sync_multipart";
        let meta = serde_json::json!({ "name": SYNC_FILE, "parents": ["appDataFolder"] });
        let mp = format!(
            "--{boundary}\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n{meta}\r\n--{boundary}\r\nContent-Type: application/json\r\n\r\n{}\r\n--{boundary}--\r\n",
            String::from_utf8_lossy(&body)
        );
        client
            .post(format!("{DRIVE_UPLOAD}?uploadType=multipart"))
            .header("Authorization", &auth)
            .header(
                "Content-Type",
                format!("multipart/related; boundary={boundary}"),
            )
            .body(mp)
            .send()
            .await?
            .error_for_status()
            .context("No se pudo crear el archivo de sincronización")?;
    }

    let now_ms = SystemTime::now().duration_since(UNIX_EPOCH)?.as_millis() as i64;
    store.meta_set(META_LAST_SYNC, &now_ms.to_string())?;
    Ok(status(&app))
}

pub async fn logout(app: AppHandle) -> anyhow::Result<()> {
    if let Ok(entry) = keyring_entry() {
        if let Ok(token) = entry.get_password() {
            let _ = reqwest::Client::new()
                .post(REVOKE_URL)
                .form(&[("token", token.as_str())])
                .send()
                .await;
        }
        let _ = entry.delete_credential();
    }
    let store = app.state::<Arc<Store>>();
    let _ = store.meta_del(META_EMAIL);
    let _ = store.meta_del(META_LAST_SYNC);
    Ok(())
}
