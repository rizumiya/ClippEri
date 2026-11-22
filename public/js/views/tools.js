import { api } from "../api.js";
import { toast, confirmModal, escapeHtml } from "../components.js";

export async function mountYoutube(container) {
    container.innerHTML = `
        <div class="main-inner stack-lg">
            <div class="view-header">
                <div>
                    <h1>YouTube Downloader</h1>
                    <p class="view-desc">Unduh satu atau banyak video YouTube sekaligus secara berurutan.</p>
                </div>
            </div>

            <form id="yt-form" class="card stack-md">
                <div class="form-group">
                    <label>Daftar URL YouTube (1 URL per baris)</label>
                    <textarea name="url" rows="4" placeholder="https://www.youtube.com/watch?v=...&#10;https://youtu.be/..." required></textarea>
                </div>
                <div class="form-row">
                    <div class="form-group">
                        <label>Folder Output</label>
                        <input type="text" name="outputDir" value="youtube_downloads" required>
                    </div>
                    <div class="form-group">
                        <label>Kualitas Video</label>
                        <select name="quality">
                            <option value="highest">Terbaik (Highest)</option>
                            <option value="1080p">1080p</option>
                            <option value="720p">720p</option>
                            <option value="audio">Audio Saja (MP3/M4A)</option>
                        </select>
                    </div>
                </div>
                <div class="actions-end">
                    <button type="submit" class="btn-primary">
                        <i class="fas fa-download"></i> Mulai Download
                    </button>
                </div>
            </form>
        </div>
    `;

    container.querySelector("#yt-form").addEventListener("submit", async (e) => {
        e.preventDefault();
        const fd = new FormData(e.target);
        const d = Object.fromEntries(fd.entries());
        await api.run("/api/run/youtube", {
            url: d.url.trim(),
            outputDir: d.outputDir.trim(),
            quality: d.quality
        });
        toast("Proses download YouTube dimulai.");
    });
}

export async function mountAnalysis(container) {
    container.innerHTML = `
        <div class="main-inner stack-lg">
            <div class="view-header">
                <div>
                    <h1>Analisis Video AI</h1>
                    <p class="view-desc">Bedah struktur hook, alur, dan potensi konten dari link video menggunakan Gemini AI.</p>
                </div>
            </div>

            <form id="analysis-form" class="card stack-md">
                <div class="form-group">
                    <label>URL Video (YouTube / Sosial Media)</label>
                    <input type="url" name="url" placeholder="https://..." required>
                </div>
                <div class="actions-end">
                    <button type="submit" id="analysis-submit" class="btn-primary">
                        <i class="fas fa-microscope"></i> Analisis Sekarang
                    </button>
                </div>
            </form>

            <div id="analysis-result-card" class="card stack-sm" style="display:none;">
                <div class="actions-between">
                    <h3>Hasil Analisis</h3>
                    <button type="button" id="analysis-copy-btn" class="btn-secondary">
                        <i class="fas fa-copy"></i> Salin Hasil
                    </button>
                </div>
                <textarea id="analysis-output" rows="14" class="mono" readonly></textarea>
            </div>
        </div>
    `;

    const resultCard = container.querySelector("#analysis-result-card");
    const outputEl = container.querySelector("#analysis-output");
    const submitBtn = container.querySelector("#analysis-submit");

    container.querySelector("#analysis-form").addEventListener("submit", async (e) => {
        e.preventDefault();
        const url = e.target.url.value.trim();
        if (!url) return;
        resultCard.style.display = "";
        outputEl.value = "Sedang menganalisis video dengan Gemini AI...";
        submitBtn.disabled = true;
        try {
            const res = await api.post("/api/run/analyze-video", { url });
            outputEl.value = typeof res.analysis === "string"
                ? res.analysis
                : JSON.stringify(res.analysis, null, 2);
            toast("Analisis selesai!");
        } catch (err) {
            outputEl.value = `Error: ${err.message}`;
            toast(err.message, "error");
        } finally {
            submitBtn.disabled = false;
        }
    });

    container.querySelector("#analysis-copy-btn").addEventListener("click", async () => {
        await navigator.clipboard.writeText(outputEl.value);
        toast("Disalin ke clipboard!");
    });
}

