const path = require("path");
const fs = require("fs/promises");
const chalk = require("chalk");
const inquirer = require("inquirer");
const { runCommand, getToolCommand, ensureDirectoryExists } = require("../utils/shell");
const { runEncode } = require("../utils/encoder");
const { applyHookToFinalVideo } = require("../utils/ffmpeg");
const { generateHooks, generateCaptions, extractStoryFacts } = require("./ai_hook");
const { getPersonas, resolvePersona } = require("./personas");
const { runHooks } = require("./hooks");
const config = require("../config");

const { getSettings } = require("../utils/settings_manager");

function buildPersonaPlan(count, personaKey = "default", customPrompt = "", fallbackMode = "standard") {
    const total = Math.max(0, parseInt(count, 10) || 0);
    if (customPrompt && String(customPrompt).trim() !== "") {
        const custom = resolvePersona({ customPrompt });
        return Array.from({ length: total }, () => custom);
    }

    const key = String(personaKey || "default").trim().toLowerCase();
    if (key === "mixed" || key === "cycle") {
        const all = getPersonas();
        const pool = all.length > 0 ? all : [resolvePersona({ personaId: "default" })];
        return Array.from({ length: total }, (_, i) => pool[i % pool.length]);
    }

    if (key === "current" && fallbackMode && fallbackMode !== "standard") {
        const mappedId = fallbackMode === "edukasi_bisnis" ? "business" : (fallbackMode === "story" ? "atomic" : "default");
        const p = resolvePersona({ personaId: mappedId });
        return Array.from({ length: total }, () => p);
    }

    const chosen = resolvePersona({ personaId: personaKey || "default" });
    return Array.from({ length: total }, () => chosen);
}

async function generateHooksByPersonaPlan({
    apiKey,
    context,
    count,
    brandName = "",
    brandContentHooks = "",
    personaKey = "default",
    customPrompt = "",
    fallbackCaptionMode = "standard",
    storySummary = ""
}) {
    const plan = buildPersonaPlan(count, personaKey, customPrompt, fallbackCaptionMode);
    const buckets = new Map();
    plan.forEach((persona, idx) => {
        if (!buckets.has(persona.id)) {
            buckets.set(persona.id, { persona, idxs: [] });
        }
        buckets.get(persona.id).idxs.push(idx);
    });

    const out = Array(plan.length).fill("");
    for (const { persona, idxs } of buckets.values()) {
        if (!idxs.length) continue;
        const generated = await generateHooks(apiKey, context, idxs.length, brandName, brandContentHooks, persona, storySummary);
        idxs.forEach((targetIdx, i) => { out[targetIdx] = generated[i] || ""; });
    }
    return out;
}

async function generateCaptionsByPersonaPlan({
    apiKey,
    context,
    count,
    brandName = "",
    brandContentHooks = "",
    brandCaptionRule = "",
    personaKey = "default",
    customPrompt = "",
    fallbackCaptionMode = "standard",
    storySourceContent = "",
    hooksArray = []
}) {
    const plan = buildPersonaPlan(count, personaKey, customPrompt, fallbackCaptionMode);
    const buckets = new Map();
    plan.forEach((persona, idx) => {
        if (!buckets.has(persona.id)) {
            buckets.set(persona.id, { persona, idxs: [] });
        }
        buckets.get(persona.id).idxs.push(idx);
    });

    const out = Array(plan.length).fill("");
    for (const { persona, idxs } of buckets.values()) {
        if (!idxs.length) continue;
        const hooksSubset = idxs.map(idx => hooksArray[idx] || "");
        const generated = await generateCaptions(
            apiKey,
            context,
            idxs.length,
            brandName,
            undefined,
            "Akun Bisnis/Brand",
            brandContentHooks,
            brandCaptionRule,
            persona,
            storySourceContent,
            hooksSubset
        );
        idxs.forEach((targetIdx, i) => { out[targetIdx] = generated[i] || ""; });
    }
    return out;
}

function refreshConfig() {
    const s = getSettings();
    config.batch.maxClips = s.max_clips || config.batch.maxClips;
    config.batch.clipDuration = s.clip_duration || config.batch.clipDuration;
    config.batch.trimStart = s.trim_start || config.batch.trimStart;
    config.batch.trimEnd = s.trim_end || config.batch.trimEnd;
    config.paths.sourceDir = s.source_folder || config.paths.sourceDir;
    config.paths.audioDir = s.backsound_folder || config.paths.audioDir;
    config.brands = s.brands || config.brands;
    if (s.gemini_api_key) {
        const raw = s.gemini_api_key;
        let keys = [];
        if (Array.isArray(raw)) {
            keys = raw.map(k => String(k).trim()).filter(Boolean);
        } else {
            keys = String(raw).split("\n").map(k => k.trim()).filter(Boolean);
        }
        if (keys.length > 0) {
            config.ai.apiKey = keys[0];
            config.ai.apiKeys = keys;
        }
    }
}

