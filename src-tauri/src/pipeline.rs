use crate::audio::{AudioRecorder, Resampler16k};
use crate::chunker;
use crate::inject::inject_text;
use crate::models::{self, ModelStatus};
use crate::overlay;
use crate::polish::{self, PolishCtx};
use crate::settings::{EngineKind, HudPos, PolishKind, SettingsState};
use crate::store::Store;
use crate::stt::{groq, groq::GroqStt, parakeet::ParakeetStt, Stt, SttOpts};
use std::sync::atomic::{AtomicBool, AtomicU64, Ordering};
use std::sync::mpsc::{Receiver, RecvTimeoutError};
use std::sync::{Arc, Mutex};
use std::time::{Duration, Instant};
use tauri::{AppHandle, Emitter, Manager};

/// Tope duro de un dictado: al llegar, el pipeline se detiene solo y transcribe
/// lo grabado. Perder la cola en silencio (lo que hacia antes) es peor que
/// cortar avisando.
const MAX_DICTADO: Duration = Duration::from_secs(600);
/// Cada cuanto se drena el micro mientras grabas.
const TICK_GRABANDO: Duration = Duration::from_millis(400);
/// Tamano de trozo en muestras a 16 kHz. El minimo evita malgastar peticiones
/// (Groq factura 10 s como minimo) y el maximo mantiene los trozos cortos para
/// que cada uno decida su propio idioma.
const MIN_TROZO: usize = 20 * 16_000;
const MAX_TROZO: usize = 55 * 16_000;

pub enum Cmd {
    Start,
    Stop,
    /// Te arrepentiste a media frase: se tira el audio y no se transcribe ni se
    /// pega nada. Lo manda el Escape mientras grabas.
    Cancel,
    /// El modelo terminó de descargarse; se cargará al dictar.
    ModelReady,
}

/// Frases que los modelos STT "alucinan" sobre audio casi mudo: vienen de
/// los subtítulos de video de sus datos de entrenamiento.
const STT_HALLUCINATIONS: &[&str] = &[
    "subtítulos realizados",
    "subtitulado por",
    "subtítulos por",
    "traducido por",
    "traducción de",
    "traducir del inglés",
    "amara.org",
    "gracias por ver",
    "suscríbete",
    "subtitles by",
    "thanks for watching",
    "www.youtube",
];

/// RMS máximo por ventana: la energía del tramo más fuerte de la grabación.
fn max_window_rms(samples: &[f32], window: usize) -> f32 {
    samples
        .chunks(window)
        .map(|w| (w.iter().map(|s| s * s).sum::<f32>() / w.len() as f32).sqrt())
        .fold(0.0f32, f32::max)
}

/// Incorpora una carga de Parakeet terminada (o la espera, si `block`).
fn absorb_load(
    parakeet: &mut Option<ParakeetStt>,
    loading: &mut Option<std::thread::JoinHandle<anyhow::Result<ParakeetStt>>>,
    block: bool,
) -> anyhow::Result<()> {
    if !block && !loading.as_ref().is_some_and(|h| h.is_finished()) {
        return Ok(());
    }
    if let Some(handle) = loading.take() {
        match handle.join() {
            Ok(Ok(m)) => *parakeet = Some(m),
            Ok(Err(e)) => return Err(e.context("No se pudo cargar el modelo local")),
            Err(_) => anyhow::bail!("El hilo de carga del modelo falló"),
        }
    }
    Ok(())
}

fn emit_state(app: &AppHandle, state: &str, extra: Option<serde_json::Value>) {
    let mut payload = serde_json::json!({ "state": state });
    if let Some(serde_json::Value::Object(map)) = extra {
        for (k, v) in map {
            payload[k] = v;
        }
    }
    let _ = app.emit("recording-state", payload);
}

/// Log de diagnóstico que sobrevive en builds release (sin consola):
/// escribe a %APPDATA%/<identifier>/dicho.log además del logger normal.
pub(crate) fn diag(app: &AppHandle, msg: &str) {
    log::info!("{msg}");
    if let Ok(dir) = app.path().app_data_dir() {
        let ts = std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .map(|d| d.as_secs())
            .unwrap_or(0);
        if let Ok(mut f) = std::fs::OpenOptions::new()
            .create(true)
            .append(true)
            .open(dir.join("dicho.log"))
        {
            use std::io::Write;
            let _ = writeln!(f, "[{ts}] {msg}");
        }
    }
}

/// El HUD mide esto en puntos lógicos; en píxeles depende de la escala del
/// monitor donde caiga.
const HUD_W: f64 = 360.0;
const HUD_H: f64 = 96.0;
/// La pantalla de cine de la actualización: cuadrada, y del doble de alto.
///
/// Una tira de 360×96 no deja poner nada en escena — no hay arriba ni abajo, y
/// la carita ya ocupa casi todo. Los V-Pet de Digimon dibujaban en 16×16
/// cuadrados justo por eso. Para el estreno de versión, y **sólo** para eso, la
/// onda se convierte en pantalla cuadrada: así hay cielo para que caigan cosas,
/// suelo para la sombra, y sitio para acercar la cámara.
const CINE_W: f64 = 260.0;
const CINE_H: f64 = 260.0;
/// Qué tamaño toca ahora. Lo consulta `place_hud`, que es quien coloca.
pub(crate) static MODO_CINE: AtomicBool = AtomicBool::new(false);

