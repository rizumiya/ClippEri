import { api } from "./api.js";

export function escapeHtml(str) {
    return String(str ?? "")
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;")
        .replace(/"/g, "&quot;")
        .replace(/'/g, "&#39;");
}

export function toast(message, type = "info") {
    const container = document.getElementById("toast-container");
    if (!container) return;
    const el = document.createElement("div");
    el.className = `toast ${type === "error" ? "error" : ""}`;
    el.textContent = message;
    container.appendChild(el);
    setTimeout(() => el.remove(), 3800);
}

export function confirmModal({ title = "Konfirmasi", message = "", confirmText = "Lanjutkan", cancelText = "Batal", danger = false } = {}) {
    const root = document.getElementById("modal-root");
    if (!root) return Promise.resolve(window.confirm(message));

    return new Promise((resolve) => {
        root.style.display = "flex";
        root.innerHTML = `
            <div class="modal-card stack-md">
                <h3>${escapeHtml(title)}</h3>
                <p class="muted" style="margin:0; white-space:pre-line;">${escapeHtml(message)}</p>
                <div class="actions-end">
                    <button type="button" class="btn-secondary" id="modal-cancel">${escapeHtml(cancelText)}</button>
                    <button type="button" class="${danger ? "btn-danger" : "btn-primary"}" id="modal-confirm">${escapeHtml(confirmText)}</button>
                </div>
            </div>
        `;

        const cleanup = (val) => {
            root.style.display = "none";
            root.innerHTML = "";
            resolve(val);
        };

        root.querySelector("#modal-cancel").addEventListener("click", () => cleanup(false));
        root.querySelector("#modal-confirm").addEventListener("click", () => cleanup(true));
        root.addEventListener("click", (e) => {
            if (e.target === root) cleanup(false);
        }, { once: true });
    });
}

export function populateBrandSelect(selectEl, brands = [], contextInputEl = null) {
    if (!selectEl) return;
    const current = selectEl.value;
    selectEl.innerHTML = `<option value="">-- Tanpa Brand (Pakai Konteks Manual) --</option>`;
    brands.forEach((b, idx) => {
        const opt = document.createElement("option");
        opt.value = String(idx);
        opt.textContent = b.name;
        selectEl.appendChild(opt);
    });
    if (current !== "" && brands[Number(current)]) {
        selectEl.value = current;
    }

    if (contextInputEl) {
        const sync = () => {
            if (selectEl.value !== "") {
                contextInputEl.value = "";
                contextInputEl.disabled = true;
                contextInputEl.dataset.origPlaceholder = contextInputEl.dataset.origPlaceholder || contextInputEl.placeholder;
                contextInputEl.placeholder = "(Mengikuti pengaturan Brand terpilih)";
            } else {
                contextInputEl.disabled = false;
                if (contextInputEl.dataset.origPlaceholder) {
                    contextInputEl.placeholder = contextInputEl.dataset.origPlaceholder;
                }
            }
        };
        selectEl.addEventListener("change", sync);
        sync();
    }
}

/**
 * Render global AI Persona selector with Mixed + Custom Prompt + "Save as Persona".
 */
export function mountPersonaSelector({ container, personas = [], defaultId = "default", allowMixed = true, onPersonasUpdated }) {
    let personaList = [...personas];
    const uid = `ps_${Math.random().toString(36).slice(2, 7)}`;

    const renderOptions = (selectedVal) => {
        const opts = personaList.map((p) => `<option value="${escapeHtml(p.id)}">${escapeHtml(p.name)}</option>`);
        if (allowMixed) {
            opts.push(`<option value="mixed">Campuran (Rotasi semua persona)</option>`);
        }
        opts.push(`<option value="custom">Custom... (Tulis prompt sendiri)</option>`);
        return opts.join("");
    };

    container.innerHTML = `
        <div class="stack-sm">
            <div class="form-group">
                <label>Persona AI</label>
                <select id="${uid}-select">${renderOptions(defaultId)}</select>
            </div>
            <div id="${uid}-custom-box" class="card-subtle stack-sm" style="display:none;">
                <div class="form-group">
                    <label>Custom System Prompt</label>
                    <textarea id="${uid}-prompt" rows="4" placeholder="Tulis instruksi gaya bahasa, aturan, atau peran AI untuk sekali jalan..."></textarea>
                </div>
                <div class="form-row" style="align-items:end;">
                    <div class="form-group">
                        <label>Nama jika ingin disimpan permanen</label>
                        <input type="text" id="${uid}-save-name" placeholder="Contoh: Gaya Komedi Santai">
                    </div>
                    <div class="actions-end">
                        <button type="button" id="${uid}-save-btn" class="btn-secondary">
                            <i class="fas fa-bookmark"></i> Simpan sebagai Persona
                        </button>
                    </div>
                </div>
            </div>
        </div>
    `;

    const selectEl = container.querySelector(`#${uid}-select`);
    const customBox = container.querySelector(`#${uid}-custom-box`);
    const promptEl = container.querySelector(`#${uid}-prompt`);
    const saveNameEl = container.querySelector(`#${uid}-save-name`);
    const saveBtn = container.querySelector(`#${uid}-save-btn`);

    if (defaultId) selectEl.value = defaultId;

    const toggleCustom = () => {
        customBox.style.display = selectEl.value === "custom" ? "" : "none";
    };
    selectEl.addEventListener("change", toggleCustom);
    toggleCustom();

    saveBtn.addEventListener("click", async () => {
        const name = saveNameEl.value.trim();
        const sysPrompt = promptEl.value.trim();
        if (!name || !sysPrompt) {
            toast("Isi nama persona dan prompt terlebih dahulu.", "error");
            return;
        }
        const id = name.toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_|_$/g, "") || `persona_${Date.now()}`;
        const nextList = [
            ...personaList,
            { id, name, mode: "standard", systemPrompt: sysPrompt, hookRule: "", captionRule: "", topics: [] }
        ];
        try {
            const res = await api.post("/api/personas", nextList);
            personaList = res.personas || nextList;
            selectEl.innerHTML = renderOptions(id);
            selectEl.value = id;
            toggleCustom();
            saveNameEl.value = "";
            toast(`Persona "${name}" disimpan!`);
            if (onPersonasUpdated) onPersonasUpdated(personaList);
        } catch (err) {
            toast(err.message, "error");
        }
    });

    return {
        getValue() {
            const val = selectEl.value;
            if (val === "custom") {
                return { personaId: "default", customPersonaPrompt: promptEl.value.trim() };
            }
            return { personaId: val, customPersonaPrompt: "" };
        }
    };
}

export async function saveClipsFolderToRegistry(fullPath) {
    const trimmed = String(fullPath || "").trim();
    if (!trimmed) return;
    const folderName = trimmed.replace(/[\\/]+$/, "").split(/[\\/]/).pop();
    if (!folderName) return;

    try {
        const cfg = await api.get("/api/config");
        const existing = Array.isArray(cfg.clips_folders) ? cfg.clips_folders : [];
        const alreadyExists = existing.some((obj) => Object.values(obj)[0] === trimmed);
        if (!alreadyExists) {
            const updated = [...existing, { [folderName]: trimmed }];
            await api.post("/api/settings", { clips_folders: updated });
        }
    } catch { /* non-critical */ }
}