// --- HELPER UNTUK MULTI-CUT ---
async function processMultiCut(videoFiles, sourceDir, clipsDir, generalSettings = null, fastMode = false) {
    await ensureDirectoryExists(clipsDir);
    const videoSettings = [];
    for (let i = 0; i < videoFiles.length; i++) {
        const file = videoFiles[i];
        let settings;

        if (generalSettings) {
            settings = { ...generalSettings };
            console.log(chalk.gray(`[Auto] Menggunakan pengaturan untuk: ${file}`));
        } else {
            console.log(chalk.magenta.bold(`\n--- Pengaturan Video ${i + 1}/${videoFiles.length}: ${file} ---`));
            settings = await inquirer.prompt([
                { type: "input", name: "trimStart", message: `(Opsional) Waktu mulai:`, default: config.batch.trimStart },
                { type: "input", name: "trimEnd", message: `(Opsional) Waktu selesai:`, default: config.batch.trimEnd },
                { type: "number", name: "maxClips", message: `Maksimal klip?`, default: config.batch.maxClips },
                { type: "input", name: "clipDuration", message: `Durasi per klip (detik)?`, default: config.batch.clipDuration },
            ]);
        }
        videoSettings.push({ ...settings, fileName: file, sourceIndex: i + 1 });
    }

    console.log(chalk.cyan.bold(`\n--- ✂️  Memulai Pemotongan ${fastMode ? "(⚡ Fast Mode)" : "(🐢 Standard Mode)"} ---`));

    for (const setting of videoSettings) {
        const sourcePath = path.join(sourceDir, setting.fileName);
        let currentInput = sourcePath;
        let videoDuration = 0;

        // Settings for standardization
        const { width, height, fps } = config.video.standardization;
        // Fix: Ensure even dimensions after scaling to prevent "pad" errors
        // Fix Color Shift: Re-map color matrix to prevent DSLR videos from looking reddish
        const filter = `scale=${width}:${height}:force_original_aspect_ratio=decrease,scale=trunc(iw/2)*2:trunc(ih/2)*2,pad=${width}:${height}:(ow-iw)/2:(oh-ih)/2,setsar=1,colormatrix=bt601:bt709`;

        try {
            const out = await runCommand(`ffprobe -v quiet -show_entries format=duration -of csv=p=0 "${sourcePath}"`);
            videoDuration = parseFloat(out.trim());
            if (isNaN(videoDuration)) videoDuration = 0;
        } catch (e) { }

        if (setting.trimStart || setting.trimEnd) {
            const tempTrim = path.join(clipsDir, `temp_trim_${setting.sourceIndex}.mp4`);
            let ssTo = "";
            if (setting.trimStart) ssTo += `-ss ${setting.trimStart} `;
            if (setting.trimEnd) ssTo += `-to ${setting.trimEnd} `;

            if (fastMode) {
                await runCommand(`ffmpeg -y -i "${sourcePath}" ${ssTo}-c copy "${tempTrim}"`);
            } else {
                await runEncode(
                    (encArgs) => `ffmpeg -y -i "${sourcePath}" ${ssTo}-vf "${filter}" -r ${fps} ${encArgs} -c:a aac -b:a 128k -ar 44100 "${tempTrim}"`,
                    { quality: 23, preset: "ultrafast" }
                );
            }
            currentInput = tempTrim;

            // Recalculate duration of trimmed video
            const outTrim = await runCommand(`ffprobe -v quiet -show_entries format=duration -of csv=p=0 "${tempTrim}"`);
            videoDuration = parseFloat(outTrim.trim());
            if (isNaN(videoDuration)) videoDuration = 0;
        }

        const clipDur = parseFloat(setting.clipDuration) || 2.5;
        const maxClips = parseInt(setting.maxClips) || 5;

        // Hitung actualMax berdasarkan durasi video
        const possibleClips = videoDuration > 0 ? Math.floor(videoDuration / clipDur) : maxClips;
        const actualMax = Math.min(maxClips, possibleClips);

        console.log(chalk.gray(`   > Durasi Video: ${videoDuration.toFixed(2)}s | Target Klip: ${maxClips} | Bisa dipotong: ${possibleClips} | Akan dibuat: ${actualMax}`));

        for (let i = 0; i < actualMax; i++) {
            const start = i * clipDur;
            const outName = `video_${setting.sourceIndex}_${i + 1}.mp4`;
            const outPath = path.join(clipsDir, outName);

            if (fastMode) {
                await runCommand(`ffmpeg -y -ss ${start} -t ${clipDur} -i "${currentInput}" -c copy -avoid_negative_ts make_zero "${outPath}" -loglevel error`);
            } else {
                await runEncode(
                    (encArgs) => `ffmpeg -y -ss ${start} -t ${clipDur} -i "${currentInput}" -vf "${filter}" -r ${fps} ${encArgs} -c:a aac -avoid_negative_ts make_zero "${outPath}"`,
                    { quality: 23, preset: "fast" }
                );
            }
        }
        if (currentInput.includes("temp_trim")) await fs.unlink(currentInput).catch(() => { });
    }
}

// --- CORE LOGIC: MULTI-FILE CUT AND MERGE ---