/// Mientras arrastras el HUD nadie más lo mueve: el vigilante lo devolvería a
/// su sitio a media maniobra.
pub(crate) static ARRASTRANDO: AtomicBool = AtomicBool::new(false);
/// Modo "colócalo donde quieras" desde Ajustes: el HUD se queda a la vista
/// hasta que el usuario diga que ya, así que nadie puede ocultarlo.
pub(crate) static COLOCANDO: AtomicBool = AtomicBool::new(false);
/// Hay un dictado en curso. La consulta el menú de la onda: desclavarla a media
/// frase no puede esconderla y dejarte dictando a ciegas.
pub(crate) static GRABANDO: AtomicBool = AtomicBool::new(false);
/// El ratón está encima de la onda. Mientras lo esté **no se esconde**, aunque
/// el dictado haya terminado: si se fuera bajo el cursor, llegar a su menú sería
/// una carrera contra un cronómetro de dos segundos.
pub(crate) static RATON_ENCIMA: AtomicBool = AtomicBool::new(false);

pub(crate) fn grabando() -> bool {
    GRABANDO.load(Ordering::SeqCst)
}

/// Coloca el HUD en el área de trabajo indicada (píxeles físicos): donde lo
/// dejó el usuario, o abajo-centro si nunca lo movió.
fn place_hud(
    app: &AppHandle,
    hud: &tauri::WebviewWindow,
    area: overlay::WorkArea,
) -> (i32, i32) {
    let (ax, ay, aw, ah) = area;
    // Escala del monitor de destino, no la del actual: si venimos de otra
    // pantalla, el tamaño en píxeles cambia.
    let escala = hud
        .monitor_from_point((ax + aw / 2) as f64, (ay + ah / 2) as f64)
        .ok()
        .flatten()
        .map(|m| m.scale_factor())
        .unwrap_or_else(|| hud.scale_factor().unwrap_or(1.0));
    let (base_w, base_h) = if MODO_CINE.load(Ordering::SeqCst) {
        (CINE_W, CINE_H)
    } else {
        (HUD_W, HUD_H)
    };
    let w = (base_w * escala) as u32;
    let h = (base_h * escala) as u32;
    let _ = hud.set_size(tauri::PhysicalSize {
        width: w,
        height: h,
    });
    // Al saltar a un monitor con otro DPI, Windows y tao redimensionan la
    // ventana pero WebView2 se queda con su lienzo viejo y pinta la carita en
    // una esquina. Hay que estirarlo a mano; el HUD se adapta al lienzo que le
    // toque escalando su contenido (ver `--k` en Hud.tsx).
    let webview: &tauri::Webview<_> = hud.as_ref();
    let _ = webview.set_bounds(tauri::Rect {
        position: tauri::PhysicalPosition::new(0, 0).into(),
        size: tauri::PhysicalSize::new(w, h).into(),
    });
    // El rincón que el usuario eligió *en esta pantalla*: cada monitor guarda
    // el suyo, así que colocarlo en la 4K no lo mueve en el portátil.
    let guardada = app.try_state::<SettingsState>().and_then(|s| {
        let clave = HudPos::clave(area);
        s.read().ok().and_then(|s| s.hud_posiciones.get(&clave).copied())
    });
    let (x, y) = match guardada {
        // En fracción del hueco libre de la pantalla (ver `HudPos`).
        Some(p) => p.a_pixeles((w as i32, h as i32), area),
        // Sitio de siempre: abajo al centro, un dedo por encima de la barra.
        None => (
            ax + (aw - w as i32).max(0) / 2,
            ay + ah - h as i32 - (22.0 * escala) as i32,
        ),
    };
    let _ = hud.set_position(tauri::PhysicalPosition { x, y });
    (x, y)
}

/// Monitor donde el usuario está trabajando (el de la ventana activa), no el
/// primario: con dos pantallas el HUD salía en la otra.
fn area_hud(app: &AppHandle) -> overlay::WorkArea {
    overlay::active_work_area().unwrap_or_else(|| {
        let (mut x, mut y, mut w, mut h) = (0, 0, 1920, 1080);
        if let Ok(Some(m)) = app.primary_monitor() {
            x = m.position().x;
            y = m.position().y;
            w = m.size().width as i32;
            h = m.size().height as i32;
        }
        (x, y, w, h)
    })
}

