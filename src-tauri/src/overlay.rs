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

/// Cuánto tiene que viajar el cursor en una dirección para que el cambio de
/// sentido cuente como vaivén. Por debajo, el pulso de la mano al arrastrar ya
/// disparaba el mareo sin querer.
const MENEO_AMPLITUD: i32 = 26;
/// Vaivenes seguidos que hacen un meneo. Cuatro son dos idas y dos vueltas:
/// bastante para que sea a propósito, poco para que no canse.
const MENEO_VAIVENES: u8 = 4;
/// Si entre dos vaivenes pasa más que esto, la cuenta vuelve a empezar: llevar
/// la onda de un lado a otro con calma no es zarandearla.
const MENEO_PAUSA_MS: u128 = 500;

/// Cuenta los zarandeos del ratón mientras arrastras la onda, para la carita
/// mareada. Cada vez que el cursor invierte el sentido horizontal habiendo
/// recorrido al menos `MENEO_AMPLITUD` desde el último giro, cuenta un vaivén;
/// con `MENEO_VAIVENES` seguidos y sin pausas largas, hay meneo.
///
/// Pieza aparte del bucle de arrastre —y sin Win32 dentro— para poder probarla
/// sin ratón ni ventana.
pub struct Meneo {
    sentido: i32,
    pivote: i32,
    vaivenes: u8,
    ultimo_giro_ms: u128,
}

impl Meneo {
    pub fn nuevo(x0: i32) -> Self {
        Self {
            sentido: 0,
            pivote: x0,
            vaivenes: 0,
            ultimo_giro_ms: 0,
        }
    }

    /// Le pasa la posición del cursor. Devuelve `true` en el instante exacto en
    /// que se completa un meneo (y deja la cuenta a cero para el siguiente).
    pub fn empuja(&mut self, x: i32, ahora_ms: u128) -> bool {
        let dx = x - self.pivote;
        if self.sentido == 0 {
            if dx.abs() >= MENEO_AMPLITUD {
                self.sentido = dx.signum();
                self.pivote = x;
            }
            return false;
        }
        if dx * self.sentido > 0 {
            // Sigue en la misma dirección: el pivote acompaña, así la amplitud
            // se mide siempre desde el punto más lejano del recorrido.
            self.pivote = x;
            return false;
        }
        if (dx * self.sentido).abs() < MENEO_AMPLITUD {
            return false;
        }
        if ahora_ms.saturating_sub(self.ultimo_giro_ms) > MENEO_PAUSA_MS {
            self.vaivenes = 0;
        }
        self.vaivenes += 1;
        self.ultimo_giro_ms = ahora_ms;
        self.sentido = -self.sentido;
        self.pivote = x;
        if self.vaivenes >= MENEO_VAIVENES {
            self.vaivenes = 0;
            return true;
        }
        false
    }
}

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

// ─── quién tiene el foco ────────────────────────────────────────────────────
//
// Lo usa la corrección al vuelo para saber dónde está escribiendo el usuario y,
// sobre todo, dónde **no** debe meterse.

/// La ventana que tiene el foco ahora mismo, o 0 si no hay ninguna.
#[cfg(windows)]
pub fn ventana_al_frente() -> isize {
    use windows_sys::Win32::UI::WindowsAndMessaging::GetForegroundWindow;
    unsafe { GetForegroundWindow() as isize }
}

#[cfg(not(windows))]
pub fn ventana_al_frente() -> isize {
    0
}

/// Nombre del ejecutable al que pertenece la ventana en primer plano, en
/// minúsculas y sin la ruta (`chrome.exe`, `code.exe`…).
///
/// Es lo que compara la lista de apps donde la corrección no actúa. Se pide con
/// `PROCESS_QUERY_LIMITED_INFORMATION` y no con el permiso completo: para leer
/// el nombre basta, y es el único que da un proceso elevado sin ser
/// administrador. Con el permiso completo, escribir en una ventana abierta como
/// administrador devolvería siempre `None` y la lista de vetados no se aplicaría
/// justo donde más importa.
#[cfg(windows)]
pub fn proceso_al_frente() -> Option<String> {
    use windows_sys::Win32::Foundation::CloseHandle;
    use windows_sys::Win32::System::Threading::{
        OpenProcess, QueryFullProcessImageNameW, PROCESS_NAME_WIN32,
        PROCESS_QUERY_LIMITED_INFORMATION,
    };
    use windows_sys::Win32::UI::WindowsAndMessaging::{
        GetForegroundWindow, GetWindowThreadProcessId,
    };

    unsafe {
        let hwnd = GetForegroundWindow();
        if hwnd.is_null() {
            return None;
        }
        let mut pid: u32 = 0;
        GetWindowThreadProcessId(hwnd, &mut pid);
        if pid == 0 {
            return None;
        }
        let h = OpenProcess(PROCESS_QUERY_LIMITED_INFORMATION, 0, pid);
        if h.is_null() {
            return None;
        }
        let mut buf = [0u16; 260];
        let mut len = buf.len() as u32;
        let ok = QueryFullProcessImageNameW(h, PROCESS_NAME_WIN32, buf.as_mut_ptr(), &mut len);
        CloseHandle(h);
        if ok == 0 {
            return None;
        }
        let ruta = String::from_utf16_lossy(&buf[..len as usize]);
        Some(
            ruta.rsplit(['\\', '/'])
                .next()
                .unwrap_or(&ruta)
                .to_lowercase(),
        )
    }
}

