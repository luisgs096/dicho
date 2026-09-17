//! Corregir mientras escribes.
//!
//! Mira lo que tecleas y, al terminar una palabra, si esa palabra está mal
//! escrita la reemplaza: borra lo escrito y pone la buena. Es la función de
//! LABS que pidió el usuario porque, en sus palabras, tiene «muy mala
//! ortografía».
//!
//! # Todo pasa aquí dentro
//!
//! **Nada de lo que escribes sale de este proceso.** No se guarda en disco, no
//! se manda a ninguna API y no entra en el historial. La corrección es una
//! tabla local y el diccionario que el propio usuario escribió; no hay IA de
//! por medio, y no la habrá: mandar cada palabra que tecleas a un servidor es
//! justo lo que no se puede hacer. La palabra a medias vive en memoria unos
//! milisegundos y se borra al cerrarla.
//!
//! # Lo que no se puede garantizar, dicho antes
//!
//! Windows sólo deja saber si estás en un campo de contraseña cuando es un
//! control **nativo** (`EM_GETPASSWORDCHAR`). En Chrome, Edge, Electron o
//! cualquier app que se dibuje su propia interfaz, eso no se puede consultar:
//! el sistema ve una sola ventana de dibujo y nada más. O sea que **en el
//! navegador no hay forma de detectar un campo de contraseña**.
//!
//! Lo que sí protege, y por eso está:
//!
//!  - La tabla sólo contiene palabras castellanas mal escritas. Una contraseña
//!    no está ahí, así que no se toca.
//!  - La palabra en curso se tira entera en cuanto cambias de ventana.
//!  - Hay una lista de apps donde no actúa nunca, editable por el usuario, y
//!    viene con las terminales y los gestores de contraseñas ya puestos.
//!
//! # Por qué el trabajo va en otro hilo
//!
//! El hook de teclado de Windows es de baja latencia: lo que corra dentro
//! bloquea el teclado de todo el sistema. Escribir con `enigo` son decenas de
//! milisegundos, así que el hook sólo **decide** y manda el reemplazo por un
//! canal; teclear lo hace el hilo de aquí abajo.

use rdev::{EventType, Keyboard, KeyboardState};
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::mpsc::{channel, Sender};
use std::sync::Arc;

/// Tope de letras de una palabra antes de dejar de mirarla.
///
/// No es una optimización: las palabras larguísimas suelen ser rutas, claves o
/// identificadores, justo lo que no hay que tocar ni acumular.
const MAX_PALABRA: usize = 24;

/// Apps donde nunca se corrige, salvo que el usuario diga lo contrario.
///
/// Las terminales porque ahí se escriben órdenes, no prosa: cambiar una palabra
/// puede ejecutar algo distinto de lo que quisiste. Los gestores de contraseñas
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
pub struct Reemplazo {
    pub borrar: usize,
    pub texto: String,
}

/// Lo que el hook necesita para seguir la palabra en curso.
pub struct Corrector {
    teclado: Keyboard,
    palabra: String,
    /// La ventana que tenía el foco cuando empezó la palabra. Si cambia, la
    /// palabra se tira: lo tecleado en otra ventana no es continuación de esto.
    ventana: isize,
    /// Esta ventana está vetada o es un campo de contraseña. Se resuelve una vez
    /// por ventana y no en cada tecla, que si no habría una consulta a Win32 por
    /// pulsación.
    vetada: bool,
    tx: Sender<Reemplazo>,
    /// Lo levanta el hilo que teclea. Nuestras propias teclas vuelven por el
    /// hook, y sin esto el corrector se leería a sí mismo y podría entrar en
    /// bucle corrigiendo lo que acaba de corregir.
    escribiendo: Arc<AtomicBool>,
}

impl Corrector {
    pub fn nuevo(vetadas: Vec<String>) -> Self {
        let escribiendo = Arc::new(AtomicBool::new(false));
        Self {
            teclado: Keyboard::new().expect("teclado de rdev"),
            palabra: String::new(),
            ventana: 0,
            vetada: false,
            tx: spawn_tecleador(escribiendo.clone(), vetadas),
            escribiendo,
        }
    }