fn show_hud(app: &AppHandle, gen: &Arc<AtomicU64>) {
    let Some(hud) = app.get_webview_window("hud") else {
        diag(app, "HUD: ventana 'hud' NO EXISTE");
        return;
    };
    let area = area_hud(app);
    let (x, y) = place_hud(app, &hud, area);
    let _ = hud.show();
    let _ = hud.set_always_on_top(true);
    let hwnd = overlay::hwnd_of(&hud).unwrap_or(0);
    overlay::assert_topmost(hwnd);
    diag(
        app,
        &format!(
            "HUD: área {:?}, pos ({x},{y}), visible={:?}",
            area,
            hud.is_visible()
        ),
    );

    // Vigilante: mientras el HUD esté a la vista reafirma el z-order (otras
    // apps topmost se cuelan por encima) y lo sigue si cambias de monitor.
    let expected = gen.load(Ordering::SeqCst);
    let gen = gen.clone();
    let app = app.clone();
    std::thread::spawn(move || {
        let mut area_actual = area;
        // Al cambiar de monitor Windows redimensiona la ventana por el DPI, y
        // eso llega *después* de moverla: por cada cambio hay que recolocar dos
        // veces (ahora, con el tamaño viejo, y al tick siguiente, con el nuevo).
        let mut recolocar = 2;
        for i in 0..80 {
            std::thread::sleep(Duration::from_millis(if i == 0 { 70 } else { 250 }));
            if gen.load(Ordering::SeqCst) != expected {
                return;
            }
            let Some(hud) = app.get_webview_window("hud") else {
                return;
            };
            if !matches!(hud.is_visible(), Ok(true)) {
                return;
            }
            if ARRASTRANDO.load(Ordering::SeqCst) {
                continue;
            }
            overlay::assert_topmost(hwnd);
            // Si te cambias de pantalla a media dictada, el HUD te sigue.
            if let Some(nueva) = overlay::active_work_area() {
                if nueva != area_actual {
                    area_actual = nueva;
                    recolocar = 2;
                }
            }
            if recolocar > 0 {
                recolocar -= 1;
                place_hud(&app, &hud, area_actual);
            }
        }
    });
}

/// ¿El usuario dejó la onda clavada en pantalla? Clavada no se esconde nunca:
/// vuelve a reposo y se queda ahí, a medio velo.
pub(crate) fn hud_clavado(app: &AppHandle) -> bool {
    app.try_state::<SettingsState>()
        .and_then(|s| s.read().ok().map(|s| s.hud_pin && s.hud_enabled))
        .unwrap_or(false)
}

fn hide_hud_later(app: &AppHandle, gen: &Arc<AtomicU64>, delay_ms: u64) {
    let expected = gen.load(Ordering::SeqCst);
    let app = app.clone();
    let gen = gen.clone();
    std::thread::spawn(move || {
        std::thread::sleep(Duration::from_millis(delay_ms));
        if gen.load(Ordering::SeqCst) == expected && !COLOCANDO.load(Ordering::SeqCst) {
            if let Some(hud) = app.get_webview_window("hud") {
                // Clavada se queda: sólo vuelve a reposo, que es su cara de
                // "aquí estoy, sin molestar". Y con el ratón encima tampoco se
                // va: esconderse bajo el cursor es lo contrario de dejarse usar.
                if hud_clavado(&app) || RATON_ENCIMA.load(Ordering::SeqCst) {
                    emit_state(&app, "idle", None);
                } else {
                    let _ = hud.hide();
                }
            }
        }
    });
}

/// Saca la onda a celebrar que acabas de actualizar. Una sola vez, al primer
/// arranque con la versión nueva.
///
/// No se enseña si tienes la onda apagada: quien la apagó no quiere verla, y
/// menos por sorpresa nada más encender el ordenador.
pub(crate) fn celebrar_actualizacion(app: &AppHandle, version: &str) {
    // Sólo con las caritas puestas: en el estilo clásico no hay bicho que
    // evolucione, y una pantalla cuadrada con cinco barras no cuenta nada.
    let (visible, tamagotchi) = app
        .try_state::<SettingsState>()
        .and_then(|s| {
            s.read()
                .ok()
                .map(|s| (s.hud_enabled, s.hud_style == crate::settings::HudStyle::Tamagotchi))
        })
        .unwrap_or((true, true));
    if !visible || !tamagotchi {
        return;
    }
    let Some(hud) = app.get_webview_window("hud") else {
        return;
    };
    // La pantalla se vuelve cuadrada para la ocasión, y vuelve a su tira al
    // acabar. Se coloca DESPUÉS de cambiar el tamaño: la posición guardada está
    // en fracción del hueco libre, así que depende de lo que mida la ventana.
    MODO_CINE.store(true, Ordering::SeqCst);
    place_hud(app, &hud, area_hud(app));
    emit_state(
        app,
        "actualizado",
        Some(serde_json::json!({ "version": version })),
    );
    let _ = hud.show();
    diag(app, &format!("Estrenando la versión {version}"));
    // La película dura 6 s y se para en el último cuadro; se le dejan 1,4 s de
    // propina para que la sonrisa con el número se quede a la vista antes de
    // recogerlo todo.
    let app = app.clone();
    std::thread::spawn(move || {
        std::thread::sleep(Duration::from_millis(7400));
        if GRABANDO.load(Ordering::SeqCst) || COLOCANDO.load(Ordering::SeqCst) {
            return;
        }
        MODO_CINE.store(false, Ordering::SeqCst);
        if hud_clavado(&app) {
            emit_state(&app, "idle", None);
            recolocar_hud(&app);
        } else if let Some(hud) = app.get_webview_window("hud") {
            let _ = hud.hide();
            // Se devuelve a su tira aunque esté escondida: si no, el próximo
            // dictado la sacaría cuadrada.
            recolocar_hud(&app);
        }
    });
}

