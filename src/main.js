import { Terminal } from "xterm";
import { FitAddon } from "xterm-addon-fit";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { getCurrentWindow } from "@tauri-apps/api/window";
import "xterm/css/xterm.css";

const terminalTheme = {
  background: "rgba(37, 46, 53, 0.95)",
  foreground: "#E6E6E6",
  cursor: "#E6E6E6",
  selectionBackground: "rgba(73, 174, 230, 0.38)",
  selectionForeground: "#FFFFFF",
  black: "#1F2229",
  red: "#D41919",
  green: "#5EBDAB",
  yellow: "#FEA44C",
  blue: "#367BF0",
  magenta: "#9755B3",
  cyan: "#49AEE6",
  white: "#E6E6E6",
  brightBlack: "#198388",
  brightRed: "#EC0101",
  brightGreen: "#47D4B9",
  brightYellow: "#FF8A18",
  brightBlue: "#277FFF",
  brightMagenta: "#962AC3",
  brightCyan: "#05A1F7",
  brightWhite: "#FFFFFF",
};

const appWindow = getCurrentWindow();
const tabList = document.getElementById("tab-list");
const newTabButton = document.getElementById("new-tab");
const terminalHost = document.getElementById("terminal-host");

const tabs = new Map();
let tabCounter = 0;
let activeTabId = "";
let history = [];

const createTerminal = () => {
  const term = new Terminal({
    cursorBlink: true,
    cursorStyle: "block",
    fontFamily: '"Fira Code", "Hack Nerd Font", monospace',
    fontSize: 14,
    theme: terminalTheme,
  });
  const fitAddon = new FitAddon();
  term.loadAddon(fitAddon);
  return { term, fitAddon };
};

const getActiveTab = () => tabs.get(activeTabId);

const resizeTab = (tab) => {
  if (!tab || !tab.running) {
    return;
  }

  tab.fitAddon.fit();
  invoke("pty_resize", {
    tabId: tab.id,
    cols: tab.term.cols,
    rows: tab.term.rows,
  }).catch(console.error);
};

const resizeActiveTab = () => resizeTab(getActiveTab());

window.addEventListener("resize", resizeActiveTab);

const writePty = (tab, data) => {
  if (!tab?.running) {
    return Promise.resolve();
  }

  return invoke("pty_write", { tabId: tab.id, data }).catch(console.error);
};

const loadHistory = async () => {
  history = await invoke("get_history", { limit: 100 }).catch((err) => {
    console.error(err);
    return [];
  });

  for (const tab of tabs.values()) {
    tab.historyIndex = history.length;
  }
};

const updateSuggestion = async (tab) => {
  if (!tab.currentLine.trim()) {
    tab.currentSuggestion = "";
    return;
  }

  const suggestions = await invoke("get_suggestions", {
    currentLine: tab.currentLine,
  }).catch((err) => {
    console.error(err);
    return [];
  });
  tab.currentSuggestion = suggestions.find((item) => item !== tab.currentLine) ?? "";
};

const replaceCurrentLine = async (tab, nextLine) => {
  const eraseCurrentLine = "\u007f".repeat(tab.currentLine.length);
  tab.currentLine = nextLine;
  tab.currentSuggestion = "";
  await writePty(tab, `${eraseCurrentLine}${nextLine}`);
  await updateSuggestion(tab);
};

const renderTabs = () => {
  tabList.innerHTML = "";

  for (const tab of tabs.values()) {
    const tabButton = document.createElement("button");
    tabButton.className = `tab${tab.id === activeTabId ? " active" : ""}`;
    tabButton.type = "button";
    tabButton.title = tab.title;
    tabButton.addEventListener("click", () => activateTab(tab.id));

    const title = document.createElement("span");
    title.className = "tab-title";
    title.textContent = tab.title;
    tabButton.append(title);

    const closeButton = document.createElement("button");
    closeButton.className = "tab-close";
    closeButton.type = "button";
    closeButton.title = `Close ${tab.title}`;
    closeButton.setAttribute("aria-label", `Close ${tab.title}`);
    closeButton.textContent = "×";
    closeButton.addEventListener("click", (event) => {
      event.stopPropagation();
      closeTab(tab.id);
    });
    tabButton.append(closeButton);

    tabList.append(tabButton);
  }
};

