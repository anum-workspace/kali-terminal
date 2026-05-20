import { Terminal } from "xterm";
import { FitAddon } from "xterm-addon-fit";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import "xterm/css/xterm.css";

// ── Kali‑themed terminal setup ──────────────────────────
const term = new Terminal({
  cursorBlink: true,
  cursorStyle: "block",
  fontFamily: '"Fira Code", "Hack Nerd Font", monospace',
  fontSize: 14,
  theme: {
    background: "#000000",
    foreground: "#00ff00",
    cursor: "#00ff00",
    selectionBackground: "#00ff00",
    selectionForeground: "#000000",
    black: "#000000",
    red: "#cc0000",
    green: "#4e9a06",
    yellow: "#c4a000",
    blue: "#3465a4",
    magenta: "#75507b",
    cyan: "#06989a",
    white: "#d3d7cf",
    brightBlack: "#555753",
    brightRed: "#ef2929",
    brightGreen: "#8ae234",
    brightYellow: "#fce94f",
    brightBlue: "#729fcf",
    brightMagenta: "#ad7fa8",
    brightCyan: "#34e2e2",
    brightWhite: "#eeeeec",
  },
});

const fitAddon = new FitAddon();
term.loadAddon(fitAddon);
term.open(document.getElementById("terminal"));
fitAddon.fit();
window.addEventListener("resize", () => {
  fitAddon.fit();
  invoke("pty_resize", { cols: term.cols, rows: term.rows }).catch(console.error);
});

// ── PTY communication ────────────────────────────────────
let currentLine = "";
let isCommandRunning = false;
let promptReady = false;

// Spawn the shell via Tauri command
invoke("pty_spawn", { cols: term.cols, rows: term.rows })
  .then(() => term.writeln("Shell connected."))
  .catch((err) => term.writeln(`Error: ${err}`));

// Listen to real‑time output from the shell
listen("pty-output", (event) => {
  const data = event.payload;
  // Write directly to the terminal (the shell handles its own prompt)
  term.write(data);

  // Detect the end of a command by looking for our custom prompt marker
  if (data.includes("__KALI_PROMPT__")) {
    isCommandRunning = false;
    promptReady = true;
  }
});

// Forward user keystrokes to the PTY
term.onData((data) => {
  // When a command is running, just forward everything
  if (isCommandRunning) {
    invoke("pty_write", { data }).catch(console.error);
    return;
  }

  // If we are at the prompt, handle special keys for suggestions
  if (promptReady) {
    if (data === "\r") {
      // Enter
      // Execute the command, reset the line buffer
      invoke("pty_write", { data: currentLine + "\r" }).catch(console.error);
      invoke("add_history", { command: currentLine }).catch(console.error);
      currentLine = "";
      isCommandRunning = true;
      promptReady = false;
    } else if (data === "\u007f") {
      // Backspace
      if (currentLine.length > 0) {
        currentLine = currentLine.slice(0, -1);
        invoke("pty_write", { data: "\b \b" }).catch(console.error);
      }
    } else if (data === "\t") {
      // Tab: accept inline suggestion
      // The suggestion will be fetched on each keystroke; here we accept it
      const suggestion = term.getSelection(); // dummy – we'll implement proper suggestion later
    } else {
      currentLine += data;
      invoke("pty_write", { data }).catch(console.error);
      // Fetch suggestions in real‑time
      invoke("get_suggestions", { currentLine })
        .then((suggestions) => {
          if (suggestions.length > 0) {
            // Show ghost text using xterm’s decoration (simple version: write dimmed text)
            // This is a placeholder; full implementation would use decorations API
          }
        })
        .catch(console.error);
    }
  }
});