/// Devuelve el HUD a donde digan los ajustes, sin esperar al próximo dictado
/// (lo usa "Restablecer posición" para que se vea el salto).
pub(crate) fn recolocar_hud(app: &AppHandle) {
    if let Some(hud) = app.get_webview_window("hud") {
        place_hud(app, &hud, area_hud(app));
    }
}

/// Modo "colócalo donde quieras", desde Ajustes: deja el HUD a la vista y
/// agarrable hasta que el usuario diga que ya.
///
/// Sin esto sólo se podría mover durante los pocos segundos que dura un
/// dictado, que es justo cuando el usuario está ocupado hablando.
pub(crate) fn modo_colocar(app: &AppHandle, on: bool) {
    // Apagar lo que ya estaba apagado no puede esconder un HUD que esté en
    // mitad de un dictado; encender dos veces no puede dejar dos vigilantes.
    if COLOCANDO.swap(on, Ordering::SeqCst) == on {
        return;
    }
    let Some(hud) = app.get_webview_window("hud") else {
        return;
    };
    let _ = app.emit("hud-colocar", on);
    if !on {
        // Al salir, el ratón vuelve a lo que diga Ajustes: durante la
        // colocación el HUD atrapa clics aunque el usuario lo quiera cristal.
        let arrastrable = app
            .try_state::<SettingsState>()
            .and_then(|s| s.read().ok().map(|s| s.hud_arrastrable))
            .unwrap_or(true);
        crate::commands::aplicar_raton_hud(app, arrastrable);
        if hud_clavado(app) {
            emit_state(app, "idle", None);
        } else {
            let _ = hud.hide();
        }
        return;
    }
    place_hud(app, &hud, area_hud(app));
    emit_state(app, "idle", None);
    let _ = hud.show();
    let _ = hud.set_always_on_top(true);
    let hwnd = overlay::hwnd_of(&hud).unwrap_or(0);
    overlay::assert_topmost(hwnd);
    // Vigilante propio mientras dure la colocación: el de show_hud se apaga a
    // los 20 s, y aquí el usuario puede tardar lo que quiera en decidir.
    std::thread::spawn(move || {
        while COLOCANDO.load(Ordering::SeqCst) {
            std::thread::sleep(Duration::from_millis(400));
            if !ARRASTRANDO.load(Ordering::SeqCst) {
                overlay::assert_topmost(hwnd);
            }
        }
    });
}

// ─── dictado en curso ───────────────────────────────────────────────────────

/// Un trozo de audio mandado a transcribir mientras el usuario sigue hablando.
enum Trozo {
    Pendiente,
    Listo(String),
    Fallo,
}

/// Lo que hace falta para transcribir en caliente. Sólo Groq: el modelo local
/// no se puede compartir entre hilos y tarda más que la propia grabación.
#[derive(Clone)]
struct Caliente {
    client: reqwest::Client,
    key: String,
}

/// Estado del dictado en curso: remuestrea lo que va entrando, lo acumula a
/// 16 kHz y suelta un trozo a transcribir en cuanto el hablante hace una pausa.
/// Al soltar la tecla ya sólo queda pendiente el último trozo, así que un
/// dictado de diez minutos responde casi tan rápido como uno de veinte segundos.
struct EnVivo {
    resampler: Option<Resampler16k>,
    /// Todo el dictado a 16 kHz: alimenta la compuerta de silencio y el plan B.
    pcm: Vec<f32>,
    /// Hasta dónde se ha repartido ya en trozos.
    cursor: usize,
    trozos: Arc<Mutex<Vec<Trozo>>>,
    caliente: Option<Caliente>,
    opts: SttOpts,
}

impl EnVivo {
    fn nuevo(caliente: Option<Caliente>, opts: SttOpts) -> Self {
        Self {
            resampler: None,
            pcm: Vec::new(),
            cursor: 0,
            trozos: Arc::new(Mutex::new(Vec::new())),
            caliente,
            opts,
        }
    }

    /// Drena el micro, remuestrea y reparte lo que ya cierre un trozo.
    fn bombear(&mut self, rec: &AudioRecorder) -> anyhow::Result<()> {
        let (nuevas, rate) = rec.drain();
        if rate == 0 {
            return Ok(());
        }
        if self.resampler.is_none() {
            self.resampler = Some(Resampler16k::new(rate)?);
        }
        if !nuevas.is_empty() {
            let out = self.resampler.as_mut().unwrap().push(&nuevas)?;
            self.pcm.extend_from_slice(&out);
        }
        self.repartir(false);
        Ok(())
    }

    /// Cierra el remuestreador con la cola del micro y suelta el último trozo.
    fn cerrar(&mut self, cola: Vec<f32>, rate: u32) -> anyhow::Result<()> {
        if self.resampler.is_none() && rate > 0 {
            self.resampler = Some(Resampler16k::new(rate)?);
        }
        if let Some(r) = self.resampler.as_mut() {
            if !cola.is_empty() {
                let out = r.push(&cola)?;
                self.pcm.extend_from_slice(&out);
            }
            let out = r.finish()?;
            self.pcm.extend_from_slice(&out);
        }
        self.repartir(true);
        Ok(())
    }

