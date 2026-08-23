use anyhow::Context;
use enigo::{Direction, Enigo, Key, Keyboard, Settings};
use std::thread;
use std::time::Duration;

/// Inserta texto en la app activa: respalda el portapapeles, coloca el texto,
/// simula Ctrl+V y restaura el contenido original. Maneja Unicode completo
/// (acentos, ñ, emoji) sin depender del layout de teclado.
pub fn inject_text(text: &str) -> anyhow::Result<()> {
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
    if let Some(old) = previous {
        let _ = clipboard.set_text(old);
    }
    Ok(())
}
