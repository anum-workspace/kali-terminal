#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

mod db;
mod pty;
mod suggestions;

use db::Database;
use pty::PtyManager;
use std::sync::Mutex;
use tauri::Manager;

struct AppState {
    pty: Mutex<PtyManager>,
    db: Mutex<Database>,
}

fn main() {
    env_logger::init();

    tauri::Builder::default()
        .setup(|app| {
            // Get app data directory for SQLite database
            let db_path = app
                .path()
                .app_data_dir()
                .expect("failed to get app data dir");
            std::fs::create_dir_all(&db_path).ok();
            let db = Database::new(db_path.join("kali-terminal.db"))
                .expect("Failed to open database");
            let pty = PtyManager::new();

            app.manage(AppState {
                pty: Mutex::new(pty),
                db: Mutex::new(db),
            });

            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            pty::pty_spawn,
            pty::pty_write,
            pty::pty_resize,
            db::add_history,
            db::get_history,
            suggestions::get_suggestions,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
