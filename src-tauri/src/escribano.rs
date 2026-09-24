//! Modo escribano: la onda se ofrece a corregir lo que acabas de copiar.
//!
//! # El gesto
//!
//! Seleccionas texto donde sea, lo copias **tú** con el atajo que use esa app, y
//! la onda —que está clavada, para eso se fuerza— cambia a la carita de la pluma
//! y espera. Un clic encima y lo corrige. El atajo de teclado sigue existiendo
//! como segundo camino, para cuando ya tienes las manos ahí.
//!
//! # Por qué vigila el portapapeles en vez de leer la selección
//!
//! Porque **no se puede leer la selección sin romper cosas**. Windows no tiene
//! una API general para «qué hay seleccionado», así que la forma habitual es
//! sintetizar un Ctrl+C y mirar qué aparece. Eso es lo que hacía la primera
//! versión y le cerraba al usuario las conversaciones de Claude Code: en una
//! terminal Ctrl+C no copia, **interrumpe**. Ver `inject::leer_seleccion`.
//!
//! Vigilar el portapapeles cuesta un paso más al usuario —copiar— y a cambio
//! Dicho no pulsa ni una tecla que él no haya pulsado. Es el intercambio
//! correcto.
//!
//! # Por qué sondea en vez de suscribirse
//!
//! Windows sí avisa de los cambios del portapapeles
//! (`AddClipboardFormatListener`), pero exige una ventana con su bucle de
//! mensajes para recibirlos. Sondear cada 400 ms es una lectura de memoria
//! compartida: no se nota, y evita montar una ventana fantasma sólo para esto.

use crate::settings::SettingsState;
use std::sync::atomic::{AtomicBool, AtomicIsize, AtomicU64, Ordering};
use std::sync::{Mutex, OnceLock};
use std::time::Duration;
use tauri::AppHandle;

/// Cada cuánto se mira el portapapeles.
const SONDEO: Duration = Duration::from_millis(400);

/// Cuánto se queda la onda ofreciéndose antes de volver a lo suyo.
///
/// Lo justo para decidir si la quieres: en la onda no hay nada que leer, el
/// texto se lee en la revisión. Eran 20 s y Luis pidió 8, porque casi siempre
/// copias por otro motivo y 20 s de onda plantada delante eran demasiados.
const ESPERA: Duration = Duration::from_secs(8);

/// Lo último que vio el vigilante. Sirve para dos cosas: detectar el cambio, y
/// que **lo que escribimos nosotros no se cuente como copia del usuario** — sin
/// esto, guardar el texto corregido en el portapapeles rearmaría el escribano
/// con su propia salida, en bucle.
static VISTO: OnceLock<Mutex<String>> = OnceLock::new();

/// El escribano está armado y esperando un clic.
pub static ARMADO: AtomicBool = AtomicBool::new(false);

/// La ventana que tenía el foco cuando el usuario copió.
///
/// Se apunta **antes** de abrir la revisión, porque abrirla se lleva el foco: sin
/// esto, «Sustituir» pegaría dentro de la propia ventana de revisión.
static FOCO: AtomicIsize = AtomicIsize::new(0);

pub fn recordar_foco() {
    FOCO.store(crate::overlay::ventana_al_frente(), Ordering::SeqCst);
}

pub fn foco_anterior() -> isize {
    FOCO.load(Ordering::SeqCst)
}

fn visto() -> &'static Mutex<String> {
    VISTO.get_or_init(|| Mutex::new(String::new()))
}

/// Apunta un texto como «ya visto» para que el vigilante no lo tome por una
/// copia nueva. Lo llama quien deja algo en el portapapeles a propósito.
pub fn ya_visto(texto: &str) {
    if let Ok(mut v) = visto().lock() {
        *v = texto.to_string();
    }
}

/// Baja la bandera: ya se usó, o se acabó el tiempo.
pub fn desarmar() {
    ARMADO.store(false, Ordering::SeqCst);
}