// --- SHARED MERGE LOGIC ---
async function performMergeLogic(sourceDir, finalDir, uploadConfig = null) {
    await ensureDirectoryExists(finalDir);
    const allFiles = await fs.readdir(sourceDir);
    const clips = allFiles.filter(f => f.endsWith(".mp4"));
    if (clips.length === 0) return console.log(chalk.red("Tidak ada klip."));

    const { getAudioFiles, getRandomAudio } = require("../utils/audio");

    // Jika uploadConfig sudah ada (dari collectUploadConfig), gunakan itu.
    // Jika tidak, minta input manual seperti biasa.
    let mergeSettings;
    if (uploadConfig && uploadConfig.mergeSettings) {
        // Gunakan settings yang sudah dikumpulkan di awal
        mergeSettings = uploadConfig.mergeSettings;
    } else {
        // Fallback: minta input manual (untuk backward compatibility)
        mergeSettings = await inquirer.prompt([
            { type: "number", name: "finalCount", message: "Total final video?", default: 3 },
            { type: "number", name: "maxPerSource", message: "Maks klip per sumber?", default: 2 },
            { type: "number", name: "maxSources", message: "Maks sumber video per video akhir (0 = semua)?", default: 0 },
            { type: "number", name: "finalDurationSec", message: "Target durasi final per video (detik)?", default: 17 },
            { type: "list", name: "mode", message: "Mode?", choices: [{ name: "Sequential", value: "sequential" }, { name: "Random", value: "random" }], default: "sequential" },
            { type: "confirm", name: "useHook", message: "Tambah AI Hook?", default: false },
            { type: "confirm", name: "useMusic", message: "Gunakan Backsound?", default: false }
        ]);
    }
    const { finalCount, maxPerSource, maxSources = 0, finalDurationSec = 17, mode, useHook, useMusic } = mergeSettings;

    let musicFolder = "";
    let musicFiles = [];
    let musicMode = "";
    let fixedMusic = null;

    if (useMusic) {
        let musicAns;
        if (uploadConfig) {
            musicAns = uploadConfig.musicAns;
        } else {
            musicAns = await inquirer.prompt([
                { type: "input", name: "folder", message: "Folder Backsound:", default: config.paths.audioDir },
                { type: "list", name: "mode", message: "Mode Backsound:", choices: [{ name: "1. Acak per Video", value: "random" }, { name: "2. Satu untuk Semua", value: "fixed" }] }
            ]);
        }
        musicFolder = musicAns.folder;
        musicMode = musicAns.mode;
        musicFiles = await getAudioFiles(musicFolder);

        if (musicFiles.length === 0) {
            console.log(chalk.red("❌ Tidak ditemukan file audio di folder tersebut. Fitur audio dibatalkan."));
        } else if (musicMode === "fixed") {
            fixedMusic = getRandomAudio(musicFiles);
            console.log(chalk.cyan(`🎵 Musik terpilih untuk semua: ${path.basename(fixedMusic)}`));
        }
    }

    // ── Pre-extract Stories if in Story Mode ────────────────────
    let stories = [];
    const captionMode = uploadConfig ? (uploadConfig.captionMode || 'standard') : 'standard';
    const personaKey = uploadConfig?.personaId || uploadConfig?.systemPersona || "default";
    const customPersonaPrompt = uploadConfig?.customPersonaPrompt || "";
    const activePlan = buildPersonaPlan(finalCount, personaKey, customPersonaPrompt, captionMode);
    const needsStory = captionMode === 'story' || activePlan.some(p => p.mode === 'story');

    if (needsStory && uploadConfig && uploadConfig.storySourceContent) {
        refreshConfig();
        const geminiKeys = (config.ai.apiKeys && config.ai.apiKeys.length > 0)
            ? config.ai.apiKeys
            : [config.ai.apiKey || process.env.GEMINI_API_KEY].filter(Boolean);

        console.log(chalk.cyan(`\n📖 Mengambil ${finalCount} potongan cerita unik untuk sinkronisasi Hook & Caption...`));
        try {
            stories = await extractStoryFacts(geminiKeys, uploadConfig.storySourceContent, finalCount);
        } catch (e) {
            console.log(chalk.yellow(`⚠️ Gagal ekstrak potongan cerita: ${e.message}. Menggunakan default.`));
        }
    }

    let hooks = [];
    if (useHook) {
        // Refresh config to pick up latest API keys saved via Settings UI
        refreshConfig();
        // Use full apiKeys array for multi-key fallback
        const geminiKeys = (config.ai.apiKeys && config.ai.apiKeys.length > 0)
            ? config.ai.apiKeys
            : [config.ai.apiKey || process.env.GEMINI_API_KEY].filter(Boolean);
        let hookContext;
        if (uploadConfig) {
            hookContext = uploadConfig.hookContext;
        } else {
            const ans = await inquirer.prompt([
                { type: "input", name: "context", message: "Konteks Video:" }
            ]);
            hookContext = ans.context;
        }

        // Extract Brand Info for Hooks
        let brandName = "";
        let brandContentHooks = "";
        if (uploadConfig && uploadConfig.brandIndex !== "" && uploadConfig.brandIndex !== undefined && config.brands[uploadConfig.brandIndex]) {
            const b = config.brands[uploadConfig.brandIndex];
            brandName = b.name;
            brandContentHooks = b.hooks || "";
        }

        // Pass stories array to generateHooks for alignment
        hooks = await generateHooksByPersonaPlan({
            apiKey: geminiKeys,
            context: hookContext,
            count: finalCount,
            brandName,
            brandContentHooks,
            personaKey,
            customPrompt: customPersonaPrompt,
            fallbackCaptionMode: captionMode,
            storySummary: stories.length > 0 ? stories : ''
        });

    }

    // Grouping
    const clipsBySource = {};
    clips.forEach(clip => {
        const match = clip.match(/^video_([a-zA-Z0-9]+)_/);
        const src = match ? match[1] : "misc";
        if (!clipsBySource[src]) clipsBySource[src] = [];
        clipsBySource[src].push(clip);
    });

    let finalVideos = [];

    for (let i = 1; i <= finalCount; i++) {
        console.log(chalk.magenta.bold(`\n--- Video Gabungan #${i}/${finalCount} ---`));
        const selection = [];
        const tempGroup = JSON.parse(JSON.stringify(clipsBySource));
        let keys = Object.keys(tempGroup).sort();
        // let keys = Object.keys(tempGroup).sort(); // Duplicate removed
        if (mode === "random") keys.sort(() => Math.random() - 0.5);

        // --- Fitur Max Sources ---
        // Jika maxSources diisi (>0), kita batasi jumlah sumber yang dipakai untuk video ini.
        // Karena keys sudah di-sort (acak atau urut), kita tinggal slice.
        if (maxSources > 0 && keys.length > maxSources) {
            keys = keys.slice(0, maxSources);
        }
        // -------------------------

        for (const k of keys) {
            let count = 0;
            while (tempGroup[k].length > 0 && count < maxPerSource) {
                const idx = Math.floor(Math.random() * tempGroup[k].length);
                selection.push(path.join(sourceDir, tempGroup[k].splice(idx, 1)[0]));
                count++;
            }
        }

        if (selection.length > 0) {
            const outPath = path.join(finalDir, `final_${i}_${Date.now().toString().slice(-4)}.mp4`);

            // --- REPLACE MP4BOX WITH FFMPEG CONCAT ---
            const concatListPath = path.join(finalDir, `concat_list_${i}.txt`);
            // FFmpeg concat expects: file 'path/to/file'
            // Fix 2: Use ABSOLUTE PATHS to avoid any ambiguity.
            // FFmpeg requires forward slashes even on Windows for the concat demuxer if using absolute paths with confusing drive letters, 
            // but standard forward slashes usually work best.
            const concatContent = selection.map(p => {
                const absPath = path.resolve(p);
                return `file '${absPath.replace(/\\/g, '/')}'`;
            }).join('\n');
            await fs.writeFile(concatListPath, concatContent);

            const tempMerged = path.join(finalDir, `temp_merged_${i}.mp4`);

            // Gunakan stream copy karena semua video sudah distandarisasi
            await runCommand(`ffmpeg -y -f concat -safe 0 -i "${concatListPath}" -c copy "${tempMerged}"`);
            await fs.unlink(concatListPath);
            // -----------------------------------------

            const selectedMusic = (useMusic && musicFiles.length > 0)
                ? (musicMode === "fixed" ? fixedMusic : getRandomAudio(musicFiles))
                : null;

            if (selectedMusic) console.log(chalk.cyan(`🎵 Menambahkan musik: ${path.basename(selectedMusic)}`));

            try {
                if ((useHook && hooks[i - 1]) || selectedMusic) {
                    const hookText = hooks[i - 1] || "";
                    // Extract hook timing from uploadConfig
                    const hookTimingMode = uploadConfig?.hookTimingMode || 'full';
                    const hookStartTime = uploadConfig?.hookStartTime;
                    const hookDuration = uploadConfig?.hookDuration;
                    await applyHookToFinalVideo(tempMerged, hookText, outPath, selectedMusic, hookTimingMode === 'custom' ? hookStartTime : null, hookTimingMode === 'custom' ? hookDuration : null);
                } else {
                    await fs.rename(tempMerged, outPath);
                }

                if (finalDurationSec > 0 && !(uploadConfig && uploadConfig.useSubtitles)) {
                    const trimmedOutPath = path.join(finalDir, `trimmed_${i}_${Date.now().toString().slice(-4)}.mp4`);
                    await runCommand(`ffmpeg -y -i "${outPath}" -t ${finalDurationSec} -c copy "${trimmedOutPath}"`);
                    await fs.unlink(outPath).catch(() => { });
                    await fs.rename(trimmedOutPath, outPath);
                }

                // Cleanup temp if it still exists (if rename happened it's gone, if applyHook happen it reads then we delete)
                try { await fs.unlink(tempMerged); } catch (e) { }

                console.log(chalk.green(`✅ Berhasil: ${path.basename(outPath)}`));
                finalVideos.push(outPath);
            } catch (e) {
                console.log(chalk.red(`❌ Gagal proses video akhir: ${e.message}`));
            }

        }
    }

    let aiCaptions = [];

    // --- AI CAPTIONS GENERATION ---
    if (uploadConfig && uploadConfig.useCaptions) {
        const capContext = uploadConfig.captionContext || uploadConfig.hookContext;

        let brandName = "";
        let brandContentHooks = "";
        let brandCaptionRule = "";
        const captionMode = uploadConfig.captionMode || 'standard';
        const storySourceContent = uploadConfig.storySourceContent || '';

        const targetBrandIndex = (uploadConfig.captionBrandIndex !== "" && uploadConfig.captionBrandIndex !== undefined)
            ? uploadConfig.captionBrandIndex
            : uploadConfig.brandIndex;

        if (targetBrandIndex !== "" && targetBrandIndex !== undefined && config.brands[targetBrandIndex]) {
            const b = config.brands[targetBrandIndex];
            brandName = b.name;
            brandContentHooks = b.hooks || "";
            brandCaptionRule = b.captionRule || "";
        }

        if (capContext || brandName) {
            console.log(chalk.cyan(`\n🤖 Menyiapkan AI Captions (Mode: ${captionMode}) untuk ${finalVideos.length} video...`));
            const geminiKeys = (config.ai.apiKeys && config.ai.apiKeys.length > 0)
                ? config.ai.apiKeys
                : [config.ai.apiKey || process.env.GEMINI_API_KEY].filter(Boolean);

            const storyInput = stories.length > 0 ? stories : storySourceContent;

            aiCaptions = await generateCaptionsByPersonaPlan({
                apiKey: geminiKeys,
                context: capContext,
                count: finalVideos.length,
                brandName,
                brandContentHooks,
                brandCaptionRule,
                personaKey,
                customPrompt: customPersonaPrompt,
                fallbackCaptionMode: captionMode,
                storySourceContent: storyInput,
                hooksArray: hooks
            });

            // Save to captions.json mapping output file name to caption
            const { wrapText } = require("../utils/ffmpeg");
            const captionsMap = {};
            for (let i = 0; i < finalVideos.length; i++) {
                captionsMap[path.basename(finalVideos[i])] = {
                    caption: aiCaptions[i] || "Generated by ClippEri",
                    hook_raw: hooks[i] || "",
                    hook_lines: wrapText(hooks[i] || "", config.styles.wrapLimit).split('\n')
                };
            }
            try {
                await fs.writeFile(path.join(finalDir, "captions.json"), JSON.stringify(captionsMap, null, 2));
                console.log(chalk.green(`   📝 Captions disimpan ke: ${path.join(finalDir, "captions.json")}`));
            } catch (e) {
                console.log(chalk.yellow(`   ⚠️ Gagal menyimpan captions.json: ${e.message}`));
            }
        }
    }

    await runHooks("afterMergeMedia", { finalVideos, finalDir, hooks, captions: aiCaptions, uploadConfig });
    await runHooks("afterMerge", { finalVideos, finalDir, hooks, captions: aiCaptions, uploadConfig });
}

