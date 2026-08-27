//! Superposición del HUD en Windows: en qué monitor aparece y cómo se mantiene
//! por encima de todo sin robar el foco.
//!
//! Antes el HUD se colocaba siempre en el monitor primario, así que con dos
//! pantallas aparecía en la que el usuario no estaba mirando (parecía que "no
//! salía"). Ahora se ancla al monitor de la ventana en primer plano —la misma
//! donde se va a inyectar el texto— y se reafirma el z-order tope, porque
//! Windows mete cada ventana topmost nueva por encima de las anteriores.

/// Área de trabajo (sin barra de tareas) en píxeles físicos: (x, y, ancho, alto).
pub type WorkArea = (i32, i32, i32, i32);

#[cfg(windows)]
pub fn active_work_area() -> Option<WorkArea> {
    use windows_sys::Win32::Foundation::POINT;
    use windows_sys::Win32::Graphics::Gdi::{
        GetMonitorInfoW, MonitorFromPoint, MonitorFromWindow, HMONITOR, MONITORINFO,
        MONITOR_DEFAULTTONEAREST, MONITOR_DEFAULTTOPRIMARY,
    };
    use windows_sys::Win32::UI::WindowsAndMessaging::{GetCursorPos, GetForegroundWindow};

    unsafe {
        let fg = GetForegroundWindow();
        let mon: HMONITOR = if !fg.is_null() {
            MonitorFromWindow(fg, MONITOR_DEFAULTTONEAREST)
        } else {
            // Sin ventana activa (escritorio, bloqueo): el monitor del cursor.
            let mut pt = POINT { x: 0, y: 0 };
            if GetCursorPos(&mut pt) != 0 {
                MonitorFromPoint(pt, MONITOR_DEFAULTTONEAREST)
            } else {
                MonitorFromPoint(POINT { x: 0, y: 0 }, MONITOR_DEFAULTTOPRIMARY)
            }
        };
        if mon.is_null() {
            return None;
        }
        let mut info: MONITORINFO = std::mem::zeroed();
        info.cbSize = std::mem::size_of::<MONITORINFO>() as u32;
        if GetMonitorInfoW(mon, &mut info) == 0 {
            return None;
        }
        let r = info.rcWork;
        Some((r.left, r.top, r.right - r.left, r.bottom - r.top))
    }
}

#[cfg(not(windows))]
pub fn active_work_area() -> Option<WorkArea> {
    None
}

/// HWND de una ventana de Tauri como entero (así cruza hilos sin punteros).
#[cfg(windows)]
pub fn hwnd_of(win: &tauri::WebviewWindow) -> Option<isize> {
    win.hwnd().ok().map(|h| h.0 as isize)
}

#[cfg(not(windows))]
pub fn hwnd_of(_win: &tauri::WebviewWindow) -> Option<isize> {
    None
}

/// Reinserta la ventana en lo alto de la banda "topmost" sin activarla.
/// Hay que repetirlo: cualquier otra app que se declare topmost después
/// (notificaciones, instaladores, overlays) queda por encima si no.
#[cfg(windows)]
pub fn assert_topmost(hwnd: isize) {
    use windows_sys::Win32::UI::WindowsAndMessaging::{
        SetWindowPos, HWND_TOPMOST, SWP_NOACTIVATE, SWP_NOMOVE, SWP_NOOWNERZORDER, SWP_NOSIZE,
    };
    if hwnd == 0 {
        return;
    }
    unsafe {
        SetWindowPos(
            hwnd as *mut core::ffi::c_void,
            HWND_TOPMOST,
            0,
            0,
            0,
            0,
            SWP_NOMOVE | SWP_NOSIZE | SWP_NOACTIVATE | SWP_NOOWNERZORDER,
        );
    }
}

#[cfg(not(windows))]
pub fn assert_topmost(_hwnd: isize) {}
