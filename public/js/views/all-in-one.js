import { api } from "../api.js";
import { toast, mountPersonaSelector, populateBrandSelect } from "../components.js";

export async function mount(container) {
    const [cfg, personas, brands, addons] = await Promise.all([
        api.get("/api/config").catch(() => ({})),
        api.get("/api/personas").catch(() => []),
        api.get("/api/brands").catch(() => []),
        api.get("/api/addons").catch(() => [])
    ]);

    const mc = cfg.aio_defaults?.multicut || {};
    const mg = cfg.aio_defaults?.merge || {};
    const replizAddon = addons.find((a) => a.id === "repliz" && a.enabled);
    const ttsAddon = addons.find((a) => a.id === "tts-narration" && a.enabled);

    let replizAccounts = [];
    if (replizAddon) {
        replizAccounts = await api.get("/api/addons/repliz/accounts").catch(() => []);
    }

    container.innerHTML = `
        <div class="main-inner stack-lg">
            <div class="view-header">
                <div>
                    <h1>All-in-One Workflow</h1>
                    <p class="view-desc">Alur terpadu dari pemotongan video mentah, penggabungan, musik, hingga AI Hooks &amp; Captions.</p>
                </div>
            </div>

            <form id="aio-form" class="stack-md">
                <div class="card stack-md">
                    <h3>1. Sumber &amp; Hasil Akhir</h3>
                    <div class="form-row">
                        <div class="form-group">
                            <label>Folder Video Mentah</label>
                            <input type="text" name="allInOneSourceDir" value="${cfg.source_folder || "sumber_video"}" required>
                        </div>
                        <div class="form-group">
                            <label>Folder Output Akhir</label>
                            <input type="text" name="finalDir" value="hasil_all_in_one" required>
                        </div>
                    </div>

                    <div class="form-row">
                        <div class="form-group">
                            <label>Maks Klip per Video</label>
                            <input type="number" name="mcMaxClips" min="1" value="${mc.maxClips || 5}" required>
                        </div>
                        <div class="form-group">
                            <label>Durasi Klip (Detik)</label>
                            <input type="number" name="mcClipDuration" step="0.1" min="0.5" value="${mc.clipDuration || 2}" required>
                        </div>
                    </div>

                    <div class="form-row">
                        <div class="form-group">
                            <label>Potong Awal (Opsional)</label>
                            <input type="text" name="mcTrimStart" value="${mc.trimStart || ""}" placeholder="00:00:02">
                        </div>
                        <div class="form-group">
                            <label>Potong Akhir (Opsional)</label>
                            <input type="text" name="mcTrimEnd" value="${mc.trimEnd || ""}" placeholder="00:01:00">
                        </div>
                    </div>
                </div>

                <div class="card stack-md">
                    <h3>2. Pengaturan Penggabungan</h3>
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
                            <label>Durasi Final (Detik)</label>
                            <input type="number" name="finalDurationSec" min="0" value="${mg.finalDurationSec || 17}">
                        </div>
                        <div class="form-group">
                            <label>Urutan Klip</label>
                            <select name="mode">
                                <option value="random" ${mg.mode !== "sequential" ? "selected" : ""}>Random (Acak)</option>
                                <option value="sequential" ${mg.mode === "sequential" ? "selected" : ""}>Sequential (Berurutan)</option>
                            </select>
                        </div>
                    </div>
                </div>

                <div class="card stack-md">
                    <h3>3. Backsound &amp; AI Konten</h3>
                    <label class="toggle-row">
                        <div>
                            <strong>Gunakan Backsound</strong>
                            <div class="muted small">Ganti audio video dengan musik latar.</div>
                        </div>
                        <input type="checkbox" id="aio-useMusic">
                    </label>
                    <div id="aio-music-box" class="form-row card-subtle" style="display:none;">
                        <div class="form-group">
                            <label>Folder Backsound</label>
                            <input type="text" name="musicDir" value="${cfg.backsound_folder || "backsound"}">
                        </div>
                        <div class="form-group">
                            <label>Mode Backsound</label>
                            <select name="musicMode">
                                <option value="random">Acak per Video</option>
                                <option value="fixed">Satu untuk Semua</option>
                            </select>
                        </div>
                    </div>

                    <label class="toggle-row">
                        <div>
                            <strong>Tambahkan AI Hook (Teks Pembuka Video)</strong>
                            <div class="muted small">Generate teks hook otomatis di atas video.</div>
                        </div>
                        <input type="checkbox" id="aio-useHooks">
                    </label>

                    <label class="toggle-row">
                        <div>
                            <strong>Generate AI Captions (captions.json)</strong>
                            <div class="muted small">Simpan caption sosial media ke captions.json di folder output.</div>
                        </div>
                        <input type="checkbox" id="aio-useCaptions">
                    </label>

                    <div id="aio-ai-box" class="stack-md card-subtle" style="display:none;">
                        <div class="form-row">
                            <div class="form-group">
                                <label>Brand (Opsional)</label>
                                <select id="aio-brand-select" name="brandIndex"></select>
                            </div>
                            <div class="form-group">
                                <label>Waktu Tampil Hook</label>
                                <select id="aio-timing-mode" name="aioHookTimingMode">
                                    <option value="full">Sepanjang Video</option>
                                    <option value="custom">Waktu Tertentu (detik_awal,durasi)</option>
                                </select>
                            </div>
                        </div>
                        <div id="aio-timing-custom" class="form-group" style="display:none;">
                            <label>Detik Awal &amp; Durasi (Contoh: 0,5)</label>
                            <input type="text" name="aioHookTiming" value="0,5">
                        </div>
                        <div class="form-group">
                            <label>Konteks / Topik Video</label>
                            <input type="text" id="aio-hook-context" name="hookContext" placeholder="Contoh: Tips produktivitas pagi">
                        </div>
                        <div id="aio-persona-mount"></div>
                    </div>
                </div>

                ${(replizAddon || ttsAddon) ? `
                <div class="card stack-md">
                    <h3>4. Integrasi Addon Aktif</h3>
                    ${ttsAddon ? `
                    <label class="toggle-row">
                        <div>
                            <strong>TikTok TTS &amp; Narasi AI</strong>
                            <div class="muted small">Tambahkan narasi TTS otomatis setelah video digabung.</div>
                        </div>
                        <input type="checkbox" id="aio-addon-tts">
                    </label>
                    ` : ""}
                    ${replizAddon ? `
                    <label class="toggle-row">
                        <div>
                            <strong>Log Spreadsheet (Addon Repliz)</strong>
                            <div class="muted small">Simpan video + caption ke file .txt &amp; webhook spreadsheet.</div>
                        </div>
                        <input type="checkbox" id="aio-addon-sheet">
                    </label>
                    <label class="toggle-row">
                        <div>
                            <strong>Upload Otomatis ke Repliz</strong>
                            <div class="muted small">Jadwalkan upload langsung setelah merge selesai.</div>
                        </div>
                        <input type="checkbox" id="aio-addon-repliz">
                    </label>
                    <div id="aio-repliz-box" class="stack-sm card-subtle" style="display:none;">
                        <div class="form-group">
                            <label>Pilih Akun Repliz</label>
                            <div class="check-grid" id="aio-repliz-accounts">
                                ${replizAccounts.length ? replizAccounts.map((a) => `
                                    <label class="check-chip"><input type="checkbox" value="${a.id}" checked><span>${a.name || a.id}</span></label>
                                `).join("") : `<span class="muted small">Belum ada akun di addon Repliz.</span>`}
                            </div>
                        </div>
                        <div class="form-row">
                            <div class="form-group">
                                <label>Tanggal Upload</label>
                                <input type="date" id="aio-repliz-date" value="${new Date().toISOString().split("T")[0]}">
                            </div>
                            <div class="form-group">
                                <label>Jam Upload</label>
                                <input type="time" id="aio-repliz-time" value="13:00">
                            </div>
                        </div>
                    </div>
                    ` : ""}
                </div>
                ` : ""}

                <div class="actions-end">
                    <button type="submit" class="btn-primary">
                        <i class="fas fa-play"></i> Jalankan All-in-One
                    </button>
                </div>
            </form>
        </div>
    `;

    const personaCtrl = mountPersonaSelector({
        container: container.querySelector("#aio-persona-mount"),
        personas,
        defaultId: "default",
        allowMixed: true
    });

    const brandSel = container.querySelector("#aio-brand-select");
    const ctxInput = container.querySelector("#aio-hook-context");
    populateBrandSelect(brandSel, brands, ctxInput);

    const musicChk = container.querySelector("#aio-useMusic");
    const hookChk = container.querySelector("#aio-useHooks");
    const capChk = container.querySelector("#aio-useCaptions");
    const aiBox = container.querySelector("#aio-ai-box");
    const timingSel = container.querySelector("#aio-timing-mode");
    const timingCustom = container.querySelector("#aio-timing-custom");

    const syncAiVisibility = () => {
        aiBox.style.display = (hookChk.checked || capChk.checked) ? "" : "none";
    };
    musicChk.addEventListener("change", () => {
        container.querySelector("#aio-music-box").style.display = musicChk.checked ? "" : "none";
    });
    hookChk.addEventListener("change", syncAiVisibility);
    capChk.addEventListener("change", syncAiVisibility);
    timingSel.addEventListener("change", () => {
        timingCustom.style.display = timingSel.value === "custom" ? "" : "none";
    });

    const replizChk = container.querySelector("#aio-addon-repliz");
    if (replizChk) {
        replizChk.addEventListener("change", () => {
            container.querySelector("#aio-repliz-box").style.display = replizChk.checked ? "" : "none";
        });
    }

    container.querySelector("#aio-form").addEventListener("submit", async (e) => {
        e.preventDefault();
        const fd = new FormData(e.target);
        const d = Object.fromEntries(fd.entries());
        const pVal = personaCtrl.getValue();

        const finalCount = parseInt(d.finalCount, 10) || 3;
        const mergeSettings = {
            finalCount,
            maxPerSource: parseInt(d.maxPerSource, 10) || 2,
            maxSources: parseInt(d.maxSources, 10) || 0,
            finalDurationSec: parseInt(d.finalDurationSec, 10) || 17,
            mode: d.mode || "random",
            useHook: hookChk.checked,
            useMusic: musicChk.checked
        };

        let hookStartTime = null;
        let hookDuration = null;
        if (d.aioHookTimingMode === "custom" && d.aioHookTiming) {
            const [s, dur] = d.aioHookTiming.split(",").map((v) => parseFloat(v.trim()));
            if (!isNaN(s) && !isNaN(dur) && s >= 0 && dur > 0) {
                hookStartTime = s;
                hookDuration = dur;
            }
        }

        const wantSheet = Boolean(container.querySelector("#aio-addon-sheet")?.checked);
        const wantRepliz = Boolean(replizChk?.checked);
        const wantTts = Boolean(container.querySelector("#aio-addon-tts")?.checked);

        const uploadConfig = {
            mergeSettings,
            musicAns: musicChk.checked ? { folder: d.musicDir || "backsound", mode: d.musicMode || "random" } : null,
            hookContext: d.hookContext || "",
            captionContext: d.hookContext || "",
            brandIndex: d.brandIndex ?? "",
            captionBrandIndex: d.brandIndex ?? "",
            useCaptions: capChk.checked || wantSheet || wantRepliz,
            personaId: pVal.personaId,
            customPersonaPrompt: pVal.customPersonaPrompt,
            hookTimingMode: d.aioHookTimingMode || "full",
            hookStartTime,
            hookDuration,
            addons: {}
        };

        if (wantTts) {
            uploadConfig.addons["tts-narration"] = true;
        }
        if (wantSheet || wantRepliz) {
            const dt = container.querySelector("#aio-repliz-date")?.value || new Date().toISOString().split("T")[0];
            const tm = container.querySelector("#aio-repliz-time")?.value || "13:00";
            const iso = new Date(`${dt}T${tm}:00`).toISOString();
            const selectedIds = Array.from(container.querySelectorAll("#aio-repliz-accounts input:checked")).map((i) => i.value);
            uploadConfig.addons.repliz = {
                upload: wantRepliz,
                spreadsheet: wantSheet,
                selectedReplizAccountIds: selectedIds,
                scheduleTimes: Array.from({ length: finalCount }, () => iso)
            };
        }

        await api.run("/api/run/all-in-one", {
            multicut: {
                sourceDir: d.allInOneSourceDir.trim(),
                clipsDir: "temp_allinone_clips",
                fastMode: false,
                settings: {
                    trimStart: d.mcTrimStart.trim(),
                    trimEnd: d.mcTrimEnd.trim(),
                    maxClips: parseInt(d.mcMaxClips, 10) || 5,
                    clipDuration: parseFloat(d.mcClipDuration) || 2
                }
            },
            merge: {
                sourceDir: "temp_allinone_clips",
                finalDir: d.finalDir.trim(),
                uploadConfig
            }
        });
        toast("Workflow All-in-One dimulai.");
    });
}
