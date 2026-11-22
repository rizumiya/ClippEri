const listeners = new Map();

let socket = null;
let consoleDrawerEl = null;
let consoleOutputEl = null;
let statusPillEl = null;

function emitLocal(event, payload) {
    const fns = listeners.get(event);
    if (!fns) return;
    fns.forEach((fn) => {
        try { fn(payload); } catch (e) { console.error(e); }
    });
}

export function onSocket(event, fn) {
    if (!listeners.has(event)) listeners.set(event, new Set());
    listeners.get(event).add(fn);
    return () => listeners.get(event)?.delete(fn);
}

export function setProcessRunning(isRunning) {
    if (!statusPillEl) return;
    statusPillEl.style.display = isRunning ? "inline-flex" : "none";
}

export function expandConsole() {
    if (consoleDrawerEl) consoleDrawerEl.classList.remove("collapsed");
}

export function appendLog(message, type = "info") {
    if (!consoleOutputEl) return;
    const line = document.createElement("div");
    if (type === "error") line.style.color = "#f87171";
    line.textContent = message;
    consoleOutputEl.appendChild(line);
    consoleOutputEl.scrollTop = consoleOutputEl.scrollHeight;
}

export function initConsoleAndSocket(onNotify) {
    consoleDrawerEl = document.getElementById("console-drawer");
    consoleOutputEl = document.getElementById("console-output");
    statusPillEl = document.getElementById("process-status-pill");

    const toggle = document.getElementById("console-toggle");
    const clearBtn = document.getElementById("console-clear-btn");

    if (toggle && consoleDrawerEl) {
        toggle.addEventListener("click", (e) => {
            if (e.target.closest("#console-clear-btn")) return;
            consoleDrawerEl.classList.toggle("collapsed");
        });
    }

    if (clearBtn && consoleOutputEl) {
        clearBtn.addEventListener("click", () => {
            consoleOutputEl.innerHTML = "";
        });
    }

    if (typeof window.io === "function") {
        socket = window.io();
        socket.on("log", (data) => {
            appendLog(data.message, data.type);
            emitLocal("log", data);
        });
        socket.on("subtitle-progress", (data) => {
            emitLocal("subtitle-progress", data);
        });
        socket.on("process-complete", (data) => {
            setProcessRunning(false);
            if (onNotify) {
                if (data?.success) {
                    onNotify(data.message || "Proses selesai!", "info");
                } else {
                    onNotify(data?.error || "Proses gagal.", "error");
                }
            }
            emitLocal("process-complete", data);
        });
    }
}

async function request(method, url, body) {
    const opts = {
        method,
        headers: {}
    };
    if (body !== undefined) {
        opts.headers["Content-Type"] = "application/json";
        opts.body = JSON.stringify(body);
    }
    const res = await fetch(url, opts);
    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
        throw new Error(data.error || `HTTP ${res.status}`);
    }
    return data;
}

export const api = {
    get: (url) => request("GET", url),
    post: (url, body) => request("POST", url, body),
    async run(url, body) {
        expandConsole();
        setProcessRunning(true);
        appendLog(`> Memulai ${url}...`);
        try {
            const res = await request("POST", url, body);
            return res;
        } catch (err) {
            setProcessRunning(false);
            appendLog(`❌ Error: ${err.message}`, "error");
            throw err;
        }
    }
};