/**
 * Helper untuk parsing jam + tanggal menjadi Date object.
 * @param {string} timeStr  - Format 'HH:MM' atau 'HH.MM'
 * @param {string} [dateStr] - Format 'YYYY-MM-DD'. Jika kosong, gunakan hari ini.
 */
function parseTime(timeStr, dateStr = null) {
    const parts = timeStr.replace('.', ':').split(':');
    const h = parseInt(parts[0]);
    const m = parseInt(parts[1] || 0);

    let base;
    if (dateStr) {
        base = new Date(`${dateStr}T00:00:00`);
    } else {
        base = new Date();
        base.setHours(0, 0, 0, 0); // midnight today
    }
    base.setHours(h, m, 0, 0);
    if (isNaN(base.getTime())) return null;
    return base;
}

/**
 * Helper untuk mengumpulkan konfigurasi upload & penjadwalan di awal.
 * Digunakan oleh multiFileCutAndMerge dan mergeOnly agar alurnya seragam.
 */
async function collectUploadConfig() {
    console.log(chalk.magenta.bold("\n--- Pengaturan Gabung ---"));
    const mergeSettings = await inquirer.prompt([
        { type: "number", name: "finalCount", message: "Berapa banyak video akhir yang ingin dihasilkan?", default: 3 },
        { type: "number", name: "maxPerSource", message: "Maks klip per sumber video dalam 1 hasil akhir?", default: 2 },
        { type: "number", name: "maxSources", message: "Maks sumber video yang dipakai (0 = semua)?", default: 0 },
        { type: "list", name: "mode", message: "Mode urutan klip?", choices: [{ name: "Sequential (Berurutan)", value: "sequential" }, { name: "Random (Acak)", value: "random" }], default: "sequential" },
        { type: "confirm", name: "useHook", message: "Gunakan AI Hook (Caption)?", default: false },
        { type: "confirm", name: "useMusic", message: "Gunakan Backsound?", default: false }
    ]);

    let musicAns = null;
    if (mergeSettings.useMusic) {
        musicAns = await inquirer.prompt([
            { type: "input", name: "folder", message: "Folder Backsound:", default: config.paths.audioDir },
            { type: "list", name: "mode", message: "Mode Backsound:", choices: [{ name: "1. Acak per Video", value: "random" }, { name: "2. Satu untuk Semua", value: "fixed" }] }
        ]);
    }

    let hookContext = "";
    if (mergeSettings.useHook) {
        const { context } = await inquirer.prompt([{ type: "input", name: "context", message: "Konteks Video (untuk AI):" }]);
        hookContext = context;
    }

    return { mergeSettings, musicAns, hookContext };
}


