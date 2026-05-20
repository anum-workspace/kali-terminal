use rusqlite::params;
use tauri::{command, State};

use crate::AppState;

#[command]
pub fn get_suggestions(state: State<'_, AppState>, current_line: String) -> Result<Vec<String>, String> {
    if current_line.is_empty() {
        return Ok(Vec::new());
    }

    let db = state.db.lock().map_err(|_| "Lock poisoned")?;
    let mut stmt = db
        .conn
        .prepare(
            "SELECT command FROM suggestions
             WHERE prefix = ?1
             ORDER BY frequency DESC
             LIMIT 5",
        )
        .map_err(|e: rusqlite::Error| e.to_string())?;

    let suggestions = stmt
        .query_map(params![current_line], |row: &rusqlite::Row| row.get(0))
        .map_err(|e: rusqlite::Error| e.to_string())?
        .filter_map(|r: Result<String, rusqlite::Error>| r.ok())
        .collect();

    Ok(suggestions)
}