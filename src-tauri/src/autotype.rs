//! Corregir mientras escribes.
//!
//! Mira lo que tecleas y, al terminar una palabra, si está mal escrita la
//! reemplaza: borra lo escrito y pone la buena. Es la función de LABS que pidió
//! el usuario porque, en sus palabras, tiene «muy mala ortografía».
//!
//! # Todo pasa aquí dentro
//!
//! **Nada de lo que escribes sale de este proceso.** No se guarda en disco, no
//! se manda a ninguna API y no entra en el historial. Las correcciones salen de
//! una tabla local ([`crate::ortografia`]) y del diccionario que el propio
//! usuario escribió; no hay IA de por medio, y no la puede haber — mandar cada
//! palabra que tecleas a un servidor es justo lo que no se puede hacer. La
//! palabra a medias vive en memoria unos milisegundos y se borra al cerrarla.
//!
//! # Lo que no se puede garantizar, dicho antes
//!
//! Windows sólo deja saber si estás en un campo de contraseña cuando es un
//! control **nativo**. En Chrome, Edge, Electron o cualquier app que se dibuje
//! su propia interfaz eso no se puede consultar (ver
//! [`crate::overlay::es_campo_password`]). O sea que **en el navegador no hay
//! detección de contraseñas**.
//!
//! Lo que sí protege, y por eso está:
//!
//!  - La tabla sólo pone tildes a palabras castellanas. Una contraseña no está
//!    ahí, así que no se toca. Eso es una invariante con test, no una promesa.
//!  - La palabra en curso se tira entera al cambiar de ventana, y también al
//!    teclear cualquier cosa que no sea una letra.
//!  - Hay una lista de apps donde no actúa nunca, editable, y viene con las
//!    terminales y los gestores de contraseñas ya puestos.
//!
//! # Por qué el trabajo va en otro hilo
//!
//! El hook de teclado de Windows es de baja latencia: **lo que corra dentro
//! bloquea el teclado de todo el sistema**. Escribir con `enigo` son decenas de
//! milisegundos, así que el hook sólo decide y manda el reemplazo por un canal.

use crate::settings::SettingsState;
use rdev::{EventType, Key, Keyboard, KeyboardState};
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::mpsc::{channel, Sender};
use std::sync::Arc;
use std::time::{Duration, Instant};

/// Tope de letras de una palabra antes de dejar de mirarla.
///
/// No es una optimización: una palabra larguísima suele ser una ruta, una clave
/// o un identificador, justo lo que no hay que tocar **ni acumular**.
const MAX_PALABRA: usize = 24;

/// Cada cuánto se relee el diccionario del usuario. Se mira sólo al cerrar una
/// palabra, así que no cuesta nada, pero leer SQLite en cada pulsación sí.
const REFRESCO_DICCIONARIO: Duration = Duration::from_secs(60);

/// Apps donde nunca se corrige, salvo que el usuario diga lo contrario.
///
/// Las terminales porque ahí se escriben órdenes y no prosa: cambiar una palabra
/// puede ejecutar algo distinto de lo que quisiste. Los gestores de contraseñas,
/// por lo evidente.
pub const APPS_VETADAS: &[&str] = &[
    "cmd.exe",
    "powershell.exe",
    "pwsh.exe",
    "windowsterminal.exe",
    "conhost.exe",
    "putty.exe",
    "1password.exe",
    "keepass.exe",
    "keepassxc.exe",
    "bitwarden.exe",
    "dashlane.exe",
];

/// Un reemplazo que hay que teclear: cuántos caracteres borrar y qué poner.
struct Reemplazo {
    borrar: usize,
    texto: String,
}

/// Sigue la palabra en curso y decide si hay que corregirla.
pub struct Corrector {
    /// `Option` y no a secas: si rdev no puede abrir el teclado, la corrección
    /// se queda apagada, pero **el hook sigue vivo**. Un `expect` aquí mataría
    /// el hilo del hook y con él el atajo de dictar, que es la función
    /// principal de la app — por una de laboratorio que no pudo arrancar.
    teclado: Option<Keyboard>,
    palabra: String,
    /// La ventana que tenía el foco cuando empezó la palabra. Si cambia, lo que
    /// hubiera a medias se tira: no es continuación de nada.
    ventana: isize,
    /// Esta ventana está vetada o es un campo de contraseña. Se resuelve **una
    /// vez por ventana**, que si no habría dos consultas a Win32 por pulsación.
    vetada: bool,
    settings: SettingsState,
    store: Arc<crate::store::Store>,
    /// El diccionario del usuario, con su hora de lectura.
    dicc: Vec<(String, String)>,
    dicc_leido: Instant,
    tx: Sender<Reemplazo>,
    /// Lo levanta el hilo que teclea. Nuestras propias teclas vuelven por el
    /// hook, y sin esto el corrector se leería a sí mismo.
    escribiendo: Arc<AtomicBool>,
}

impl Corrector {
    pub fn nuevo(settings: SettingsState, store: Arc<crate::store::Store>) -> Self {
        let escribiendo = Arc::new(AtomicBool::new(false));
        let tx = spawn_tecleador(escribiendo.clone(), settings.clone());
        let teclado = Keyboard::new();
        if teclado.is_none() {
            log::warn!("Corrección al vuelo: rdev no pudo abrir el teclado; queda apagada");
        }
        Self {
            teclado,
            palabra: String::new(),
            ventana: 0,
            vetada: true,
            settings,
            store,
            dicc: Vec::new(),
            // Forzar la primera lectura en cuanto se cierre una palabra.
            dicc_leido: Instant::now() - REFRESCO_DICCIONARIO,
            tx,
            escribiendo,
        }
    }