    fn repartir(&mut self, cerrando: bool) {
        if self.caliente.is_none() {
            return;
        }
        while let Some(corte) =
            chunker::punto_de_corte(&self.pcm, self.cursor, MIN_TROZO, MAX_TROZO)
        {
            self.lanzar(self.cursor..corte);
            self.cursor = corte;
        }
        // La cola sólo se manda si ya hubo trozos: un dictado corto viaja de
        // una pieza, que sale más barato y con mejor contexto.
        let hubo_trozos = !self.trozos.lock().unwrap().is_empty();
        if cerrando && hubo_trozos && self.cursor < self.pcm.len() {
            let fin = self.pcm.len();
            self.lanzar(self.cursor..fin);
            self.cursor = fin;
        }
    }

    fn lanzar(&mut self, rango: std::ops::Range<usize>) {
        let Some(cal) = self.caliente.clone() else {
            return;
        };
        let audio: Vec<f32> = self.pcm[rango].to_vec();
        let mut opts = self.opts.clone();
        let idx = {
            let mut t = self.trozos.lock().unwrap();
            // Contexto para el motor: la cola de lo ya transcrito. Es el uso
            // que Whisper le da al prompt (registro y ortografía, no órdenes)
            // y de paso da continuidad de puntuación entre trozos.
            if let Some(Trozo::Listo(previo)) = t.last() {
                opts.prompt = Some(cola_de(previo, 220));
            }
            t.push(Trozo::Pendiente);
            t.len() - 1
        };
        let trozos = self.trozos.clone();
        let segundos = audio.len() as f32 / 16_000.0;
        std::thread::spawn(move || {
            let mut intento = 0u32;
            loop {
                match groq::transcribe_blocking(&cal.client, &cal.key, &audio, &opts) {
                    Ok(txt) => {
                        log::info!("Trozo {idx} ({segundos:.1} s) listo");
                        trozos.lock().unwrap()[idx] = Trozo::Listo(txt);
                        return;
                    }
                    Err(e) => {
                        intento += 1;
                        if intento >= 3 {
                            log::warn!("Trozo {idx} falló definitivamente: {e:#}");
                            trozos.lock().unwrap()[idx] = Trozo::Fallo;
                            return;
                        }
                        std::thread::sleep(Duration::from_millis(600 * intento as u64));
                    }
                }
            }
        });
    }

    fn hay_trozos(&self) -> bool {
        !self.trozos.lock().unwrap().is_empty()
    }

    /// Espera a los trozos en vuelo y devuelve el texto concatenado.
    /// `None` si alguno falló: entonces el llamante repite el audio entero.
    fn esperar(&self, limite: Duration) -> Option<String> {
        let t0 = Instant::now();
        loop {
            {
                let t = self.trozos.lock().unwrap();
                if t.iter().any(|x| matches!(x, Trozo::Fallo)) {
                    return None;
                }
                if t.iter().all(|x| matches!(x, Trozo::Listo(_))) {
                    let partes: Vec<&str> = t
                        .iter()
                        .filter_map(|x| match x {
                            Trozo::Listo(s) => Some(s.trim()),
                            _ => None,
                        })
                        .filter(|s| !s.is_empty())
                        .collect();
                    return Some(partes.join(" "));
                }
            }
            if t0.elapsed() >= limite {
                log::warn!("Trozos sin terminar tras {} s", limite.as_secs());
                return None;
            }
            std::thread::sleep(Duration::from_millis(60));
        }
    }
}

/// Últimos `max` caracteres, respetando los límites de carácter.
fn cola_de(texto: &str, max: usize) -> String {
    let n = texto.chars().count();
    if n <= max {
        return texto.to_string();
    }
    texto.chars().skip(n - max).collect()
}

/// Opciones de transcripción según los ajustes. Con "no traducir" jamás se fija
/// idioma —es justo lo que empuja al motor a traducir el otro— y se le pasa una
/// muestra de spanglish como contexto de estilo.
fn opts_de(s: &crate::settings::AppSettings) -> SttOpts {
    SttOpts {
        language: if s.no_traducir {
            None
        } else {
            match s.language.as_str() {
                "auto" | "" => None,
                other => Some(other.to_string()),
            }
        },
        prompt: s.no_traducir.then(|| groq::PRIME_SPANGLISH.to_string()),
    }
}

/// El modelo local se come el audio de una pieza: en dictados largos eso es
/// mucha RAM y mucho rato, así que va por trozos cortados en las pausas.
fn parakeet_por_trozos(
    p: &mut ParakeetStt,
    pcm: &[f32],
    opts: &SttOpts,
) -> anyhow::Result<String> {
    if pcm.len() <= MAX_TROZO {
        return p.transcribe(pcm, opts);
    }
    let mut partes = Vec::new();
    for r in chunker::cortes(pcm, MIN_TROZO, MAX_TROZO) {
        let t = p.transcribe(&pcm[r], opts)?;
        let t = t.trim();
        if !t.is_empty() {
            partes.push(t.to_string());
        }
    }
    Ok(partes.join(" "))
}