// --- HELPER: STANDARDIZE VIDEO ---
async function standardizeVideo(inputPath, outputPath) {
    const { width, height, fps } = config.video.standardization;
    const filter = `scale=${width}:${height}:force_original_aspect_ratio=decrease,scale=trunc(iw/2)*2:trunc(ih/2)*2,pad=${width}:${height}:(ow-iw)/2:(oh-ih)/2,setsar=1,colormatrix=bt601:bt709`;

    try {
        await runEncode(
            (encArgs) => `ffmpeg -y -i "${inputPath}" -vf "${filter}" -r ${fps} ${encArgs} -c:a aac -ar 44100 -ac 2 "${outputPath}"`,
            { quality: 26, preset: "fast" }
        );
    } catch (e) {
        throw new Error(`Gagal standarisasi video ${path.basename(inputPath)}: ${e.message}`);
    }
}

// --- CORE LOGIC: MIX EXTERNAL CLIPS ---
async function mixExternalClips() {
    refreshConfig();
    console.log(chalk.magenta.bold("\n--- Mix Clip Internal + External ---"));

    const { internalDir, externalDir } = await inquirer.prompt([
        { type: "input", name: "internalDir", message: "Folder Clip Internal (Opsional, Enter jika tidak ada):" },
        { type: "input", name: "externalDir", message: "Folder Clip External (Wajib):", validate: input => input ? true : "Folder external wajib diisi!" }
    ]);

    const stagingDir = "staging_mix";
    await ensureDirectoryExists(stagingDir);
    // Bersihkan staging dir
    const oldFiles = await fs.readdir(stagingDir);
    for (const f of oldFiles) await fs.unlink(path.join(stagingDir, f));

    let fileCount = 0;

    // 1. Copy Internal Clips (Assuming they are already somewhat standard, but better to standardize if we want to be safe. 
    // However, re-encoding everything might be slow. 
    // If internal clips came from THIS tool, they might vary in resolution if source varied.
    // Let's standardize eveything to be safe as per plan.)
    if (internalDir && (await fs.stat(internalDir).catch(() => false))) {
        const iFiles = await fs.readdir(internalDir);
        const iClips = iFiles.filter(f => f.endsWith(".mp4"));

        console.log(chalk.cyan(`   ⏳ Memproses internal clips (Standarisasi)...`));
        for (const f of iClips) {
            const sourcePath = path.join(internalDir, f);
            const destPath = path.join(stagingDir, f);
            try {
                process.stdout.write(chalk.gray(`      > ${f} ... `));
                await standardizeVideo(sourcePath, destPath);
                console.log(chalk.green("OK"));
                fileCount++;
            } catch (e) {
                console.log(chalk.red(`FAIL (${e.message})`));
            }
        }
    }

    // 2. Copy External Clips
    if (await fs.stat(externalDir).catch(() => false)) {
        const eFiles = await fs.readdir(externalDir);
        const eClips = eFiles.filter(f => f.endsWith(".mp4") || f.endsWith(".mkv") || f.endsWith(".mov"));

        if (eClips.length > 0) {
            const { extStrategy } = await inquirer.prompt([
                {
                    type: "list",
                    name: "extStrategy",
                    message: "Bagaimana perlakukan clip external?",
                    choices: [
                        { name: "1. Gabung sebagai 1 Grup Sumber (video_EXT_x)", value: "group" },
                        { name: "2. Anggap setiap video sebagai Sumber Unik (video_EXT1_x, video_EXT2_x...)", value: "unique" }
                    ]
                }
            ]);

            console.log(chalk.cyan(`   ⏳ Memproses external clips (Standarisasi)...`));
            for (let i = 0; i < eClips.length; i++) {
                const srcName = extStrategy === "group" ? "EXT" : `EXT${i + 1}`;
                const destName = `video_${srcName}_${i + 1}.mp4`;

                const sourcePath = path.join(externalDir, eClips[i]);
                const destPath = path.join(stagingDir, destName);

                try {
                    process.stdout.write(chalk.gray(`      > ${eClips[i]} -> ${destName} ... `));
                    await standardizeVideo(sourcePath, destPath);
                    console.log(chalk.green("OK"));
                    fileCount++;
                } catch (e) {
                    console.log(chalk.red(`FAIL (${e.message})`));
                }
            }
        }
    }

    if (fileCount === 0) return console.log(chalk.red("❌ Tidak ada file yang diproses."));

    const { finalDir } = await inquirer.prompt([
        { type: "input", name: "finalDir", message: "Folder Hasil Akhir Mix:", default: "video_mix_result" }
    ]);
    await ensureDirectoryExists(finalDir);

    const uploadConfig = await collectUploadConfig();
    await performMergeLogic(stagingDir, finalDir, uploadConfig);
}


