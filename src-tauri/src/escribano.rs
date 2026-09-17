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
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Mutex, OnceLock};
use std::time::Duration;
use tauri::AppHandle;

/// Cada cuánto se mira el portapapeles.
const SONDEO: Duration = Duration::from_millis(400);

/// Cuánto se queda la onda ofreciéndose antes de volver a lo suyo.
///
/// Suficiente para leer, seleccionar el siguiente trozo y decidir; poco para que
/// no se quede ahí plantada si copiaste algo por otro motivo, que es lo normal.
const ESPERA: Duration = Duration::from_secs(20);

/// Lo último que vio el vigilante. Sirve para dos cosas: detectar el cambio, y
/// que **lo que escribimos nosotros no se cuente como copia del usuario** — sin
/// esto, guardar el texto corregido en el portapapeles rearmaría el escribano
/// con su propia salida, en bucle.
static VISTO: OnceLock<Mutex<String>> = OnceLock::new();

/// El escribano está armado y esperando un clic.
pub static ARMADO: AtomicBool = AtomicBool::new(false);

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
        loop {
            std::thread::sleep(SONDEO);
            let activo = settings
                .read()
                .map(|s| !s.corregir_atajo.is_empty())
                .unwrap_or(false);
            if !activo || crate::pipeline::grabando() {
                continue;
            }
            let Ok(mut c) = arboard::Clipboard::new() else {
                continue;
            };
            let Ok(texto) = c.get_text() else { continue };
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
            // Copió algo nuevo: la onda se ofrece.
            crate::pipeline::armar_escribano(&app, &texto);
        }
    });
}

/// Programa el desarme: si nadie pulsa, la onda vuelve a lo suyo.
pub fn desarmar_luego(app: AppHandle) {
    std::thread::spawn(move || {
        std::thread::sleep(ESPERA);
        if ARMADO.swap(false, Ordering::SeqCst) {
            crate::pipeline::escribano_expirado(&app);
        }
    });
}