const activateTab = (tabId) => {
  if (!tabs.has(tabId)) {
    return;
  }

  activeTabId = tabId;

  for (const tab of tabs.values()) {
    tab.pane.classList.toggle("active", tab.id === activeTabId);
  }

  renderTabs();

  const tab = getActiveTab();
  window.requestAnimationFrame(() => {
    resizeTab(tab);
    tab.term.focus();
  });
};

const closeTab = async (tabId) => {
  const tab = tabs.get(tabId);
  if (!tab) {
    return;
  }

  tab.running = false;
  await invoke("pty_close", { tabId }).catch(console.error);
  tab.term.dispose();
  tab.pane.remove();
  tabs.delete(tabId);

  if (tabs.size === 0) {
    await appWindow.close();
    return;
  }

  if (activeTabId === tabId) {
    activateTab([...tabs.keys()].at(-1));
  } else {
    renderTabs();
  }
};

const handleTerminalInput = (tab, data) => {
  if (!tab.running) {
    return;
  }

  if (data === "\u001b[A") {
    if (history.length > 0 && tab.historyIndex > 0) {
      tab.historyIndex -= 1;
      replaceCurrentLine(tab, history[tab.historyIndex]);
    }
    return;
  }

  if (data === "\u001b[B") {
    if (tab.historyIndex < history.length - 1) {
      tab.historyIndex += 1;
      replaceCurrentLine(tab, history[tab.historyIndex]);
    } else if (tab.historyIndex < history.length) {
      tab.historyIndex = history.length;
      replaceCurrentLine(tab, "");
    }
    return;
  }

  if (data === "\t") {
    if (tab.currentSuggestion && tab.currentSuggestion.startsWith(tab.currentLine)) {
      const suffix = tab.currentSuggestion.slice(tab.currentLine.length);
      tab.currentLine = tab.currentSuggestion;
      tab.currentSuggestion = "";
      writePty(tab, suffix);
    } else {
      writePty(tab, data);
    }
    return;
  }

  writePty(tab, data);

  if (data === "\r") {
    const submittedLine = tab.currentLine;
    invoke("add_history", { command: submittedLine }).then(loadHistory).catch(console.error);
    tab.currentLine = "";
    tab.currentSuggestion = "";
    tab.historyIndex = history.length;
  } else if (data === "\u007f") {
    tab.currentLine = tab.currentLine.slice(0, -1);
    updateSuggestion(tab);
  } else if (data === "\u0003" || data === "\u0004") {
    tab.currentLine = "";
    tab.currentSuggestion = "";
    tab.historyIndex = history.length;
  } else if (data >= " " && data !== "\u007f") {
    tab.currentLine += data;
    tab.historyIndex = history.length;
    updateSuggestion(tab);
  }
};

const createTab = async () => {
  const id = `tab-${++tabCounter}`;
  const pane = document.createElement("div");
  pane.className = "terminal-pane";
  terminalHost.append(pane);

  const { term, fitAddon } = createTerminal();
  const tab = {
    id,
    title: `Terminal ${tabCounter}`,
    pane,
    term,
    fitAddon,
    currentLine: "",
    currentSuggestion: "",
    historyIndex: history.length,
    running: false,
  };

  tabs.set(id, tab);
  term.open(pane);
  term.onData((data) => handleTerminalInput(tab, data));
  activateTab(id);

  await invoke("pty_spawn", { tabId: id, cols: term.cols, rows: term.rows });
  tab.running = true;
  resizeTab(tab);
};

async function startApp() {
  await listen("pty-output", (event) => {
    const tab = tabs.get(event.payload.tabId);
    tab?.term.write(event.payload.data);
  });

  await listen("pty-exit", async (event) => {
    const tab = tabs.get(event.payload.tabId);
    if (!tab) {
      return;
    }
    tab.running = false;
    await closeTab(tab.id);
  });

  await loadHistory();
  await createTab();
}

newTabButton.addEventListener("click", () => {
  createTab().catch((err) => getActiveTab()?.term.writeln(`Error: ${err}`));
});

startApp().catch((err) => {
  const { term } = createTerminal();
  const pane = document.createElement("div");
  pane.className = "terminal-pane active";
  terminalHost.append(pane);
  term.open(pane);
  term.writeln(`Error: ${err}`);
});
