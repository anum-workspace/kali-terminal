use portable_pty::{native_pty_system, CommandBuilder, PtySize};
use std::io::{Read, Write};
use tauri::{command, Emitter, State, Window};

use crate::AppState;

pub struct PtyManager {
    master: Option<Box<dyn portable_pty::MasterPty + Send>>,
    writer: Option<Box<dyn Write + Send>>,
    _child: Option<Box<dyn portable_pty::Child + Send>>,
}

impl PtyManager {
    pub fn new() -> Self {
        PtyManager {
            master: None,
            writer: None,
            _child: None,
        }
    }
}

#[command]
pub async fn pty_spawn(
    window: Window,
    state: State<'_, AppState>,
    cols: u16,
    rows: u16,
) -> Result<(), String> {
    let pty_system = native_pty_system();
    let pty_pair = pty_system
        .openpty(PtySize {
            rows,
            cols,
            pixel_width: 0,
            pixel_height: 0,
        })
        .map_err(|e| e.to_string())?;

    let shell = std::env::var("SHELL").unwrap_or_else(|_| "/bin/bash".to_string());
    let mut cmd = CommandBuilder::new(shell);
    cmd.env("TERM", "xterm-256color");
    cmd.env("COLORTERM", "truecolor");

    #[cfg(target_os = "windows")]
    let mut cmd = CommandBuilder::new("cmd.exe");

    let child = pty_pair.slave.spawn_command(cmd).map_err(|e| e.to_string())?;
    let master = pty_pair.master;

    // Clone a reader from the master before storing it
    let reader = master.try_clone_reader().map_err(|e| e.to_string())?;
    let writer = master.take_writer().map_err(|e| e.to_string())?;

    let mut pty = state.pty.lock().map_err(|_| "Lock poisoned")?;
    pty.master = Some(master);
    pty.writer = Some(writer);
    pty._child = Some(child);

    // Spawn a thread to read raw PTY bytes. Shell prompts usually do not end
    // with a newline, so line-based reads make the terminal appear frozen.
    let window_handle = window.clone();
    std::thread::spawn(move || {
        let mut reader = reader;
        let mut buf = [0_u8; 8192];
        loop {
            match reader.read(&mut buf) {
                Ok(0) => break, // EOF
                Ok(n) => {
                    let data = String::from_utf8_lossy(&buf[..n]).to_string();
                    let _ = window_handle.emit("pty-output", data);
                }
                Err(e) => {
                    let _ = window_handle.emit("pty-output", format!("\r\nRead error: {e}\r\n"));
                    break;
                }
            }
        }
    });

    Ok(())
}

#[command]
pub async fn pty_write(state: State<'_, AppState>, data: String) -> Result<(), String> {
    let mut pty = state.pty.lock().map_err(|_| "Lock poisoned")?;
    let writer = pty
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
    cols: u16,
    rows: u16,
) -> Result<(), String> {
    let pty = state.pty.lock().map_err(|_| "Lock poisoned")?;
    if let Some(ref master) = pty.master {
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