export async function mountRotate(container) {
    const cfg = await api.get("/api/config").catch(() => ({}));
    container.innerHTML = `
        <div class="main-inner stack-lg">
            <div class="view-header">
                <div>
                    <h1>Batch Auto Portrait</h1>
                    <p class="view-desc">Putar video landscape (-90°) menjadi portrait secara massal (melewati video yang sudah portrait).</p>
                </div>
            </div>

            <form id="rotate-form" class="card stack-md">
                <div class="notice warn">
                    <i class="fas fa-triangle-exclamation"></i>
                    <span>Video landscape di folder ini akan di-render ulang dan menimpa file asli.</span>
                </div>
                <div class="form-group">
                    <label>Folder Sumber Video</label>
                    <input type="text" name="sourceDir" value="${escapeHtml(cfg.source_folder || "sumber_landscape")}" required>
                </div>
                <div class="actions-end">
                    <button type="submit" class="btn-primary">
                        <i class="fas fa-mobile-screen"></i> Mulai Rotasi ke Portrait
                    </button>
                </div>
            </form>
        </div>
    `;

    container.querySelector("#rotate-form").addEventListener("submit", async (e) => {
        e.preventDefault();
        const sourceDir = e.target.sourceDir.value.trim();
        await api.run("/api/run/rotate-portrait", { sourceDir });
        toast("Proses Auto Portrait dimulai.");
    });
}

export async function mountCompress(container) {
    const [cfg, enc] = await Promise.all([
        api.get("/api/config").catch(() => ({})),
        api.get("/api/encoders").catch(() => ({ active: "libx264", selected: "auto", encoders: [] }))
    ]);

    const activeObj = (enc.encoders || []).find((e) => e.id === enc.active);
    const encoderLabel = activeObj ? activeObj.label : enc.active;

    container.innerHTML = `
        <div class="main-inner stack-lg">
            <div class="view-header">
                <div>
                    <h1>Kompres Ukuran Video &amp; Audio</h1>
                    <p class="view-desc">Perkecil ukuran semua file video (.mp4, .mkv, .mov) dan audio (.mp3, .m4a, .wav, .aac, .flac, .ogg) dalam satu folder.</p>
                </div>
            </div>

            <form id="compress-form" class="card stack-md">
                <div class="notice emerald">
                    <i class="fas fa-microchip"></i>
                    <div>
                        <strong>Encoder Video Aktif:</strong> ${escapeHtml(encoderLabel)}
                        <div class="small muted">Mode: ${escapeHtml(enc.selected || "auto")} — Dapat diubah di Pengaturan &rarr; Encoding.</div>
                    </div>
                </div>

                <div class="notice warn">
                    <i class="fas fa-shield-halved"></i>
                    <div>
                        File asli akan ditimpa <strong>hanya jika</strong> ukuran hasil kompresi lebih kecil. Jika ukuran hasil tidak lebih kecil, file asli dipertahankan otomatis.
                    </div>
                </div>

                <div class="form-group">
                    <label>Folder Sumber (Video / Audio)</label>
                    <input type="text" name="sourceDir" value="${escapeHtml(cfg.source_folder || "sumber_mentahan")}" required>
                </div>

                <div class="actions-end">
                    <button type="submit" class="btn-primary">
                        <i class="fas fa-compress-arrows-alt"></i> Mulai Kompres Folder
                    </button>
                </div>
            </form>
        </div>
    `;

    container.querySelector("#compress-form").addEventListener("submit", async (e) => {
        e.preventDefault();
        const sourceDir = e.target.sourceDir.value.trim();
        if (!sourceDir) return;

        const ok = await confirmModal({
            title: "Konfirmasi Kompresi",
            message: `Semua file video & audio di folder "${sourceDir}" akan dikompres dan menimpa file asli jika ukurannya lebih kecil.\n\nLanjutkan?`,
            confirmText: "Ya, Kompres Sekarang",
            danger: true
        });
        if (!ok) return;

        await api.run("/api/run/compress-video", { sourceDir });
        toast("Proses kompresi dimulai.");
    });
}
