import { api } from "../api.js";
import { toast, confirmModal, escapeHtml } from "../components.js";

export async function mount(container, addonId) {
    try {
        const res = await fetch(`/addons/${encodeURIComponent(addonId)}/panel.html`);
        if (!res.ok) {
            throw new Error(`Panel addon "${addonId}" tidak tersedia (pastikan addon aktif dan server telah di-restart).`);
        }
        const html = await res.text();
        container.innerHTML = `<div class="main-inner stack-lg">${html}</div>`;
        const root = container.querySelector(".main-inner");

        const mod = await import(`/addons/${encodeURIComponent(addonId)}/panel.js?v=${Date.now()}`);
        if (typeof mod.mount === "function") {
            return await mod.mount(root, { api, toast, confirmModal });
        }
    } catch (err) {
        container.innerHTML = `
            <div class="main-inner">
                <div class="card stack-sm">
                    <h3>Addon tidak dapat dimuat</h3>
                    <p class="muted">${escapeHtml(err.message)}</p>
                </div>
            </div>
        `;
    }
}
