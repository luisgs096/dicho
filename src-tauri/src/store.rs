use rusqlite::Connection;
use serde::Serialize;
use std::sync::Mutex;

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
    /// Cuánto tuviste la tecla apretada, o sea cuánto hablaste. **No** es lo
    /// que tardó en procesarse: eso son `stt_ms` y `polish_ms`.
    pub duration_ms: i64,
    /// Correcciones del diccionario: [{term, replacement, count, aplicadas}].
    pub corrections: serde_json::Value,
    /// Qué modo redactó de verdad este dictado ("reglas" | "estandar" |
    /// "editor"). `None` en los dictados anteriores a la 0.11: no se guardaba,
    /// y no hay de dónde deducirlo. La interfaz tiene que enseñar un guion, no
    /// inventarse uno.
    pub polish_mode: Option<String>,
    /// Milisegundos de transcripción y de redacción. `None` por lo mismo.
    pub stt_ms: Option<i64>,
    pub polish_ms: Option<i64>,
}

/// Lo que hace falta para guardar un dictado.
///
/// Era una lista de cinco parámetros posicionales y con los tres campos nuevos
/// se iba a ocho: a esa altura nadie acierta el orden a la primera y el
/// compilador no avisa, porque tres de ellos son enteros.
pub struct NuevoDictado<'a> {
    pub raw: &'a str,
    pub polished: &'a str,
    pub engine: &'a str,
    pub duration_ms: i64,
    pub corrections_json: Option<&'a str>,
    pub polish_mode: &'a str,
    pub stt_ms: i64,
    pub polish_ms: i64,
}

#[derive(Debug, Serialize)]
pub struct DictItem {
    pub id: i64,
    pub term: String,
    pub replacement: Option<String>,
}