    /// Se llama con cada evento de teclado. Vuelve enseguida: aquí no se teclea.
    pub fn observa(&mut self, event: &EventType) {
        let (activo, vetadas) = {
            let Ok(s) = self.settings.read() else {
                return;
            };
            (s.corregir_al_escribir, s.apps_sin_correccion.clone())
        };
        if !activo {
            self.palabra.clear();
            return;
        }
        // Mientras nosotros tecleamos, el hook ve nuestras propias teclas.
        if self.escribiendo.load(Ordering::SeqCst) {
            return;
        }

        let ahora = crate::overlay::ventana_al_frente();
        if ahora != self.ventana {
            self.ventana = ahora;
            self.palabra.clear();
            self.vetada = esta_vetada(&vetadas);
        }
        if self.vetada {
            return;
        }

        // Borrar retrocede la palabra en curso: sin esto, arreglar un dedazo a
        // mano dejaba el buffer diciendo una cosa y la pantalla otra, y el
        // reemplazo borraba de más.
        if matches!(event, EventType::KeyPress(Key::Backspace)) {
            self.palabra.pop();
            return;
        }

        let Some(teclado) = self.teclado.as_mut() else {
            return;
        };
        let Some(texto) = teclado.add(event) else {
            return;
        };
        for c in texto.chars() {
            if c == ' ' {
                self.cierra_palabra();
            } else if c.is_alphabetic() || c == '\'' {
                self.palabra.push(c);
                if self.palabra.chars().count() > MAX_PALABRA {
                    self.palabra.clear();
                }
            } else {
                // Dígitos, signos, Enter, tabulador: cierran sin corregir. Una
                // «palabra» con un número dentro no es prosa, y **reteclear un
                // Enter enviaría dos veces** lo que estuvieras enviando.
                self.palabra.clear();
            }
        }
    }

    /// El espacio es el único cierre que dispara una corrección, porque es el
    /// único separador que se puede volver a teclear sin efectos secundarios.
    fn cierra_palabra(&mut self) {
        if self.palabra.is_empty() {
            return;
        }
        if self.dicc_leido.elapsed() >= REFRESCO_DICCIONARIO {
            self.dicc = self
                .store
                .dict_pairs()
                .into_iter()
                .filter_map(|(t, r)| r.map(|r| (t.to_lowercase(), r)))
                .collect();
            self.dicc_leido = Instant::now();
        }
        // El diccionario del usuario manda sobre la tabla: lo escribió él.
        let baja = self.palabra.to_lowercase();
        let bueno = self
            .dicc
            .iter()
            .find(|(t, _)| *t == baja)
            .map(|(_, r)| r.clone())
            .or_else(|| crate::ortografia::corrige(&self.palabra));
        if let Some(bueno) = bueno {
            if bueno != self.palabra {
                let _ = self.tx.send(Reemplazo {
                    borrar: self.palabra.chars().count() + 1,
                    texto: format!("{bueno} "),
                });
            }
        }
        self.palabra.clear();
    }
}

/// ¿Esta ventana está fuera de límites?
fn esta_vetada(vetadas: &[String]) -> bool {
    if crate::overlay::es_campo_password() {
        return true;
    }
    match crate::overlay::proceso_al_frente() {
        // Sin saber en qué app estamos, no se corrige. Es el lado seguro: una
        // corrección que no se hace no molesta a nadie.
        None => true,
        Some(exe) => vetadas.iter().any(|v| v.to_lowercase() == exe),
    }
}

/// El hilo que teclea de verdad.
///
/// Va aparte del hook (ver la cabecera del módulo) y **vuelve a comprobar la
/// ventana justo antes de escribir**: entre que el hook decide y esto se ejecuta
/// pasan milisegundos, y en ese hueco el usuario pudo saltar a otra ventana.
/// Reemplazar entonces escribiría los borrados en el sitio equivocado.
fn spawn_tecleador(escribiendo: Arc<AtomicBool>, settings: SettingsState) -> Sender<Reemplazo> {
    let (tx, rx) = channel::<Reemplazo>();
    std::thread::spawn(move || {
        for r in rx {
            let vetadas = settings
                .read()
                .map(|s| s.apps_sin_correccion.clone())
                .unwrap_or_default();
            if esta_vetada(&vetadas) {
                continue;
            }
            escribiendo.store(true, Ordering::SeqCst);
            if let Err(e) = teclear(&r) {
                log::warn!("Corrección al vuelo: no se pudo escribir ({e})");
            }
            // Un respiro antes de bajar la bandera: las teclas sintéticas
            // todavía vienen de camino al hook, y sin esto las leería como si
            // las hubiera escrito el usuario.
            std::thread::sleep(Duration::from_millis(40));
            escribiendo.store(false, Ordering::SeqCst);
        }
    });
    tx
}

fn teclear(r: &Reemplazo) -> anyhow::Result<()> {
    use enigo::{Direction, Enigo, Key as EKey, Keyboard as _, Settings};
    let mut enigo = Enigo::new(&Settings::default())?;
    for _ in 0..r.borrar {
        enigo.key(EKey::Backspace, Direction::Click)?;
    }
    enigo.text(&r.texto)?;
    Ok(())
}
