import { Terminal } from "xterm";
import { FitAddon } from "xterm-addon-fit";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { getCurrentWindow } from "@tauri-apps/api/window";
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
term.focus();

const resizePty = () => {
  fitAddon.fit();
  invoke("pty_resize", { cols: term.cols, rows: term.rows }).catch(console.error);
};

window.addEventListener("resize", resizePty);

// ── PTY communication ────────────────────────────────────
let currentLine = "";
let history = [];
let historyIndex = 0;
let currentSuggestion = "";
let terminalRunning = false;

const appWindow = getCurrentWindow();

const writePty = (data) => {
  if (!terminalRunning) {
    return Promise.resolve();
  }

  return invoke("pty_write", { data }).catch((err) => {
    console.error(err);
  });
};

const loadHistory = async () => {
  history = await invoke("get_history", { limit: 100 }).catch((err) => {
    console.error(err);
    return [];
  });
  historyIndex = history.length;
};

const updateSuggestion = async () => {
  if (!currentLine.trim()) {
    currentSuggestion = "";
    return;
  }

  const suggestions = await invoke("get_suggestions", { currentLine }).catch((err) => {
    console.error(err);
    return [];
  });
  currentSuggestion = suggestions.find((item) => item !== currentLine) ?? "";
};

const replaceCurrentLine = async (nextLine) => {
  const eraseCurrentLine = "\u007f".repeat(currentLine.length);
  currentLine = nextLine;
  currentSuggestion = "";
  await writePty(`${eraseCurrentLine}${nextLine}`);
  await updateSuggestion();
};

const closeAfterShellExitCommand = () => {
  terminalRunning = false;
  window.setTimeout(() => {
    appWindow.close().catch(console.error);
  }, 100);
};

// Forward user keystrokes to the PTY
term.onData((data) => {
  if (!terminalRunning) {
    return;
  }

  if (data === "\u001b[A") {
    if (history.length > 0 && historyIndex > 0) {
      historyIndex -= 1;
      replaceCurrentLine(history[historyIndex]);
    }
    return;
  }

  if (data === "\u001b[B") {
    if (historyIndex < history.length - 1) {
      historyIndex += 1;
      replaceCurrentLine(history[historyIndex]);
    } else if (historyIndex < history.length) {
      historyIndex = history.length;
      replaceCurrentLine("");
    }
    return;
  }

  if (data === "\t") {
    if (currentSuggestion && currentSuggestion.startsWith(currentLine)) {
      const suffix = currentSuggestion.slice(currentLine.length);
      currentLine = currentSuggestion;
      currentSuggestion = "";
      writePty(suffix);
    } else {
      writePty(data);
    }
    return;
  }

  writePty(data);

  if (data === "\r") {
    const submittedLine = currentLine;
    invoke("add_history", { command: submittedLine })
      .then(loadHistory)
      .catch(console.error);
    currentLine = "";
    currentSuggestion = "";
    historyIndex = history.length;

    if (submittedLine.trim().toLowerCase() === "exit") {
      closeAfterShellExitCommand();
    }
  } else if (data === "\u007f") {
    currentLine = currentLine.slice(0, -1);
    updateSuggestion();
  } else if (data === "\u0003" || data === "\u0004") {
    currentLine = "";
    currentSuggestion = "";
    historyIndex = history.length;
  } else if (data >= " " && data !== "\u007f") {
    currentLine += data;
    historyIndex = history.length;
    updateSuggestion();
  }
});

async function startTerminal() {
  // Register output handling before spawning so the first shell prompt is not lost.
  await listen("pty-output", (event) => {
    term.write(event.payload);
  });
  await listen("pty-exit", async () => {
    terminalRunning = false;
    await appWindow.close();
  });

  await loadHistory();
  await invoke("pty_spawn", { cols: term.cols, rows: term.rows });
  terminalRunning = true;
  resizePty();
}

startTerminal().catch((err) => {
  term.writeln(`Error: ${err}`);
});
