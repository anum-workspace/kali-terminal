use portable_pty::{native_pty_system, CommandBuilder, PtySize};
use serde::Serialize;
use std::collections::HashMap;
use std::io::{Read, Write};
use tauri::{command, Emitter, State, Window};

use crate::AppState;

pub struct PtyManager {
    sessions: HashMap<String, PtySession>,
}

struct PtySession {
    master: Box<dyn portable_pty::MasterPty + Send>,
    writer: Option<Box<dyn Write + Send>>,
    child: Box<dyn portable_pty::Child + Send>,
}

#[derive(Clone, Serialize)]
struct PtyOutput {
    #[serde(rename = "tabId")]
    tab_id: String,
    data: String,
}

#[derive(Clone, Serialize)]
struct PtyExit {
    #[serde(rename = "tabId")]
    tab_id: String,
}

impl PtyManager {
    pub fn new() -> Self {
        PtyManager {
            sessions: HashMap::new(),
        }
    }
}

#[command]
pub async fn pty_spawn(
    window: Window,
    state: State<'_, AppState>,
    tab_id: String,
    cols: u16,
    rows: u16,
) -> Result<(), String> {
    {
        let pty = state.pty.lock().map_err(|_| "Lock poisoned")?;
        if pty.sessions.contains_key(&tab_id) {
            return Ok(());
        }
    }

    let pty_system = native_pty_system();
    let pty_pair = pty_system
        .openpty(PtySize {
            rows,
            cols,
            pixel_width: 0,
            pixel_height: 0,
        })
        .map_err(|e| e.to_string())?;

    #[cfg(not(target_os = "windows"))]
    let cmd = {
        let shell = std::env::var("SHELL").unwrap_or_else(|_| "/bin/bash".to_string());
        let mut cmd = CommandBuilder::new(shell);
        cmd.env("TERM", "xterm-256color");
        cmd.env("COLORTERM", "truecolor");
        cmd
    };

    #[cfg(target_os = "windows")]
    let cmd = {
        let mut cmd = CommandBuilder::new("powershell.exe");
        cmd.arg("-NoLogo");
        cmd
    };

    let child = pty_pair.slave.spawn_command(cmd).map_err(|e| e.to_string())?;
    let master = pty_pair.master;

    // Clone a reader from the master before storing it
    let reader = master.try_clone_reader().map_err(|e| e.to_string())?;
    let writer = master.take_writer().map_err(|e| e.to_string())?;

    {
        let mut pty = state.pty.lock().map_err(|_| "Lock poisoned")?;
        pty.sessions.insert(
            tab_id.clone(),
            PtySession {
                master,
                writer: Some(writer),
                child,
            },
        );
    }

    // Spawn a thread to read raw PTY bytes. Shell prompts usually do not end
    // with a newline, so line-based reads make the terminal appear frozen.
    let window_handle = window.clone();
    let output_tab_id = tab_id.clone();
    std::thread::spawn(move || {
        let mut reader = reader;
        let mut buf = [0_u8; 8192];
        loop {
            match reader.read(&mut buf) {
                Ok(0) => break, // EOF
                Ok(n) => {
                    let data = String::from_utf8_lossy(&buf[..n]).to_string();
                    let _ = window_handle.emit(
                        "pty-output",
                        PtyOutput {
                            tab_id: output_tab_id.clone(),
                            data,
                        },
                    );
                }
                Err(e) => {
                    let _ = window_handle.emit(
                        "pty-output",
                        PtyOutput {
                            tab_id: output_tab_id.clone(),
                            data: format!("\r\nRead error: {e}\r\n"),
                        },
                    );
                    break;
                }
            }
        }
        let _ = window_handle.emit(
            "pty-exit",
            PtyExit {
                tab_id: output_tab_id,
            },
        );
    });

    Ok(())
}

#[command]
pub async fn pty_write(
    state: State<'_, AppState>,
    tab_id: String,
    data: String,
) -> Result<(), String> {
    let mut pty = state.pty.lock().map_err(|_| "Lock poisoned")?;
    let writer = pty
        .sessions
        .get_mut(&tab_id)
        .ok_or_else(|| "PTY is not running".to_string())?
        .writer
        .as_mut()
        .ok_or_else(|| "PTY is not running".to_string())?;

    writer
        .write_all(data.as_bytes())
        .map_err(|e| e.to_string())?;
    writer.flush().map_err(|e| e.to_string())?;

    Ok(())
}

#[command]
pub async fn pty_resize(
    state: State<'_, AppState>,
    tab_id: String,
    cols: u16,
    rows: u16,
) -> Result<(), String> {
    let pty = state.pty.lock().map_err(|_| "Lock poisoned")?;
    if let Some(session) = pty.sessions.get(&tab_id) {
        let master = &session.master;
        master
            .resize(PtySize {
                rows,
                cols,
                pixel_width: 0,
                pixel_height: 0,
            })
            .map_err(|e| e.to_string())?;
    }
    Ok(())
}

#[command]
pub async fn pty_close(state: State<'_, AppState>, tab_id: String) -> Result<(), String> {
    let mut pty = state.pty.lock().map_err(|_| "Lock poisoned")?;
    if let Some(mut session) = pty.sessions.remove(&tab_id) {
        let _ = session.child.kill();
    }
    Ok(())
}
