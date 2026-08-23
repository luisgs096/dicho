use crate::audio::{resample_to_16k, AudioRecorder};
use crate::inject::inject_text;
use crate::models::{self, ModelStatus};
use crate::polish::{self, PolishCtx};
use crate::settings::{EngineKind, PolishKind, SettingsState};
use crate::store::Store;
use crate::stt::{groq::GroqStt, parakeet::ParakeetStt, Stt};
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::mpsc::Receiver;
use std::sync::{Arc, Mutex};
use std::time::{Duration, Instant};
use tauri::{AppHandle, Emitter, Manager};

pub enum Cmd {
    Start,
    Stop,
    /// El modelo terminó de descargarse: precarga en caliente.
    ModelReady,
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

fn show_hud(app: &AppHandle) {
    let Some(hud) = app.get_webview_window("hud") else {
        return;
    };
    if let Ok(Some(monitor)) = app.primary_monitor() {
        let msize = monitor.size();
        let mpos = monitor.position();
        let wsize = hud.outer_size().unwrap_or(tauri::PhysicalSize {
            width: 360,
            height: 96,
        });
        let x = mpos.x + ((msize.width as i32 - wsize.width as i32) / 2);
        let y = mpos.y + msize.height as i32
            - wsize.height as i32
            - (64.0 * monitor.scale_factor()) as i32;
        let _ = hud.set_position(tauri::PhysicalPosition { x, y });
    }
    let _ = hud.show();
}

fn hide_hud_later(app: &AppHandle, gen: &Arc<AtomicU64>, delay_ms: u64) {
    let expected = gen.load(Ordering::SeqCst);
    let app = app.clone();
    let gen = gen.clone();
    std::thread::spawn(move || {
        std::thread::sleep(Duration::from_millis(delay_ms));
        if gen.load(Ordering::SeqCst) == expected {
            if let Some(hud) = app.get_webview_window("hud") {
                let _ = hud.hide();
            }
        }
    });
}

pub fn spawn(app: AppHandle, rx: Receiver<Cmd>, settings: SettingsState, store: Arc<Store>) {
    std::thread::spawn(move || {
        let mut recorder: Option<AudioRecorder> = None;
        let mut started_at = Instant::now();
        let mut parakeet: Option<ParakeetStt> = None;
        let mut groq = GroqStt::new();
        // Generación de sesión HUD: invalida ocultados diferidos si llega una nueva.
        let hud_gen = Arc::new(AtomicU64::new(0));

        // Precarga el modelo local si ya está en disco (arranque en caliente).
        if matches!(models::status(&app), ModelStatus::Ready) {
            log::info!("Precargando Parakeet...");
            match ParakeetStt::load(&models::model_dir(&app)) {
                Ok(m) => {
                    parakeet = Some(m);
                    log::info!("Parakeet listo");
                }
                Err(e) => log::error!("Precarga de Parakeet falló: {e}"),
            }
        }

        while let Ok(cmd) = rx.recv() {
            match cmd {
                Cmd::ModelReady => {
                    if parakeet.is_none() {
                        match ParakeetStt::load(&models::model_dir(&app)) {
                            Ok(m) => parakeet = Some(m),
                            Err(e) => log::error!("Carga de Parakeet falló: {e}"),
                        }
                    }
                }
                Cmd::Start => {
                    if recorder.is_some() {
                        continue;
                    }
                    let engine = settings.read().map(|s| s.engine).unwrap_or(EngineKind::Parakeet);
                    // Sin modelo local y sin motor cloud → guía al usuario.
                    if engine == EngineKind::Parakeet && parakeet.is_none() {
                        let msg = match models::status(&app) {
                            ModelStatus::Downloading => {
                                "Descargando el modelo de voz… abre Configuración para ver el progreso".to_string()
                            }
                            _ => "Falta el modelo de voz: ábreme desde la bandeja y descárgalo".to_string(),
                        };
                        hud_gen.fetch_add(1, Ordering::SeqCst);
                        show_hud(&app);
                        emit_state(&app, "error", Some(serde_json::json!({ "message": msg })));
                        hide_hud_later(&app, &hud_gen, 3200);
                        continue;
                    }
                    hud_gen.fetch_add(1, Ordering::SeqCst);
                    let hud_enabled = settings.read().map(|s| s.hud_enabled).unwrap_or(true);
                    if hud_enabled {
                        show_hud(&app);
                    }
                    emit_state(&app, "recording", None);
                    let level_app = app.clone();
                    // Máximo ~30 eventos/s hacia el HUD para no saturar el IPC.
                    let last_emit = Arc::new(Mutex::new(Instant::now() - Duration::from_secs(1)));
                    match AudioRecorder::start(move |rms| {
                        let mut last = last_emit.lock().unwrap();
                        if last.elapsed() >= Duration::from_millis(33) {
                            *last = Instant::now();
                            drop(last);
                            let _ = level_app
                                .emit("audio-level", serde_json::json!({ "level": rms }));
                        }
                    }) {
                        Ok(r) => {
                            recorder = Some(r);
                            started_at = Instant::now();
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
                Cmd::Stop => {
                    let Some(rec) = recorder.take() else { continue };
                    let held = started_at.elapsed();
                    emit_state(&app, "processing", None);

                    let outcome = (|| -> anyhow::Result<Option<(String, String, &'static str, i64)>> {
                        let (samples, rate) = rec.stop()?;
                        // Toques accidentales: menos de 350 ms no se procesan.
                        if held < Duration::from_millis(350) {
                            return Ok(None);
                        }
                        let t_rs = Instant::now();
                        let samples = resample_to_16k(samples, rate)?;
                        log::info!(
                            "Resample {}Hz→16k: {} ms ({:.1} s de audio)",
                            rate,
                            t_rs.elapsed().as_millis(),
                            samples.len() as f32 / 16_000.0
                        );
                        if samples.len() < 16_000 / 4 {
                            return Ok(None);
                        }
                        let (engine, polish_kind, language) = {
                            let s = settings.read().unwrap();
                            (s.engine, s.polish, s.language.clone())
                        };
                        let lang = match language.as_str() {
                            "auto" | "" => None,
                            other => Some(other.to_string()),
                        };

                        let t0 = Instant::now();
                        let (raw, engine_name) = match engine {
                            EngineKind::Groq => {
                                match groq.transcribe(&samples, lang.as_deref()) {
                                    Ok(t) => (t, "groq"),
                                    Err(e) => {
                                        // Fallback transparente al motor local.
                                        if let Some(p) = parakeet.as_mut() {
                                            log::warn!("Groq falló ({e}), usando Parakeet local");
                                            (p.transcribe(&samples, lang.as_deref())?, "parakeet")
                                        } else {
                                            return Err(e);
                                        }
                                    }
                                }
                            }
                            EngineKind::Parakeet => {
                                let p = parakeet
                                    .as_mut()
                                    .ok_or_else(|| anyhow::anyhow!("Modelo local no cargado"))?;
                                (p.transcribe(&samples, lang.as_deref())?, "parakeet")
                            }
                        };
                        let stt_ms = t0.elapsed().as_millis() as i64;
                        log::info!("STT [{engine_name}] {stt_ms} ms: {raw}");
                        if raw.trim().is_empty() {
                            return Ok(None);
                        }

                        let ctx = PolishCtx {
                            language,
                            dictionary: store.dict_pairs(),
                        };
                        let polished = match polish_kind {
                            PolishKind::Rules => polish::rules::polish(&raw, &ctx),
                            PolishKind::GroqLlm => match polish::groq::polish(&raw, &ctx) {
                                Ok(t) => t,
                                Err(e) => {
                                    log::warn!("Pulido LLM falló ({e}), usando reglas locales");
                                    polish::rules::polish(&raw, &ctx)
                                }
                            },
                        };
                        Ok(Some((raw, polished, engine_name, stt_ms)))
                    })();

                    match outcome {
                        Ok(Some((raw, polished, engine_name, stt_ms))) => {
                            if let Err(e) = inject_text(&polished) {
                                emit_state(
                                    &app,
                                    "error",
                                    Some(serde_json::json!({ "message": e.to_string() })),
                                );
                                hide_hud_later(&app, &hud_gen, 3200);
                                continue;
                            }
                            let _ = store.add_history(
                                &raw,
                                &polished,
                                engine_name,
                                held.as_millis() as i64,
                            );
                            log::info!(
                                "Dictado listo: {} ms grabación, {} ms STT",
                                held.as_millis(),
                                stt_ms
                            );
                            emit_state(
                                &app,
                                "done",
                                Some(serde_json::json!({ "text": polished })),
                            );
                            let _ = app.emit("history-changed", ());
                            hide_hud_later(&app, &hud_gen, 1400);
                        }
                        Ok(None) => {
                            emit_state(&app, "idle", None);
                            hide_hud_later(&app, &hud_gen, 150);
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