    /// Se llama con cada evento de teclado. Devuelve enseguida: aquí no se
    /// teclea nada, sólo se decide.
    ///
    /// `activo` llega de los ajustes en cada evento, igual que el atajo, para
    /// que encender y apagar el interruptor de LABS surta efecto al momento.
    pub fn observa(&mut self, event: &EventType, activo: bool, tabla: &dyn Tabla) {
        if !activo {
            self.palabra.clear();
            return;
        }
        // Mientras nosotros tecleamos, el hook ve nuestras propias teclas.
        if self.escribiendo.load(Ordering::SeqCst) {
            return;
        }
        // Cambió la ventana: lo que hubiera a medias no sigue aquí.
        let actual = crate::overlay::ventana_al_frente();
        if actual != self.ventana {
            self.ventana = actual;
            self.palabra.clear();
            self.vetada = crate::overlay::ventana_vetada(actual);
        }
        if self.vetada {
            return;
        }

        // Borrar retrocede la palabra en curso; sin esto, corregir un dedazo a
        // mano dejaba el buffer desincronizado con la pantalla.
        if matches!(event, EventType::KeyPress(rdev::Key::Backspace)) {
            self.palabra.pop();
            return;
        }

        let Some(texto) = self.teclado.add(event) else {
            return;
        };
        for c in texto.chars() {
            if c == ' ' {
                // El espacio es el único cierre que dispara. Con Enter o con un
                // signo de puntuación sólo se tira la palabra: para reemplazar
                // hay que volver a teclear el separador, y **retecleando un
                // Enter se envía dos veces** lo que estuvieras enviando.
                if let Some(bueno) = tabla.corrige(&self.palabra) {
                    let _ = self.tx.send(Reemplazo {
                        borrar: self.palabra.chars().count() + 1,
                        texto: format!("{bueno} "),
                    });
                }
                self.palabra.clear();
            } else if c.is_alphabetic() || c == '\'' {
                self.palabra.push(c);
                if self.palabra.chars().count() > MAX_PALABRA {
                    self.palabra.clear();
                }
            } else {
                // Dígitos, signos, Enter, tabulador: cierran la palabra sin
                // corregirla. Una «palabra» con un número dentro no es prosa.
                self.palabra.clear();
            }
        }
    }
}

/// De dónde salen las correcciones. Es un trait para que el hook no tenga que
/// conocer ni la base de datos ni los ajustes.
pub trait Tabla {
    fn corrige(&self, palabra: &str) -> Option<String>;
}

/// El hilo que teclea de verdad.
///
/// Va aparte del hook a propósito (ver la cabecera del módulo) y además
/// **vuelve a comprobar la ventana justo antes de teclear**: entre que el hook
/// decide y esto se ejecuta pueden pasar milisegundos, y en ese hueco el
/// usuario pudo saltar a otra ventana. Reemplazar ahí escribiría ocho borrados
/// en el sitio equivocado.
fn spawn_tecleador(escribiendo: Arc<AtomicBool>, vetadas: Vec<String>) -> Sender<Reemplazo> {
    let (tx, rx) = channel::<Reemplazo>();
    std::thread::spawn(move || {
        for r in rx {
            if crate::overlay::ventana_vetada_por(&vetadas) {
                continue;
            }
            escribiendo.store(true, Ordering::SeqCst);
            if let Err(e) = teclear(&r) {
                log::warn!("Corrección al vuelo: no se pudo escribir ({e})");
            }
            // Un respiro antes de bajar la bandera: las teclas sintéticas
            // todavía vienen de camino al hook y sin esto las leería como si
            // las hubiera escrito el usuario.
            std::thread::sleep(std::time::Duration::from_millis(40));
            escribiendo.store(false, Ordering::SeqCst);
        }
    });
    tx
}

fn teclear(r: &Reemplazo) -> anyhow::Result<()> {
    use enigo::{Direction, Enigo, Key, Keyboard as _, Settings};
    let mut enigo = Enigo::new(&Settings::default())?;
    for _ in 0..r.borrar {
        enigo.key(Key::Backspace, Direction::Click)?;
    }
    enigo.text(&r.texto)?;
    Ok(())
}
