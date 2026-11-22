import { api } from "../api.js";
import { toast, confirmModal, escapeHtml } from "../components.js";

export async function mount(container, { onAddonsChanged } = {}) {
    const [cfg, personasInit, brandsInit, encSummary, addonsList] = await Promise.all([
        api.get("/api/config").catch(() => ({})),
        api.get("/api/personas").catch(() => []),
        api.get("/api/brands").catch(() => []),
        api.get("/api/encoders").catch(() => ({ selected: "auto", active: "libx264", encoders: [] })),
        api.get("/api/addons").catch(() => [])
    ]);

    let personas = Array.isArray(personasInit) ? personasInit : [];
    let brands = Array.isArray(brandsInit) ? brandsInit : [];
    let addons = Array.isArray(addonsList) ? addonsList : [];
    let editingPersonaIdx = -1;
    let editingBrandIdx = -1;

    const mc = cfg.aio_defaults?.multicut || {};
    const mg = cfg.aio_defaults?.merge || {};
    const sub = cfg.subtitle_ai || {};
    const rawKeys = Array.isArray(cfg.gemini_api_key)
        ? cfg.gemini_api_key.join("\n")
        : String(cfg.gemini_api_key || "");

    container.innerHTML = `
        <div class="main-inner stack-lg">
            <div class="view-header">
                <div>
                    <h1>Pengaturan</h1>
                    <p class="view-desc">Kelola folder default, API Key Gemini, Persona AI global, Brand, gaya subtitle, encoder GPU/CPU, dan addons.</p>
                </div>
            </div>

            <div class="tabs-inline" id="settings-tabs">
                <button type="button" class="tab-pill active" data-stab="general">Umum &amp; Folder</button>
                <button type="button" class="tab-pill" data-stab="ai">AI &amp; API Key</button>
                <button type="button" class="tab-pill" data-stab="personas">Persona AI</button>
                <button type="button" class="tab-pill" data-stab="brands">Brand</button>
                <button type="button" class="tab-pill" data-stab="subtitle">Gaya Subtitle</button>
                <button type="button" class="tab-pill" data-stab="encoding">Encoding (GPU/CPU)</button>
                <button type="button" class="tab-pill" data-stab="addons">Addons</button>
            </div>

            <!-- 1. Umum & Folder -->
            <div id="stab-general" class="stack-md">
                <form id="set-general-form" class="card stack-md">
                    <h3>Folder &amp; Default Pemotongan</h3>
                    <div class="form-row">
                        <div class="form-group">
                            <label>Folder Sumber Default</label>
                            <input type="text" name="source_folder" value="${escapeHtml(cfg.source_folder || "sumber_video")}">
                        </div>
                        <div class="form-group">
                            <label>Folder Backsound Default</label>
                            <input type="text" name="backsound_folder" value="${escapeHtml(cfg.backsound_folder || "backsound")}">
                        </div>
                    </div>
                    <div class="form-row">
                        <div class="form-group">
                            <label>Potong Awal Default</label>
                            <input type="text" name="trim_start" value="${escapeHtml(cfg.trim_start || "")}">
                        </div>
                        <div class="form-group">
                            <label>Potong Akhir Default</label>
                            <input type="text" name="trim_end" value="${escapeHtml(cfg.trim_end || "")}">
                        </div>
                    </div>
                    <div class="form-row">
                        <div class="form-group">
                            <label>Maks Klip Default</label>
                            <input type="number" name="max_clips" value="${cfg.max_clips || 5}">
                        </div>
                        <div class="form-group">
                            <label>Durasi Klip Default (Detik)</label>
                            <input type="text" name="clip_duration" value="${escapeHtml(cfg.clip_duration || "2.5")}">
                        </div>
                    </div>
                    <div class="actions-end">
                        <button type="submit" class="btn-primary">Simpan Pengaturan Umum</button>
                    </div>
                </form>

                <form id="set-aio-form" class="card stack-md">
                    <h3>Default Workflow All-in-One</h3>
                    <div class="form-row-3">
                        <div class="form-group">
                            <label>AIO Maks Klip</label>
                            <input type="number" name="mcMaxClips" value="${mc.maxClips || 5}">
                        </div>
                        <div class="form-group">
                            <label>AIO Durasi Klip (s)</label>
                            <input type="number" step="0.1" name="mcClipDuration" value="${mc.clipDuration || 2}">
                        </div>
                        <div class="form-group">
                            <label>AIO Jumlah Final</label>
                            <input type="number" name="mgFinalCount" value="${mg.finalCount || 3}">
                        </div>
                    </div>
                    <div class="form-row-3">
                        <div class="form-group">
                            <label>Maks Klip / Sumber</label>
                            <input type="number" name="mgMaxPerSource" value="${mg.maxPerSource || 2}">
                        </div>
                        <div class="form-group">
                            <label>Durasi Final (Detik)</label>
                            <input type="number" name="mgFinalDuration" value="${mg.finalDurationSec || 17}">
                        </div>
                        <div class="form-group">
                            <label>Mode Urutan</label>
                            <select name="mgMode">
                                <option value="random" ${mg.mode !== "sequential" ? "selected" : ""}>Random</option>
                                <option value="sequential" ${mg.mode === "sequential" ? "selected" : ""}>Sequential</option>
                            </select>
                        </div>
                    </div>
                    <div class="actions-end">
                        <button type="submit" class="btn-secondary">Simpan Default All-in-One</button>
                    </div>
                </form>
            </div>

            <!-- 2. AI & API Key -->
            <div id="stab-ai" class="stack-md" style="display:none;">
                <form id="set-ai-form" class="card stack-md">
                    <h3>Gemini API Keys</h3>
                    <p class="muted small">Masukkan 1 API Key per baris untuk fallback otomatis apabila kuota key pertama habis.</p>
                    <div class="form-group">
                        <label>Daftar API Key</label>
                        <textarea id="set-gemini-keys" rows="5" class="mono" placeholder="AIzaSy...">${escapeHtml(rawKeys)}</textarea>
                    </div>
                    <div class="actions-end">
                        <button type="submit" class="btn-primary">Simpan API Keys</button>
                    </div>
                </form>
            </div>

            <!-- 3. Persona AI -->
            <div id="stab-personas" class="stack-md" style="display:none;">
                <div class="card stack-md">
                    <div class="actions-between">
                        <div>
                            <h3>Daftar Persona AI Global</h3>
                            <p class="muted small">Dipakai di AI Hooks &amp; All-in-One. Mendukung placeholder <code>{count}</code>, <code>{brand}</code>, dan <code>{context}</code>.</p>
                        </div>
                        <button type="button" id="persona-reset-btn" class="btn-secondary">
                            <i class="fas fa-rotate-left"></i> Reset ke Default
                        </button>
                    </div>
                    <div id="persona-list" class="stack-sm"></div>
                </div>

                <form id="persona-editor-form" class="card stack-md">
                    <h3 id="persona-editor-title">Tambah Persona Baru</h3>
                    <div class="form-row">
                        <div class="form-group">
                            <label>Nama Persona</label>
                            <input type="text" id="pe-name" placeholder="Contoh: Storytelling Hangat" required>
                        </div>
                        <div class="form-group">
                            <label>Mode Alur Data</label>
                            <select id="pe-mode">
                                <option value="standard">Standard</option>
                                <option value="edukasi_bisnis">Edukasi Bisnis (Sinkron Hook-Caption)</option>
                                <option value="story">Story (2-Step dari File Referensi Brand)</option>
                                <option value="bisnis">Bisnis / Kemitraan</option>
                            </select>
                        </div>
                    </div>
                    <div class="form-group">
                        <label>System Prompt (Peran, Gaya Penulisan, &amp; Larangan)</label>
                        <textarea id="pe-system" rows="5" placeholder="SYSTEM ROLE: Kamu adalah..."></textarea>
                    </div>
                    <div class="form-row">
                        <div class="form-group">
                            <label>Aturan Hook (Opsional)</label>
                            <textarea id="pe-hook-rule" rows="4" placeholder="Aturan panjang & gaya kalimat hook..."></textarea>
                        </div>
                        <div class="form-group">
                            <label>Aturan Caption (Opsional)</label>
                            <textarea id="pe-caption-rule" rows="4" placeholder="Aturan struktur caption..."></textarea>
                        </div>
                    </div>
                    <div class="form-group">
                        <label>Daftar Topik / Sudut Pandang Acak (1 topik per baris, opsional)</label>
                        <textarea id="pe-topics" rows="4" placeholder="Topik 1&#10;Topik 2"></textarea>
                    </div>
                    <div class="actions-end">
                        <button type="button" id="pe-cancel-btn" class="btn-secondary" style="display:none;">Batal Edit</button>
                        <button type="submit" class="btn-primary" id="pe-submit-btn">Simpan Persona</button>
                    </div>
                </form>
            </div>

            <!-- 4. Brand -->
            <div id="stab-brands" class="stack-md" style="display:none;">
                <div class="card stack-md">
                    <h3>Daftar Brand</h3>
                    <div id="brand-list" class="stack-sm"></div>
                </div>

                <form id="brand-editor-form" class="card stack-md">
                    <h3 id="brand-editor-title">Tambah / Edit Brand</h3>
                    <div class="form-row">
                        <div class="form-group">
                            <label>Nama Brand</label>
                            <input type="text" id="br-name" required>
                        </div>
                        <div class="form-group">
                            <label>Mode Default Brand</label>
                            <select id="br-mode">
                                <option value="standard">Standard</option>
                                <option value="edukasi_bisnis">Edukasi Bisnis</option>
                                <option value="story">Story</option>
                                <option value="bisnis">Bisnis</option>
                            </select>
                        </div>
                    </div>
                    <div class="form-group">
                        <label>Fokus Konten / Hook</label>
                        <input type="text" id="br-hooks" placeholder="Contoh: Pizza artisan, suasana cozy">
                    </div>
                    <div class="form-group" id="br-story-wrap">
                        <label>File Referensi Cerita (Mode Story)</label>
                        <input type="text" id="br-story-file" placeholder="Contoh: Resume atomic habit.txt">
                    </div>
                    <div class="form-group">
                        <label>Aturan Caption &amp; Hashtag</label>
                        <textarea id="br-caption-rule" rows="3"></textarea>
                    </div>
                    <div class="actions-end">
                        <button type="button" id="br-cancel-btn" class="btn-secondary" style="display:none;">Batal Edit</button>
                        <button type="submit" class="btn-primary">Simpan Brand</button>
                    </div>
                </form>
            </div>

            <!-- 5. Gaya Subtitle -->
            <div id="stab-subtitle" class="stack-md" style="display:none;">
                <form id="set-subtitle-form" class="card stack-md">
                    <h3>Gaya Subtitle Default</h3>
                    <div class="form-row-3">
                        <div class="form-group">
                            <label>Font Family</label>
                            <input type="text" name="fontFamily" value="${escapeHtml(sub.fontFamily || "Poppins")}">
                        </div>
                        <div class="form-group">
                            <label>Ukuran Font (px)</label>
                            <input type="number" name="fontSize" min="24" max="160" value="${sub.fontSize || 80}">
                        </div>
                        <div class="form-group">
                            <label>Mode Penanda Kata</label>
                            <select name="highlightMode">
                                <option value="karaoke" ${sub.highlightMode !== "active" && sub.highlightMode !== "none" ? "selected" : ""}>Karaoke (Sudah &amp; Sedang Diucap)</option>
                                <option value="active" ${sub.highlightMode === "active" ? "selected" : ""}>Sorot Kata Aktif Saja</option>
                                <option value="none" ${sub.highlightMode === "none" ? "selected" : ""}>Polos</option>
                            </select>
                        </div>
                    </div>
                    <div class="form-row-3">
                        <div class="form-group">
                            <label>Warna Teks</label>
                            <input type="color" name="primaryColor" value="${sub.primaryColor || "#ffffff"}">
                        </div>
                        <div class="form-group">
                            <label>Warna Penanda Kata</label>
                            <input type="color" name="highlightColor" value="${sub.highlightColor || "#10b981"}">
                        </div>
                        <div class="form-group">
                            <label>Warna Outline</label>
                            <input type="color" name="outlineColor" value="${sub.outlineColor || "#000000"}">
                        </div>
                    </div>
                    <div class="form-row-3">
                        <div class="form-group">
                            <label>Jarak dari Bawah (px)</label>
                            <input type="number" name="positionBottom" min="20" max="600" value="${sub.positionBottom || 300}">
                        </div>
                        <div class="form-group">
                            <label>Maks Kata / Baris</label>
                            <input type="number" name="maxWordsPerLine" min="1" max="8" value="${sub.maxWordsPerLine || 3}">
                        </div>
                        <div class="form-group">
                            <label>Maks Baris</label>
                            <select name="maxLines">
                                <option value="1" ${sub.maxLines === 1 ? "selected" : ""}>1 Baris</option>
                                <option value="2" ${sub.maxLines !== 1 ? "selected" : ""}>2 Baris</option>
                            </select>
                        </div>
                    </div>
                    <div class="actions-end">
                        <button type="submit" class="btn-primary">Simpan Gaya Subtitle</button>
                    </div>
                </form>
            </div>

            <!-- 6. Encoding -->
            <div id="stab-encoding" class="stack-md" style="display:none;">
                <form id="set-encoding-form" class="card stack-md">
                    <h3>Hardware Acceleration (GPU / CPU Encoder)</h3>
                    <div class="notice emerald">
                        <i class="fas fa-bolt"></i>
                        <div>
                            <strong>Encoder Terpilih Saat Ini:</strong> ${escapeHtml(encSummary.active)}
                            <div class="small muted">Mode konfigurasi: ${escapeHtml(encSummary.selected)}. Fallback otomatis ke CPU (libx264) aktif jika encoder GPU gagal.</div>
                        </div>
                    </div>
                    <div class="form-group">
                        <label>Pilih Video Encoder</label>
                        <select id="set-encoder-select">
                            <option value="auto" ${encSummary.selected === "auto" ? "selected" : ""}>Auto (Rekomendasi — pilih GPU tercepat yang tersedia)</option>
                            ${(encSummary.encoders || []).map((enc) => `
                                <option value="${enc.id}" ${encSummary.selected === enc.id ? "selected" : ""} ${!enc.available ? "disabled" : ""}>
                                    ${escapeHtml(enc.label)} ${enc.available ? "✓ Tersedia" : "✗ Tidak didukung perangkat"}
                                </option>
                            `).join("")}
                        </select>
                    </div>
                    <div class="actions-end">
                        <button type="submit" class="btn-primary">Simpan Pilihan Encoder</button>
                    </div>
                </form>
            </div>

            <!-- 7. Addons -->
            <div id="stab-addons" class="stack-md" style="display:none;">
                <div class="notice warn">
                    <i class="fas fa-circle-info"></i>
                    <span>Mengaktifkan atau menonaktifkan addon memerlukan <strong>restart server</strong> agar rute &amp; panel termuat dengan bersih.</span>
                </div>
                <div id="addons-list" class="stack-sm"></div>
            </div>
        </div>
    `;

    // Tab switching
    container.querySelectorAll("#settings-tabs .tab-pill").forEach((btn) => {
        btn.addEventListener("click", () => {
            container.querySelectorAll("#settings-tabs .tab-pill").forEach((b) => b.classList.remove("active"));
            btn.classList.add("active");
            const tab = btn.dataset.stab;
            ["general", "ai", "personas", "brands", "subtitle", "encoding", "addons"].forEach((k) => {
                container.querySelector(`#stab-${k}`).style.display = k === tab ? "" : "none";
            });
        });
    });

    // General & AIO
    container.querySelector("#set-general-form").addEventListener("submit", async (e) => {
        e.preventDefault();
        const d = Object.fromEntries(new FormData(e.target).entries());
        await api.post("/api/settings", {
            source_folder: d.source_folder.trim(),
            backsound_folder: d.backsound_folder.trim(),
            trim_start: d.trim_start.trim(),
            trim_end: d.trim_end.trim(),
            max_clips: parseInt(d.max_clips, 10) || 5,
            clip_duration: d.clip_duration.trim() || "2.5"
        });
        toast("Pengaturan umum disimpan.");
    });

    container.querySelector("#set-aio-form").addEventListener("submit", async (e) => {
        e.preventDefault();
        const d = Object.fromEntries(new FormData(e.target).entries());
        await api.post("/api/settings/aio", {
            aio_defaults: {
                multicut: {
                    maxClips: parseInt(d.mcMaxClips, 10) || 5,
                    clipDuration: parseFloat(d.mcClipDuration) || 2,
                    trimStart: mc.trimStart || "",
                    trimEnd: mc.trimEnd || ""
                },
                merge: {
                    finalCount: parseInt(d.mgFinalCount, 10) || 3,
                    maxPerSource: parseInt(d.mgMaxPerSource, 10) || 2,
                    maxSources: mg.maxSources ?? 0,
                    finalDurationSec: parseInt(d.mgFinalDuration, 10) || 17,
                    mode: d.mgMode || "random"
                }
            }
        });
        toast("Default All-in-One disimpan.");
    });

    // AI Keys
    container.querySelector("#set-ai-form").addEventListener("submit", async (e) => {
        e.preventDefault();
        const keys = container.querySelector("#set-gemini-keys").value.split(/\r?\n/).map((k) => k.trim()).filter(Boolean);
        await api.post("/api/settings", { gemini_api_key: keys });
        toast(`${keys.length} Gemini API Key disimpan.`);
    });

    // Personas CRUD
    function resetPersonaEditor() {
        editingPersonaIdx = -1;
        container.querySelector("#persona-editor-title").textContent = "Tambah Persona Baru";
        container.querySelector("#pe-cancel-btn").style.display = "none";
        container.querySelector("#pe-name").value = "";
        container.querySelector("#pe-mode").value = "standard";
        container.querySelector("#pe-system").value = "";
        container.querySelector("#pe-hook-rule").value = "";
        container.querySelector("#pe-caption-rule").value = "";
        container.querySelector("#pe-topics").value = "";
    }

    function renderPersonas() {
        const listEl = container.querySelector("#persona-list");
        if (personas.length === 0) {
            listEl.innerHTML = `<div class="muted small">Belum ada persona.</div>`;
            return;
        }
        listEl.innerHTML = personas.map((p, idx) => `
            <div class="list-row">
                <div>
                    <div style="display:flex; align-items:center; gap:8px;">
                        <strong>${escapeHtml(p.name)}</strong>
                        <span class="badge emerald">${escapeHtml(p.mode)}</span>
                        ${p.topics?.length ? `<span class="badge">${p.topics.length} topik</span>` : ""}
                    </div>
                    <div class="muted small mono">${escapeHtml(p.id)}</div>
                </div>
                <div style="display:flex; gap:6px;">
                    <button type="button" class="btn-secondary" data-pedit="${idx}">Edit</button>
                    <button type="button" class="btn-danger-ghost" data-pdel="${idx}" ${personas.length <= 1 ? "disabled" : ""}>
                        <i class="fas fa-trash"></i>
                    </button>
                </div>
            </div>
        `).join("");

        listEl.querySelectorAll("[data-pedit]").forEach((btn) => {
            btn.addEventListener("click", () => {
                const idx = Number(btn.dataset.pedit);
                const p = personas[idx];
                editingPersonaIdx = idx;
                container.querySelector("#persona-editor-title").textContent = `Edit Persona: ${p.name}`;
                container.querySelector("#pe-cancel-btn").style.display = "";
                container.querySelector("#pe-name").value = p.name || "";
                container.querySelector("#pe-mode").value = p.mode || "standard";
                container.querySelector("#pe-system").value = p.systemPrompt || "";
                container.querySelector("#pe-hook-rule").value = p.hookRule || "";
                container.querySelector("#pe-caption-rule").value = p.captionRule || "";
                container.querySelector("#pe-topics").value = (p.topics || []).join("\n");
            });
        });

        listEl.querySelectorAll("[data-pdel]").forEach((btn) => {
            btn.addEventListener("click", async () => {
                const idx = Number(btn.dataset.pdel);
                const target = personas[idx];
                const ok = await confirmModal({
                    title: "Hapus Persona",
                    message: `Hapus persona "${target.name}"?`,
                    confirmText: "Hapus",
                    danger: true
                });
                if (!ok) return;
                personas.splice(idx, 1);
                const res = await api.post("/api/personas", personas);
                personas = res.personas || personas;
                renderPersonas();
                toast("Persona dihapus.");
            });
        });
    }

    container.querySelector("#pe-cancel-btn").addEventListener("click", resetPersonaEditor);

    container.querySelector("#persona-editor-form").addEventListener("submit", async (e) => {
        e.preventDefault();
        const name = container.querySelector("#pe-name").value.trim();
        if (!name) return;
        const existingId = editingPersonaIdx >= 0 ? personas[editingPersonaIdx].id : "";
        const id = existingId || name.toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_|_$/g, "") || `persona_${Date.now()}`;
        const item = {
            id,
            name,
            mode: container.querySelector("#pe-mode").value,
            systemPrompt: container.querySelector("#pe-system").value.trim(),
            hookRule: container.querySelector("#pe-hook-rule").value.trim(),
            captionRule: container.querySelector("#pe-caption-rule").value.trim(),
            topics: container.querySelector("#pe-topics").value.split(/\r?\n/).map((t) => t.trim()).filter(Boolean)
        };

        if (editingPersonaIdx >= 0) {
            personas[editingPersonaIdx] = item;
        } else {
            personas.push(item);
        }

        const res = await api.post("/api/personas", personas);
        personas = res.personas || personas;
        resetPersonaEditor();
        renderPersonas();
        toast("Persona AI disimpan.");
    });

    container.querySelector("#persona-reset-btn").addEventListener("click", async () => {
        const ok = await confirmModal({
            title: "Reset Persona AI",
            message: "Kembalikan daftar Persona AI ke 3 preset bawaan? Persona custom Anda akan digantikan.",
            confirmText: "Reset",
            danger: true
        });
        if (!ok) return;
        const res = await api.post("/api/personas/reset", {});
        personas = res.personas || [];
        resetPersonaEditor();
        renderPersonas();
        toast("Persona AI direset ke default.");
    });

    // Brands CRUD
    function resetBrandEditor() {
        editingBrandIdx = -1;
        container.querySelector("#brand-editor-title").textContent = "Tambah / Edit Brand";
        container.querySelector("#br-cancel-btn").style.display = "none";
        container.querySelector("#br-name").value = "";
        container.querySelector("#br-mode").value = "standard";
        container.querySelector("#br-hooks").value = "";
        container.querySelector("#br-story-file").value = "";
        container.querySelector("#br-caption-rule").value = "";
    }

    function renderBrands() {
        const listEl = container.querySelector("#brand-list");
        if (brands.length === 0) {
            listEl.innerHTML = `<div class="muted small">Belum ada brand terdaftar.</div>`;
            return;
        }
        listEl.innerHTML = brands.map((b, idx) => `
            <div class="list-row">
                <div>
                    <strong>${escapeHtml(b.name)}</strong>
                    <span class="badge" style="margin-left:6px;">${escapeHtml(b.captionMode || "standard")}</span>
                    <div class="muted small">${escapeHtml(b.hooks || "Tanpa fokus khusus")}</div>
                </div>
                <div style="display:flex; gap:6px;">
                    <button type="button" class="btn-secondary" data-bedit="${idx}">Edit</button>
                    <button type="button" class="btn-danger-ghost" data-bdel="${idx}"><i class="fas fa-trash"></i></button>
                </div>
            </div>
        `).join("");

        listEl.querySelectorAll("[data-bedit]").forEach((btn) => {
            btn.addEventListener("click", () => {
                const idx = Number(btn.dataset.bedit);
                const b = brands[idx];
                editingBrandIdx = idx;
                container.querySelector("#brand-editor-title").textContent = `Edit Brand: ${b.name}`;
                container.querySelector("#br-cancel-btn").style.display = "";
                container.querySelector("#br-name").value = b.name || "";
                container.querySelector("#br-mode").value = b.captionMode || "standard";
                container.querySelector("#br-hooks").value = b.hooks || "";
                container.querySelector("#br-story-file").value = b.storySourceFile || "";
                container.querySelector("#br-caption-rule").value = b.captionRule || "";
            });
        });

        listEl.querySelectorAll("[data-bdel]").forEach((btn) => {
            btn.addEventListener("click", async () => {
                const idx = Number(btn.dataset.bdel);
                brands.splice(idx, 1);
                await api.post("/api/brands", brands);
                renderBrands();
                toast("Brand dihapus.");
            });
        });
    }

    container.querySelector("#br-cancel-btn").addEventListener("click", resetBrandEditor);

    container.querySelector("#brand-editor-form").addEventListener("submit", async (e) => {
        e.preventDefault();
        const item = {
            name: container.querySelector("#br-name").value.trim(),
            captionMode: container.querySelector("#br-mode").value,
            hooks: container.querySelector("#br-hooks").value.trim(),
            storySourceFile: container.querySelector("#br-story-file").value.trim(),
            captionRule: container.querySelector("#br-caption-rule").value.trim()
        };
        if (!item.name) return;
        if (editingBrandIdx >= 0) brands[editingBrandIdx] = item;
        else brands.push(item);

        await api.post("/api/brands", brands);
        resetBrandEditor();
        renderBrands();
        toast("Brand disimpan.");
    });

    // Subtitle default style
    container.querySelector("#set-subtitle-form").addEventListener("submit", async (e) => {
        e.preventDefault();
        const d = Object.fromEntries(new FormData(e.target).entries());
        await api.post("/api/settings", {
            subtitle_ai: {
                ...sub,
                fontFamily: d.fontFamily.trim() || "Poppins",
                fontSize: parseInt(d.fontSize, 10) || 80,
                highlightMode: d.highlightMode || "karaoke",
                primaryColor: d.primaryColor,
                highlightColor: d.highlightColor,
                outlineColor: d.outlineColor,
                positionBottom: parseInt(d.positionBottom, 10) || 300,
                maxWordsPerLine: parseInt(d.maxWordsPerLine, 10) || 3,
                maxLines: parseInt(d.maxLines, 10) || 2
            }
        });
        toast("Gaya subtitle default disimpan.");
    });

    // Encoding
    container.querySelector("#set-encoding-form").addEventListener("submit", async (e) => {
        e.preventDefault();
        const videoEncoder = container.querySelector("#set-encoder-select").value;
        await api.post("/api/settings", { encoding: { videoEncoder } });
        toast(`Encoder "${videoEncoder}" disimpan.`);
    });

    // Addons
    function renderAddons() {
        const listEl = container.querySelector("#addons-list");
        if (addons.length === 0) {
            listEl.innerHTML = `<div class="muted small">Tidak ada addon terdeteksi.</div>`;
            return;
        }
        listEl.innerHTML = addons.map((a) => `
            <div class="list-row">
                <div style="display:flex; align-items:flex-start; gap:12px;">
                    <i class="fas ${escapeHtml(a.icon || "fa-puzzle-piece")}" style="font-size:18px; color:var(--em-600); margin-top:3px;"></i>
                    <div>
                        <div style="display:flex; align-items:center; gap:8px;">
                            <strong>${escapeHtml(a.name)}</strong>
                            <span class="badge ${a.enabled ? "emerald" : ""}">${a.enabled ? "Aktif" : "Nonaktif"}</span>
                        </div>
                        <div class="muted small">${escapeHtml(a.description)}</div>
                    </div>
                </div>
                <button type="button" class="${a.enabled ? "btn-secondary" : "btn-primary"}" data-addon-toggle="${escapeHtml(a.id)}">
                    ${a.enabled ? "Nonaktifkan" : "Aktifkan"}
                </button>
            </div>
        `).join("");

        listEl.querySelectorAll("[data-addon-toggle]").forEach((btn) => {
            btn.addEventListener("click", async () => {
                const id = btn.dataset.addonToggle;
                const res = await api.post(`/api/addons/${encodeURIComponent(id)}/toggle`, {});
                const target = addons.find((x) => x.id === id);
                if (target) target.enabled = res.enabled;
                renderAddons();
                toast(`Addon ${id} ${res.enabled ? "diaktifkan" : "dinonaktifkan"}. Restart server untuk menerapkan.`);
                if (onAddonsChanged) onAddonsChanged();
            });
        });
    }

    renderPersonas();
    renderBrands();
    renderAddons();
}