#[cfg(not(windows))]
pub fn proceso_al_frente() -> Option<String> {
    None
}

/// Devuelve el foco a una ventana concreta.
///
/// Windows **no deja** que cualquier proceso robe el primer plano: si no eres tú
/// quien tiene el foco, `SetForegroundWindow` se ignora en silencio y devuelve
/// éxito. El rodeo conocido es simular una pulsación de ALT justo antes, que es
/// lo que hace creer al sistema que hay intención del usuario detrás.
///
/// Aquí sí la hay —acaba de pulsar «Sustituir»— pero al sistema eso no le
/// consta, así que el rodeo hace falta igual.
#[cfg(windows)]
pub fn devolver_foco(hwnd: isize) -> bool {
    use windows_sys::Win32::UI::Input::KeyboardAndMouse::{
        keybd_event, KEYEVENTF_KEYUP, VK_MENU,
    };
    use windows_sys::Win32::UI::WindowsAndMessaging::{IsWindow, SetForegroundWindow};

    if hwnd == 0 {
        return false;
    }
    unsafe {
        let h = hwnd as *mut core::ffi::c_void;
        // La ventana pudo cerrarse mientras el usuario leía la corrección.
        if IsWindow(h) == 0 {
            return false;
        }
        keybd_event(VK_MENU as u8, 0, 0, 0);
        let ok = SetForegroundWindow(h) != 0;
        keybd_event(VK_MENU as u8, 0, KEYEVENTF_KEYUP, 0);
        ok
    }
}

#[cfg(not(windows))]
pub fn devolver_foco(_hwnd: isize) -> bool {
    false
}

/// ¿El control que tiene el foco es un campo de contraseña?
///
/// **Sólo lo sabe cuando el control es nativo de Windows.** Un `EDIT` con el
/// estilo de contraseña contesta a `EM_GETPASSWORDCHAR` con el carácter que
/// pinta en vez de las letras. En Chrome, Edge, Electron o cualquier app que se
/// dibuje su propia interfaz **no hay nada que preguntar**: el sistema ve una
/// sola superficie de dibujo y el campo de contraseña vive dentro, fuera del
/// alcance de Win32. Ahí esto devuelve `false` y no queda más remedio que
/// confiar en las otras dos protecciones — la lista de apps vetadas, y que la
/// tabla de correcciones sólo contenga palabras castellanas.
///
/// Se pregunta con `SendMessageTimeout` y no con `SendMessage`: el mensaje va a
/// la ventana de **otro proceso**, así que a secas se queda esperando a que esa
/// app conteste, y una app colgada colgaría con ella el hilo del corrector.
#[cfg(windows)]
pub fn es_campo_password() -> bool {
    use windows_sys::Win32::UI::WindowsAndMessaging::{
        GetGUIThreadInfo, SendMessageTimeoutW, GUITHREADINFO, SMTO_ABORTIFHUNG,
    };

    /// `EM_GETPASSWORDCHAR`: devuelve el carácter con el que el control tapa lo
    /// que escribes, o 0 si no tapa nada.
    const EM_GETPASSWORDCHAR: u32 = 0x00D2;

    unsafe {
        let mut gti: GUITHREADINFO = std::mem::zeroed();
        gti.cbSize = std::mem::size_of::<GUITHREADINFO>() as u32;
        // Hilo 0 = el del primer plano, que es el único que nos interesa.
        if GetGUIThreadInfo(0, &mut gti) == 0 || gti.hwndFocus.is_null() {
            return false;
        }
        let mut res: usize = 0;
        let ok = SendMessageTimeoutW(
            gti.hwndFocus,
            EM_GETPASSWORDCHAR,
            0,
            0,
            SMTO_ABORTIFHUNG,
            80,
            &mut res,
        );
        ok != 0 && res != 0
    }
}

