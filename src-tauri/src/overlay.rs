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

/// Área de trabajo de un monitor concreto.
#[cfg(windows)]
unsafe fn area_de(mon: windows_sys::Win32::Graphics::Gdi::HMONITOR) -> Option<WorkArea> {
    use windows_sys::Win32::Graphics::Gdi::{GetMonitorInfoW, MONITORINFO};
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

#[cfg(windows)]
pub fn active_work_area() -> Option<WorkArea> {
    use windows_sys::Win32::Foundation::POINT;
    use windows_sys::Win32::Graphics::Gdi::{
        MonitorFromPoint, MonitorFromWindow, HMONITOR, MONITOR_DEFAULTTONEAREST,
        MONITOR_DEFAULTTOPRIMARY,
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
        area_de(mon)
    }
}

#[cfg(not(windows))]
pub fn active_work_area() -> Option<WorkArea> {
    None
}

/// Área de trabajo del monitor donde está *esa* ventana. Al soltar el HUD hay
/// que medirlo contra la pantalla en la que quedó, que no tiene por qué ser la
/// de la ventana activa: se puede arrastrar a la otra sin cambiar de foco.
#[cfg(windows)]
pub fn work_area_of(hwnd: isize) -> Option<WorkArea> {
    use windows_sys::Win32::Graphics::Gdi::{MonitorFromWindow, MONITOR_DEFAULTTONEAREST};
    if hwnd == 0 {
        return None;
    }
    unsafe {
        area_de(MonitorFromWindow(
            hwnd as *mut core::ffi::c_void,
            MONITOR_DEFAULTTONEAREST,
        ))
    }
}

#[cfg(not(windows))]
pub fn work_area_of(_hwnd: isize) -> Option<WorkArea> {
    None
}

/// Rectángulo de una ventana en píxeles físicos: (x, y, ancho, alto).
#[cfg(windows)]
pub fn window_rect(hwnd: isize) -> Option<WorkArea> {
    use windows_sys::Win32::Foundation::RECT;
    use windows_sys::Win32::UI::WindowsAndMessaging::GetWindowRect;
    if hwnd == 0 {
        return None;
    }
    unsafe {
        let mut r: RECT = std::mem::zeroed();
        if GetWindowRect(hwnd as *mut core::ffi::c_void, &mut r) == 0 {
            return None;
        }
        Some((r.left, r.top, r.right - r.left, r.bottom - r.top))
    }
}

#[cfg(not(windows))]
pub fn window_rect(_hwnd: isize) -> Option<WorkArea> {
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

/// Pega la ventana al cursor hasta que se suelte el botón del ratón, y devuelve
/// dónde quedó.
///
/// No se usa el arrastre nativo de Windows (`WM_NCLBUTTONDOWN` con `HTCAPTION`,
/// que es lo que hace `start_dragging()` de Tauri): abre un bucle modal que
/// activa la ventana, y el HUD está declarado no activable a propósito para no
/// robarle el foco a lo que estás escribiendo. Seguir el cursor a mano cuesta
/// treinta líneas y no toca el foco de nadie.
///
/// Corre en su propio hilo: bloquea mientras dure el gesto.
#[cfg(windows)]
pub fn arrastrar_con_cursor(hwnd: isize) -> Option<WorkArea> {
    use windows_sys::Win32::Foundation::POINT;
    use windows_sys::Win32::UI::Input::KeyboardAndMouse::{
        GetAsyncKeyState, VK_LBUTTON, VK_RBUTTON,
    };
    use windows_sys::Win32::UI::WindowsAndMessaging::{
        GetCursorPos, GetSystemMetrics, SetWindowPos, HWND_TOPMOST, SM_SWAPBUTTON, SWP_NOACTIVATE,
        SWP_NOOWNERZORDER, SWP_NOSIZE,
    };

    if hwnd == 0 {
        return None;
    }
    let cursor = || unsafe {
        let mut pt = POINT { x: 0, y: 0 };
        (GetCursorPos(&mut pt) != 0).then_some(pt)
    };
    unsafe {
        // Con los botones invertidos (zurdos), el botón "principal" que el
        // webview reporta como primario es el físico derecho.
        let boton = if GetSystemMetrics(SM_SWAPBUTTON) != 0 {
            VK_RBUTTON
        } else {
            VK_LBUTTON
        };
        let apretado = || (GetAsyncKeyState(boton as i32) as u16) & 0x8000 != 0;

        let c0 = cursor()?;
        let (wx, wy, _, _) = window_rect(hwnd)?;
        // Tope de 60 s: si algo se traga el "botón soltado" (una sesión remota,
        // un cambio de escritorio), el hilo se va solo en vez de quedarse vivo.
        for _ in 0..7_500 {
            if !apretado() {
                break;
            }
            if let Some(c) = cursor() {
                SetWindowPos(
                    hwnd as *mut core::ffi::c_void,
                    HWND_TOPMOST,
                    wx + (c.x - c0.x),
                    wy + (c.y - c0.y),
                    0,
                    0,
                    SWP_NOSIZE | SWP_NOACTIVATE | SWP_NOOWNERZORDER,
                );
            }
            std::thread::sleep(std::time::Duration::from_millis(8));
        }
    }
    window_rect(hwnd)
}

#[cfg(not(windows))]
pub fn arrastrar_con_cursor(_hwnd: isize) -> Option<WorkArea> {
    None
}
