import { api } from "../api.js";
import { toast, escapeHtml } from "../components.js";

export async function mount(container) {
    const cfg = await api.get("/api/config").catch(() => ({}));
    const folders = Array.isArray(cfg.clips_folders) ? cfg.clips_folders : [];
    const mg = cfg.aio_defaults?.merge || {};

    const folderOpts = folders.map((obj) => {
        const [name, p] = Object.entries(obj)[0] || [];
        return p ? `<option value="${escapeHtml(p)}">${escapeHtml(name)} (${escapeHtml(p)})</option>` : "";
    }).join("");

    container.innerHTML = `
        <div class="main-inner stack-lg">
            <div class="view-header">
                <div>
                    <h1>Merge Klip</h1>
                    <p class="view-desc">Gabungkan klip hasil potongan secara acak atau berurutan dengan opsional backsound.</p>
                </div>
            </div>

            <form id="merge-form" class="card stack-md">
                <div class="form-row">
                    <div class="form-group">
                        <label>Folder Klip Sumber</label>
                        <select id="merge-clips-select">
                            <option value="">-- Pilih Folder Klip --</option>
                            ${folderOpts}
                            <option value="manual">Input Path Manual...</option>
                        </select>
                        <input type="text" id="merge-manual-dir" placeholder="Contoh: hasil_potongan" style="display:none; margin-top:6px;">
                    </div>
                    <div class="form-group">
                        <label>Folder Hasil Akhir</label>
                        <input type="text" name="finalDir" value="video_gabungan" required>
                    </div>
                </div>

                <div class="form-row-3">
                    <div class="form-group">
                        <label>Jumlah Video Akhir</label>
                        <input type="number" name="finalCount" min="1" value="${mg.finalCount || 3}" required>
                    </div>
                    <div class="form-group">
                        <label>Maks Klip per Sumber</label>
                        <input type="number" name="maxPerSource" min="1" value="${mg.maxPerSource || 2}" required>
                    </div>
                    <div class="form-group">
                        <label>Maks Sumber (0 = semua)</label>
                        <input type="number" name="maxSources" min="0" value="${mg.maxSources ?? 0}">
                    </div>
                </div>

                <div class="form-row">
                    <div class="form-group">
                        <label>Target Durasi Final (Detik, 0 = penuh)</label>
                        <input type="number" name="finalDurationSec" min="0" value="${mg.finalDurationSec || 17}">
                    </div>
                    <div class="form-group">
                        <label>Urutan Klip</label>
                        <select name="mode">
                            <option value="sequential" ${mg.mode === "sequential" ? "selected" : ""}>Sequential (Berurutan)</option>
                            <option value="random" ${mg.mode !== "sequential" ? "selected" : ""}>Random (Acak)</option>
                        </select>
                    </div>
                </div>

                <label class="toggle-row">
                    <div>
                        <strong>Tambahkan Backsound Audio</strong>
                        <div class="muted small">Ganti suara asli dengan musik dari folder backsound.</div>
                    </div>
                    <input type="checkbox" id="merge-use-music">
                </label>

                <div id="merge-music-box" class="form-row card-subtle" style="display:none;">
                    <div class="form-group">
                        <label>Folder Backsound</label>
                        <input type="text" name="musicDir" value="${cfg.backsound_folder || "backsound"}">
                    </div>
                    <div class="form-group">
                        <label>Mode Pilihan Lagu</label>
                        <select name="musicMode">
                            <option value="random">Acak per Video</option>
                            <option value="fixed">Satu Lagu untuk Semua</option>
                        </select>
                    </div>
                </div>

                <div class="actions-end">
                    <button type="submit" class="btn-primary">
                        <i class="fas fa-film"></i> Mulai Gabung Video
                    </button>
                </div>
            </form>
        </div>
    `;

    const sel = container.querySelector("#merge-clips-select");
    const manualInput = container.querySelector("#merge-manual-dir");
    const musicChk = container.querySelector("#merge-use-music");
    const musicBox = container.querySelector("#merge-music-box");

    if (folders.length === 0) {
        sel.value = "manual";
        manualInput.style.display = "";
        manualInput.required = true;
    }

    sel.addEventListener("change", () => {
        const isManual = sel.value === "manual";
        manualInput.style.display = isManual ? "" : "none";
        manualInput.required = isManual;
    });

    musicChk.addEventListener("change", () => {
        musicBox.style.display = musicChk.checked ? "" : "none";
    });

    container.querySelector("#merge-form").addEventListener("submit", async (e) => {
        e.preventDefault();
        const fd = new FormData(e.target);
        const d = Object.fromEntries(fd.entries());
        const sourceDir = sel.value === "manual" ? manualInput.value.trim() : sel.value;

        if (!sourceDir) {
            toast("Pilih atau isi folder klip sumber terlebih dahulu.", "error");
            return;
        }

        const useMusic = musicChk.checked;
        await api.run("/api/run/merge", {
            sourceDir,
            finalDir: d.finalDir.trim(),
            uploadConfig: {
                mergeSettings: {
                    finalCount: parseInt(d.finalCount, 10) || 3,
                    maxPerSource: parseInt(d.maxPerSource, 10) || 2,
                    maxSources: parseInt(d.maxSources, 10) || 0,
                    finalDurationSec: parseInt(d.finalDurationSec, 10) || 0,
                    mode: d.mode || "random",
                    useHook: false,
                    useMusic
                },
                musicAns: useMusic ? { folder: d.musicDir || "backsound", mode: d.musicMode || "random" } : null,
                hookContext: "",
                brandIndex: ""
            }
        });
        toast("Proses Merge dimulai.");
    });
}