// --- CORE LOGIC: HOOK GENERATOR (CORE) ---
async function processHooksForFolderCore(sourceDir, finalDir, context, geminiKey, brandName = "", brandContentHooks = "", captionMode = "standard", storySummary = "", useCaptions = false, personaKey = "default", hookTimingMode = "full", hookStartTime = null, hookDuration = null, customPersonaPrompt = "") {
    await ensureDirectoryExists(finalDir);

    const files = await fs.readdir(sourceDir);
    const videoFiles = files.filter(f => [".mp4", ".mkv", ".mov"].includes(path.extname(f).toLowerCase()));

    if (videoFiles.length === 0) {
        console.log(chalk.red("Folder kosong atau tidak ada video."));
        return;
    }

    console.log(chalk.cyan(`\n🤖 Meng-generate ${videoFiles.length} hook (Persona: ${customPersonaPrompt ? "Custom" : personaKey}) dengan AI...`));
    const hooks = await generateHooksByPersonaPlan({
        apiKey: geminiKey,
        context,
        count: videoFiles.length,
        brandName,
        brandContentHooks,
        personaKey,
        customPrompt: customPersonaPrompt,
        fallbackCaptionMode: captionMode,
        storySummary
    });

    console.log(chalk.cyan(`\n🚀 Memulai proses penambahan hook ke ${videoFiles.length} video...`));

    // Log timing info
    if (hookTimingMode === "custom") {
        console.log(chalk.yellow(`   ⏱️ Hook Timing: Detik ${hookStartTime} selama ${hookDuration} detik`));
    } else {
        console.log(chalk.yellow(`   ⏱️ Hook Timing: Seluruh video (awal sampai akhir)`));
    }

    const finalVideos = [];

    for (let i = 0; i < videoFiles.length; i++) {
        const file = videoFiles[i];
        const hookText = hooks[i] || config.ai.defaultHook;
        const inputPath = path.join(sourceDir, file);
        const outputPath = path.join(finalDir, `hook_${file}`);

        console.log(chalk.cyan(`\n[${i + 1}/${videoFiles.length}] Memproses: ${file}`));
        console.log(chalk.gray(`   📝 Hook: "${hookText.replace(/\n/g, ' ')}"`));

        try {
            // Pass timing parameters to applyHookToFinalVideo
            const startTime = hookTimingMode === "custom" ? hookStartTime : null;
            const duration = hookTimingMode === "custom" ? hookDuration : null;
            await applyHookToFinalVideo(inputPath, hookText, outputPath, null, startTime, duration);
            console.log(chalk.green(`   ✅ Selesai: ${path.basename(outputPath)}`));
            finalVideos.push(outputPath);
        } catch (e) {
            console.log(chalk.red(`   ❌ Gagal: ${e.message}`));
        }
    }

    if (useCaptions) {
        console.log(chalk.cyan(`\n🤖 Menyiapkan AI Captions (Mode: ${captionMode}) untuk ${finalVideos.length} video...`));

        let capContext = context;
        let brandCaptionRule = "";

        // Coba ambil rule brand kalau ada
        const currentSettings = getSettings();
        if (brandName) {
            const foundBrand = currentSettings.brands.find(b => b.name === brandName);
            if (foundBrand) brandCaptionRule = foundBrand.captionRule || "";
        }

        const geminiKeys = (config.ai.apiKeys && config.ai.apiKeys.length > 0)
            ? config.ai.apiKeys
            : [geminiKey].filter(Boolean);

        const aiCaptions = await generateCaptionsByPersonaPlan({
            apiKey: geminiKeys,
            context: capContext,
            count: finalVideos.length,
            brandName,
            brandContentHooks,
            brandCaptionRule,
            personaKey,
            customPrompt: customPersonaPrompt,
            fallbackCaptionMode: captionMode,
            storySourceContent: storySummary,
            hooksArray: hooks
        });

        const { wrapText } = require("../utils/ffmpeg");
        const captionsMap = {};
        for (let i = 0; i < finalVideos.length; i++) {
            captionsMap[path.basename(finalVideos[i])] = {
                caption: aiCaptions[i] || "Generated by ClippEri",
                hook_raw: hooks[i] || "",
                hook_lines: wrapText(hooks[i] || "", config.styles.wrapLimit).split('\n')
            };
        }
        try {
            await fs.writeFile(path.join(finalDir, "captions.json"), JSON.stringify(captionsMap, null, 2));
            console.log(chalk.green(`   📝 Captions disimpan ke: ${path.join(finalDir, "captions.json")}`));
        } catch (e) {
            console.log(chalk.yellow(`   ⚠️ Gagal menyimpan captions.json: ${e.message}`));
        }
    }

    console.log(chalk.green.bold("\n🎉 Semua proses selesai!"));
}

// --- CORE LOGIC: HOOK GENERATOR (CLI) ---
async function processHooksForFolder() {
    refreshConfig();
    const { sourceDir } = await inquirer.prompt([
        { type: "input", name: "sourceDir", message: "Folder Video Sumber:", default: config.paths.sourceDir }
    ]);

    const { finalDir, context } = await inquirer.prompt([
        { type: "input", name: "finalDir", message: "Folder Output:", default: "video_with_hooks" },
        { type: "input", name: "context", message: "Konteks/Topik Video (untuk AI Hook):" }
    ]);

    // Hook timing configuration
    const { hookTimingChoice } = await inquirer.prompt([
        {
            type: "list",
            name: "hookTimingChoice",
            message: "Kapan hook ingin ditampilkan?",
            choices: [
                { name: "Dari awal sampai akhir video", value: "full" },
                { name: "Waktu tertentu (custom)", value: "custom" }
            ],
            default: "full"
        }
    ]);

    let hookStartTime = null;
    let hookDuration = null;

    if (hookTimingChoice === "custom") {
        const { timingInput } = await inquirer.prompt([
            {
                type: "input",
                name: "timingInput",
                message: "Masukkan waktu hook (format: detik_awal,detik_durasi). Contoh: 0,5 = hook muncul dari detik 0 selama 5 detik:",
                validate: (input) => {
                    const parts = input.split(",");
                    if (parts.length !== 2) return "Format harus: detik_awal,detik_durasi (contoh: 0,5)";
                    const start = parseFloat(parts[0].trim());
                    const duration = parseFloat(parts[1].trim());
                    if (isNaN(start) || isNaN(duration)) return "Harus angka valid";
                    if (start < 0) return "Detik awal tidak boleh negatif";
                    if (duration <= 0) return "Durasi harus lebih dari 0";
                    return true;
                }
            }
        ]);

        const [start, dur] = timingInput.split(",").map(s => parseFloat(s.trim()));
        hookStartTime = start;
        hookDuration = dur;
    }

    let geminiKey = config.ai.apiKey || process.env.GEMINI_API_KEY;
    if (!geminiKey) {
        const { key } = await inquirer.prompt([{ type: "input", name: "key", message: "Masukkan Gemini API Key:" }]);
        geminiKey = key;
    }

    await processHooksForFolderCore(sourceDir, finalDir, context, geminiKey, "", "", "standard", "", false, "default", hookTimingChoice, hookStartTime, hookDuration);
}