/// El contador de cambios del portapapeles que lleva Windows. Leerlo no abre
/// el portapapeles ni copia nada: si no cambió, no hay nada que mirar. 0 = no
/// se sabe (o no es Windows) y se lee como siempre.
#[cfg(windows)]
fn version_portapapeles() -> u32 {
    unsafe { windows_sys::Win32::System::DataExchange::GetClipboardSequenceNumber() }
}

#[cfg(not(windows))]
fn version_portapapeles() -> u32 {
    0
}

/// ¿La ventana del frente es de Dicho? Fuera de Windows no se sabe y dice que no.
fn dicho_al_frente() -> bool {
    let propio = std::env::current_exe()
        .ok()
        .and_then(|p| p.file_name().map(|n| n.to_string_lossy().to_lowercase()));
    propio.is_some() && crate::overlay::proceso_al_frente() == propio
}

/// Arranca el vigilante. Una sola vez, al inicio de la app.
pub fn vigilar(app: AppHandle, settings: SettingsState) {
    std::thread::spawn(move || {
        // La primera lectura no cuenta: lo que ya hubiera en el portapapeles al
        // arrancar la app no es una copia que el usuario acabe de hacer.
        if let Ok(mut c) = arboard::Clipboard::new() {
            if let Ok(t) = c.get_text() {
                ya_visto(&t);
            }
        }
        let mut ultima = version_portapapeles();
        loop {
            std::thread::sleep(SONDEO);
            let activo = settings
                .read()
                .map(|s| !s.corregir_atajo.is_empty())
                .unwrap_or(false);
            if !activo || crate::pipeline::grabando() {
                continue;
            }
            // Abrir el portapapeles y copiar su texto entero cada 400 ms, sin
            // que haya cambiado nada, bloquea a las demás apps mientras dura.
            let version = version_portapapeles();
            if version != 0 && version == ultima {
                continue;
            }
            let Ok(mut c) = arboard::Clipboard::new() else {
                continue;
            };
            let leido = c.get_text();
            // Si otra app lo tenía abierto, se reintenta en la vuelta siguiente.
            if !matches!(leido, Err(arboard::Error::ClipboardOccupied)) {
                ultima = version;
            }
            let Ok(texto) = leido else { continue };
            if texto.trim().is_empty() {
                continue;
            }
            {
                let Ok(mut v) = visto().lock() else { continue };
                if *v == texto {
                    continue;
                }
                *v = texto.clone();
            }
            // Sin key de Groq no hay con qué corregir: ofrecerse es prometer
            // algo que al hacer clic acaba en un error, y en cada Ctrl+C del
            // día. Se mira aquí, con una copia nueva ya confirmada, y no en
            // cada vuelta: el Administrador de credenciales no es gratis.
            if crate::stt::groq::get_api_key().is_err() {
                continue;
            }
            // Lo que se copia con Dicho al frente —desde la revisión, o lo que
            // pone ahí «Copiar otra vez»— no es una copia nueva: ofrecerse
            // encima de la revisión, y apuntarla como ventana de destino, haría
            // que «Sustituir» pegara dentro de la propia revisión.
            if dicho_al_frente() {
                continue;
            }
            // Copió algo nuevo: la onda se ofrece. Y se apunta dónde estaba,
            // que es donde habrá que devolver el texto si pulsa «Sustituir».
            recordar_foco();
            crate::pipeline::armar_escribano(&app, &texto);
        }
    });
}

/// Cada oferta nueva invalida el plazo de la anterior.
static OFERTA: AtomicU64 = AtomicU64::new(0);

/// Programa el desarme: si nadie pulsa, la onda vuelve a lo suyo.
pub fn desarmar_luego(app: AppHandle) {
    let mia = OFERTA.fetch_add(1, Ordering::SeqCst) + 1;
    std::thread::spawn(move || {
        std::thread::sleep(ESPERA);
        // Sólo caduca la última oferta: una copia nueva reinicia la cuenta.
        if OFERTA.load(Ordering::SeqCst) == mia && ARMADO.swap(false, Ordering::SeqCst) {
            crate::pipeline::escribano_expirado(&app);
        }
    });
}
