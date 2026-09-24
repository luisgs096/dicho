use anyhow::{anyhow, Context};
use futures_util::StreamExt;
use serde::Serialize;
use std::path::PathBuf;
use std::sync::atomic::{AtomicBool, Ordering};
use tauri::{AppHandle, Emitter, Manager};

const BASE_URL: &str =
    "https://huggingface.co/istupakov/parakeet-tdt-0.6b-v3-onnx/resolve/main/";

/// Archivos que exige transcribe-rs para Parakeet int8, con su tamaño exacto.
const FILES: [(&str, u64); 4] = [
    ("encoder-model.int8.onnx", 652_183_999),
    ("decoder_joint-model.int8.onnx", 18_202_004),
    ("nemo128.onnx", 139_764),
    ("vocab.txt", 93_939),
];

static DOWNLOADING: AtomicBool = AtomicBool::new(false);

#[derive(Debug, Clone, Serialize)]
#[serde(tag = "state", rename_all = "snake_case")]
pub enum ModelStatus {
    Ready,
    Missing { downloaded: u64, total: u64 },
    Downloading,
}

#[derive(Debug, Clone, Serialize)]
struct Progress {
    file: String,
    downloaded: u64,
    total: u64,
    done: bool,
    error: Option<String>,
}

pub fn model_dir(app: &AppHandle) -> PathBuf {
    app.path()
        .app_data_dir()
        .expect("app_data_dir no disponible")
        .join("models")
        .join("parakeet-tdt-0.6b-v3-int8")
}

pub fn total_bytes() -> u64 {
    FILES.iter().map(|(_, s)| s).sum()
}

pub fn status(app: &AppHandle) -> ModelStatus {
    if DOWNLOADING.load(Ordering::SeqCst) {
        return ModelStatus::Downloading;
    }
    let dir = model_dir(app);
    let mut have = 0u64;
    let mut complete = true;
    for (name, size) in FILES {
        match std::fs::metadata(dir.join(name)) {
            Ok(m) if m.len() == size => have += size,
            _ => complete = false,
        }
    }
    if complete {
        ModelStatus::Ready
    } else {
        ModelStatus::Missing {
            downloaded: have,
            total: total_bytes(),
        }
    }
}

fn emit_progress(app: &AppHandle, file: &str, downloaded: u64, done: bool, error: Option<String>) {
    let _ = app.emit(
        "model-progress",
        Progress {
            file: file.to_string(),
            downloaded,
            total: total_bytes(),
            done,
            error,
        },
    );
}

/// Descarga los archivos faltantes con reanudación (HTTP Range) y progreso.
pub async fn download(app: AppHandle) -> anyhow::Result<()> {
    if DOWNLOADING.swap(true, Ordering::SeqCst) {
        return Ok(()); // ya hay una descarga en curso
    }
    let result = download_inner(&app).await;
    DOWNLOADING.store(false, Ordering::SeqCst);
    match &result {
        // El `done` del progreso es el aviso de "listo": Ajustes no escucha otro.
        Ok(()) => emit_progress(&app, "", total_bytes(), true, None),
        Err(e) => emit_progress(&app, "", 0, false, Some(e.to_string())),
    }
    result
}

async fn download_inner(app: &AppHandle) -> anyhow::Result<()> {
    let dir = model_dir(app);
    std::fs::create_dir_all(&dir)?;
    let client = reqwest::Client::builder()
        .connect_timeout(std::time::Duration::from_secs(20))
        .build()?;

    // Bytes ya completos de archivos anteriores, para el progreso global.
    let mut overall_done: u64 = 0;

    for (name, expected) in FILES {
        let final_path = dir.join(name);
        if let Ok(m) = std::fs::metadata(&final_path) {
            if m.len() == expected {
                overall_done += expected;
                continue;
            }
        }
        let part_path = dir.join(format!("{name}.part"));
        let mut start: u64 = std::fs::metadata(&part_path).map(|m| m.len()).unwrap_or(0);
        if start > expected {
            std::fs::remove_file(&part_path).ok();
            start = 0;
        }

        let mut request = client.get(format!("{BASE_URL}{name}"));
        if start > 0 {
            request = request.header("Range", format!("bytes={start}-"));
        }
        let resp = request
            .send()
            .await
            .with_context(|| format!("No se pudo descargar {name} (¿sin internet?)"))?;
        if !resp.status().is_success() {
            return Err(anyhow!("Descarga de {name} falló: HTTP {}", resp.status()));
        }
        // Si el servidor ignoró el Range, empezamos de cero.
        if start > 0 && resp.status() != reqwest::StatusCode::PARTIAL_CONTENT {
            start = 0;
        }

        // Sin truncar a propósito: se reanuda donde se quedó. El set_len de
        // abajo recorta lo que sobre si el servidor ignoró el Range.
        let mut file = std::fs::OpenOptions::new()
            .create(true)
            .write(true)
            .truncate(false)
            .open(&part_path)?;
        {
            use std::io::{Seek, SeekFrom, Write};
            file.set_len(start)?;
            file.seek(SeekFrom::Start(start))?;
            let mut written = start;
            let mut last_emit = std::time::Instant::now();
            let mut stream = resp.bytes_stream();
            while let Some(chunk) = stream.next().await {
                let chunk = chunk.with_context(|| format!("Descarga de {name} interrumpida"))?;
                file.write_all(&chunk)?;
                written += chunk.len() as u64;
                if last_emit.elapsed().as_millis() > 150 {
                    emit_progress(app, name, overall_done + written, false, None);
                    last_emit = std::time::Instant::now();
                }
            }
            file.flush()?;
            if written != expected {
                return Err(anyhow!(
                    "{name}: tamaño inesperado ({written} de {expected} bytes)"
                ));
            }
        }
        std::fs::rename(&part_path, &final_path)?;
        overall_done += expected;
        emit_progress(app, name, overall_done, false, None);
    }
    Ok(())
}
