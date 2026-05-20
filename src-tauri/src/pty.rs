use portable_pty::{CommandBuilder, PtySize, native_pty_system};
use std::io::{BufRead, BufReader, Read};
use std::sync::Mutex;
use tauri::{command, Emitter, Window, State};

use crate::AppState;

pub struct PtyManager {
    master: Option<Box<dyn portable_pty::MasterPty + Send>>,
    _child: Option<Box<dyn portable_pty::Child + Send>>,
}

impl PtyManager {
    pub fn new() -> Self {
        PtyManager {
            master: None,
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

    // Custom prompt to detect command boundaries
    let mut cmd = CommandBuilder::new("bash");
    cmd.args(&["-c", "export PS1='\\[\\e]0;__KALI_PROMPT__\\a\\]\\u@\\h:\\w\\$ '; exec bash"]);

    #[cfg(target_os = "windows")]
    let mut cmd = CommandBuilder::new("cmd.exe");

    let child = pty_pair.slave.spawn_command(cmd).map_err(|e| e.to_string())?;
    let master = pty_pair.master;

    // Clone a reader from the master before storing it
    let reader = master.try_clone_reader().map_err(|e| e.to_string())?;

    let mut pty = state.pty.lock().map_err(|_| "Lock poisoned")?;
    pty.master = Some(master);
    pty._child = Some(child);

    // Spawn a thread to read the PTY output and emit events
    let window_handle = window.clone();
    std::thread::spawn(move || {
        let mut reader = BufReader::new(reader);
        let mut buf = String::new();
        loop {
            match reader.read_line(&mut buf) {
                Ok(0) => break, // EOF
                Ok(_) => {
                    let _ = window_handle.emit("pty-output", buf.clone());
                    buf.clear();
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
    let pty = state.pty.lock().map_err(|_| "Lock poisoned")?;
    if let Some(ref master) = pty.master {
        let mut writer = master.take_writer().map_err(|e| e.to_string())?;
        std::io::Write::write_all(&mut writer, data.as_bytes()).map_err(|e| e.to_string())?;
    }
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