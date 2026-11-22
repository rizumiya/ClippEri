import { api } from "../api.js";
import { toast, saveClipsFolderToRegistry } from "../components.js";

export async function mount(container) {
    const cfg = await api.get("/api/config").catch(() => ({}));
    const mc = cfg.aio_defaults?.multicut || {};

    container.innerHTML = `
        <div class="main-inner stack-lg">
            <div class="view-header">
                <div>
                    <h1>Multi-File Cutter</h1>
                    <p class="view-desc">Potong seluruh video mentah di satu folder menjadi klip-klip pendek siap gabung.</p>
                </div>
            </div>

            <form id="multicut-form" class="card stack-md">
                <div class="form-row">
                    <div class="form-group">
                        <label>Folder Video Sumber</label>
                        <input type="text" name="sourceDir" value="${cfg.source_folder || "sumber_video"}" required>
                    </div>
                    <div class="form-group">
                        <label>Folder Output Klip</label>
                        <input type="text" name="clipsDir" value="hasil_potongan" required>
                    </div>
                </div>

                <div class="form-row">
                    <div class="form-group">
                        <label>Potong Mulai (Opsional, HH:MM:SS)</label>
                        <input type="text" name="trimStart" value="${mc.trimStart ?? cfg.trim_start ?? ""}" placeholder="Contoh: 00:00:02">
                    </div>
                    <div class="form-group">
                        <label>Potong Akhir (Opsional, HH:MM:SS)</label>
                        <input type="text" name="trimEnd" value="${mc.trimEnd ?? cfg.trim_end ?? ""}" placeholder="Contoh: 00:01:00">
                    </div>
                </div>

                <div class="form-row">
                    <div class="form-group">
                        <label>Maksimal Klip per Video</label>
                        <input type="number" name="maxClips" min="1" value="${mc.maxClips || cfg.max_clips || 5}" required>
                    </div>
                    <div class="form-group">
                        <label>Durasi per Klip (Detik)</label>
                        <input type="number" name="clipDuration" step="0.1" min="0.5" value="${mc.clipDuration || cfg.clip_duration || 2.5}" required>
                    </div>
                </div>

                <label class="toggle-row">
                    <div>
                        <strong>Fast Mode (Stream Copy)</strong>
                        <div class="muted small">Pemotongan instan tanpa re-encode (posisi potong mengikuti keyframe).</div>
                    </div>
                    <input type="checkbox" name="fastMode">
                </label>

                <div class="actions-end">
                    <button type="submit" class="btn-primary">
                        <i class="fas fa-scissors"></i> Mulai Potong Video
                    </button>
                </div>
            </form>
        </div>
    `;

    container.querySelector("#multicut-form").addEventListener("submit", async (e) => {
        e.preventDefault();
        const fd = new FormData(e.target);
        const d = Object.fromEntries(fd.entries());
        const fastMode = Boolean(e.target.querySelector('[name="fastMode"]').checked);

        if (d.clipsDir) await saveClipsFolderToRegistry(d.clipsDir);

        await api.run("/api/run/multicut", {
            sourceDir: d.sourceDir.trim(),
            clipsDir: d.clipsDir.trim(),
            fastMode,
            settings: {
                trimStart: d.trimStart.trim(),
                trimEnd: d.trimEnd.trim(),
                maxClips: parseInt(d.maxClips, 10) || 5,
                clipDuration: parseFloat(d.clipDuration) || 2.5
            }
        });
        toast("Proses Multi-Cut dimulai.");
    });
}
