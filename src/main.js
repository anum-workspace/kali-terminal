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

const resizePty = () => {
  fitAddon.fit();
  invoke("pty_resize", { cols: term.cols, rows: term.rows }).catch(console.error);
};

window.addEventListener("resize", resizePty);

// ── PTY communication ────────────────────────────────────
let currentLine = "";

// Spawn the shell via Tauri command
invoke("pty_spawn", { cols: term.cols, rows: term.rows })
  .then(resizePty)
  .catch((err) => term.writeln(`Error: ${err}`));

// Listen to real‑time output from the shell
listen("pty-output", (event) => {
  term.write(event.payload);
});

// Forward user keystrokes to the PTY
term.onData((data) => {
  invoke("pty_write", { data }).catch(console.error);

  if (data === "\r") {
    invoke("add_history", { command: currentLine }).catch(console.error);
    currentLine = "";
  } else if (data === "\u007f") {
    currentLine = currentLine.slice(0, -1);
  } else if (data === "\u0003" || data === "\u0004") {
    currentLine = "";
  } else if (data >= " " && data !== "\u007f") {
    currentLine += data;
  }
});
