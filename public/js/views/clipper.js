import { api, onSocket } from "../api.js";
import { toast, escapeHtml } from "../components.js";

export async function mount(container) {
    const [cfg, engineStatus, subPresets] = await Promise.all([
        api.get("/api/config").catch(() => ({})),
        api.get("/api/subtitle/engine").catch(() => ({ defaultModel: "small-q5_1", models: [] })),
        api.get("/api/subtitle/presets").catch(() => ({}))
    ]);

    const models = engineStatus.models || [
        { name: "base-q5_1", label: "Base Q5_1 (~60 MB) - Cepat" },
        { name: "small-q5_1", label: "Small Q5_1 (~190 MB) - Rekomendasi" },
        { name: "medium-q5_0", label: "Medium Q5_0 (~540 MB) - Akurat" }
    ];

    let sourceMode = "local";
    let analyzedVideoPath = "";
    let highlights = [];
    let unsubProgress = null;
    let unsubComplete = null;

    container.innerHTML = `
        <div class="main-inner wide stack-lg">
            <div class="view-header">
                <div>
                    <h1>AI Highlight Clipper</h1>
                    <p class="view-desc">Ambil video panjang atau link YouTube, biarkan AI memilih momen paling menarik dan potong otomatis lengkap dengan subtitle karaoke.</p>
                </div>
            </div>

            <div class="tabs-inline" id="clipper-source-tabs">
                <button type="button" class="tab-pill active" data-cmode="local">
                    <i class="fas fa-folder-open"></i> File Lokal
                </button>
                <button type="button" class="tab-pill" data-cmode="youtube">
                    <i class="fab fa-youtube"></i> Link YouTube
                </button>
            </div>

            <div class="card stack-md">
                <div id="clipper-local-box" class="stack-sm">
                    <div class="form-group">
                        <label>Folder Video Sumber</label>
                        <div style="display:flex; gap:8px;">
                            <input type="text" id="cl-browse-dir" value="${escapeHtml(cfg.source_folder || "sumber_video")}" placeholder="Path folder video panjang">
                            <button type="button" id="cl-browse-btn" class="btn-secondary">Muat File</button>
                        </div>
                    </div>
                    <div id="cl-file-list" class="file-list-scroll">
                        <div class="muted small">Klik "Muat File" untuk memilih video lokal.</div>
                    </div>
                    <div class="form-group">
                        <label>Path Video Terpilih</label>
                        <input type="text" id="cl-file-path" placeholder="Atau tempel path file video langsung (mis. videos/podcast.mp4)">
                    </div>
                </div>

                <div id="clipper-yt-box" class="form-group" style="display:none;">
                    <label>URL Video YouTube</label>
                    <input type="url" id="cl-yt-url" placeholder="https://www.youtube.com/watch?v=...">
                </div>

                <div class="form-row-3">
                    <div class="form-group">
                        <label>Jumlah Klip</label>
                        <input type="number" id="cl-count" min="1" max="12" value="3">
                    </div>
                    <div class="form-group">
                        <label>Durasi Min (Detik)</label>
                        <input type="number" id="cl-min-dur" min="3" max="120" value="15">
                    </div>
                    <div class="form-group">
                        <label>Durasi Maks (Detik)</label>
                        <input type="number" id="cl-max-dur" min="5" max="180" value="60">
                    </div>
                </div>

                <div class="form-row-3">
                    <div class="form-group">
                        <label>Model Whisper</label>
                        <select id="cl-model">
                            ${models.map((m) => `<option value="${escapeHtml(m.name)}" ${m.name === (engineStatus.defaultModel || "small-q5_1") ? "selected" : ""}>${escapeHtml(m.label || m.name)}</option>`).join("")}
                        </select>
                    </div>
                    <div class="form-group">
                        <label>Bahasa Audio</label>
                        <select id="cl-lang">
                            <option value="id" selected>Indonesia (id)</option>
                            <option value="en">English (en)</option>
                            <option value="auto">Otomatis (auto)</option>
                        </select>
                    </div>
                    <div class="form-group">
                        <label>Fokus / Konteks (Opsional)</label>
                        <input type="text" id="cl-context" placeholder="Misal: tips marketing, momen lucu">
                    </div>
                </div>

                <div class="form-row-3">
                    <div class="form-group">
                        <label>Rasio Video Output</label>
                        <select id="cl-aspect">
                            <option value="portrait_blur" selected>Portrait Blur 9:16 (Rekomendasi)</option>
                            <option value="portrait_crop">Portrait Crop Tengah 9:16</option>
                            <option value="original">Pertahankan Rasio Asli</option>
                        </select>
                    </div>
                    <div class="form-group">
                        <label>Folder Output Klip</label>
                        <input type="text" id="cl-output-dir" value="hasil_highlight">
                    </div>
                    <div class="form-group" style="justify-content:end;">
                        <label class="toggle-row" style="margin-top:auto;">
                            <span>Burn Subtitle Otomatis</span>
                            <input type="checkbox" id="cl-burn-sub" checked>
                        </label>
                    </div>
                </div>

                <div class="form-row-3">
                    <div class="form-group">
                        <label>Gaya Subtitle Klip</label>
                        <select id="cl-style-preset">
                            <option value="">Ikuti Default Pengaturan (${escapeHtml(cfg.subtitle_ai?.alignment === "left" ? "Kiri" : "Tengah")} · ${escapeHtml(cfg.subtitle_ai?.fontFamily || "Poppins")})</option>
                            <option value="editorial_left">Editorial Kiri (Kecil Miring + Gradasi Bawah)</option>
                            <option value="editorial_gold">Editorial Gold (Garis Bawah + Gradasi)</option>
                            <option value="bold_center">Tebal Tengah (Klasik TikTok)</option>
                        </select>
                    </div>
                    <div class="form-group">
                        <label>Footer Label Editorial (Opsional)</label>
                        <input type="text" id="cl-footer-text" maxlength="120" value="${escapeHtml(cfg.subtitle_ai?.footerText || "")}" placeholder="Misal: PODCAST · EPISODE 12">
                    </div>
                    <div class="form-group" style="justify-content:end;">
                        <label class="toggle-row" style="margin-top:auto;">
                            <span>Koreksi Teks via Gemini AI (Audio)</span>
                            <input type="checkbox" id="cl-ai-correct" checked>
                        </label>
                    </div>
                </div>

                <div id="cl-progress-wrap" style="display:none;" class="stack-sm">
                    <div class="actions-between small">
                        <span id="cl-progress-msg" class="muted">Memproses...</span>
                        <span id="cl-progress-pct" class="mono">0%</span>
                    </div>
                    <div class="progress-track"><div class="progress-fill" id="cl-progress-fill"></div></div>
                </div>

                <div class="actions-end">
                    <button type="button" id="cl-analyze-btn" class="btn-primary">
                        <i class="fas fa-bolt"></i> Analisis &amp; Cari Highlight
                    </button>
                </div>
            </div>

            <!-- Step 2: Results & Preview -->
            <div id="cl-results-section" class="stack-md" style="display:none;">
                <div class="card stack-sm" id="cl-preview-card" style="display:none;">
                    <div class="actions-between">
                        <h3>Preview Sumber Video</h3>
                        <span id="cl-preview-label" class="muted small mono"></span>
                    </div>
                    <video id="cl-preview-video" controls playsinline style="width:100%; max-height:360px; border-radius:8px; background:#0f131c;"></video>
                </div>

                <div class="card stack-md">
                    <div class="actions-between">
                        <div>
                            <h3>Hasil Highlight AI</h3>
                            <p class="muted small" style="margin:2px 0 0;">Centang klip yang diinginkan, edit batas waktu bila perlu, lalu render.</p>
                        </div>
                        <button type="button" id="cl-render-btn" class="btn-primary">
                            <i class="fas fa-scissors"></i> Render Klip Terpilih
                        </button>
                    </div>
                    <div id="cl-highlights-list" class="stack-md"></div>
                </div>
            </div>

            <div id="cl-rendered-section" class="card stack-md" style="display:none;">
                <h3>Klip Selesai Dirender</h3>
                <div id="cl-rendered-list" class="stack-sm"></div>
            </div>
        </div>
    `;

    const filePathInput = container.querySelector("#cl-file-path");
    const fileListEl = container.querySelector("#cl-file-list");
    const analyzeBtn = container.querySelector("#cl-analyze-btn");
    const renderBtn = container.querySelector("#cl-render-btn");
    const progWrap = container.querySelector("#cl-progress-wrap");
    const progMsg = container.querySelector("#cl-progress-msg");
    const progPct = container.querySelector("#cl-progress-pct");
    const progFill = container.querySelector("#cl-progress-fill");
    const resultsSection = container.querySelector("#cl-results-section");
    const highlightsListEl = container.querySelector("#cl-highlights-list");
    const previewCard = container.querySelector("#cl-preview-card");
    const previewVideo = container.querySelector("#cl-preview-video");
    const renderedSection = container.querySelector("#cl-rendered-section");
    const renderedListEl = container.querySelector("#cl-rendered-list");

    container.querySelectorAll("#clipper-source-tabs .tab-pill").forEach((btn) => {
        btn.addEventListener("click", () => {
            container.querySelectorAll("#clipper-source-tabs .tab-pill").forEach((b) => b.classList.remove("active"));
            btn.classList.add("active");
            sourceMode = btn.dataset.cmode;
            container.querySelector("#clipper-local-box").style.display = sourceMode === "local" ? "" : "none";
            container.querySelector("#clipper-yt-box").style.display = sourceMode === "youtube" ? "" : "none";
        });
    });

    async function loadFolderFiles() {
        const dir = container.querySelector("#cl-browse-dir").value.trim();
        if (!dir) return;
        try {
            const data = await api.get(`/api/fs/list?dir=${encodeURIComponent(dir)}`);
            if (data.exists === false) {
                fileListEl.innerHTML = `<div class="muted small">Folder tidak ditemukan: ${escapeHtml(data.dir || dir)}</div>`;
                return;
            }
            const videos = (data.files || []).filter((f) => f.type === "video");
            if (videos.length === 0) {
                fileListEl.innerHTML = `<div class="muted small">Tidak ada file video di folder tersebut.</div>`;
                return;
            }
            fileListEl.innerHTML = videos.map((f, idx) => `
                <button type="button" class="file-item" data-vidx="${idx}">
                    <span><i class="fas fa-film" style="color:var(--em-600); margin-right:6px;"></i>${escapeHtml(f.name)}</span>
                    ${f.hasTranscript ? `<span class="badge emerald">Transkrip Ada</span>` : ""}
                </button>
            `).join("");
            fileListEl.querySelectorAll(".file-item").forEach((b) => {
                b.addEventListener("click", () => {
                    fileListEl.querySelectorAll(".file-item").forEach((x) => x.classList.remove("active"));
                    b.classList.add("active");
                    filePathInput.value = videos[Number(b.dataset.vidx)].path;
                });
            });
        } catch (err) {
            fileListEl.innerHTML = `<div class="muted small">${escapeHtml(err.message)}</div>`;
        }
    }

    container.querySelector("#cl-browse-btn").addEventListener("click", loadFolderFiles);
    loadFolderFiles();

    function renderHighlightsCards() {
        if (highlights.length === 0) {
            highlightsListEl.innerHTML = `<div class="muted small">Belum ada highlight ditemukan.</div>`;
            return;
        }
        highlightsListEl.innerHTML = highlights.map((hl, idx) => `
            <div class="highlight-card stack-sm" data-hidx="${idx}">
                <div class="actions-between">
                    <label style="display:flex; align-items:center; gap:8px; cursor:pointer;">
                        <input type="checkbox" class="hl-select" checked style="width:17px; height:17px; accent-color:var(--em-600);">
                        <strong>#${idx + 1} ${escapeHtml(hl.title)}</strong>
                    </label>
                    <div style="display:flex; align-items:center; gap:8px;">
                        <span class="score-badge">Skor ${hl.score}/100</span>
                        <button type="button" class="btn-secondary hl-preview-btn">
                            <i class="fas fa-play"></i> Preview
                        </button>
                    </div>
                </div>
                ${hl.reason ? `<div class="muted small">${escapeHtml(hl.reason)}</div>` : ""}
                <div class="form-row-3">
                    <div class="form-group">
                        <label>Mulai (Detik)</label>
                        <input type="number" step="0.1" class="hl-start" value="${hl.start}">
                    </div>
                    <div class="form-group">
                        <label>Selesai (Detik)</label>
                        <input type="number" step="0.1" class="hl-end" value="${hl.end}">
                    </div>
                    <div class="form-group">
                        <label>Judul Klip</label>
                        <input type="text" class="hl-title" value="${escapeHtml(hl.title)}">
                    </div>
                </div>
                <div class="form-group">
                    <label>Caption Sosmed</label>
                    <textarea rows="2" class="hl-caption">${escapeHtml(hl.caption || "")}</textarea>
                </div>
            </div>
        `).join("");

        highlightsListEl.querySelectorAll(".hl-preview-btn").forEach((btn) => {
            btn.addEventListener("click", () => {
                const card = btn.closest(".highlight-card");
                const startVal = parseFloat(card.querySelector(".hl-start").value) || 0;
                if (analyzedVideoPath) {
                    previewCard.style.display = "";
                    const srcUrl = `/api/media?path=${encodeURIComponent(analyzedVideoPath)}`;
                    if (!previewVideo.src.includes(encodeURIComponent(analyzedVideoPath))) {
                        previewVideo.src = srcUrl;
                    }
                    previewVideo.currentTime = startVal;
                    previewVideo.play().catch(() => {});
                    container.querySelector("#cl-preview-label").textContent = `Preview mulai ${startVal.toFixed(1)}s`;
                }
            });
        });
    }

    unsubProgress = onSocket("clipper-progress", (data) => {
        progWrap.style.display = "";
        progMsg.textContent = data.message || data.stage || "Memproses...";
        const pct = Number(data.percent || 0);
        progPct.textContent = `${pct}%`;
        progFill.style.width = `${pct}%`;
    });

    unsubComplete = onSocket("process-complete", (data) => {
        if (data?.success && Array.isArray(data.clips)) {
            renderedSection.style.display = "";
            renderedListEl.innerHTML = data.clips.map((c) => `
                <div class="list-row">
                    <div>
                        <strong>${escapeHtml(c.title || c.name)}</strong>
                        <div class="muted small mono">${escapeHtml(c.path)}</div>
                    </div>
                    <span class="badge emerald">${Number(c.duration || 0).toFixed(1)}s</span>
                </div>
            `).join("");
        }
    });

    analyzeBtn.addEventListener("click", async () => {
        const filePath = filePathInput.value.trim();
        const youtubeUrl = container.querySelector("#cl-yt-url").value.trim();
        if (sourceMode === "local" && !filePath) {
            toast("Pilih atau isi path video terlebih dahulu.", "error");
            return;
        }
        if (sourceMode === "youtube" && !youtubeUrl) {
            toast("Masukkan URL YouTube terlebih dahulu.", "error");
            return;
        }

        analyzeBtn.disabled = true;
        progWrap.style.display = "";
        progMsg.textContent = "Memulai analisis...";
        progPct.textContent = "5%";
        progFill.style.width = "5%";

        try {
            const res = await api.post("/api/clipper/analyze", {
                filePath: sourceMode === "local" ? filePath : "",
                youtubeUrl: sourceMode === "youtube" ? youtubeUrl : "",
                outputDir: container.querySelector("#cl-output-dir").value.trim() || "hasil_highlight",
                language: container.querySelector("#cl-lang").value,
                model: container.querySelector("#cl-model").value,
                clipCount: parseInt(container.querySelector("#cl-count").value, 10) || 3,
                minDuration: parseInt(container.querySelector("#cl-min-dur").value, 10) || 15,
                maxDuration: parseInt(container.querySelector("#cl-max-dur").value, 10) || 60,
                context: container.querySelector("#cl-context").value.trim()
            });

            analyzedVideoPath = res.videoPath;
            highlights = res.highlights || [];
            resultsSection.style.display = "";
            renderHighlightsCards();
            toast(`Ditemukan ${highlights.length} momen highlight!`);
        } catch (err) {
            toast(err.message, "error");
        } finally {
            analyzeBtn.disabled = false;
        }
    });

    renderBtn.addEventListener("click", async () => {
        const chosen = [];
        highlightsListEl.querySelectorAll(".highlight-card").forEach((card, idx) => {
            if (!card.querySelector(".hl-select").checked) return;
            chosen.push({
                ...highlights[idx],
                title: card.querySelector(".hl-title").value.trim() || `Highlight ${idx + 1}`,
                start: parseFloat(card.querySelector(".hl-start").value) || 0,
                end: parseFloat(card.querySelector(".hl-end").value) || 10,
                caption: card.querySelector(".hl-caption").value.trim()
            });
        });

        if (chosen.length === 0) {
            toast("Centang minimal 1 highlight untuk dirender.", "error");
            return;
        }

        const presetKey = container.querySelector("#cl-style-preset").value;
        const customStyle = presetKey && subPresets?.[presetKey] ? { ...subPresets[presetKey] } : {};
        const footerVal = container.querySelector("#cl-footer-text").value.trim();
        if (footerVal) customStyle.footerText = footerVal;

        await api.run("/api/clipper/render", {
            videoPath: analyzedVideoPath,
            outputDir: container.querySelector("#cl-output-dir").value.trim() || "hasil_highlight",
            highlights: chosen,
            aspectMode: container.querySelector("#cl-aspect").value,
            burnSubtitles: container.querySelector("#cl-burn-sub").checked,
            aiCorrectSubtitles: container.querySelector("#cl-ai-correct").checked,
            style: customStyle
        });
        toast(`Merender ${chosen.length} klip highlight...`);
    });

    return () => {
        if (unsubProgress) unsubProgress();
        if (unsubComplete) unsubComplete();
    };
}