impl Store {
    /// Abre (o crea) la base en una ruta concreta.
    ///
    /// Recibe la ruta y no el `AppHandle` a propósito: esto tiene que poder
    /// correr **antes** de que Tauri construya la aplicación. Ver el comentario
    /// largo en `run()` — si el Store se registra dentro del `setup`, la ventana
    /// puede pedirlo antes y el proceso aborta.
    pub fn init_en(carpeta: &std::path::Path) -> anyhow::Result<Self> {
        std::fs::create_dir_all(carpeta)?;
        let conn = Connection::open(carpeta.join("mike.db"))?;
        conn.execute_batch(
            "CREATE TABLE IF NOT EXISTS history (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                ts INTEGER NOT NULL,
                raw TEXT NOT NULL,
                polished TEXT NOT NULL,
                engine TEXT NOT NULL,
                duration_ms INTEGER NOT NULL,
                corrections TEXT,
                polish_mode TEXT,
                stt_ms INTEGER,
                polish_ms INTEGER
            );
            CREATE TABLE IF NOT EXISTS dictionary (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                term TEXT NOT NULL UNIQUE,
                replacement TEXT
            );
            CREATE TABLE IF NOT EXISTS meta (
                key TEXT PRIMARY KEY,
                value TEXT NOT NULL
            );",
        )?;
        // Migraciones: la columna no existía en su día; si ya está, el ALTER
        // falla y se ignora. No hay sistema de versiones de esquema y para tres
        // columnas no hace falta inventarlo.
        let _ = conn.execute("ALTER TABLE history ADD COLUMN corrections TEXT", []);
        let _ = conn.execute("ALTER TABLE history ADD COLUMN polish_mode TEXT", []);
        let _ = conn.execute("ALTER TABLE history ADD COLUMN stt_ms INTEGER", []);
        let _ = conn.execute("ALTER TABLE history ADD COLUMN polish_ms INTEGER", []);
        Ok(Self {
            conn: Mutex::new(conn),
        })
    }

    pub fn add_history(&self, d: NuevoDictado<'_>) -> anyhow::Result<()> {
        let ts = std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)?
            .as_millis() as i64;
        self.conn.lock().unwrap().execute(
            "INSERT INTO history
               (ts, raw, polished, engine, duration_ms, corrections, polish_mode, stt_ms, polish_ms)
             VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9)",
            rusqlite::params![
                ts,
                d.raw,
                d.polished,
                d.engine,
                d.duration_ms,
                d.corrections_json,
                d.polish_mode,
                d.stt_ms,
                d.polish_ms
            ],
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
                polish_mode: row.get(7)?,
                stt_ms: row.get(8)?,
                polish_ms: row.get(9)?,
            });
            Ok(())
        };
        if let Some(q) = search.filter(|q| !q.trim().is_empty()) {
            let pattern = format!("%{}%", q.trim());
            let mut stmt = conn.prepare(
                "SELECT id, ts, raw, polished, engine, duration_ms, corrections,
                        polish_mode, stt_ms, polish_ms FROM history
                 WHERE polished LIKE ?1 OR raw LIKE ?1 ORDER BY ts DESC LIMIT ?2",
            )?;
            let mut rows = stmt.query(rusqlite::params![pattern, limit])?;
            while let Some(row) = rows.next()? {
                push_row(row)?;
            }
        } else {
            let mut stmt = conn.prepare(
                "SELECT id, ts, raw, polished, engine, duration_ms, corrections,
                        polish_mode, stt_ms, polish_ms FROM history
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

    pub fn meta_get(&self, key: &str) -> Option<String> {
        self.conn
            .lock()
            .unwrap()
            .query_row("SELECT value FROM meta WHERE key = ?1", [key], |r| r.get(0))
            .ok()
    }

    pub fn meta_set(&self, key: &str, value: &str) -> anyhow::Result<()> {
        self.conn.lock().unwrap().execute(
            "INSERT INTO meta (key, value) VALUES (?1, ?2)
             ON CONFLICT(key) DO UPDATE SET value = excluded.value",
            [key, value],
        )?;
        Ok(())
    }

    pub fn meta_del(&self, key: &str) -> anyhow::Result<()> {
        self.conn
            .lock()
            .unwrap()
            .execute("DELETE FROM meta WHERE key = ?1", [key])?;
        Ok(())
    }

    /// Fusión de sincronización: agrega términos remotos que no existen.
    /// En conflicto de término gana el local (el dispositivo en uso es el más fresco).
    pub fn merge_dict(&self, remote: &[(String, Option<String>)]) -> anyhow::Result<usize> {
        let conn = self.conn.lock().unwrap();
        let mut added = 0;
        for (term, replacement) in remote {
            added += conn.execute(
                "INSERT INTO dictionary (term, replacement) VALUES (?1, ?2)
                 ON CONFLICT(term) DO NOTHING",
                rusqlite::params![term, replacement],
            )?;
        }
        Ok(added)
    }

    /// Fusión de sincronización: inserta dictados remotos que no existen
    /// localmente, identificados por (ts, raw).
    pub fn merge_history(
        &self,
        remote: &[(i64, String, String, String, i64, Option<String>)],
    ) -> anyhow::Result<usize> {
        let mut conn = self.conn.lock().unwrap();
        // Todo en una transacción: sin ella cada fila es un commit propio, o sea
        // un fsync al disco por dictado. Con un respaldo de varios cientos eso
        // son varios cientos de escrituras sincronizadas, y además una fusión a
        // medias podía dejar la mitad de las filas dentro.
        let tx = conn.transaction()?;
        let mut added = 0;
        for (ts, raw, polished, engine, duration_ms, corrections) in remote {
            added += tx.execute(
                "INSERT INTO history (ts, raw, polished, engine, duration_ms, corrections)
                 SELECT ?1, ?2, ?3, ?4, ?5, ?6
                 WHERE NOT EXISTS (SELECT 1 FROM history WHERE ts = ?1 AND raw = ?2)",
                rusqlite::params![ts, raw, polished, engine, duration_ms, corrections],
            )?;
        }
        tx.commit()?;
        Ok(added)
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
