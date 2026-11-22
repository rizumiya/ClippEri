import { api } from "../api.js";
import { toast, mountPersonaSelector, populateBrandSelect } from "../components.js";

export async function mount(container) {
    const [cfg, personas, brands] = await Promise.all([
        api.get("/api/config").catch(() => ({})),
        api.get("/api/personas").catch(() => []),
        api.get("/api/brands").catch(() => [])
    ]);

    container.innerHTML = `
        <div class="main-inner stack-lg">
            <div class="view-header">
                <div>
                    <h1>AI Hooks Generator</h1>
                    <p class="view-desc">Generate kalimat hook pembuka &amp; caption sosial media dengan Persona AI yang dapat dikustomisasi.</p>
                </div>
            </div>

            <form id="hooks-form" class="card stack-md">
                <div class="form-row">
                    <div class="form-group">
                        <label>Folder Video Sumber</label>
                        <input type="text" name="sourceDir" value="${cfg.source_folder || "sumber_video"}" required>
                    </div>
                    <div class="form-group">
                        <label>Folder Output</label>
                        <input type="text" name="finalDir" value="video_with_hooks" required>
                    </div>
                </div>

                <div class="form-row">
                    <div class="form-group">
                        <label>Pilih Brand (Opsional)</label>
                        <select id="hooks-brand-select" name="brandIndex"></select>
                    </div>
                    <div class="form-group">
                        <label>Waktu Tampil Hook</label>
                        <select id="hooks-timing-mode" name="hookTimingMode">
                            <option value="full">Sepanjang Video (Awal - Akhir)</option>
                            <option value="custom">Waktu Tertentu (Detik Awal, Durasi)</option>
                        </select>
                    </div>
                </div>

                <div id="hooks-timing-custom" class="form-group" style="display:none;">
                    <label>Format: detik_awal,durasi (contoh: 0,5)</label>
                    <input type="text" name="hookTiming" value="0,5">
                </div>

                <div class="form-group">
                    <label>Konteks / Topik Video</label>
                    <input type="text" id="hooks-context" name="context" placeholder="Contoh: Review kopi lokal, tips menabung, dll">
                </div>

                <div id="hooks-persona-mount"></div>

                <label class="toggle-row">
                    <div>
                        <strong>Sekaligus Generate Captions (captions.json)</strong>
                        <div class="muted small">Buat pasangan caption panjang untuk setiap video di folder output.</div>
                    </div>
                    <input type="checkbox" id="hooks-use-captions">
                </label>

                <div class="actions-end">
                    <button type="submit" class="btn-primary">
                        <i class="fas fa-wand-magic-sparkles"></i> Generate Hooks ke Video
                    </button>
                </div>
            </form>
        </div>
    `;

    const personaCtrl = mountPersonaSelector({
        container: container.querySelector("#hooks-persona-mount"),
        personas,
        defaultId: "default",
        allowMixed: true
    });

    const brandSel = container.querySelector("#hooks-brand-select");
    const ctxInput = container.querySelector("#hooks-context");
    populateBrandSelect(brandSel, brands, ctxInput);

    const timingModeSel = container.querySelector("#hooks-timing-mode");
    const timingCustomBox = container.querySelector("#hooks-timing-custom");
    timingModeSel.addEventListener("change", () => {
        timingCustomBox.style.display = timingModeSel.value === "custom" ? "" : "none";
    });

    container.querySelector("#hooks-form").addEventListener("submit", async (e) => {
        e.preventDefault();
        const fd = new FormData(e.target);
        const d = Object.fromEntries(fd.entries());
        const pVal = personaCtrl.getValue();

        let hookStartTime = null;
        let hookDuration = null;
        if (d.hookTimingMode === "custom" && d.hookTiming) {
            const [s, dur] = d.hookTiming.split(",").map((v) => parseFloat(v.trim()));
            hookStartTime = s;
            hookDuration = dur;
        }

        await api.run("/api/run/hooks", {
            sourceDir: d.sourceDir.trim(),
            finalDir: d.finalDir.trim(),
            context: d.context || "",
            brandIndex: d.brandIndex ?? "",
            useCaptions: container.querySelector("#hooks-use-captions").checked,
            personaId: pVal.personaId,
            customPersonaPrompt: pVal.customPersonaPrompt,
            hookTimingMode: d.hookTimingMode || "full",
            hookStartTime,
            hookDuration
        });
        toast("Proses AI Hooks dimulai.");
    });
}
