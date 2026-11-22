import { api, onSocket } from "../api.js";
import { toast, escapeHtml } from "../components.js";
import { groupWords, findActiveCaption } from "../subtitle-render.js";

export async function mount(container) {
    const [cfg, engineStatus] = await Promise.all([
        api.get("/api/config").catch(() => ({})),
        api.get("/api/subtitle/engine").catch(() => ({ binReady: false, defaultModel: "small-q5_1", models: [] }))
    ]);

    let style = {
        fontFamily: "Poppins",
        fontSize: 80,
        lineSpacing: 0,
        outlineColor: "#000000",
        primaryColor: "#ffffff",
        highlightColor: "#a59fd8",
        highlightMode: "karaoke",
        maxLines: 2,
        maxWordsPerLine: 3,
        positionBottom: 300,
        uppercase: false,
        bold: true,
        ...(cfg.subtitle_ai || {})
    };

    let engine = engineStatus;
    let selectedFile = null;
    let words = [];
    let captions = [];
    let rafId = null;
    let unsubProgress = null;
    let lastCapSignature = "";
    let lastActiveGlobalIdx = -1;

    const modelOptionsHtml = (selectedName) => (engine.models || []).map((m) => `
        <option value="${escapeHtml(m.name)}" ${m.name === selectedName ? "selected" : ""}>
            ${escapeHtml(m.label)} ${m.downloaded ? "✓ Terunduh" : "(Belum diunduh)"}
        </option>
    `).join("");

    container.innerHTML = `
        <div class="main-inner wide stack-lg">
            <div class="view-header">
                <div>
                    <h1>Subtitle Otomatis Studio</h1>
                    <p class="view-desc">Transkripsi audio otomatis (offline via Whisper), penanda kata saat diucapkan, preview langsung, dan burn-in ke video.</p>
                </div>
            </div>

            <div class="tabs-inline" id="sub-mode-tabs">
                <button type="button" class="tab-pill active" data-stab="studio">
                    <i class="fas fa-play-circle"></i> Studio &amp; Preview
                </button>
                <button type="button" class="tab-pill" data-stab="batch">
                    <i class="fas fa-layer-group"></i> Proses Batch Folder
                </button>
            </div>

            <!-- Engine Status Card -->
            <div class="card stack-sm" id="sub-engine-card">
                <div class="actions-between">
                    <div class="stack-sm" style="gap:3px;">
                        <div style="display:flex; align-items:center; gap:8px;">
                            <strong>Engine Whisper.cpp</strong>
                            <span id="sub-bin-badge" class="badge ${engine.binReady ? "emerald" : ""}">
                                ${engine.binReady ? "Siap" : "Belum Terpasang"}
                            </span>
                        </div>
                        <span class="muted small">Berjalan offline di perangkat Anda untuk akurasi timestamp per kata.</span>
                    </div>
                    <div style="display:flex; align-items:center; gap:10px; flex-wrap:wrap;">
                        <select id="sub-model-select" style="width:auto; min-width:240px;">
                            ${modelOptionsHtml(engine.defaultModel || "small-q5_1")}
                        </select>
                        <select id="sub-lang-select" style="width:auto;">
                            <option value="id" selected>Bahasa Indonesia (id)</option>
                            <option value="en">English (en)</option>
                            <option value="auto">Deteksi Otomatis (auto)</option>
                        </select>
                        <button type="button" id="sub-install-btn" class="btn-secondary">
                            <i class="fas fa-download"></i> Install / Unduh Model
                        </button>
                    </div>
                </div>
                <div id="sub-progress-wrap" style="display:none;" class="stack-sm">
                    <div class="actions-between small">
                        <span id="sub-progress-msg" class="muted">Menyiapkan...</span>
                        <span id="sub-progress-pct" class="mono">0%</span>
                    </div>
                    <div class="progress-track"><div class="progress-fill" id="sub-progress-fill"></div></div>
                </div>
            </div>

            <!-- STUDIO MODE -->
            <div id="sub-panel-studio" class="studio-grid">
                <!-- Left: Video Stage & Overlay -->
                <div class="card stack-md" style="padding:16px;">
                    <div class="stage-wrap" id="sub-stage">
                        <video id="sub-video" controls playsinline></video>
                        <div class="audio-poster" id="sub-audio-poster" style="display:none;">
                            <i class="fas fa-waveform-lines fa-music"></i>
                            <div id="sub-audio-title" class="small mono">Audio Mode (1080x1920)</div>
                        </div>
                        <div class="sub-overlay" id="sub-overlay"></div>
                    </div>
                    <div class="actions-between small">
                        <span id="sub-active-file-label" class="muted mono">Pilih file media di sebelah kanan</span>
                        <span id="sub-time-readout" class="mono muted">0.00s</span>
                    </div>
                </div>

                <!-- Right: File Picker, Transcript Chips, Style Controls, Burn -->
                <div class="stack-md">
                    <div class="card stack-sm">
                        <h3>1. Pilih File Video / Audio</h3>
                        <div style="display:flex; gap:8px;">
                            <input type="text" id="sub-browse-dir" value="${cfg.source_folder || "sumber_video"}" placeholder="Path folder media">
                            <button type="button" id="sub-browse-btn" class="btn-secondary">Muat File</button>
                        </div>
                        <div id="sub-file-list" class="file-list-scroll">
                            <div class="muted small">Klik "Muat File" untuk menampilkan daftar video &amp; audio.</div>
                        </div>
                        <div class="actions-end">
                            <button type="button" id="sub-transcribe-force-btn" class="btn-secondary" disabled>
                                <i class="fas fa-rotate"></i> Transkrip Ulang
                            </button>
                            <button type="button" id="sub-transcribe-btn" class="btn-primary" disabled>
                                <i class="fas fa-wand-magic-sparkles"></i> Transkrip Audio
                            </button>
                        </div>
                    </div>

                    <div class="card stack-sm">
                        <div class="actions-between">
                            <h3>2. Transkrip Kata (Klik untuk lompat, 2x klik untuk edit)</h3>
                            <span id="sub-word-count" class="badge">0 kata</span>
                        </div>
                        <div id="sub-word-chips" class="word-chips">
                            <span class="muted small">Belum ada transkrip. Pilih file lalu klik "Transkrip Audio".</span>
                        </div>
                    </div>

                    <div class="card stack-md">
                        <div class="actions-between">
                            <h3>3. Gaya &amp; Penanda Kata (Live Preview)</h3>
                            <button type="button" id="sub-save-style-btn" class="btn-ghost-sm">Simpan Default</button>
                        </div>
                        <div class="form-row-3">
                            <div class="form-group">
                                <label>Mode Penanda</label>
                                <select id="st-highlightMode">
                                    <option value="karaoke">Karaoke (Sudah &amp; Sedang Diucap)</option>
                                    <option value="active">Sorot Kata Aktif Saja</option>
                                    <option value="none">Polos (Tanpa Penanda)</option>
                                </select>
                            </div>
                            <div class="form-group">
                                <label>Font</label>
                                <input type="text" id="st-fontFamily" value="${escapeHtml(style.fontFamily)}">
                            </div>
                            <div class="form-group">
                                <label>Ukuran Font (px)</label>
                                <input type="number" id="st-fontSize" min="24" max="160" value="${style.fontSize}">
                            </div>
                        </div>
                        <div class="form-row-3">
                            <div class="form-group">
                                <label>Warna Teks Utama</label>
                                <input type="color" id="st-primaryColor" value="${style.primaryColor}">
                            </div>
                            <div class="form-group">
                                <label>Warna Kata Aktif/Sudah</label>
                                <input type="color" id="st-highlightColor" value="${style.highlightColor}">
                            </div>
                            <div class="form-group">
                                <label>Warna Outline</label>
                                <input type="color" id="st-outlineColor" value="${style.outlineColor}">
                            </div>
                        </div>
                        <div class="form-row-3">
                            <div class="form-group">
                                <label>Posisi Bawah: <span id="st-pos-val">${style.positionBottom}</span>px</label>
                                <input type="range" id="st-positionBottom" min="40" max="550" value="${style.positionBottom}">
                            </div>
                            <div class="form-group">
                                <label>Maks Kata / Baris</label>
                                <input type="number" id="st-maxWordsPerLine" min="1" max="8" value="${style.maxWordsPerLine}">
                            </div>
                            <div class="form-group">
                                <label>Maks Baris</label>
                                <select id="st-maxLines">
                                    <option value="1" ${style.maxLines === 1 ? "selected" : ""}>1 Baris</option>
                                    <option value="2" ${style.maxLines !== 1 ? "selected" : ""}>2 Baris</option>
                                </select>
                            </div>
                        </div>
                        <div class="form-row">
                            <label class="toggle-row">
                                <span>Huruf Kapital Semua (UPPERCASE)</span>
                                <input type="checkbox" id="st-uppercase" ${style.uppercase ? "checked" : ""}>
                            </label>
                            <label class="toggle-row">
                                <span>Tebal (Bold)</span>
                                <input type="checkbox" id="st-bold" ${style.bold ? "checked" : ""}>
                            </label>
                        </div>
                    </div>

                    <div class="card stack-sm">
                        <h3>4. Render Permanen ke Video (.mp4)</h3>
                        <div style="display:flex; gap:10px; align-items:end;">
                            <div class="form-group" style="flex:1;">
                                <label>Folder Output</label>
                                <input type="text" id="sub-output-dir" value="hasil_subtitle">
                            </div>
                            <button type="button" id="sub-burn-btn" class="btn-primary" disabled>
                                <i class="fas fa-film"></i> Render ke Video
                            </button>
                        </div>
                    </div>
                </div>
            </div>

            <!-- BATCH MODE -->
            <form id="sub-batch-form" class="card stack-md" style="display:none;">
                <h3>Proses Subtitle Otomatis untuk Satu Folder</h3>
                <p class="muted small">Setiap video dan audio di folder sumber akan ditranskrip dan dirender dengan gaya subtitle aktif di atas.</p>
                <div class="form-row">
                    <div class="form-group">
                        <label>Folder Sumber (Video / Audio)</label>
                        <input type="text" name="sourceDir" value="${cfg.source_folder || "sumber_video"}" required>
                    </div>
                    <div class="form-group">
                        <label>Folder Output</label>
                        <input type="text" name="finalDir" value="hasil_subtitle_batch" required>
                    </div>
                </div>
                <div class="actions-end">
                    <button type="submit" class="btn-primary">
                        <i class="fas fa-bolt"></i> Jalankan Batch Subtitle
                    </button>
                </div>
            </form>
        </div>
    `;

    // Refs
    const stageEl = container.querySelector("#sub-stage");
    const videoEl = container.querySelector("#sub-video");
    const posterEl = container.querySelector("#sub-audio-poster");
    const overlayEl = container.querySelector("#sub-overlay");
    const timeReadout = container.querySelector("#sub-time-readout");
    const chipsEl = container.querySelector("#sub-word-chips");
    const fileListEl = container.querySelector("#sub-file-list");
    const modelSel = container.querySelector("#sub-model-select");
    const langSel = container.querySelector("#sub-lang-select");
    const installBtn = container.querySelector("#sub-install-btn");
    const progressWrap = container.querySelector("#sub-progress-wrap");
    const progressMsg = container.querySelector("#sub-progress-msg");
    const progressPct = container.querySelector("#sub-progress-pct");
    const progressFill = container.querySelector("#sub-progress-fill");
    const transBtn = container.querySelector("#sub-transcribe-btn");
    const transForceBtn = container.querySelector("#sub-transcribe-force-btn");
    const burnBtn = container.querySelector("#sub-burn-btn");

    container.querySelector("#st-highlightMode").value = style.highlightMode;

    // Tab switching
    container.querySelectorAll("#sub-mode-tabs .tab-pill").forEach((btn) => {
        btn.addEventListener("click", () => {
            container.querySelectorAll("#sub-mode-tabs .tab-pill").forEach((b) => b.classList.remove("active"));
            btn.classList.add("active");
            const mode = btn.dataset.stab;
            container.querySelector("#sub-panel-studio").style.display = mode === "studio" ? "" : "none";
            container.querySelector("#sub-batch-form").style.display = mode === "batch" ? "" : "none";
        });
    });

    function refreshCaptions() {
        captions = groupWords(words, {
            maxWordsPerLine: style.maxWordsPerLine,
            maxLines: style.maxLines
        });
        lastCapSignature = "";
    }

    function updateInstallButtonState() {
        const chosen = modelSel.value;
        const mInfo = (engine.models || []).find((m) => m.name === chosen);
        const ready = engine.binReady && mInfo?.downloaded;
        installBtn.innerHTML = ready
            ? `<i class="fas fa-check"></i> Model Siap`
            : `<i class="fas fa-download"></i> Install / Unduh Model`;
        installBtn.disabled = Boolean(ready);
    }
    modelSel.addEventListener("change", updateInstallButtonState);
    updateInstallButtonState();

    unsubProgress = onSocket("subtitle-progress", (data) => {
        progressWrap.style.display = "";
        progressMsg.textContent = data.message || data.stage || "Memproses...";
        const pct = Number(data.percent || 0);
        progressPct.textContent = `${pct}%`;
        progressFill.style.width = `${pct}%`;
        if (data.stage === "done") {
            api.get("/api/subtitle/engine").then((st) => {
                engine = st;
                container.querySelector("#sub-bin-badge").textContent = st.binReady ? "Siap" : "Belum Terpasang";
                container.querySelector("#sub-bin-badge").className = `badge ${st.binReady ? "emerald" : ""}`;
                modelSel.innerHTML = modelOptionsHtml(modelSel.value);
                updateInstallButtonState();
            }).catch(() => {});
        }
    });

    installBtn.addEventListener("click", async () => {
        progressWrap.style.display = "";
        await api.run("/api/subtitle/engine/install", { model: modelSel.value });
        toast("Mengunduh Whisper engine & model...");
    });

    // Load media list
    async function loadFiles() {
        const dir = container.querySelector("#sub-browse-dir").value.trim();
        if (!dir) return;
        try {
            const data = await api.get(`/api/fs/list?dir=${encodeURIComponent(dir)}`);
            if (data.exists === false) {
                fileListEl.innerHTML = `<div class="muted small">Folder tidak ditemukan: ${escapeHtml(data.dir || dir)}</div>`;
                return;
            }
            const files = data.files || [];
            if (files.length === 0) {
                fileListEl.innerHTML = `<div class="muted small">Tidak ada file video/audio di folder tersebut.</div>`;
                return;
            }
            fileListEl.innerHTML = files.map((f, idx) => `
                <button type="button" class="file-item" data-idx="${idx}">
                    <span>
                        <i class="fas ${f.type === "audio" ? "fa-music" : "fa-film"}" style="color:var(--em-600); margin-right:6px;"></i>
                        ${escapeHtml(f.name)}
                    </span>
                    ${f.hasTranscript ? `<span class="badge emerald">Transkrip Ada</span>` : ""}
                </button>
            `).join("");

            fileListEl.querySelectorAll(".file-item").forEach((btn) => {
                btn.addEventListener("click", () => {
                    fileListEl.querySelectorAll(".file-item").forEach((b) => b.classList.remove("active"));
                    btn.classList.add("active");
                    selectMediaFile(files[Number(btn.dataset.idx)]);
                });
            });
        } catch (err) {
            fileListEl.innerHTML = `<div class="muted small">${escapeHtml(err.message)}</div>`;
        }
    }

    container.querySelector("#sub-browse-btn").addEventListener("click", loadFiles);

    async function selectMediaFile(file) {
        selectedFile = file;
        transBtn.disabled = false;
        transForceBtn.disabled = false;
        burnBtn.disabled = false;
        container.querySelector("#sub-active-file-label").textContent = file.name;

        const mediaUrl = `/api/media?path=${encodeURIComponent(file.path)}&t=${Date.now()}`;
        videoEl.src = mediaUrl;

        if (file.type === "audio") {
            stageEl.classList.remove("landscape");
            posterEl.style.display = "flex";
            container.querySelector("#sub-audio-title").textContent = file.name;
        } else {
            posterEl.style.display = "none";
        }

        words = [];
        captions = [];
        renderWordChips();

        if (file.hasTranscript) {
            await runTranscribe(false);
        }
    }

    videoEl.addEventListener("loadedmetadata", () => {
        if (selectedFile?.type === "video" && videoEl.videoWidth > 0) {
            stageEl.classList.toggle("landscape", videoEl.videoWidth > videoEl.videoHeight);
        }
    });

    async function runTranscribe(force = false) {
        if (!selectedFile) return;
        transBtn.disabled = true;
        transForceBtn.disabled = true;
        try {
            progressWrap.style.display = "";
            const res = await api.post("/api/subtitle/transcribe", {
                filePath: selectedFile.path,
                language: langSel.value,
                model: modelSel.value,
                force
            });
            words = Array.isArray(res.words) ? res.words : [];
            refreshCaptions();
            renderWordChips();
            toast(`Transkripsi selesai (${words.length} kata).`);
            // Update badge in file list
            selectedFile.hasTranscript = true;
        } catch (err) {
            toast(err.message, "error");
        } finally {
            transBtn.disabled = false;
            transForceBtn.disabled = false;
        }
    }

    transBtn.addEventListener("click", () => runTranscribe(false));
    transForceBtn.addEventListener("click", () => runTranscribe(true));

    function renderWordChips() {
        container.querySelector("#sub-word-count").textContent = `${words.length} kata`;
        if (words.length === 0) {
            chipsEl.innerHTML = `<span class="muted small">Belum ada kata terdeteksi.</span>`;
            return;
        }
        chipsEl.innerHTML = words.map((w, idx) => `
            <span class="word-chip" data-widx="${idx}" title="Klik untuk lompat, 2x klik untuk edit">
                <span class="word-chip-text">${escapeHtml(w.text)}</span>
                <span class="word-chip-time">${Number(w.start).toFixed(1)}s</span>
            </span>
        `).join("");

        chipsEl.querySelectorAll(".word-chip").forEach((chip) => {
            const idx = Number(chip.dataset.widx);
            chip.addEventListener("click", () => {
                if (chip.querySelector("input")) return;
                videoEl.currentTime = words[idx].start;
                videoEl.play().catch(() => {});
            });
            chip.addEventListener("dblclick", (e) => {
                e.stopPropagation();
                if (chip.querySelector("input")) return;
                const textSpan = chip.querySelector(".word-chip-text");
                const input = document.createElement("input");
                input.type = "text";
                input.value = words[idx].text;
                input.style.width = `${Math.max(55, words[idx].text.length * 9)}px`;
                input.style.padding = "2px 6px";
                input.style.fontSize = "12px";
                textSpan.replaceWith(input);
                input.focus();
                input.select();

                const commit = async () => {
                    const nextVal = input.value.trim();
                    if (nextVal && nextVal !== words[idx].text) {
                        words[idx].text = nextVal;
                        refreshCaptions();
                        await api.post("/api/subtitle/words", {
                            filePath: selectedFile.path,
                            words
                        }).catch((err) => toast(err.message, "error"));
                        toast("Kata diperbarui.");
                    }
                    renderWordChips();
                };

                input.addEventListener("keydown", (ke) => {
                    if (ke.key === "Enter") commit();
                    if (ke.key === "Escape") renderWordChips();
                });
                input.addEventListener("blur", commit, { once: true });
            });
        });
    }

    // Bind live style controls
    const bindStyle = (id, key, transform = (v) => v) => {
        const el = container.querySelector(`#${id}`);
        if (!el) return;
        const evt = el.type === "checkbox" || el.tagName === "SELECT" ? "change" : "input";
        el.addEventListener(evt, () => {
            style[key] = el.type === "checkbox" ? el.checked : transform(el.value);
            if (key === "positionBottom") {
                container.querySelector("#st-pos-val").textContent = style.positionBottom;
            }
            if (key === "maxWordsPerLine" || key === "maxLines") {
                refreshCaptions();
            }
            lastCapSignature = "";
        });
    };

    bindStyle("st-highlightMode", "highlightMode");
    bindStyle("st-fontFamily", "fontFamily", (v) => v.trim() || "Poppins");
    bindStyle("st-fontSize", "fontSize", (v) => Math.max(24, Number(v) || 80));
    bindStyle("st-primaryColor", "primaryColor");
    bindStyle("st-highlightColor", "highlightColor");
    bindStyle("st-outlineColor", "outlineColor");
    bindStyle("st-positionBottom", "positionBottom", (v) => Number(v) || 300);
    bindStyle("st-maxWordsPerLine", "maxWordsPerLine", (v) => Math.max(1, Number(v) || 3));
    bindStyle("st-maxLines", "maxLines", (v) => Math.min(2, Math.max(1, Number(v) || 2)));
    bindStyle("st-uppercase", "uppercase");
    bindStyle("st-bold", "bold");

    container.querySelector("#sub-save-style-btn").addEventListener("click", async () => {
        await api.post("/api/settings", { subtitle_ai: style });
        toast("Gaya subtitle disimpan sebagai default.");
    });

    burnBtn.addEventListener("click", async () => {
        if (!selectedFile) return;
        const outputDir = container.querySelector("#sub-output-dir").value.trim() || "hasil_subtitle";
        burnBtn.disabled = true;
        try {
            const res = await api.post("/api/subtitle/burn", {
                filePath: selectedFile.path,
                outputDir,
                language: langSel.value,
                model: modelSel.value,
                style
            });
            toast(`Video berhasil dirender: ${res.outputPath}`);
        } catch (err) {
            toast(err.message, "error");
        } finally {
            burnBtn.disabled = false;
        }
    });

    container.querySelector("#sub-batch-form").addEventListener("submit", async (e) => {
        e.preventDefault();
        const fd = new FormData(e.target);
        const d = Object.fromEntries(fd.entries());
        await api.run("/api/run/subtitle-batch", {
            sourceDir: d.sourceDir.trim(),
            finalDir: d.finalDir.trim(),
            language: langSel.value,
            model: modelSel.value,
            style
        });
        toast("Proses Batch Subtitle dimulai.");
    });

    // Live overlay animation loop
    function renderOverlayFrame() {
        if (!document.body.contains(container)) return;
        const t = videoEl.currentTime || 0;
        timeReadout.textContent = `${t.toFixed(2)}s`;

        const { caption, activeLocalIdx } = findActiveCaption(captions, t);

        if (!caption) {
            if (lastCapSignature !== "empty") {
                overlayEl.innerHTML = "";
                lastCapSignature = "empty";
            }
        } else {
            const stageH = stageEl.clientHeight || 520;
            const scaledPx = Math.max(14, Math.round(style.fontSize * (stageH / 1920)));
            const bottomPct = Math.min(80, Math.max(4, (style.positionBottom / 1920) * 100));

            overlayEl.style.bottom = `${bottomPct}%`;
            overlayEl.style.fontFamily = `'${style.fontFamily}', sans-serif`;
            overlayEl.style.fontSize = `${scaledPx}px`;
            overlayEl.style.setProperty("--sub-outline", style.outlineColor);

            const sig = `${caption.start}:${activeLocalIdx}:${style.highlightMode}:${style.primaryColor}:${style.highlightColor}:${style.uppercase}:${style.bold}`;
            if (sig !== lastCapSignature) {
                lastCapSignature = sig;
                overlayEl.innerHTML = caption.lines.map((line) => {
                    const wordsHtml = line.map((w) => {
                        const isSaid = activeLocalIdx >= 0 && w.localIdx < activeLocalIdx;
                        const isActive = w.localIdx === activeLocalIdx;
                        let color = style.primaryColor;
                        let cls = "sub-word upcoming";

                        if (style.highlightMode === "karaoke") {
                            if (isSaid || isActive) {
                                color = style.highlightColor;
                                cls = isActive ? "sub-word active" : "sub-word said";
                            }
                        } else if (style.highlightMode === "active") {
                            if (isActive) {
                                color = style.highlightColor;
                                cls = "sub-word active pop";
                            } else if (isSaid) {
                                cls = "sub-word said";
                            }
                        }

                        const txt = style.uppercase ? w.text.toUpperCase() : w.text;
                        return `<span class="${cls}" style="color:${color}; font-weight:${style.bold ? 800 : 500};">${escapeHtml(txt)}</span>`;
                    }).join("");
                    return `<div class="sub-line">${wordsHtml}</div>`;
                }).join("");
            }
        }

        // Update transcript chip highlights cleanly
        const currentGlobal = caption && activeLocalIdx >= 0 ? caption.words[activeLocalIdx]?.globalIdx : -1;
        if (currentGlobal !== lastActiveGlobalIdx) {
            lastActiveGlobalIdx = currentGlobal;
            const allChips = chipsEl.querySelectorAll(".word-chip");
            allChips.forEach((chip, idx) => {
                chip.classList.toggle("active", idx === currentGlobal);
                chip.classList.toggle("said", currentGlobal >= 0 && idx < currentGlobal);
            });
        }

        rafId = requestAnimationFrame(renderOverlayFrame);
    }

    rafId = requestAnimationFrame(renderOverlayFrame);

    // Try auto-loading default folder if files exist
    loadFiles();

    return () => {
        if (rafId) cancelAnimationFrame(rafId);
        if (unsubProgress) unsubProgress();
    };
}