// --- CORE LOGIC: MULTI-FILE CUT AND MERGE ---
async function multiFileCutAndMerge() {
    refreshConfig(); // Reload all settings

    const { sourceType } = await inquirer.prompt([{
        type: "list", name: "sourceType", message: "Sumber video:",
        choices: [{ name: "1. Folder Lokal", value: "folder" }, { name: "2. Link YouTube", value: "youtube" }]
    }]);

    let sourceDir = config.paths.sourceDir;
    if (sourceType === "youtube") {
        const { url } = await inquirer.prompt([{ type: "input", name: "url", message: "Link YouTube:" }]);
        sourceDir = "youtube_downloads";
        await ensureDirectoryExists(sourceDir);
        const ytDlpCmd = await getToolCommand("yt-dlp");
        await runCommand(`${ytDlpCmd} -o "${path.join(sourceDir, "dl_%(timestamp)s.mp4")}" "${url}" -f "bestvideo[ext=mp4]+bestaudio[ext=m4a]"`);
    } else {
        const { dir } = await inquirer.prompt([{ type: "input", name: "dir", message: "Path folder:", default: config.paths.sourceDir }]);
        sourceDir = dir;
    }

    const files = await fs.readdir(sourceDir);
    const videoFiles = files.filter(f => [".mp4", ".mkv", ".mov"].includes(path.extname(f).toLowerCase()));
    if (videoFiles.length === 0) return console.log(chalk.red("Folder kosong."));

    const { clipsDir, finalDir } = await inquirer.prompt([
        { type: "input", name: "clipsDir", message: "Folder hasil potongan:", default: "hasil_potongan" },
        { type: "input", name: "finalDir", message: "Folder hasil akhir:", default: "video_gabungan" }
    ]);
    await ensureDirectoryExists(clipsDir);
    await ensureDirectoryExists(finalDir);

    const { settingsMode } = await inquirer.prompt([
        {
            type: "list",
            name: "settingsMode",
            message: "Bagaimana pengaturan video?",
            choices: [
                { name: "1. Edit 1 per 1", value: "individual" },
                { name: "2. Gunakan 1 pengaturan untuk semua", value: "all" },
                { name: "3. Gunakan pengaturan default (Cepat)", value: "default" }
            ]
        }
    ]);

    let generalSettings = null;
    if (settingsMode === "all") {
        console.log(chalk.blue.bold("\n--- Masukkan Pengaturan untuk Semua Video ---"));
        generalSettings = await inquirer.prompt([
            { type: "input", name: "trimStart", message: `Waktu mulai:`, default: config.batch.trimStart },
            { type: "input", name: "trimEnd", message: `Waktu selesai:`, default: config.batch.trimEnd },
            { type: "number", name: "maxClips", message: `Maksimal klip?`, default: config.batch.maxClips },
            { type: "input", name: "clipDuration", message: `Durasi per klip (detik)?`, default: config.batch.clipDuration },
        ]);
    } else if (settingsMode === "default") {
        generalSettings = {
            trimStart: config.batch.trimStart,
            trimEnd: config.batch.trimEnd,
            maxClips: config.batch.maxClips,
            clipDuration: config.batch.clipDuration
        };
        console.log(chalk.cyan(`\n🚀 Menggunakan pengaturan default: Max ${config.batch.maxClips} klip, Durasi ${config.batch.clipDuration}s`));
    }

    const uploadConfig = await collectUploadConfig();

    // Proses semuannya secara otomatis sekarang
    await processMultiCut(videoFiles, sourceDir, clipsDir, generalSettings);
    await performMergeLogic(clipsDir, finalDir, uploadConfig);
}



// --- CORE LOGIC: MERGE ONLY ---
async function mergeOnly() {
    refreshConfig(); // Reload all settings
    const { sourceDir, finalDir } = await inquirer.prompt([
        { type: "input", name: "sourceDir", message: "Folder klip (.mp4):", default: "hasil_potongan" },
        { type: "input", name: "finalDir", message: "Folder hasil akhir:", default: "video_gabungan_akhir" }
    ]);
    await ensureDirectoryExists(finalDir);

    const uploadConfig = await collectUploadConfig();
    await performMergeLogic(sourceDir, finalDir, uploadConfig);
}

// --- CORE LOGIC: BATCH ROTATE TO PORTRAIT ---
async function rotateVideosToPortrait(guiSourceDir = null) {
    console.log(chalk.magenta.bold("\n--- 🔄 Rotasi Video ke Portrait (-90 Derajat) (Timpa Asli) ---"));

    let sourceDir = guiSourceDir;

    if (!sourceDir) {
        const answers = await inquirer.prompt([
            { type: "input", name: "src", message: "Folder Sumber Video Landscape:", default: "sumber_landscape" }
        ]);
        sourceDir = answers.src;
    }

    if (!(await fs.stat(sourceDir).catch(() => false))) {
        return console.log(chalk.red(`❌ Folder sumber tidak ditemukan: ${sourceDir}`));
    }

    const files = await fs.readdir(sourceDir);
    const videoFiles = files.filter(f => [".mp4", ".mkv", ".mov"].includes(path.extname(f).toLowerCase()));

    if (videoFiles.length === 0) {
        return console.log(chalk.red("❌ Tidak ada video di folder tersebut."));
    }

    console.log(chalk.cyan(`\nMemulai rotasi ${videoFiles.length} video (Ini akan menimpa file asli)...`));

    for (let i = 0; i < videoFiles.length; i++) {
        const file = videoFiles[i];
        const inputPath = path.join(sourceDir, file);

        // --- CEK ORIENTASI VIDEO DENGAN FFPROBE ---
        try {
            const probeCmd = `ffprobe -v error -select_streams v:0 -show_entries stream=width,height,tags=rotate -of json "${inputPath}"`;
            const probeOutput = await runCommand(probeCmd);

            // Note: runCommand returns the stdout output
            const probeData = JSON.parse(probeOutput);
            const stream = probeData.streams[0];

            let width = stream.width;
            let height = stream.height;
            let rotateTag = stream.tags ? (stream.tags.rotate || stream.tags.ROTATE) : null;

            // Jika ada rotate tag, orientasi aslinya mungkin sudah terbalik oleh meta
            if (rotateTag == '90' || rotateTag == '-90' || rotateTag == '270') {
                width = stream.height; // Tukar
                height = stream.width;
            }

            if (width <= height) {
                console.log(chalk.yellow(`\n[${i + 1}/${videoFiles.length}] Melewati: ${file} (Sudah Portrait/Square)`));
                continue;
            }

        } catch (err) {
            console.log(chalk.yellow(`\n[${i + 1}/${videoFiles.length}] Gagal mengecek metadata ${file}, tetap akan diputar.`));
        }

        // Buat file temporary di folder yang sama
        const tempName = `temp_rotate_${Date.now()}_${file}`;
        const tempPath = path.join(sourceDir, tempName);

        console.log(chalk.gray(`\n[${i + 1}/${videoFiles.length}] Merotasi (Pixel / Hard Render): ${file}`));

        try {
            await runEncode(
                (encArgs) => `ffmpeg -y -i "${inputPath}" -vf "transpose=2" ${encArgs} -c:a copy "${tempPath}"`,
                { quality: 23, preset: "ultrafast" }
            );

            // Timpa file aslinya
            await fs.unlink(inputPath).catch(() => { });
            await fs.rename(tempPath, inputPath);

            console.log(chalk.green(`   ✅ Selesai: ${file}`));
        } catch (e) {
            console.log(chalk.red(`   ❌ Gagal: ${e.message}`));
            // Hapus file temporary jika gagal
            await fs.unlink(tempPath).catch(() => { });
        }
    }
    console.log(chalk.green.bold("\n🎉 Semua proses rotasi selesai!"));
}

