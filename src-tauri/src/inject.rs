use anyhow::Context;
use enigo::{Direction, Enigo, Key, Keyboard, Settings};
use std::thread;
use std::time::Duration;

/// Deja un texto en el portapapeles, sin tocar el teclado.
///
/// Es lo que usa la corrección al terminar: el usuario pega cuando quiera y con
/// el atajo que use su app. Ver el comentario de `leer_seleccion` sobre por qué
/// aquí no se sintetiza nada.
pub fn copiar(texto: &str) -> anyhow::Result<()> {
    arboard::Clipboard::new()
        .context("No se pudo acceder al portapapeles")?
        .set_text(texto.to_string())
        .context("No se pudo copiar el texto")
}

/// Lee el texto que el usuario haya copiado.
///
/// # Por qué NO sintetiza un Ctrl+C
///
/// La primera versión lo hacía: mandaba Ctrl+C y miraba si el portapapeles
/// cambiaba, que es como lo resuelven casi todas las herramientas de este tipo.
/// **Está mal y rompe cosas.** Ctrl+C sólo significa «copiar» en un editor de
/// texto. En una terminal significa **interrumpir**, y en una TUI como Claude
/// Code significa cortar lo que estuviera corriendo. Usar la corrección dentro
/// de una terminal le cerraba al usuario la conversación en la que estaba
/// trabajando — lo reportó él, y el síntoma no apuntaba a esto por ningún lado.
///
/// La regla que queda: **nunca sintetizar un atajo que el usuario no pulsó.**
/// No se puede saber qué significa esa combinación en la app que tiene delante,
/// y el repertorio de cosas destructivas que hay detrás de un atajo común es
/// enorme. Copiar lo hace él, con el atajo que use su app —Ctrl+C, Ctrl+Shift+C
/// o el menú—; Dicho sólo lee lo que quedó.
///
/// Devuelve `None` si el portapapeles está vacío o sólo tiene espacios.
pub fn leer_seleccion() -> anyhow::Result<Option<String>> {
    let mut clipboard =
        arboard::Clipboard::new().context("No se pudo acceder al portapapeles")?;
    Ok(clipboard
        .get_text()
        .ok()
        .filter(|t| !t.trim().is_empty()))
}

/// Inserta texto en la app activa: respalda el portapapeles, coloca el texto,
/// simula Ctrl+V y restaura el contenido original. Maneja Unicode completo
/// (acentos, ñ, emoji) sin depender del layout de teclado.
///
/// Con `conservar` en true **no restaura** lo que había: el dictado se queda en
/// el portapapeles para poder pegarlo otra vez con Ctrl+V donde quieras. Sale
/// casi gratis porque el texto ya pasaba por ahí para pegarse — lo único que se
/// salta es el último paso. Va apagado por defecto: pisarle a alguien lo que
/// tenía copiado sin avisar es de las cosas que se notan tarde y molestan.
pub fn inject_text(text: &str, conservar: bool) -> anyhow::Result<()> {
    let mut clipboard =
        arboard::Clipboard::new().context("No se pudo acceder al portapapeles")?;
    let previous = clipboard.get_text().ok();

    clipboard
        .set_text(text.to_string())
        .context("No se pudo escribir al portapapeles")?;
    // Da tiempo a que el sistema registre el nuevo contenido.
    thread::sleep(Duration::from_millis(80));

    let mut enigo =
        Enigo::new(&Settings::default()).context("No se pudo inicializar el inyector")?;
    enigo.key(Key::Control, Direction::Press)?;
    enigo.key(Key::Unicode('v'), Direction::Click)?;
    enigo.key(Key::Control, Direction::Release)?;

    // La app destino lee el portapapeles de forma asíncrona: restaurar
    // demasiado pronto rompería el pegado.
    thread::sleep(Duration::from_millis(350));
    if !conservar {
        if let Some(old) = previous {
            let _ = clipboard.set_text(old);
        }
    }
    Ok(())
}
