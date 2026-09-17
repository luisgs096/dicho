use crate::pipeline::Cmd;
use crate::settings::SettingsState;
use rdev::{EventType, Key};
use std::collections::HashSet;
use std::sync::mpsc::Sender;
use std::sync::Arc;

/// Escucha global de teclado (hook de bajo nivel de Windows vía rdev).
/// Detecta la combinación push-to-talk: al completarse → Cmd::Start,
/// al soltar cualquiera de sus teclas → Cmd::Stop.
pub fn spawn(tx: Sender<Cmd>, settings: SettingsState, store: Arc<crate::store::Store>) {
    std::thread::spawn(move || {
        // La corrección al vuelo se cuelga de este mismo hook: ya estamos
        // mirando cada tecla del sistema, así que abrir un segundo hook sería
        // pagar dos veces por lo mismo. Él decide si está encendida.
        let mut corrector = crate::autotype::Corrector::nuevo(settings.clone(), store);
        let mut pressed: HashSet<Key> = HashSet::new();
        let mut active = false;
        // Tras cancelar, el atajo sigue apretado: sin esto `all_down` seguiría
        // siendo cierto y arrancaría un dictado nuevo en el acto. Se levanta
        // cuando por fin sueltas.
        let mut esperando_soltar = false;
        // El atajo de corregir dispara una vez por pulsación, no una por evento
        // de teclado: sin esto, mantenerlo medio segundo mandaría decenas.
        let mut corrigiendo = false;
        let result = rdev::listen(move |event| {
            // Lo primero y aparte del atajo: aquí sólo se acumula la palabra y
            // se decide. Teclear lo hace otro hilo — lo que corra dentro de este
            // callback bloquea el teclado de todo el sistema.
            corrector.observa(&event.event_type);
            match event.event_type {
                EventType::KeyPress(k) => {
                    // La tecla de cancelar a media grabación = me arrepentí.
                    // Se cancela y se baja la bandera, así que soltar luego el
                    // atajo ya no manda Stop: el audio se tira y no se
                    // transcribe nada. Fuera de la grabación no se toca — sea
                    // cual sea, es una tecla de todo el mundo.
                    let cancelar = settings.read().ok().and_then(|s| s.cancelar);
                    if active && Some(k) == cancelar {
                        active = false;
                        esperando_soltar = true;
                        let _ = tx.send(Cmd::Cancel);
                        pressed.insert(k);
                        return;
                    }
                    pressed.insert(k);
                }
                EventType::KeyRelease(k) => {
                    pressed.remove(&k);
                }
                _ => return,
            }
            // El atajo de corregir se mira aparte y ANTES: es un disparo, no un
            // mantener pulsado, así que se comprueba al completarse la
            // combinación y se marca para no repetirse mientras sigue apretada.
            let (combo, corregir) = settings
                .read()
                .map(|s| (s.hotkey.clone(), s.corregir_atajo.clone()))
                .unwrap_or_default();
            if !corregir.is_empty() && !active {
                let todas = corregir.iter().all(|k| pressed.contains(k));
                if todas && !corrigiendo {
                    corrigiendo = true;
                    let _ = tx.send(Cmd::Corregir);
                } else if !todas {
                    corrigiendo = false;
                }
            }
            if combo.is_empty() {
                return;
            }
            let all_down = combo.iter().all(|k| pressed.contains(k));
            if esperando_soltar {
                if !all_down {
                    esperando_soltar = false;
                }
                return;
            }
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
