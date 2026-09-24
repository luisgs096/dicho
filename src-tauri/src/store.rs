use rusqlite::{Connection, OptionalExtension};
use serde::{Deserialize, Serialize};
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

/// Una fila de historial que llega de otro equipo por la sincronización.
///
/// Es casi `NuevoDictado`, pero con dos diferencias que obligan a que sea su
/// propia struct: trae **su** marca de tiempo —la del equipo donde se dictó, no
/// la de ahora— y lo trae todo en propiedad, porque sale de deserializar un
/// JSON y no de préstamos vivos.
///
/// Los tres últimos son `Option` a propósito: un respaldo hecho con una versión
/// anterior a la 0.11 no los lleva, y esa fila entra igual con ellos vacíos.
/// Inventarles un valor sería peor que no tenerlos — la interfaz ya sabe
/// enseñar un guion donde no hay dato.
pub struct DictadoRemoto {
    pub ts: i64,
    pub raw: String,
    pub polished: String,
    pub engine: String,
    pub duration_ms: i64,
    pub corrections_json: Option<String>,
    pub polish_mode: Option<String>,
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

/// Un término tal como viaja en la sincronización: con la hora de su último
/// cambio, que es lo que decide quién gana cuando los dos equipos lo tocaron.
/// `updated_ms` es 0 en lo que viene de un respaldo anterior a esto — y con 0
/// gana el local, que es lo que pasaba siempre.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct TerminoRemoto {
    pub term: String,
    pub replacement: Option<String>,
    #[serde(default)]
    pub updated_ms: i64,
}

/// Una lápida: algo que el usuario borró, y cuándo.
///
/// Sin ellas, borrar no servía de nada en cuanto hubiera sincronización: el
/// archivo remoto todavía lo tenía, la fusión lo veía «nuevo» y lo volvía a
/// meter — y en la subida siguiente quedaba otra vez en todos los equipos.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Borrado {
    /// "dict" o "hist".
    pub tipo: String,
    /// Término en minúsculas, o `ts:sha256(crudo)` para un dictado.
    pub clave: String,
    pub ts: i64,
}

fn ahora_ms() -> i64 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_millis() as i64)
        .unwrap_or(0)
}

/// Espacios de dentro colapsados y sin los de los bordes: «cloud  code» con
/// dos espacios tecleados es el mismo término que «cloud code».
fn normaliza(s: &str) -> String {
    s.split_whitespace().collect::<Vec<_>>().join(" ")
}

/// Cómo se reconoce un término en la tabla. El diccionario casa **sin
/// distinguir mayúsculas**, así que «Cloud» y «cloud» son el mismo término y
/// no pueden ser dos filas: la segunda nunca ganaría.
fn clave_termino(t: &str) -> String {
    normaliza(t).to_lowercase()
}

/// La lápida de un dictado lleva la **huella** del crudo, no el crudo: se
/// sube a Drive, y guardar ahí el texto de lo que el usuario borró —quizá
/// justo porque dictó algo que no debía— sería lo contrario de borrarlo.
fn clave_dictado(ts: i64, raw: &str) -> String {
    use sha2::{Digest, Sha256};
    let huella: String = Sha256::digest(raw.as_bytes())
        .iter()
        .map(|b| format!("{b:02x}"))
        .collect();
    format!("{ts}:{huella}")
}

/// Alta o edición de un término, dentro de una transacción ya abierta.
fn guardar_termino(
    tx: &rusqlite::Transaction,
    term: &str,
    replacement: Option<&str>,
    ts: i64,
) -> rusqlite::Result<()> {
    let term = normaliza(term);
    let replacement = replacement.map(str::trim).filter(|r| !r.is_empty());
    let clave = term.to_lowercase();
    let viejos: Vec<i64> = {
        let mut st = tx.prepare("SELECT id, term FROM dictionary")?;
        let filas = st.query_map([], |r| Ok((r.get::<_, i64>(0)?, r.get::<_, String>(1)?)))?;
        filas
            .filter_map(Result::ok)
            .filter(|(_, t)| clave_termino(t) == clave)
            .map(|(id, _)| id)
            .collect()
    };
    for id in viejos {
        tx.execute("DELETE FROM dictionary WHERE id = ?1", [id])?;
    }
    tx.execute(
        "INSERT INTO dictionary (term, replacement, updated_ms) VALUES (?1, ?2, ?3)",
        rusqlite::params![term, replacement, ts],
    )?;
    tx.execute("DELETE FROM borrados WHERE tipo = 'dict' AND clave = ?1", [&clave])?;
    Ok(())
}

