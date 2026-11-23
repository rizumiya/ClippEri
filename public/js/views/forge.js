import { api, onSocket } from "../api.js";
import { toast, escapeHtml, mountPersonaSelector } from "../components.js";

export async function mount(container) {
    const [cfg, personas, voices] = await Promise.all([
        api.get("/api/config").catch(() => ({})),
        api.get("/api/personas").catch(() => []),
        api.get("/api/tts/voices").catch(() => [{ id: "id-ID-GadisNeural", label: "Indonesia — Gadis (Wanita, Default)" }])
    ]);

    let forgeMode = "product";
    let uploadedImages = [];
    let currentScript = null;
    let unsubProgress = null;
    let unsubComplete = null;

    container.innerHTML = `
        <div class="main-inner wide stack-lg">
            <div class="view-header">
                <div>
                    <h1>Video Forge (Foto Produk / Topik)</h1>
                    <p class="view-desc">Buat video vertikal lengkap dari 1 foto produk atau 1 kalimat topik dengan suara Edge TTS gratis dan subtitle kata-per-kata.</p>
                </div>
            </div>

            <div class="tabs-inline" id="forge-mode-tabs">
                <button type="button" class="tab-pill active" data-fmode="product">
                    <i class="fas fa-box-open"></i> 1 Foto Produk &rarr; Video
                </button>
                <button type="button" class="tab-pill" data-fmode="topic">
                    <i class="fas fa-lightbulb"></i> 1 Topik &rarr; Video
                </button>
            </div>

            <div class="card stack-md">
                <h3>1. Input Materi &amp; Pengaturan Suara</h3>

                <!-- Product Mode Inputs -->
                <div id="forge-product-box" class="stack-md">
                    <div class="form-group">
                        <label>Upload Foto Produk (1–5 gambar PNG/JPG/WEBP, foto utama akan dianalisa AI &amp; dikunci rasionya)</label>
                        <input type="file" id="fg-img-input" accept="image/png,image/jpeg,image/webp" multiple>
                        <div id="fg-thumbs" class="thumb-grid" style="margin-top:6px;"></div>
                    </div>
                    <div class="form-row">
                        <div class="form-group">
                            <label>Nama Produk</label>
                            <input type="text" id="fg-product-name" placeholder="Contoh: Serum Vitamin C Brightening">
                        </div>
                        <div class="form-group">
                            <label>CTA Akhir</label>
                            <input type="text" id="fg-cta" placeholder="Contoh: Cek keranjang kuning sekarang!">
                        </div>
                    </div>
                    <div class="form-group">
                        <label>Keunggulan / Selling Points (Opsional jika sudah upload foto)</label>
                        <textarea id="fg-selling-points" rows="2" placeholder="Contoh: Cepat meresap, mencerahkan dalam 7 hari, aman untuk kulit sensitif"></textarea>
                    </div>
                </div>

                <!-- Topic Mode Inputs -->
                <div id="forge-topic-box" class="stack-md" style="display:none;">
                    <div class="form-group">
                        <label>Topik / Ide Utama Video</label>
                        <textarea id="fg-topic" rows="2" placeholder="Contoh: 3 kebiasaan kecil di pagi hari yang bikin lebih fokus kerja"></textarea>
                    </div>
                    <div class="form-group">
                        <label>CTA / Penutup (Opsional)</label>
                        <input type="text" id="fg-topic-cta" placeholder="Contoh: Simpan video ini biar tidak lupa!">
                    </div>
                </div>

                <div class="form-row-3">
                    <div class="form-group">
                        <label>Target Durasi (Detik)</label>
                        <input type="number" id="fg-duration" min="10" max="90" value="25">
                    </div>
                    <div class="form-group">
                        <label>Jumlah Scene</label>
                        <input type="number" id="fg-scenes" min="2" max="8" value="4">
                    </div>
                    <div class="form-group">
                        <label>Sumber Visual B-Roll</label>
                        <select id="fg-visual-source">
                            <option value="auto_stock" selected>Stok Gambar Gratis (Openverse/Wikimedia) + Foto Produk</option>
                            <option value="product_only">Foto Produk Saja (Product Lock)</option>
                            <option value="local_folder">Folder Media Lokal</option>
                            <option value="minimal_bg">Latar Minimalis Studio</option>
                        </select>
                    </div>
                </div>

                <div id="fg-local-media-wrap" class="form-group" style="display:none;">
                    <label>Path Folder Media Lokal (Gambar/Video)</label>
                    <input type="text" id="fg-local-dir" value="${escapeHtml(cfg.source_folder || "sumber_video")}">
                </div>

                <div id="fg-persona-mount"></div>

                <div class="form-row-3" style="align-items:end;">
                    <div class="form-group">
                        <label>Suara Edge TTS (Gratis)</label>
                        <select id="fg-voice">
                            ${voices.map((v) => `<option value="${escapeHtml(v.id)}">${escapeHtml(v.label)}</option>`).join("")}
                        </select>
                    </div>
                    <div class="form-group">
                        <label>Kecepatan Bicara</label>
                        <select id="fg-rate">
                            <option value="-10%">Agak Lambat (-10%)</option>
                            <option value="+0%" selected>Normal (+0%)</option>
                            <option value="+10%">Agak Cepat (+10%)</option>
                            <option value="+20%">Cepat (+20%)</option>
                        </select>
                    </div>
                    <div class="actions-end">
                        <button type="button" id="fg-tts-preview-btn" class="btn-secondary">
                            <i class="fas fa-volume-high"></i> Dengar Sampel
                        </button>
                    </div>
                </div>
                <audio id="fg-tts-audio" controls style="display:none; width:100%; height:36px;"></audio>

                <div class="form-row-3">
                    <div class="form-group">
                        <label>Folder Backsound (Opsional)</label>
                        <input type="text" id="fg-backsound" value="${escapeHtml(cfg.backsound_folder || "")}" placeholder="Kosongkan jika tanpa musik">
                    </div>
                    <div class="form-group">
                        <label>Folder Output</label>
                        <input type="text" id="fg-output-dir" value="hasil_forge">
                    </div>
                    <div class="form-group" style="justify-content:end;">
                        <label class="toggle-row" style="margin-top:auto;">
                            <span>Burn Subtitle Karaoke</span>
                            <input type="checkbox" id="fg-burn-sub" checked>
                        </label>
                    </div>
                </div>

                <div class="actions-end">
                    <button type="button" id="fg-gen-script-btn" class="btn-primary">
                        <i class="fas fa-wand-magic-sparkles"></i> Generate Skrip &amp; Scene AI
                    </button>
                </div>
            </div>

            <!-- Step 2: Script Editor & Render -->
            <div id="fg-script-card" class="card stack-md" style="display:none;">
                <div class="actions-between">
                    <div>
                        <h3>2. Editor Skrip &amp; Scene</h3>
                        <p class="muted small" style="margin:2px 0 0;">Sesuaikan narasi atau kata kunci B-roll tiap scene sebelum render.</p>
                    </div>
                    <button type="button" id="fg-add-scene-btn" class="btn-secondary">
                        <i class="fas fa-plus"></i> Tambah Scene
                    </button>
                </div>

                <div class="form-row">
                    <div class="form-group">
                        <label>Judul Video</label>
                        <input type="text" id="fg-sc-title">
                    </div>
                    <div class="form-group">
                        <label>Hook Pembuka</label>
                        <input type="text" id="fg-sc-hook">
                    </div>
                </div>

                <div id="fg-scenes-list" class="stack-sm"></div>

                <div class="form-group">
                    <label>Caption Sosmed (.txt)</label>
                    <textarea id="fg-sc-caption" rows="3"></textarea>
                </div>

                <div id="fg-progress-wrap" style="display:none;" class="stack-sm">
                    <div class="actions-between small">
                        <span id="fg-progress-msg" class="muted">Memulai...</span>
                        <span id="fg-progress-pct" class="mono">0%</span>
                    </div>
                    <div class="progress-track"><div class="progress-fill" id="fg-progress-fill"></div></div>
                </div>

                <div class="actions-end">
                    <button type="button" id="fg-render-btn" class="btn-primary">
                        <i class="fas fa-clapperboard"></i> Render Video Jadi (.mp4)
                    </button>
                </div>
            </div>

            <div id="fg-result-card" class="card stack-md" style="display:none;">
                <div class="actions-between">
                    <h3>Video Forge Siap</h3>
                    <span id="fg-result-path" class="muted small mono"></span>
                </div>
                <video id="fg-result-video" controls playsinline style="width:100%; max-height:460px; border-radius:10px; background:#0f131c;"></video>
            </div>
        </div>
    `;

    const personaCtrl = mountPersonaSelector({
        container: container.querySelector("#fg-persona-mount"),
        personas,
        defaultId: "default",
        allowMixed: false
    });

    const thumbsEl = container.querySelector("#fg-thumbs");
    const visualSel = container.querySelector("#fg-visual-source");
    const localMediaWrap = container.querySelector("#fg-local-media-wrap");
    const scriptCard = container.querySelector("#fg-script-card");
    const scenesListEl = container.querySelector("#fg-scenes-list");
    const progWrap = container.querySelector("#fg-progress-wrap");
    const progMsg = container.querySelector("#fg-progress-msg");
    const progPct = container.querySelector("#fg-progress-pct");
    const progFill = container.querySelector("#fg-progress-fill");
    const resultCard = container.querySelector("#fg-result-card");
    const resultVideo = container.querySelector("#fg-result-video");

    container.querySelectorAll("#forge-mode-tabs .tab-pill").forEach((btn) => {
        btn.addEventListener("click", () => {
            container.querySelectorAll("#forge-mode-tabs .tab-pill").forEach((b) => b.classList.remove("active"));
            btn.classList.add("active");
            forgeMode = btn.dataset.fmode;
            container.querySelector("#forge-product-box").style.display = forgeMode === "product" ? "" : "none";
            container.querySelector("#forge-topic-box").style.display = forgeMode === "topic" ? "" : "none";
        });
    });

    visualSel.addEventListener("change", () => {
        localMediaWrap.style.display = visualSel.value === "local_folder" ? "" : "none";
    });

    function renderThumbs() {
        thumbsEl.innerHTML = uploadedImages.map((img, idx) => `
            <div class="thumb-item">
                <img src="${img.previewUrl}" alt="${escapeHtml(img.name)}">
                <button type="button" class="thumb-remove" data-rm="${idx}" title="Hapus">&times;</button>
            </div>
        `).join("");

        thumbsEl.querySelectorAll("[data-rm]").forEach((btn) => {
            btn.addEventListener("click", () => {
                uploadedImages.splice(Number(btn.dataset.rm), 1);
                renderThumbs();
            });
        });
    }

    container.querySelector("#fg-img-input").addEventListener("change", async (e) => {
        const files = Array.from(e.target.files || []).slice(0, 5 - uploadedImages.length);
        for (const f of files) {
            const dataUrl = await new Promise((resolve, reject) => {
                const reader = new FileReader();
                reader.onload = () => resolve(reader.result);
                reader.onerror = reject;
                reader.readAsDataURL(f);
            });
            try {
                const res = await api.post("/api/forge/upload-image", { dataUrl, filename: f.name });
                uploadedImages.push({ name: f.name, filePath: res.filePath, previewUrl: dataUrl });
            } catch (err) {
                toast(`Gagal upload ${f.name}: ${err.message}`, "error");
            }
        }
        renderThumbs();
        e.target.value = "";
    });

    container.querySelector("#fg-tts-preview-btn").addEventListener("click", async () => {
        const btn = container.querySelector("#fg-tts-preview-btn");
        const audioEl = container.querySelector("#fg-tts-audio");
        btn.disabled = true;
        try {
            const voice = container.querySelector("#fg-voice").value;
            const rate = container.querySelector("#fg-rate").value;
            const sampleText = voice.startsWith("en-")
                ? "Hello! This is a free Edge TTS voice sample for your video."
                : "Halo! Ini adalah contoh suara gratis Edge TTS untuk video Anda.";
            const res = await api.post("/api/tts/preview", { text: sampleText, voice, rate });
            audioEl.style.display = "block";
            audioEl.src = `/api/media?path=${encodeURIComponent(res.audioPath)}&t=${Date.now()}`;
            audioEl.play().catch(() => {});
        } catch (err) {
            toast(err.message, "error");
        } finally {
            btn.disabled = false;
        }
    });

    function renderScenes() {
        const scenes = currentScript?.scenes || [];
        scenesListEl.innerHTML = scenes.map((sc, idx) => `
            <div class="card-subtle stack-sm fg-scene-row" data-sidx="${idx}">
                <div class="actions-between">
                    <strong>Scene ${idx + 1}</strong>
                    <div style="display:flex; align-items:center; gap:10px;">
                        ${forgeMode === "product" ? `
                        <label style="display:inline-flex; align-items:center; gap:6px; font-size:12px; cursor:pointer;">
                            <input type="checkbox" class="sc-use-prod" ${sc.useProductImage ? "checked" : ""} style="accent-color:var(--em-600);">
                            Pakai Foto Produk
                        </label>
                        ` : ""}
                        <button type="button" class="btn-danger-ghost sc-del-btn" ${scenes.length <= 1 ? "disabled" : ""}>
                            <i class="fas fa-trash"></i>
                        </button>
                    </div>
                </div>
                <div class="form-group">
                    <label>Narasi Voiceover</label>
                    <textarea rows="2" class="sc-narration">${escapeHtml(sc.narration)}</textarea>
                </div>
                <div class="form-group">
                    <label>Keyword Visual B-Roll (Bahasa Inggris)</label>
                    <input type="text" class="sc-query" value="${escapeHtml(sc.visualQuery || "")}">
                </div>
            </div>
        `).join("");

        scenesListEl.querySelectorAll(".sc-del-btn").forEach((btn) => {
            btn.addEventListener("click", () => {
                const idx = Number(btn.closest(".fg-scene-row").dataset.sidx);
                currentScript.scenes.splice(idx, 1);
                renderScenes();
            });
        });
    }

    function syncScriptFromDom() {
        if (!currentScript) return null;
        currentScript.title = container.querySelector("#fg-sc-title").value.trim() || "Video Forge";
        currentScript.hook = container.querySelector("#fg-sc-hook").value.trim();
        currentScript.caption = container.querySelector("#fg-sc-caption").value.trim();
        const nextScenes = [];
        scenesListEl.querySelectorAll(".fg-scene-row").forEach((row) => {
            nextScenes.push({
                narration: row.querySelector(".sc-narration").value.trim(),
                visualQuery: row.querySelector(".sc-query").value.trim(),
                useProductImage: Boolean(row.querySelector(".sc-use-prod")?.checked)
            });
        });
        currentScript.scenes = nextScenes.filter((s) => s.narration !== "");
        return currentScript;
    }

    container.querySelector("#fg-add-scene-btn").addEventListener("click", () => {
        if (!currentScript) currentScript = { title: "", hook: "", caption: "", scenes: [] };
        syncScriptFromDom();
        currentScript.scenes.push({
            narration: "",
            visualQuery: "minimalist aesthetic lifestyle",
            useProductImage: forgeMode === "product"
        });
        renderScenes();
    });

    container.querySelector("#fg-gen-script-btn").addEventListener("click", async () => {
        const btn = container.querySelector("#fg-gen-script-btn");
        const pVal = personaCtrl.getValue();
        btn.disabled = true;
        try {
            const res = await api.post("/api/forge/script", {
                mode: forgeMode,
                productName: container.querySelector("#fg-product-name").value.trim(),
                sellingPoints: container.querySelector("#fg-selling-points").value.trim(),
                topic: container.querySelector("#fg-topic").value.trim(),
                cta: forgeMode === "product"
                    ? container.querySelector("#fg-cta").value.trim()
                    : container.querySelector("#fg-topic-cta").value.trim(),
                durationSec: parseInt(container.querySelector("#fg-duration").value, 10) || 25,
                sceneCount: parseInt(container.querySelector("#fg-scenes").value, 10) || 4,
                personaId: pVal.personaId,
                customPersonaPrompt: pVal.customPersonaPrompt,
                productImagePath: uploadedImages[0]?.filePath || ""
            });

            currentScript = res.script;
            scriptCard.style.display = "";
            container.querySelector("#fg-sc-title").value = currentScript.title || "";
            container.querySelector("#fg-sc-hook").value = currentScript.hook || "";
            container.querySelector("#fg-sc-caption").value = currentScript.caption || "";
            renderScenes();
            toast(`Skrip ${currentScript.scenes.length} scene berhasil dibuat!`);
        } catch (err) {
            toast(err.message, "error");
        } finally {
            btn.disabled = false;
        }
    });

    unsubProgress = onSocket("forge-progress", (data) => {
        progWrap.style.display = "";
        progMsg.textContent = data.message || data.stage || "Merender...";
        const pct = Number(data.percent || 0);
        progPct.textContent = `${pct}%`;
        progFill.style.width = `${pct}%`;
    });

    unsubComplete = onSocket("process-complete", (data) => {
        if (data?.success && data.outputPath && data.wordsPath) {
            resultCard.style.display = "";
            container.querySelector("#fg-result-path").textContent = data.outputPath;
            resultVideo.src = `/api/media?path=${encodeURIComponent(data.outputPath)}&t=${Date.now()}`;
        }
    });

    container.querySelector("#fg-render-btn").addEventListener("click", async () => {
        const script = syncScriptFromDom();
        if (!script || script.scenes.length === 0) {
            toast("Minimal harus ada 1 scene dengan narasi.", "error");
            return;
        }

        progWrap.style.display = "";
        progMsg.textContent = "Memulai render Video Forge...";
        progPct.textContent = "5%";
        progFill.style.width = "5%";

        await api.run("/api/forge/render", {
            mode: forgeMode,
            script,
            productImagePaths: uploadedImages.map((u) => u.filePath),
            visualSource: visualSel.value,
            localMediaDir: container.querySelector("#fg-local-dir").value.trim(),
            voice: container.querySelector("#fg-voice").value,
            rate: container.querySelector("#fg-rate").value,
            backsoundDir: container.querySelector("#fg-backsound").value.trim(),
            burnSubtitles: container.querySelector("#fg-burn-sub").checked,
            outputDir: container.querySelector("#fg-output-dir").value.trim() || "hasil_forge"
        });
        toast("Proses render Video Forge dimulai.");
    });

    return () => {
        if (unsubProgress) unsubProgress();
        if (unsubComplete) unsubComplete();
    };
}
