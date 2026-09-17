use anyhow::Context;
use enigo::{Direction, Enigo, Key, Keyboard, Settings};
use std::thread;
use std::time::Duration;

/// Lee lo que el usuario tenga **seleccionado** en la app que esté usando.
///
/// No hay forma de preguntarle a Windows "qué hay seleccionado": hay que pedir
/// una copia y mirar el portapapeles, que es lo que hace cualquier herramienta
/// de este tipo. Por eso se respalda antes y se devuelve después — si no, usar
/// la corrección te borraría lo que tuvieras copiado.
///
/// Devuelve `None` si no había nada seleccionado. Se distingue comparando con
/// lo que ya había: si tras el Ctrl+C el portapapeles no cambió, es que no se
/// copió nada. No es infalible —seleccionar exactamente lo mismo que ya tenías
/// copiado daría un falso negativo— pero el precio de equivocarse es no hacer
/// nada, que es el lado seguro.
pub fn leer_seleccion() -> anyhow::Result<Option<String>> {
    let mut clipboard =
        arboard::Clipboard::new().context("No se pudo acceder al portapapeles")?;
    let previo = clipboard.get_text().ok();

    let mut enigo =
        Enigo::new(&Settings::default()).context("No se pudo inicializar el inyector")?;
    enigo.key(Key::Control, Direction::Press)?;
    enigo.key(Key::Unicode('c'), Direction::Click)?;
    enigo.key(Key::Control, Direction::Release)?;
    // La app de destino copia de forma asíncrona; leer antes devuelve lo viejo.
    thread::sleep(Duration::from_millis(160));

    let ahora = clipboard.get_text().ok();
    let seleccion = match (&previo, &ahora) {
        (_, None) => None,
        (Some(a), Some(b)) if a == b => None,
        (_, Some(b)) if b.trim().is_empty() => None,
        (_, Some(b)) => Some(b.clone()),
    };
    if let Some(viejo) = previo {
        let _ = clipboard.set_text(viejo);
    }
    Ok(seleccion)
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