function getAudioCompressArgs(ext) {
    switch (ext) {
        case ".mp3":
            return "-c:a libmp3lame -b:a 128k";
        case ".m4a":
        case ".aac":
            return "-c:a aac -b:a 128k";
        case ".wav":
            return "-ac 1 -ar 22050 -c:a pcm_s16le";
        case ".flac":
            return "-c:a flac -compression_level 8";
        case ".ogg":
            return "-c:a libvorbis -q:a 4";
        default:
            return "-c:a aac -b:a 128k";
    }
}

function formatBytesKB(bytes) {
    if (bytes >= 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(2)} MB`;
    return `${(bytes / 1024).toFixed(1)} KB`;
}

// --- CORE LOGIC: BATCH COMPRESS VIDEO & AUDIO ---
async function compressVideos(guiSourceDir = null) {
    console.log(chalk.magenta.bold("\n--- 🗜️ Kompresi Ukuran Video & Audio (Timpa Asli) ---"));
    console.log(chalk.bgRed.white(" ⚠️ PERINGATAN! ⚠️ "));
    console.log(chalk.red("Fitur ini akan MENIMPA file aslinya secara permanen jika ukuran hasil kompresi lebih kecil."));
    console.log(chalk.red("Pastikan kamu mencoba compress 1 file copy-an dulu sebelum memproses 1 folder penuh!\n"));

    let sourceDir = guiSourceDir;

    if (!sourceDir) {
        const answers = await inquirer.prompt([
            { type: "input", name: "src", message: "Folder Sumber Video / Audio:", default: "sumber_mentahan" }
        ]);
        sourceDir = answers.src;

        const confirm = await inquirer.prompt([
            { type: "confirm", name: "proceed", message: "Apakah kamu YAKIN ingin mengompres & menimpa file di folder ini?", default: false }
        ]);
        if (!confirm.proceed) {
            return console.log(chalk.yellow("Dibatalkan."));
        }
    }

    if (!(await fs.stat(sourceDir).catch(() => false))) {
        return console.log(chalk.red(`❌ Folder sumber tidak ditemukan: ${sourceDir}`));
    }

    const videoExts = [".mp4", ".mkv", ".mov"];
    const audioExts = [".mp3", ".m4a", ".wav", ".aac", ".flac", ".ogg"];
    const supportedExts = [...videoExts, ...audioExts];

    const files = await fs.readdir(sourceDir);
    const mediaFiles = files.filter(f =>
        !f.startsWith("temp_compress_") && supportedExts.includes(path.extname(f).toLowerCase())
    );

    if (mediaFiles.length === 0) {
        return console.log(chalk.red("❌ Tidak ada file video atau audio yang didukung di folder tersebut."));
    }

    console.log(chalk.cyan(`\nMemulai kompresi ${mediaFiles.length} file (Ini akan menimpa file asli jika lebih kecil)...`));

    for (let i = 0; i < mediaFiles.length; i++) {
        const file = mediaFiles[i];
        const inputPath = path.join(sourceDir, file);
        const ext = path.extname(file).toLowerCase();
        const isAudio = audioExts.includes(ext);

        const tempName = `temp_compress_${Date.now()}_${file}`;
        const tempPath = path.join(sourceDir, tempName);

        console.log(chalk.gray(`\n[${i + 1}/${mediaFiles.length}] Mengkompres (${isAudio ? "Audio" : "Video"}): ${file}`));

        try {
            const origStat = await fs.stat(inputPath);
            if (isAudio) {
                const audioArgs = getAudioCompressArgs(ext);
                await runCommand(`ffmpeg -y -i "${inputPath}" -vn ${audioArgs} "${tempPath}"`);
            } else {
                await runEncode(
                    (encArgs) => `ffmpeg -y -i "${inputPath}" ${encArgs} -c:a aac -b:a 128k "${tempPath}"`,
                    { quality: 28, preset: "veryfast" }
                );
            }

            const tempStat = await fs.stat(tempPath);
            if (tempStat.size > 0 && tempStat.size < origStat.size) {
                await fs.unlink(inputPath).catch(() => { });
                await fs.rename(tempPath, inputPath);
                const savedPct = (((origStat.size - tempStat.size) / origStat.size) * 100).toFixed(1);
                console.log(chalk.green(`   ✅ Selesai: ${file} (${formatBytesKB(origStat.size)} → ${formatBytesKB(tempStat.size)}, hemat ${savedPct}%)`));
            } else {
                await fs.unlink(tempPath).catch(() => { });
                console.log(chalk.yellow(`   ⏭️  Dilewati (tidak lebih kecil): ${file} (${formatBytesKB(origStat.size)} → ${formatBytesKB(tempStat.size)})`));
            }
        } catch (e) {
            console.log(chalk.red(`   ❌ Gagal: ${e.message}`));
            await fs.unlink(tempPath).catch(() => { });
        }
    }
    console.log(chalk.green.bold("\n🎉 Semua proses kompresi selesai!"));
}

module.exports = {
    multiFileCutAndMerge,
    mergeOnly,
    processHooksForFolder,
    mixExternalClips,
    rotateVideosToPortrait,
    // Exports for GUI/API
    processMultiCut,
    performMergeLogic,
    processHooksForFolderCore,
    compressVideos
};