fn transcribir_completo(
    pcm: &[f32],
    engine: EngineKind,
    opts: &SttOpts,
    parakeet: &mut Option<ParakeetStt>,
    groq: &mut GroqStt,
) -> anyhow::Result<(String, &'static str)> {
    match engine {
        EngineKind::Groq => match groq.transcribe(pcm, opts) {
            Ok(t) => Ok((t, "groq")),
            Err(e) => {
                // Fallback transparente al motor local.
                if let Some(p) = parakeet.as_mut() {
                    log::warn!("Groq falló ({e}), usando Parakeet local");
                    Ok((parakeet_por_trozos(p, pcm, opts)?, "parakeet"))
                } else {
                    Err(e)
                }
            }
        },
        EngineKind::Parakeet => {
            let p = parakeet
                .as_mut()
                .ok_or_else(|| anyhow::anyhow!("Modelo local no cargado"))?;
            Ok((parakeet_por_trozos(p, pcm, opts)?, "parakeet"))
        }
    }
}

enum StopResult {
    Done(String, String, &'static str, i64, Vec<polish::Correction>),
    /// Hubo grabación pero no se entendió nada: carita en el HUD.
    Empty,
    /// Toque accidental: sin feedback.
    Tap,
}

/// Todo lo que pasa al soltar la tecla (o al llegar al tope): compuerta de
/// silencio, transcripción, pulido, inyección e historial.
#[allow(clippy::too_many_arguments)]
fn procesar(
    app: &AppHandle,
    settings: &SettingsState,
    store: &Arc<Store>,
    hud_gen: &Arc<AtomicU64>,
    vivo: EnVivo,
    held: Duration,
    engine: EngineKind,
    parakeet: &mut Option<ParakeetStt>,
    groq: &mut GroqStt,
) {
    let outcome = (|| -> anyhow::Result<StopResult> {
        // Toques accidentales: menos de 350 ms no se procesan.
        if held < Duration::from_millis(350) {
            return Ok(StopResult::Tap);
        }
        let pcm = &vivo.pcm;
        if pcm.len() < 16_000 / 4 {
            return Ok(StopResult::Empty);
        }
        // Compuerta de silencio: sin energía de voz no se transcribe — los
        // modelos STT alucinan frases sobre silencio en lugar de devolver
        // vacío. El umbral es deliberadamente bajo: la ganancia de mic varía
        // mucho entre equipos y un umbral alto se traga voz real.
        let voice_rms = max_window_rms(pcm, 1600);
        diag(
            app,
            &format!(
                "Dictado: {:.1} s, rms máx {voice_rms:.5}, {} trozos",
                pcm.len() as f32 / 16_000.0,
                vivo.trozos.lock().unwrap().len()
            ),
        );
        if voice_rms < 0.0012 {
            return Ok(StopResult::Empty);
        }

        let t0 = Instant::now();
        let (raw, engine_name) = if vivo.hay_trozos() {
            // Casi todo llegó transcrito mientras hablabas; aquí sólo se espera
            // al último trozo.
            match vivo.esperar(Duration::from_secs(90)) {
                Some(texto) => (texto, "groq"),
                None => {
                    log::warn!("Troceo incompleto: se reintenta el audio entero");
                    transcribir_completo(pcm, engine, &vivo.opts, parakeet, groq)?
                }
            }
        } else {
            transcribir_completo(pcm, engine, &vivo.opts, parakeet, groq)?
        };
        let stt_ms = t0.elapsed().as_millis() as i64;
        log::info!("STT [{engine_name}] {stt_ms} ms: {raw}");
        if raw.trim().is_empty() {
            return Ok(StopResult::Empty);
        }
        // Segunda barrera: si la energía fue baja y el texto es una frase
        // típica de alucinación, se descarta.
        let raw_lc = raw.to_lowercase();
        if voice_rms < 0.006 && STT_HALLUCINATIONS.iter().any(|h| raw_lc.contains(h)) {
            diag(
                app,
                &format!("Alucinación descartada (rms {voice_rms:.5}): {raw}"),
            );
            return Ok(StopResult::Empty);
        }

        let (polish_kind, language) = {
            let s = settings.read().unwrap();
            (s.polish, s.language.clone())
        };
        let ctx = PolishCtx {
            language,
            dictionary: store.dict_pairs(),
        };
        let corrections = polish::corrections(&raw, &ctx);
        let polished = match polish_kind {
            PolishKind::Rules => polish::rules::polish(&raw, &ctx),
            PolishKind::GroqEstructurado => {
                match polish::groq::polish(&raw, &ctx, polish::groq::Nivel::Estructurado) {
                    Ok(t) => t,
                    Err(e) => {
                        log::warn!("Redacción estructurada falló ({e}), usando reglas locales");
                        polish::rules::polish(&raw, &ctx)
                    }
                }
            }
            PolishKind::GroqLlm => match polish::groq::polish(&raw, &ctx, polish::groq::Nivel::Ordenado)
            {
                Ok(t) => t,
                Err(e) => {
                    log::warn!("Pulido LLM falló ({e}), usando reglas locales");
                    polish::rules::polish(&raw, &ctx)
                }
            },
        };
        Ok(StopResult::Done(
            raw,
            polished,
            engine_name,
            stt_ms,
            corrections,
        ))
    })();

    match outcome {
        Ok(StopResult::Done(raw, polished, engine_name, stt_ms, corrections)) => {
            if let Err(e) = inject_text(&polished) {
                emit_state(
                    app,
                    "error",
                    Some(serde_json::json!({ "message": e.to_string() })),
                );
                hide_hud_later(app, hud_gen, 3200);
                return;
            }
            let corrections_json = (!corrections.is_empty())
                .then(|| serde_json::to_string(&corrections).ok())
                .flatten();
            let _ = store.add_history(
                &raw,
                &polished,
                engine_name,
                held.as_millis() as i64,
                corrections_json.as_deref(),
            );
            log::info!(
                "Dictado listo: {} ms grabación, {} ms STT",
                held.as_millis(),
                stt_ms
            );
            emit_state(app, "done", Some(serde_json::json!({ "text": polished })));
            let _ = app.emit("history-changed", ());
            // Tiempo para que la carita de celebración se aprecie.
            hide_hud_later(app, hud_gen, 2400);
        }
        Ok(StopResult::Empty) => {
            // Tiempo suficiente para la animación de la carita.
            emit_state(app, "empty", None);
            hide_hud_later(app, hud_gen, 2600);
        }
        Ok(StopResult::Tap) => {
            emit_state(app, "idle", None);
            hide_hud_later(app, hud_gen, 150);
        }
        Err(e) => {
            emit_state(
                app,
                "error",
                Some(serde_json::json!({ "message": e.to_string() })),
            );
            hide_hud_later(app, hud_gen, 3200);
        }
    }
}

pub fn spawn(app: AppHandle, rx: Receiver<Cmd>, settings: SettingsState, store: Arc<Store>) {
    std::thread::spawn(move || {
        // El modelo local ocupa ~670 MB en RAM: se carga bajo demanda al
        // dictar (en paralelo al habla, que suele durar más que la carga)
        // y se libera a los pocos segundos de terminar el dictado.
        const IDLE_UNLOAD: Duration = Duration::from_secs(10);
        const IDLE_TICK: Duration = Duration::from_secs(5);

        let mut recorder: Option<AudioRecorder> = None;
        let mut vivo: Option<EnVivo> = None;
        let mut engine_activo = EngineKind::Parakeet;
        let mut started_at = Instant::now();
        let mut parakeet: Option<ParakeetStt> = None;
        let mut parakeet_loading: Option<std::thread::JoinHandle<anyhow::Result<ParakeetStt>>> =
            None;
        let mut last_use = Instant::now();
        let mut groq = GroqStt::new();
        // Generación de sesión HUD: invalida ocultados diferidos si llega una nueva.
        let hud_gen = Arc::new(AtomicU64::new(0));

        loop {
            let espera = if recorder.is_some() {
                TICK_GRABANDO
            } else {
                IDLE_TICK
            };
            let cmd = match rx.recv_timeout(espera) {
                Ok(cmd) => Some(cmd),
                Err(RecvTimeoutError::Timeout) => None,
                Err(RecvTimeoutError::Disconnected) => break,
            };

            // Mientras se graba: drenar el micro, repartir trozos y vigilar el tope.
            let mut por_limite = false;
            if let (Some(rec), Some(v)) = (recorder.as_ref(), vivo.as_mut()) {
                if let Err(e) = v.bombear(rec) {
                    log::error!("Bombeo de audio: {e:#}");
                }
                if started_at.elapsed() >= MAX_DICTADO {
                    por_limite = true;
                }
            }

            // Cancelar: el audio se tira entero y no se toca ni el historial ni
            // el portapapeles. Va antes que el Stop para ganarle siempre.
            if matches!(cmd, Some(Cmd::Cancel)) {
                if let (Some(rec), Some(_)) = (recorder.take(), vivo.take()) {
                    GRABANDO.store(false, Ordering::SeqCst);
                    let held = started_at.elapsed();
                    let _ = rec.stop();
                    diag(
                        &app,
                        &format!("Dictado cancelado a los {:.1} s", held.as_secs_f32()),
                    );
                    emit_state(&app, "cancelado", None);
                    hide_hud_later(&app, &hud_gen, 2200);
                }
                continue;
            }

            if por_limite || matches!(cmd, Some(Cmd::Stop)) {
                if let (Some(rec), Some(mut v)) = (recorder.take(), vivo.take()) {
                    GRABANDO.store(false, Ordering::SeqCst);
                    let held = started_at.elapsed();
                    if por_limite {
                        diag(
                            &app,
                            &format!(
                                "Tope de {} s alcanzado: se transcribe lo grabado",
                                MAX_DICTADO.as_secs()
                            ),
                        );
                    }
                    emit_state(
                        &app,
                        "processing",
                        por_limite.then(|| serde_json::json!({ "motivo": "limite" })),
                    );
                    match rec.stop() {
                        Ok((cola, rate)) => {
                            if let Err(e) = v.cerrar(cola, rate) {
                                log::error!("Cierre del remuestreador: {e:#}");
                            }
                        }
                        Err(e) => {
                            emit_state(
                                &app,
                                "error",
                                Some(serde_json::json!({ "message": e.to_string() })),
                            );
                            hide_hud_later(&app, &hud_gen, 3200);
                            continue;
                        }
                    }
                    procesar(
                        &app,
                        &settings,
                        &store,
                        &hud_gen,
                        v,
                        held,
                        engine_activo,
                        &mut parakeet,
                        &mut groq,
                    );
                    last_use = Instant::now();
                }
                continue;
            }

            match cmd {
                None => {
                    if recorder.is_some() {
                        continue;
                    }
                    // Integra cargas que quedaron sin usar y libera por inactividad.
                    if let Err(e) = absorb_load(&mut parakeet, &mut parakeet_loading, false) {
                        log::error!("{e:#}");
                    }
                    if parakeet.is_some() && last_use.elapsed() >= IDLE_UNLOAD {
                        parakeet = None;
                        log::info!(
                            "Parakeet liberado de RAM tras {} s sin dictar",
                            IDLE_UNLOAD.as_secs()
                        );
                    }
                }
                Some(Cmd::ModelReady) => {
                    log::info!("Modelo local disponible; se cargará al dictar");
                }
                Some(Cmd::Stop) | Some(Cmd::Cancel) => {}
                Some(Cmd::Start) => {
                    if recorder.is_some() {
                        continue;
                    }
                    let (engine, opts) = {
                        let s = settings.read().unwrap();
                        (s.engine, opts_de(&s))
                    };
                    engine_activo = engine;
                    if engine == EngineKind::Parakeet && parakeet.is_none() {
                        if matches!(models::status(&app), ModelStatus::Ready) {
                            // Arranca la carga ya, en paralelo al habla; se
                            // espera (si hace falta) justo antes de transcribir.
                            if parakeet_loading.is_none() {
                                let dir = models::model_dir(&app);
                                parakeet_loading = Some(std::thread::spawn(move || {
                                    let t = Instant::now();
                                    let m = ParakeetStt::load(&dir);
                                    if m.is_ok() {
                                        log::info!(
                                            "Parakeet cargado en {} ms",
                                            t.elapsed().as_millis()
                                        );
                                    }
                                    m
                                }));
                            }
                        } else {
                            // Sin modelo local descargado → guía al usuario.
                            let msg = match models::status(&app) {
                                ModelStatus::Downloading => {
                                    "Descargando el modelo de voz… abre Configuración para ver el progreso"
                                }
                                _ => "Falta el modelo de voz: ábreme desde la bandeja y descárgalo",
                            };
                            hud_gen.fetch_add(1, Ordering::SeqCst);
                            show_hud(&app, &hud_gen);
                            emit_state(&app, "error", Some(serde_json::json!({ "message": msg })));
                            hide_hud_later(&app, &hud_gen, 3200);
                            continue;
                        }
                    }
                    // Si la carga del modelo ya terminó, se integra aquí.
                    if engine == EngineKind::Parakeet {
                        if let Err(e) = absorb_load(&mut parakeet, &mut parakeet_loading, false) {
                            log::error!("{e:#}");
                        }
                    }
                    last_use = Instant::now();
                    hud_gen.fetch_add(1, Ordering::SeqCst);
                    let hud_enabled = settings.read().map(|s| s.hud_enabled).unwrap_or(true);
                    if hud_enabled {
                        show_hud(&app, &hud_gen);
                    }
                    emit_state(
                        &app,
                        "recording",
                        Some(serde_json::json!({ "max_seconds": MAX_DICTADO.as_secs() })),
                    );
                    let level_app = app.clone();
                    // Máximo ~30 eventos/s hacia el HUD para no saturar el IPC.
                    let last_emit = Arc::new(Mutex::new(Instant::now() - Duration::from_secs(1)));
                    match AudioRecorder::start(move |rms| {
                        let mut last = last_emit.lock().unwrap();
                        if last.elapsed() >= Duration::from_millis(33) {
                            *last = Instant::now();
                            drop(last);
                            let _ =
                                level_app.emit("audio-level", serde_json::json!({ "level": rms }));
                        }
                    }) {
                        Ok(r) => {
                            // Trocear en caliente sólo tiene sentido con Groq, y
                            // con la key ya a mano: leerla por trozo iría al
                            // Administrador de credenciales cada vez.
                            let caliente = if engine == EngineKind::Groq {
                                match groq::get_api_key() {
                                    Ok(key) => Some(Caliente {
                                        client: groq.client(),
                                        key,
                                    }),
                                    Err(_) => None,
                                }
                            } else {
                                None
                            };
                            recorder = Some(r);
                            vivo = Some(EnVivo::nuevo(caliente, opts));
                            started_at = Instant::now();
                            GRABANDO.store(true, Ordering::SeqCst);
                        }
                        Err(e) => {
                            emit_state(
                                &app,
                                "error",
                                Some(serde_json::json!({ "message": e.to_string() })),
                            );
                            hide_hud_later(&app, &hud_gen, 3200);
                        }
                    }
                }
            }
        }
    });
}
