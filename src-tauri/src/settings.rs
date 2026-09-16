use rdev::Key;
use serde::{Deserialize, Serialize};
use std::{collections::HashMap, fs, path::PathBuf, sync::{Arc, RwLock}};
use tauri::{AppHandle, Manager};

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum EngineKind {
    Parakeet,
    Groq,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum PolishKind {
    /// Tal cual: tus palabras exactas, sólo puntuación y diccionario. Sin IA.
    Rules,
    /// Ordenado: mismas palabras, mejor forma. Es el de siempre.
    GroqLlm,
    /// Estructurado: le da forma a la idea — junta lo disperso, quita las
    /// vueltas, saca listas si las hay. **Puede cambiar tus palabras.**
    GroqEstructurado,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum HudStyle {
    /// Caritas pixel estilo tamagotchi (5 variaciones por estado).
    Tamagotchi,
    /// Barras que crecen con la intensidad de la voz, fondo claro.
    Classic,
}

/// Dónde dejó el usuario el HUD, como fracción del hueco libre del área de
/// trabajo: 0 = pegado al borde izquierdo/superior, 1 = al derecho/inferior.
///
/// Se guarda relativo y no en píxeles a propósito: el HUD aparece en el
/// monitor de la ventana activa, así que la posición tiene que significar lo
/// mismo en una pantalla 4K que en la del portátil. "Arriba a la derecha"
/// sigue siendo arriba a la derecha en las dos.
#[derive(Debug, Clone, Copy, PartialEq, Serialize, Deserialize)]
pub struct HudPos {
    pub fx: f64,
    pub fy: f64,
}

/// Un HUD tan ancho como la pantalla no tiene hueco por donde moverse: en vez
/// de dividir entre cero se queda en medio.
fn fraccion(desplazado: i32, libre: i32) -> f64 {
    if libre <= 0 {
        return 0.5;
    }
    (desplazado as f64 / libre as f64).clamp(0.0, 1.0)
}

impl HudPos {
    /// Con qué nombre se guarda el rincón de una pantalla.
    ///
    /// El tamaño del área de trabajo en píxeles basta para distinguir el
    /// portátil de la 4K, y aguanta que se muevan de sitio en la configuración
    /// de Windows: ahí cambia dónde empieza el monitor, no cuánto mide.
    pub fn clave(area: (i32, i32, i32, i32)) -> String {
        let (_, _, aw, ah) = area;
        format!("{aw}x{ah}")
    }

    /// Dónde quedó una ventana ya colocada. `rect` y `area` en píxeles
    /// físicos: (x, y, ancho, alto).
    pub fn desde_pixeles(rect: (i32, i32, i32, i32), area: (i32, i32, i32, i32)) -> Self {
        let (x, y, w, h) = rect;
        let (ax, ay, aw, ah) = area;
        Self {
            fx: fraccion(x - ax, aw - w),
            fy: fraccion(y - ay, ah - h),
        }
    }

    /// Y a la inversa: dónde cae en esta pantalla, en píxeles físicos.
    pub fn a_pixeles(&self, (w, h): (i32, i32), area: (i32, i32, i32, i32)) -> (i32, i32) {
        let (ax, ay, aw, ah) = area;
        let sitio = |f: f64, libre: i32| (libre.max(0) as f64 * f.clamp(0.0, 1.0)).round() as i32;
        (ax + sitio(self.fx, aw - w), ay + sitio(self.fy, ah - h))
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(default)]
pub struct AppSettings {
    /// Combinación push-to-talk: todas las teclas deben estar presionadas a la vez.
    pub hotkey: Vec<Key>,
    pub engine: EngineKind,
    pub polish: PolishKind,
    /// "auto" o código ISO-639-1 ("es", "en", ...). Se ignora si `no_traducir`.
    pub language: String,
    /// Conserva cada palabra en el idioma en que se dijo: nunca fija idioma en
    /// el motor (fijarlo es lo que hace que Whisper traduzca el otro) y le pasa
    /// una muestra de spanglish como contexto de estilo.
    pub no_traducir: bool,
    /// Deja el dictado en el portapapeles al terminar, en vez de devolver lo
    /// que hubiera antes. El texto ya pasa por ahí para pegarse (ver
    /// `inject::inject_text`), así que esto sólo se salta la restauración.
    /// Apagado por defecto: encenderlo significa que cada dictado pisa lo que
    /// tuvieras copiado.
    pub copiar_al_portapapeles: bool,
    pub hud_enabled: bool,
    pub hud_style: HudStyle,
    /// El rincón donde el usuario dejó el HUD **en cada pantalla**, por
    /// `HudPos::clave()`. Sin entrada para la pantalla de turno: abajo al
    /// centro, donde siempre. (El `hud_pos` suelto de la 0.7.0 era uno solo
    /// para todos los monitores: mover el HUD en la 4K lo movía también en el
    /// portátil. Serde ignora esa clave vieja y se empieza de cero.)
    pub hud_posiciones: HashMap<String, HudPos>,
    /// Si el HUD atrapa el ratón para poder arrastrarlo. Apagado vuelve a ser
    /// un cristal: los clics lo atraviesan y llegan a lo que haya debajo.
    pub hud_arrastrable: bool,
    /// La cinta de niveles debajo de la onda: enseña cuál está puesto y deja
    /// cambiarlo de un clic, que es el momento en que de verdad lo decides —
    /// justo antes de hablar, no en un ajuste que pusiste hace una semana.
    #[serde(default = "verdadero")]
    pub hud_niveles: bool,
    /// Clavada: la onda se queda a la vista siempre, no sólo mientras dictas.
    /// Es el "modo mascota": la cápsula vive en tu escritorio.
    #[serde(default)]
    pub hud_pin: bool,
    /// Lo transparente que se pone la onda **cuando no está en uso**. 1 = opaca.
    /// Sólo aplica clavada: mientras dictas siempre se ve entera.
    #[serde(default = "opacidad_reposo_default")]
    pub hud_opacidad_reposo: f32,
    /// Con qué versión arrancó la app la última vez. Si al arrancar no coincide
    /// con la de ahora, es que acabas de actualizar y toca la animación —una
    /// sola vez—. Vacío la primera vez de todas: una instalación nueva no ha
    /// actualizado nada y no debe celebrarlo.
    #[serde(default)]
    pub ultima_version_vista: String,
    pub autostart: bool,
    /// Cliente OAuth "Desktop" de Google para la sincronización vía Drive.
    /// En apps instaladas el client_secret no es confidencial por diseño.
    pub google_client_id: String,
    pub google_client_secret: String,
}

/// Medio velo: se ve que está ahí sin competir con lo que estés leyendo.
fn opacidad_reposo_default() -> f32 {
    0.45
}

/// Para los ajustes que nacen encendidos y sólo se apagan a mano.
fn verdadero() -> bool {
    true
}

impl Default for AppSettings {
    fn default() -> Self {
        Self {
            hotkey: vec![Key::ControlLeft, Key::MetaLeft],
            engine: EngineKind::Parakeet,
            polish: PolishKind::Rules,
            language: "auto".into(),
            no_traducir: true,
            copiar_al_portapapeles: false,
            hud_enabled: true,
            hud_style: HudStyle::Tamagotchi,
            hud_posiciones: HashMap::new(),
            hud_arrastrable: true,
            hud_niveles: true,
            hud_pin: false,
            hud_opacidad_reposo: opacidad_reposo_default(),
            ultima_version_vista: String::new(),
            autostart: false,
            google_client_id: String::new(),
            google_client_secret: String::new(),
        }
    }
}

pub type SettingsState = Arc<RwLock<AppSettings>>;

fn settings_path(app: &AppHandle) -> PathBuf {
    app.path()
        .app_config_dir()
        .expect("app_config_dir no disponible")
        .join("settings.json")
}

pub fn load(app: &AppHandle) -> AppSettings {
    let path = settings_path(app);
    match fs::read_to_string(&path) {
        Ok(raw) => serde_json::from_str(&raw).unwrap_or_else(|e| {
            log::warn!("settings.json inválido ({e}), usando defaults");
            AppSettings::default()
        }),
        Err(_) => AppSettings::default(),
    }
}

pub fn save(app: &AppHandle, settings: &AppSettings) -> anyhow::Result<()> {
    let path = settings_path(app);
    if let Some(dir) = path.parent() {
        fs::create_dir_all(dir)?;
    }
    fs::write(&path, serde_json::to_string_pretty(settings)?)?;
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    /// Área de trabajo de la pantalla del portátil y de la 4K del usuario.
    const PORTATIL: (i32, i32, i32, i32) = (0, 0, 1920, 1032);
    const CUATRO_K: (i32, i32, i32, i32) = (1920, -300, 3840, 2100);
    /// El HUD en cada una: 360x96 puntos, al 100 % y al 250 %.
    const HUD_1X: (i32, i32) = (360, 96);
    const HUD_25X: (i32, i32) = (900, 240);

    #[test]
    fn las_esquinas_se_guardan_y_se_devuelven() {
        let (w, h) = HUD_1X;
        for (fx, fy) in [(0.0, 0.0), (1.0, 0.0), (0.0, 1.0), (1.0, 1.0), (0.5, 0.5)] {
            let p = HudPos { fx, fy };
            let (x, y) = p.a_pixeles(HUD_1X, PORTATIL);
            let vuelta = HudPos::desde_pixeles((x, y, w, h), PORTATIL);
            assert!(
                (vuelta.fx - fx).abs() < 1e-3 && (vuelta.fy - fy).abs() < 1e-3,
                "({fx},{fy}) volvió como ({},{})",
                vuelta.fx,
                vuelta.fy
            );
        }
    }

    #[test]
    fn el_hud_cabe_entero_en_la_pantalla() {
        for (area, tam) in [(PORTATIL, HUD_1X), (CUATRO_K, HUD_25X)] {
            let (ax, ay, aw, ah) = area;
            let (w, h) = tam;
            for (fx, fy) in [(0.0, 0.0), (1.0, 1.0), (0.37, 0.82)] {
                let (x, y) = HudPos { fx, fy }.a_pixeles(tam, area);
                assert!(x >= ax && x + w <= ax + aw, "se sale de ancho: {x}");
                assert!(y >= ay && y + h <= ay + ah, "se sale de alto: {y}");
            }
        }
    }

    /// Lo que justifica guardar fracciones y no píxeles: el rincón de arriba a
    /// la derecha sigue siendo el de arriba a la derecha en la otra pantalla,
    /// que además tiene otro tamaño, otro DPI y ni siquiera empieza en (0,0).
    #[test]
    fn el_rincon_es_el_mismo_en_las_dos_pantallas() {
        let arriba_derecha = HudPos { fx: 1.0, fy: 0.0 };
        let (x, y) = arriba_derecha.a_pixeles(HUD_1X, PORTATIL);
        assert_eq!((x + HUD_1X.0, y), (1920, 0));
        let (x, y) = arriba_derecha.a_pixeles(HUD_25X, CUATRO_K);
        assert_eq!((x + HUD_25X.0, y), (5760, -300));
    }

    /// Soltar el HUD a medias fuera de la pantalla no puede guardar una
    /// fracción imposible: la próxima vez tiene que volver a verse entero.
    #[test]
    fn soltarlo_fuera_de_pantalla_se_recorta() {
        let fuera = HudPos::desde_pixeles((-200, 1000, 360, 96), PORTATIL);
        assert_eq!((fuera.fx, fuera.fy), (0.0, 1.0));
    }

    /// Cada pantalla guarda su propio rincón, y sigue siendo la misma pantalla
    /// aunque la muevas de sitio en la configuración de Windows.
    #[test]
    fn cada_pantalla_tiene_su_clave() {
        assert_eq!(HudPos::clave(PORTATIL), "1920x1032");
        assert_eq!(HudPos::clave(CUATRO_K), "3840x2100");
        assert_ne!(HudPos::clave(PORTATIL), HudPos::clave(CUATRO_K));
        let cuatro_k_a_la_izquierda = (-3840, 500, 3840, 2100);
        assert_eq!(
            HudPos::clave(cuatro_k_a_la_izquierda),
            HudPos::clave(CUATRO_K),
            "cambiar de sitio un monitor no lo convierte en otro"
        );
    }

    /// Pantalla más estrecha que el propio HUD: ni pánico ni NaN.
    #[test]
    fn sin_hueco_donde_moverse_se_queda_en_medio() {
        let diminuta = (0, 0, 200, 60);
        let p = HudPos::desde_pixeles((0, 0, 360, 96), diminuta);
        assert_eq!((p.fx, p.fy), (0.5, 0.5));
        assert_eq!(p.a_pixeles(HUD_1X, diminuta), (0, 0));
    }
}
