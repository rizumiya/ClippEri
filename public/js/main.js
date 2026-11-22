import { api, initConsoleAndSocket } from "./api.js";
import { toast, escapeHtml } from "./components.js";
import { mount as mountAllInOne } from "./views/all-in-one.js";
import { mount as mountMulticut } from "./views/multicut.js";
import { mount as mountMerge } from "./views/merge.js";
import { mount as mountHooks } from "./views/hooks.js";
import { mount as mountSubtitle } from "./views/subtitle-studio.js";
import { mountYoutube, mountAnalysis, mountRotate, mountCompress } from "./views/tools.js";
import { mount as mountSettings } from "./views/settings.js";
import { mount as mountAddon } from "./views/addon-host.js";

const viewRoot = document.getElementById("view-root");
const sidebar = document.getElementById("sidebar");
const mobileBtn = document.getElementById("mobile-menu-btn");
const themeBtn = document.getElementById("theme-toggle");

let activeCleanup = null;

// Theme persistence (light default)
function applyTheme(theme) {
    document.documentElement.setAttribute("data-theme", theme);
    localStorage.setItem("vt_theme", theme);
    if (themeBtn) {
        themeBtn.innerHTML = theme === "dark"
            ? '<i class="fas fa-sun"></i>'
            : '<i class="fas fa-moon"></i>';
    }
}

applyTheme(localStorage.getItem("vt_theme") || "light");

if (themeBtn) {
    themeBtn.addEventListener("click", () => {
        const next = document.documentElement.getAttribute("data-theme") === "dark" ? "light" : "dark";
        applyTheme(next);
    });
}

if (mobileBtn && sidebar) {
    mobileBtn.addEventListener("click", () => {
        sidebar.classList.toggle("open");
    });
}

async function refreshAddonSidebar() {
    const group = document.getElementById("nav-addons-group");
    const listEl = document.getElementById("nav-addons-list");
    if (!group || !listEl) return;

    try {
        const addons = await api.get("/api/addons");
        const activeAddons = (addons || []).filter((a) => a.enabled && a.loaded && a.hasPanel);

        if (activeAddons.length === 0) {
            group.style.display = "none";
            listEl.innerHTML = "";
            return;
        }

        group.style.display = "";
        listEl.innerHTML = activeAddons.map((a) => `
            <a href="#/addon/${escapeHtml(a.id)}" class="nav-item" data-route="/addon/${escapeHtml(a.id)}">
                <i class="fas ${escapeHtml(a.icon || "fa-puzzle-piece")}"></i>
                <span>${escapeHtml(a.name)}</span>
            </a>
        `).join("");
        updateActiveNav();
    } catch {
        group.style.display = "none";
    }
}

function getCurrentRoute() {
    const hash = window.location.hash || "#/all-in-one";
    return hash.replace(/^#/, "") || "/all-in-one";
}

function updateActiveNav() {
    const route = getCurrentRoute();
    document.querySelectorAll(".sidebar .nav-item").forEach((el) => {
        el.classList.toggle("active", el.dataset.route === route);
    });
}

async function navigate() {
    const route = getCurrentRoute();
    updateActiveNav();
    if (sidebar) sidebar.classList.remove("open");

    if (typeof activeCleanup === "function") {
        try { activeCleanup(); } catch { /* ignore */ }
        activeCleanup = null;
    }

    viewRoot.innerHTML = `<div class="main-inner muted">Memuat...</div>`;

    try {
        if (route === "/all-in-one") {
            activeCleanup = await mountAllInOne(viewRoot);
        } else if (route === "/multicut") {
            activeCleanup = await mountMulticut(viewRoot);
        } else if (route === "/merge") {
            activeCleanup = await mountMerge(viewRoot);
        } else if (route === "/hooks") {
            activeCleanup = await mountHooks(viewRoot);
        } else if (route === "/subtitle") {
            activeCleanup = await mountSubtitle(viewRoot);
        } else if (route === "/youtube") {
            activeCleanup = await mountYoutube(viewRoot);
        } else if (route === "/analysis") {
            activeCleanup = await mountAnalysis(viewRoot);
        } else if (route === "/rotate") {
            activeCleanup = await mountRotate(viewRoot);
        } else if (route === "/compress") {
            activeCleanup = await mountCompress(viewRoot);
        } else if (route === "/settings") {
            activeCleanup = await mountSettings(viewRoot, { onAddonsChanged: refreshAddonSidebar });
        } else if (route.startsWith("/addon/")) {
            const addonId = route.slice("/addon/".length);
            activeCleanup = await mountAddon(viewRoot, addonId);
        } else {
            window.location.hash = "#/all-in-one";
        }
    } catch (err) {
        viewRoot.innerHTML = `<div class="main-inner card"><h3>Gagal memuat halaman</h3><p class="muted">${escapeHtml(err.message)}</p></div>`;
    }
}

initConsoleAndSocket((msg, type) => toast(msg, type));
window.addEventListener("hashchange", navigate);

await refreshAddonSidebar();
navigate();