/// Apunta una lápida, quedándose con la hora más reciente si ya había una.
fn apuntar_lapida(
    tx: &rusqlite::Transaction,
    tipo: &str,
    clave: &str,
    ts: i64,
) -> rusqlite::Result<()> {
    tx.execute(
        "INSERT INTO borrados (tipo, clave, ts) VALUES (?1, ?2, ?3)
         ON CONFLICT(tipo, clave) DO UPDATE SET ts = MAX(ts, excluded.ts)",
        rusqlite::params![tipo, clave, ts],
    )?;
    Ok(())
}

fn lapida(tx: &rusqlite::Transaction, tipo: &str, clave: &str) -> rusqlite::Result<Option<i64>> {
    tx.query_row(
        "SELECT ts FROM borrados WHERE tipo = ?1 AND clave = ?2",
        [tipo, clave],
        |r| r.get(0),
    )
    .optional()
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
            );
            CREATE TABLE IF NOT EXISTS borrados (
                tipo TEXT NOT NULL,
                clave TEXT NOT NULL,
                ts INTEGER NOT NULL,
                PRIMARY KEY (tipo, clave)
            );",
        )?;
        // Migraciones: la columna no existía en su día; si ya está, el ALTER
        // falla y se ignora. No hay sistema de versiones de esquema y para tres
        // columnas no hace falta inventarlo.
        let _ = conn.execute("ALTER TABLE history ADD COLUMN corrections TEXT", []);
        let _ = conn.execute("ALTER TABLE history ADD COLUMN polish_mode TEXT", []);
        let _ = conn.execute("ALTER TABLE history ADD COLUMN stt_ms INTEGER", []);
        let _ = conn.execute("ALTER TABLE history ADD COLUMN polish_ms INTEGER", []);
        let _ = conn.execute(
            "ALTER TABLE dictionary ADD COLUMN updated_ms INTEGER NOT NULL DEFAULT 0",
            [],
        );
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
        let mut conn = self.conn.lock().unwrap();
        let tx = conn.transaction()?;
        let fila: Option<(i64, String)> = tx
            .query_row("SELECT ts, raw FROM history WHERE id = ?1", [id], |r| {
                Ok((r.get(0)?, r.get(1)?))
            })
            .optional()?;
        tx.execute("DELETE FROM history WHERE id = ?1", [id])?;
        if let Some((ts, raw)) = fila {
            apuntar_lapida(&tx, "hist", &clave_dictado(ts, &raw), ahora_ms())?;
        }
        tx.commit()?;
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
        let mut conn = self.conn.lock().unwrap();
        let tx = conn.transaction()?;
        guardar_termino(&tx, term, replacement, ahora_ms())?;
        tx.commit()?;
        Ok(())
    }

    pub fn dict_remove(&self, id: i64) -> anyhow::Result<()> {
        let mut conn = self.conn.lock().unwrap();
        let tx = conn.transaction()?;
        let term: Option<String> = tx
            .query_row("SELECT term FROM dictionary WHERE id = ?1", [id], |r| r.get(0))
            .optional()?;
        tx.execute("DELETE FROM dictionary WHERE id = ?1", [id])?;
        if let Some(t) = term {
            apuntar_lapida(&tx, "dict", &clave_termino(&t), ahora_ms())?;
        }
        tx.commit()?;
        Ok(())
    }

    /// El diccionario con la hora de cada término, para subirlo.
    pub fn dict_export(&self) -> anyhow::Result<Vec<TerminoRemoto>> {
        let conn = self.conn.lock().unwrap();
        let mut st =
            conn.prepare("SELECT term, replacement, updated_ms FROM dictionary ORDER BY term")?;
        let filas = st.query_map([], |r| {
            Ok(TerminoRemoto {
                term: r.get(0)?,
                replacement: r.get(1)?,
                updated_ms: r.get(2)?,
            })
        })?;
        Ok(filas.collect::<Result<_, _>>()?)
    }

    /// Las lápidas, para subirlas junto con lo demás.
    pub fn borrados(&self) -> anyhow::Result<Vec<Borrado>> {
        let conn = self.conn.lock().unwrap();
        let mut st = conn.prepare("SELECT tipo, clave, ts FROM borrados")?;
        let filas = st.query_map([], |r| {
            Ok(Borrado {
                tipo: r.get(0)?,
                clave: r.get(1)?,
                ts: r.get(2)?,
            })
        })?;
        Ok(filas.collect::<Result<_, _>>()?)
    }

    /// Lo que se borró en otro equipo se borra aquí, salvo que aquí se haya
    /// vuelto a tocar después. Va **antes** de fusionar lo que baja.
    pub fn aplicar_borrados(&self, borrados: &[Borrado]) -> anyhow::Result<usize> {
        let mut conn = self.conn.lock().unwrap();
        let tx = conn.transaction()?;
        let mut quitados = 0;
        for b in borrados {
            apuntar_lapida(&tx, &b.tipo, &b.clave, b.ts)?;
            match b.tipo.as_str() {
                "dict" => {
                    let ids: Vec<i64> = {
                        let mut st = tx.prepare("SELECT id, term, updated_ms FROM dictionary")?;
                        let filas = st.query_map([], |r| {
                            Ok((
                                r.get::<_, i64>(0)?,
                                r.get::<_, String>(1)?,
                                r.get::<_, i64>(2)?,
                            ))
                        })?;
                        filas
                            .filter_map(Result::ok)
                            .filter(|(_, t, upd)| clave_termino(t) == b.clave && *upd <= b.ts)
                            .map(|(id, _, _)| id)
                            .collect()
                    };
                    for id in ids {
                        quitados += tx.execute("DELETE FROM dictionary WHERE id = ?1", [id])?;
                    }
                }
                "hist" => {
                    let Some(ts) = b.clave.split_once(':').and_then(|(ts, _)| ts.parse::<i64>().ok())
                    else {
                        continue;
                    };
                    // La marca de tiempo acota a una fila o dos; la huella
                    // decide cuál.
                    // El `let` de dentro no sobra: `filas` toma prestado `st`, y
                    // devolverlo como cola del bloque no compila en la edición
                    // 2021 (el temporal vive más que `st`).
                    #[allow(clippy::let_and_return)]
                    let ids: Vec<i64> = {
                        let mut st = tx.prepare("SELECT id, raw FROM history WHERE ts = ?1")?;
                        let filas = st.query_map([ts], |r| {
                            Ok((r.get::<_, i64>(0)?, r.get::<_, String>(1)?))
                        })?;
                        let ids = filas
                            .filter_map(Result::ok)
                            .filter(|(_, raw)| clave_dictado(ts, raw) == b.clave)
                            .map(|(id, _)| id)
                            .collect();
                        ids
                    };
                    for id in ids {
                        quitados += tx.execute("DELETE FROM history WHERE id = ?1", [id])?;
                    }
                }
                _ => {}
            }
        }
        tx.commit()?;
        Ok(quitados)
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

    /// Fusión de sincronización del diccionario: **gana el cambio más
    /// reciente**, venga de donde venga.
    ///
    /// Antes ganaba siempre el local, y eso tenía dos caras: una edición hecha
    /// en otro equipo no llegaba nunca (y la subida siguiente la pisaba en el
    /// archivo remoto), y un término borrado aquí volvía en la siguiente
    /// sincronización porque el archivo remoto aún lo tenía. Lo segundo lo
    /// frenan las lápidas: lo que se borró después de su último cambio no entra.
    ///
    /// Los términos se comparan sin distinguir mayúsculas, como se aplican:
    /// «Cloud» de un equipo y «cloud» del otro son uno solo.
    pub fn merge_dict(&self, remote: &[TerminoRemoto]) -> anyhow::Result<usize> {
        let mut conn = self.conn.lock().unwrap();
        let tx = conn.transaction()?;
        let mut added = 0;
        for r in remote {
            let clave = clave_termino(&r.term);
            if clave.is_empty() {
                continue;
            }
            if lapida(&tx, "dict", &clave)?.is_some_and(|ts| ts >= r.updated_ms) {
                continue;
            }
            // Mismo `let` necesario que en aplicar_borrados: el préstamo de `st`.
            #[allow(clippy::let_and_return)]
            let local: Option<i64> = {
                let mut st = tx.prepare("SELECT term, updated_ms FROM dictionary")?;
                let filas =
                    st.query_map([], |f| Ok((f.get::<_, String>(0)?, f.get::<_, i64>(1)?)))?;
                let upd = filas
                    .filter_map(Result::ok)
                    .find(|(t, _)| clave_termino(t) == clave)
                    .map(|(_, upd)| upd);
                upd
            };
            // Con la misma hora gana el local: es lo que pasa con todo lo que
            // viene de un respaldo sin horas (0 contra 0).
            if local.is_some_and(|upd| upd >= r.updated_ms) {
                continue;
            }
            guardar_termino(&tx, &r.term, r.replacement.as_deref(), r.updated_ms)?;
            added += 1;
        }
        tx.commit()?;
        Ok(added)
    }

    /// Fusión de sincronización: inserta dictados remotos que no existen
    /// localmente, identificados por (ts, raw).
    /// Mete las filas que falten, sin duplicar.
    ///
    /// Recibe structs y no tuplas por lo mismo que `add_history`: con nueve
    /// campos, cuatro de ellos enteros, una tupla posicional es una trampa que
    /// el compilador no ve.
    pub fn merge_history(&self, remote: &[DictadoRemoto]) -> anyhow::Result<usize> {
        let mut conn = self.conn.lock().unwrap();
        // Todo en una transacción: sin ella cada fila es un commit propio, o sea
        // un fsync al disco por dictado. Con un respaldo de varios cientos eso
        // son varios cientos de escrituras sincronizadas, y además una fusión a
        // medias podía dejar la mitad de las filas dentro.
        let tx = conn.transaction()?;
        let mut added = 0;
        for d in remote {
            added += tx.execute(
                "INSERT INTO history
                   (ts, raw, polished, engine, duration_ms, corrections,
                    polish_mode, stt_ms, polish_ms)
                 SELECT ?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9
                 WHERE NOT EXISTS (SELECT 1 FROM history WHERE ts = ?1 AND raw = ?2)
                   AND NOT EXISTS (SELECT 1 FROM borrados
                                   WHERE tipo = 'hist' AND clave = ?10)",
                rusqlite::params![
                    d.ts,
                    d.raw,
                    d.polished,
                    d.engine,
                    d.duration_ms,
                    d.corrections_json,
                    d.polish_mode,
                    d.stt_ms,
                    d.polish_ms,
                    clave_dictado(d.ts, &d.raw),
                ],
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

#[cfg(test)]
mod tests {
    use super::*;

    /// Una base de usar y tirar, en una carpeta temporal propia.
    fn base(nombre: &str) -> Store {
        let carpeta = std::env::temp_dir().join(format!("mike-test-{nombre}"));
        let _ = std::fs::remove_dir_all(&carpeta);
        Store::init_en(&carpeta).unwrap()
    }

    /// El sync viajaba con seis campos cuando la tabla ya tenía nueve: el modo
    /// de redacción y los dos tiempos se perdían en silencio al fusionar un
    /// respaldo. Silencio es la palabra — no fallaba nada, sólo llegaban filas
    /// a las que les faltaba la mitad de lo que cuenta la tarjeta del historial.
    #[test]
    fn fusionar_conserva_el_modo_y_los_tiempos() {
        let store = base("merge-campos");
        store
            .merge_history(&[DictadoRemoto {
                ts: 1_700_000_000,
                raw: "a ver, o sea, esto".into(),
                polished: "Esto.".into(),
                engine: "groq".into(),
                duration_ms: 4200,
                corrections_json: None,
                polish_mode: Some("editor".into()),
                stt_ms: Some(910),
                polish_ms: Some(2400),
            }])
            .unwrap();

        let filas = store.list_history(None, 10).unwrap();
        assert_eq!(filas.len(), 1);
        assert_eq!(filas[0].polish_mode.as_deref(), Some("editor"));
        assert_eq!(filas[0].stt_ms, Some(910));
        assert_eq!(filas[0].polish_ms, Some(2400));
    }

    /// Un respaldo subido por una versión anterior a la 0.11 no trae esos tres
    /// campos. Tiene que entrar igual, con ellos vacíos: perder el respaldo
    /// entero por tres columnas que faltan sería mucho peor que no tenerlas.
    #[test]
    fn un_respaldo_viejo_entra_con_los_campos_nuevos_vacios() {
        let store = base("merge-viejo");
        store
            .merge_history(&[DictadoRemoto {
                ts: 1_600_000_000,
                raw: "dictado de antes".into(),
                polished: "Dictado de antes.".into(),
                engine: "local".into(),
                duration_ms: 3000,
                corrections_json: None,
                polish_mode: None,
                stt_ms: None,
                polish_ms: None,
            }])
            .unwrap();

        let filas = store.list_history(None, 10).unwrap();
        assert_eq!(filas.len(), 1);
        assert!(filas[0].polish_mode.is_none());
        assert!(filas[0].stt_ms.is_none());
    }

    /// Fusionar dos veces el mismo respaldo no puede duplicar nada: la clave de
    /// hecho es (ts, raw), porque los ids son de cada equipo.
    #[test]
    fn fusionar_dos_veces_no_duplica() {
        let store = base("merge-idempotente");
        let fila = || DictadoRemoto {
            ts: 1_700_000_001,
            raw: "lo mismo".into(),
            polished: "Lo mismo.".into(),
            engine: "groq".into(),
            duration_ms: 1000,
            corrections_json: None,
            polish_mode: Some("estandar".into()),
            stt_ms: Some(300),
            polish_ms: Some(700),
        };
        assert_eq!(store.merge_history(&[fila()]).unwrap(), 1);
        assert_eq!(store.merge_history(&[fila()]).unwrap(), 0);
        assert_eq!(store.list_history(None, 10).unwrap().len(), 1);
    }
}
