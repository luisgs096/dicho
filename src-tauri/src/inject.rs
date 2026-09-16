use anyhow::Context;
use enigo::{Direction, Enigo, Key, Keyboard, Settings};
use std::thread;
use std::time::Duration;

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