#[cfg(not(windows))]
pub fn es_campo_password() -> bool {
    false
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
/// Cuánto tiene que viajar el ratón antes de que la onda se despegue.
///
/// Existe desde que la onda se arrastra **siempre**, sin modo de colocación. Sin
/// umbral, el `pointerdown` la pegaba al cursor en el acto: ir a pulsar su
/// propio menú o el toggle de niveles la movía sin querer, que es justo el
/// motivo por el que antes el arrastre estaba bajo llave.
///
/// Seis píxeles es lo que separa un clic de un arrastre. Por debajo no se toca
/// la ventana, así que el clic llega limpio a lo que haya dentro.
const UMBRAL_ARRASTRE: i32 = 6;

/// Pega la ventana al cursor hasta que se suelte el botón.
///
/// `al_arrancar` se llama **una sola vez**, al cruzar el umbral: es lo que le
/// dice al HUD que ya va montado de verdad (el aro punteado y la carita de la
/// montaña rusa). `al_menear` salta en cada vaivén.
pub fn arrastrar_con_cursor(
    hwnd: isize,
    mut al_arrancar: impl FnMut(),
    mut al_menear: impl FnMut(),
) -> Option<WorkArea> {
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
    // Fuera del bloque porque se consulta al final: un clic que no cruzó el
    // umbral no deja posición nueva.
    let mut suelta = false;
    unsafe {
        // Con los botones invertidos (zurdos), el botón "principal" que el
        // webview reporta como primario es el físico derecho.
        let boton = if GetSystemMetrics(SM_SWAPBUTTON) != 0 {
            VK_RBUTTON
        } else {
            VK_LBUTTON
        };
        let apretado = || (GetAsyncKeyState(boton as i32) as u16) & 0x8000 != 0;

        let mut c0 = cursor()?;
        let (wx, wy, _, _) = window_rect(hwnd)?;
        // Detección del meneo, para la carita mareada. Va aquí y no en el
        // webview porque durante el arrastre la ventana persigue al cursor:
        // visto desde dentro, el ratón no se mueve ni un píxel.
        let mut meneo = Meneo::nuevo(c0.x);
        let arranque = std::time::Instant::now();
        // Tope de 60 s: si algo se traga el "botón soltado" (una sesión remota,
        // un cambio de escritorio), el hilo se va solo en vez de quedarse vivo.
        for _ in 0..7_500 {
            if !apretado() {
                break;
            }
            if let Some(c) = cursor() {
                if !suelta {
                    if (c.x - c0.x).abs() < UMBRAL_ARRASTRE
                        && (c.y - c0.y).abs() < UMBRAL_ARRASTRE
                    {
                        std::thread::sleep(std::time::Duration::from_millis(8));
                        continue;
                    }
                    // Se recoloca el origen: sin esto la onda pegaría un salto
                    // de seis píxeles justo al empezar a moverse.
                    c0 = c;
                    meneo = Meneo::nuevo(c.x);
                    suelta = true;
                    al_arrancar();
                }
                if meneo.empuja(c.x, arranque.elapsed().as_millis()) {
                    al_menear();
                }
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
    // Un clic no es un arrastre. Sin esta salida, pulsar la onda para cualquier
    // cosa reescribiría `hud_posiciones` y guardaría los ajustes enteros.
    if !suelta {
        return None;
    }
    window_rect(hwnd)
}

#[cfg(not(windows))]
pub fn arrastrar_con_cursor(
    _hwnd: isize,
    _al_arrancar: impl FnMut(),
    _al_menear: impl FnMut(),
) -> Option<WorkArea> {
    None
}

#[cfg(test)]
mod tests {
    use super::*;

    /// Zarandea: va y viene con amplitud de sobra, deprisa.
    fn zarandear(m: &mut Meneo, veces: usize, amplitud: i32, paso_ms: u128) -> usize {
        let mut meneos = 0;
        let mut t = 0u128;
        for i in 0..veces {
            let x = if i % 2 == 0 { amplitud } else { -amplitud };
            t += paso_ms;
            if m.empuja(x, t) {
                meneos += 1;
            }
        }
        meneos
    }

    #[test]
    fn zarandearla_la_marea() {
        let mut m = Meneo::nuevo(0);
        // 4 vaivenes = 1 meneo; 8 = 2. El primer tramo sólo fija el sentido.
        assert_eq!(zarandear(&mut m, 9, 40, 50), 2);
    }

    #[test]
    fn arrastrarla_de_un_tiron_no_la_marea() {
        let mut m = Meneo::nuevo(0);
        // Un viaje largo en línea recta, como colocarla de una pantalla a otra.
        let mut meneos = 0;
        for x in (0..1200).step_by(7) {
            if m.empuja(x, x as u128) {
                meneos += 1;
            }
        }
        assert_eq!(meneos, 0, "un arrastre recto no debería marearla");
    }

    #[test]
    fn el_temblor_de_la_mano_no_cuenta() {
        let mut m = Meneo::nuevo(0);
        // Vaivenes por debajo del umbral de amplitud: pulso, no zarandeo.
        assert_eq!(zarandear(&mut m, 40, MENEO_AMPLITUD / 2 - 1, 30), 0);
    }

    #[test]
    fn ir_y_venir_con_calma_tampoco() {
        let mut m = Meneo::nuevo(0);
        // Amplitud de sobra pero un giro cada 900 ms: pasa de MENEO_PAUSA_MS,
        // así que la cuenta se reinicia y nunca llega a cuatro seguidos.
        assert_eq!(zarandear(&mut m, 30, 60, 900), 0);
    }
}
