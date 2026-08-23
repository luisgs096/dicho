use anyhow::Context;
use rusqlite::Connection;
use serde::Serialize;
use std::path::PathBuf;
use std::sync::Mutex;
use tauri::{AppHandle, Manager};

pub struct Store {
    conn: Mutex<Connection>,
}

#[derive(Debug, Serialize)]
pub struct HistoryItem {
    pub id: i64,
    pub ts: i64,
    pub raw: String,
    pub polished: String,
    pub engine: String,
    pub duration_ms: i64,
    /// Correcciones del diccionario aplicadas: [{term, replacement, count}].
    pub corrections: serde_json::Value,
}

#[derive(Debug, Serialize)]
pub struct DictItem {
    pub id: i64,
    pub term: String,
    pub replacement: Option<String>,
}

fn db_path(app: &AppHandle) -> anyhow::Result<PathBuf> {
    let dir = app
        .path()
        .app_data_dir()
        .context("app_data_dir no disponible")?;
    std::fs::create_dir_all(&dir)?;
    Ok(dir.join("mike.db"))
}

impl Store {
    pub fn init(app: &AppHandle) -> anyhow::Result<Self> {
        let conn = Connection::open(db_path(app)?)?;
        conn.execute_batch(
            "CREATE TABLE IF NOT EXISTS history (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                ts INTEGER NOT NULL,
                raw TEXT NOT NULL,
                polished TEXT NOT NULL,
                engine TEXT NOT NULL,
                duration_ms INTEGER NOT NULL,
                corrections TEXT
            );
            CREATE TABLE IF NOT EXISTS dictionary (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                term TEXT NOT NULL UNIQUE,
                replacement TEXT
            );",
        )?;
        // Migración desde v0.1: la columna no existía; si ya está, el ALTER falla y se ignora.
        let _ = conn.execute("ALTER TABLE history ADD COLUMN corrections TEXT", []);
        Ok(Self {
            conn: Mutex::new(conn),
        })
    }

    pub fn add_history(
        &self,
        raw: &str,
        polished: &str,
        engine: &str,
        duration_ms: i64,
        corrections_json: Option<&str>,
    ) -> anyhow::Result<()> {
        let ts = std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)?
            .as_millis() as i64;
        self.conn.lock().unwrap().execute(
            "INSERT INTO history (ts, raw, polished, engine, duration_ms, corrections)
             VALUES (?1, ?2, ?3, ?4, ?5, ?6)",
            rusqlite::params![ts, raw, polished, engine, duration_ms, corrections_json],
        )?;
        Ok(())
    }

    pub fn list_history(
        &self,
        search: Option<&str>,
        limit: u32,
    ) -> anyhow::Result<Vec<HistoryItem>> {
        let conn = self.conn.lock().unwrap();
        let mut items = Vec::new();
        let mut push_row = |row: &rusqlite::Row| -> rusqlite::Result<()> {
            items.push(HistoryItem {
                id: row.get(0)?,
                ts: row.get(1)?,
                raw: row.get(2)?,
                polished: row.get(3)?,
                engine: row.get(4)?,
                duration_ms: row.get(5)?,
                corrections: row
                    .get::<_, Option<String>>(6)?
                    .and_then(|s| serde_json::from_str(&s).ok())
                    .unwrap_or_else(|| serde_json::Value::Array(Vec::new())),
            });
            Ok(())
        };
        if let Some(q) = search.filter(|q| !q.trim().is_empty()) {
            let pattern = format!("%{}%", q.trim());
            let mut stmt = conn.prepare(
                "SELECT id, ts, raw, polished, engine, duration_ms, corrections FROM history
                 WHERE polished LIKE ?1 OR raw LIKE ?1 ORDER BY ts DESC LIMIT ?2",
            )?;
            let mut rows = stmt.query(rusqlite::params![pattern, limit])?;
            while let Some(row) = rows.next()? {
                push_row(row)?;
            }
        } else {
            let mut stmt = conn.prepare(
                "SELECT id, ts, raw, polished, engine, duration_ms, corrections FROM history
                 ORDER BY ts DESC LIMIT ?1",
            )?;
            let mut rows = stmt.query(rusqlite::params![limit])?;
            while let Some(row) = rows.next()? {
                push_row(row)?;
            }
        }
        Ok(items)
    }

    pub fn delete_history(&self, id: i64) -> anyhow::Result<()> {
        self.conn
            .lock()
            .unwrap()
            .execute("DELETE FROM history WHERE id = ?1", [id])?;
        Ok(())
    }

    pub fn dict_list(&self) -> anyhow::Result<Vec<DictItem>> {
        let conn = self.conn.lock().unwrap();
        let mut stmt =
            conn.prepare("SELECT id, term, replacement FROM dictionary ORDER BY term")?;
        let mut rows = stmt.query([])?;
        let mut items = Vec::new();
        while let Some(row) = rows.next()? {
            items.push(DictItem {
                id: row.get(0)?,
                term: row.get(1)?,
                replacement: row.get(2)?,
            });
        }
        Ok(items)
    }

    pub fn dict_add(&self, term: &str, replacement: Option<&str>) -> anyhow::Result<()> {
        self.conn.lock().unwrap().execute(
            "INSERT INTO dictionary (term, replacement) VALUES (?1, ?2)
             ON CONFLICT(term) DO UPDATE SET replacement = excluded.replacement",
            rusqlite::params![term.trim(), replacement.map(str::trim)],
        )?;
        Ok(())
    }

    pub fn dict_remove(&self, id: i64) -> anyhow::Result<()> {
        self.conn
            .lock()
            .unwrap()
            .execute("DELETE FROM dictionary WHERE id = ?1", [id])?;
        Ok(())
    }

    /// Pares (término, reemplazo) para la capa de limpieza.
    pub fn dict_pairs(&self) -> Vec<(String, Option<String>)> {
        self.dict_list()
            .map(|items| {
                items
                    .into_iter()
                    .map(|d| (d.term, d.replacement))
                    .collect()
            })
            .unwrap_or_default()
    }
}
