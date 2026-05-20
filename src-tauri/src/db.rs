use rusqlite::{Connection, params};
use std::path::PathBuf;
use tauri::{command, State};

use crate::AppState;

pub struct Database {
    pub(crate) conn: Connection,
}

impl Database {
    pub fn new(db_path: PathBuf) -> Result<Self, Box<dyn std::error::Error>> {
        let conn = Connection::open(db_path)?;

        conn.execute_batch(
            "CREATE TABLE IF NOT EXISTS history (
                id INTEGER PRIMARY KEY,
                command TEXT NOT NULL,
                cwd TEXT NOT NULL,
                exit_code INTEGER,
                timestamp DATETIME DEFAULT CURRENT_TIMESTAMP
            );
            CREATE TABLE IF NOT EXISTS suggestions (
                id INTEGER PRIMARY KEY,
                prefix TEXT NOT NULL,
                command TEXT NOT NULL,
                frequency INTEGER DEFAULT 1,
                UNIQUE(prefix, command)
            );
            DELETE FROM suggestions
            WHERE id NOT IN (
                SELECT MIN(id)
                FROM suggestions
                GROUP BY prefix, command
            );
            CREATE UNIQUE INDEX IF NOT EXISTS idx_suggestions_prefix_command
            ON suggestions(prefix, command);"
        )?;

        Ok(Database { conn })
    }
}

#[command]
pub fn add_history(state: State<'_, AppState>, command: String) -> Result<(), String> {
    let command = command.trim();
    if command.is_empty() {
        return Ok(());
    }

    let db = state.db.lock().map_err(|_| "Lock poisoned")?;
    db.conn
        .execute(
            "INSERT INTO history (command, cwd) VALUES (?1, '')",
            params![command],
        )
        .map_err(|e| e.to_string())?;

    // Update suggestion frequencies
    for (i, _) in command.char_indices() {
        let prefix = &command[..i + 1];
        db.conn
            .execute(
                "INSERT INTO suggestions (prefix, command) VALUES (?1, ?2)
                 ON CONFLICT(prefix, command) DO UPDATE SET frequency = frequency + 1",
                params![prefix, command],
            )
            .map_err(|e| e.to_string())?;
    }

    Ok(())
}

#[command]
pub fn get_history(state: State<'_, AppState>, limit: i64) -> Result<Vec<String>, String> {
    let db = state.db.lock().map_err(|_| "Lock poisoned")?;
    let mut stmt = db
        .conn
        .prepare(
            "SELECT command FROM history
             ORDER BY id DESC
             LIMIT ?1",
        )
        .map_err(|e| e.to_string())?;

    let mut commands = stmt
        .query_map(params![limit.max(1)], |row| row.get(0))
        .map_err(|e| e.to_string())?
        .filter_map(|result: Result<String, rusqlite::Error>| result.ok())
        .collect::<Vec<_>>();

    commands.reverse();
    Ok(commands)
}
