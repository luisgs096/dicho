use crate::pipeline::Cmd;
use crate::settings::SettingsState;
use rdev::{EventType, Key};
use std::collections::HashSet;
use std::sync::mpsc::Sender;

/// Escucha global de teclado (hook de bajo nivel de Windows vía rdev).
/// Detecta la combinación push-to-talk: al completarse → Cmd::Start,
/// al soltar cualquiera de sus teclas → Cmd::Stop.
pub fn spawn(tx: Sender<Cmd>, settings: SettingsState) {
    std::thread::spawn(move || {
        let mut pressed: HashSet<Key> = HashSet::new();
        let mut active = false;
        let result = rdev::listen(move |event| {
            match event.event_type {
                EventType::KeyPress(k) => {
                    pressed.insert(k);
                }
                EventType::KeyRelease(k) => {
                    pressed.remove(&k);
                }
                _ => return,
            }
            let combo = settings
                .read()
                .map(|s| s.hotkey.clone())
                .unwrap_or_default();
            if combo.is_empty() {
                return;
            }
            let all_down = combo.iter().all(|k| pressed.contains(k));
            if !active && all_down {
                active = true;
                let _ = tx.send(Cmd::Start);
            } else if active && !all_down {
                active = false;
                let _ = tx.send(Cmd::Stop);
            }
        });
        if let Err(e) = result {
            log::error!("El listener global de teclado falló: {e:?}");
        }
    });
}
