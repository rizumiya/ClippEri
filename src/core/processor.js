const path = require("path");
const fs = require("fs/promises");
const chalk = require("chalk");
const inquirer = require("inquirer");
const { runCommand, getToolCommand, ensureDirectoryExists } = require("../utils/shell");
const { applyHookToFinalVideo } = require("../utils/ffmpeg");
const { generateHooks, generateCaptions, extractStoryFacts } = require("./ai_hook");
const config = require("../config");

const { getSettings } = require("../utils/settings_manager");

function mapPersonaToCaptionMode(personaKey = "default", fallbackMode = "standard") {
    const p = String(personaKey || "default").toLowerCase();
    if (p === "business") return "edukasi_bisnis";
    if (p === "atomic") return "story";
    if (p === "current" || p === "default") return fallbackMode;
    return fallbackMode;
}

function buildPersonaPlan(count, selectedPersona = "default") {
    const total = Math.max(0, parseInt(count, 10) || 0);
    const key = String(selectedPersona || "default").toLowerCase();
    if (key !== "mixed" && key !== "cycle") {
        return Array.from({ length: total }, () => key === "current" ? "default" : key);
    }
    const cycle = ["business", "default", "atomic"];
    return Array.from({ length: total }, (_, i) => cycle[i % cycle.length]);
}

async function generateHooksByPersonaPlan({
    apiKey,
    context,
    count,
    brandName = "",
    brandContentHooks = "",
    personaKey = "default",
    fallbackCaptionMode = "standard",
    storySummary = ""
}) {
    const plan = buildPersonaPlan(count, personaKey);
    const buckets = {};
    plan.forEach((persona, idx) => {
        if (!buckets[persona]) buckets[persona] = [];
        buckets[persona].push(idx);
    });
    const out = Array(plan.length).fill("");
    for (const persona of Object.keys(buckets)) {
        const idxs = buckets[persona];
        if (!idxs.length) continue;
        const captionMode = mapPersonaToCaptionMode(persona, fallbackCaptionMode);
        const generated = await generateHooks(apiKey, context, idxs.length, brandName, brandContentHooks, captionMode, storySummary);
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
    fallbackCaptionMode = "standard",
    storySourceContent = "",
    hooksArray = []
}) {
    const plan = buildPersonaPlan(count, personaKey);
    const buckets = {};
    plan.forEach((persona, idx) => {
        if (!buckets[persona]) buckets[persona] = [];
        buckets[persona].push(idx);
    });
    const out = Array(plan.length).fill("");
    for (const persona of Object.keys(buckets)) {
        const idxs = buckets[persona];
        if (!idxs.length) continue;
        const captionMode = mapPersonaToCaptionMode(persona, fallbackCaptionMode);
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
            captionMode,
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
    config.repliz.accessKey = s.repliz_access_key || config.repliz.accessKey;
    config.repliz.secretKey = s.repliz_secret_key || config.repliz.secretKey;
    config.repliz.secretKey = s.repliz_secret_key || config.repliz.secretKey;
    // Handle account ID as array of {name,id} objects or plain strings — normalize to array of ID strings
    const rawIds = Array.isArray(s.repliz_account_id) ? s.repliz_account_id : [s.repliz_account_id || config.repliz.accountId];
    config.repliz.accountId = rawIds.map(entry => (entry && typeof entry === 'object' ? entry.id : entry)).filter(Boolean);
    config.storage.webhookUrl = s.upload_webhook_url || config.storage.webhookUrl;
    config.storage.publicBaseUrl = s.upload_public_base_url || config.storage.publicBaseUrl;
    config.storage.spreadsheetWebhookUrl = s.spreadsheet_webhook_url || config.storage.spreadsheetWebhookUrl;
    // Normalize gemini_api_key: supports array or newline-separated string
    if (s.gemini_api_key) {
        const raw = s.gemini_api_key;
        let keys = [];
        if (Array.isArray(raw)) {
            keys = raw.map(k => String(k).trim()).filter(Boolean);
        } else {
            keys = String(raw).split('\n').map(k => k.trim()).filter(Boolean);
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
            let trimCmd = `ffmpeg -y -i "${sourcePath}" `;
            if (setting.trimStart) trimCmd += `-ss ${setting.trimStart} `;
            if (setting.trimEnd) trimCmd += `-to ${setting.trimEnd} `;

            if (fastMode) {
                // Fast Mode: Stream Copy for trim (Might be inaccurate on start point)
                trimCmd += `-c copy "${tempTrim}"`;
            } else {
                // Standard: Re-encode
                trimCmd += `-vf "${filter}" -r ${fps} -c:v libx264 -preset ultrafast -crf 23 -c:a aac -b:a 128k -ar 44100 -pix_fmt yuv420p "${tempTrim}"`;
            }

            await runCommand(trimCmd);
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
                // Fast Mode: Copy codec, faster but risk of freeze if mixed later
                // Note: -ss before -i is faster but keyframe dependent. -ss after -i is accurate but slower.
                // For "Fast Mode" we prioritize speed, so -ss before -i.
                // -avoid_negative_ts make_zero is good practice.
                await runCommand(`ffmpeg -y -ss ${start} -t ${clipDur} -i "${currentInput}" -c copy -avoid_negative_ts make_zero "${outPath}" -loglevel error`);
            } else {
                // Standard: Re-encode with filter
                await runCommand(`ffmpeg -y -ss ${start} -t ${clipDur} -i "${currentInput}" -vf "${filter}" -r ${fps} -c:v libx264 -c:a aac -avoid_negative_ts make_zero "${outPath}"`);
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

    if (captionMode === 'story' && uploadConfig && uploadConfig.storySourceContent) {
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
            personaKey: uploadConfig?.systemPersona || "default",
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
                personaKey: uploadConfig?.systemPersona || "default",
                fallbackCaptionMode: captionMode,
                storySourceContent: storyInput,
                hooksArray: hooks
            });

            // Save to captions.json mapping output file name to caption
            const { wrapText } = require("../utils/ffmpeg");
            const captionsMap = {};
            for (let i = 0; i < finalVideos.length; i++) {
                captionsMap[path.basename(finalVideos[i])] = {
                    caption: aiCaptions[i] || "Generated by Video Toolkit",
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

    const outputMode = String(uploadConfig?.outputMode || "normal").toLowerCase();
    if (outputMode === "video_caption_sheet" && finalVideos.length > 0) {
        const { appendRowsToSpreadsheet } = require("../utils/spreadsheet_logger");
        const { uploadToStorage } = require("../utils/file_uploader");
        const rows = [];

        for (let i = 0; i < finalVideos.length; i++) {
            const file = finalVideos[i];
            const caption = aiCaptions[i] || "Generated by Video Toolkit";
            const txtPath = path.join(path.dirname(file), `${path.parse(file).name}.txt`);
            await fs.writeFile(txtPath, caption, "utf8");

            let videoRef = path.resolve(file);
            try {
                videoRef = await uploadToStorage(file);
            } catch (_) { }

            rows.push({
                timestamp: new Date().toISOString(),
                video: videoRef,
                caption
            });
        }

        const sheetResult = await appendRowsToSpreadsheet(rows, {
            webhookUrl: uploadConfig?.spreadsheetWebhookUrl || config.storage.spreadsheetWebhookUrl || "",
            csvPath: path.join(finalDir, "spreadsheet_log.csv")
        });
        console.log(chalk.green(`✅ Output mode spreadsheet tersimpan via ${sheetResult.mode}: ${sheetResult.target}`));
    }

    // --- AUTO SUBTITLE GENERATION (Added for Super All-In-One) ---
    if (uploadConfig && uploadConfig.useSubtitles) {
        console.log(chalk.cyan(`\n🎙️ Memulai proses Auto Subtitle untuk ${finalVideos.length} video...`));
        const { processSubtitleForFolderCore } = require('./subtitle');
        const currentSettings = getSettings();
        const voice = currentSettings.tiktok_voice || 'id_001';

        // Use finalDir as both source and destination because we want to apply subtitles onto the already merged/hooked videos.
        // Wait, processSubtitleForFolderCore writes to a new folder. It's safer to create a temp folder.
        const subtitleTempDir = path.join(finalDir, "_temp_subtitled");
        await ensureDirectoryExists(subtitleTempDir);

        try {
            await processSubtitleForFolderCore(finalDir, subtitleTempDir, uploadConfig.captionContext, voice, uploadConfig.srtWavDir);

            const subbedFiles = await fs.readdir(subtitleTempDir);
            const validSubbedFiles = subbedFiles.filter(f => f.endsWith('.mp4'));
            const updatedFinalVideos = [];

            for (const originalFile of finalVideos) {
                const originalBase = path.basename(originalFile, path.extname(originalFile));
                const expectedSubFile = `${originalBase}_subtitled.mp4`;
                const matchedSubFile = validSubbedFiles.find(f => f === expectedSubFile);

                if (!matchedSubFile) {
                    updatedFinalVideos.push(originalFile);
                    continue;
                }

                const tempPath = path.join(subtitleTempDir, matchedSubFile);
                await fs.copyFile(tempPath, originalFile);
                updatedFinalVideos.push(originalFile);
            }

            finalVideos = updatedFinalVideos;

            console.log(chalk.green("✅ Proses Auto Subtitle selesai dan menimpa file asli."));
        } catch (e) {
            console.log(chalk.red(`❌ Gagal merender Subtitle: ${e.message}`));
        } finally {
            // Clean temp subtitle dir
            try { await fs.rm(subtitleTempDir, { recursive: true, force: true }); } catch (e) { }
        }
    }


    // --- REPLIZ AUTO UPLOAD (Automated) ---
    if (uploadConfig && uploadConfig.replizConfig) {
        const { scheduleTimes } = uploadConfig;
        const { scheduleReplizVideo } = require("../utils/repliz_api");
        const { uploadToStorage } = require("../utils/file_uploader");

        console.log(chalk.cyan(`\n📤 Memulai proses upload otomatis ke Repliz untuk ${finalVideos.length} video...`));

        // Round-Robin Logic Prep
        const selectedAccountIds = Array.isArray(uploadConfig.selectedReplizAccountIds)
            ? uploadConfig.selectedReplizAccountIds.filter(Boolean)
            : [];
        const accountIds = selectedAccountIds.length > 0
            ? selectedAccountIds
            : ((Array.isArray(config.repliz.accountId) && config.repliz.accountId.length > 0)
                ? config.repliz.accountId
                : (config.repliz.accountId ? [config.repliz.accountId] : []));

        if (accountIds.length === 0) {
            console.log(chalk.red("❌ Tidak ada Repliz Account ID yang dikonfigurasi. Upload dibatalkan."));
            return;
        }

        // Check for limit warning (Mock check: if total videos / numAccounts > 20)
        // Or simply check if we are scheduling more than 20 for any single account
        const videosPerAccount = Math.ceil(finalVideos.length / accountIds.length);
        if (videosPerAccount > 20) {
            console.log(chalk.yellow.bold(`\n⚠️  PERINGATAN: Estimasi ${videosPerAccount} video per akun. Batas aman API Repliz mungkin terlampaui (Max 10-20/jam).`));
        }

        const usageCounter = {};
        accountIds.forEach(id => usageCounter[id] = 0);

        for (let i = 0; i < finalVideos.length; i++) {
            const file = finalVideos[i];
            const sched = scheduleTimes[i] || scheduleTimes[0];
            const caption = aiCaptions[i] || "Generated by Video Toolkit";

            // Round-Robin Selection
            const accountId = accountIds[i % accountIds.length];
            usageCounter[accountId]++;

            // Per-Loop Warning (optional, but requested "warn if video > 20 for 1 account id")
            if (usageCounter[accountId] > 20) {
                console.log(chalk.red.bold(`⚠️  PERINGATAN SISIPAN: Akun ${accountId} telah mencapai limit 20 video! API mungkin menolak.`));
            } else if (usageCounter[accountId] > 10) {
                console.log(chalk.yellow(`⚠️  Info: Akun ${accountId} telah antri ${usageCounter[accountId]} video.`));
            }

            try {
                console.log(chalk.cyan(`\n[${i + 1}/${finalVideos.length}] Menangani: ${path.basename(file)}`));
                console.log(chalk.blue(`   👤 Menggunakan Akun Repliz: ${accountId} (Antrian #${usageCounter[accountId]})`));

                // 1. Upload ke storage public
                const publicUrl = await uploadToStorage(file);

                // 2. Schedule ke Repliz
                let finalSched = new Date(sched);
                if (!finalSched || isNaN(finalSched.getTime())) {
                    console.log(chalk.red(`   > Skipping Repliz: Waktu tidak valid untuk ${file}`));
                    continue;
                }

                // If date+time is in the past, set to NOW to force immediate upload
                if (finalSched < new Date()) {
                    console.log(chalk.yellow(`   > Waktu ${finalSched.toLocaleString()} sudah lewat. Upload SEKARANG.`));
                    finalSched = new Date();
                    finalSched.setSeconds(finalSched.getSeconds() + 10); // Buffer 10s
                }

                console.log(chalk.yellow(`   > Menjadwalkan di Repliz untuk: ${finalSched.toLocaleString()}`));
                await scheduleReplizVideo(config.repliz.accessKey, config.repliz.secretKey, {
                    title: `Video Content - ${path.basename(file)}`,
                    description: caption,
                    videoUrl: publicUrl,
                    accountId: accountId,
                    scheduleAt: finalSched
                });
            } catch (e) {
                console.log(chalk.red(`❌ Gagal upload/jadwal untuk ${file}: ${e.message}`));
            }
        }
    } else if (!uploadConfig && config.repliz.accessKey && config.repliz.secretKey) {
        // Fallback or old manual path if needed
        console.log(chalk.gray("\nℹ️  Lewati upload otomatis (Gunakan menu 2 untuk full otomatis)."));
    }
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
    console.log(chalk.magenta.bold("\n--- Pengaturan Gabung & Upload ---"));
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

    let uploadConfig = null;
    if (config.repliz.accessKey && config.repliz.secretKey) {
        const { wantUpload, useCaptions } = await inquirer.prompt([
            { type: "confirm", name: "wantUpload", message: "Otomatis Upload ke Repliz setelah selesai?", default: true },
            { type: "confirm", name: "useCaptions", message: "Gunakan AI untuk generate Caption (Deskripsi) Repliz?", default: true, when: (ans) => ans.wantUpload }
        ]);
        if (wantUpload) {
            const { scheduleMode } = await inquirer.prompt([
                {
                    type: "list",
                    name: "scheduleMode",
                    message: "Pilih Mode Penjadwalan Repliz:",
                    choices: [
                        { name: "1. Waktu Pasti (Sama untuk semua)", value: "fixed" },
                        { name: "2. Rentang Waktu (Acak didalam rentang)", value: "range" },
                        { name: "3. Daftar Waktu Spesifik (Pemisah koma)", value: "list" }
                    ]
                }
            ]);

            let scheduleTimes = [];
            const now = new Date();
            const todayStr = now.toISOString().split('T')[0]; // YYYY-MM-DD
            const count = mergeSettings.finalCount;

            if (scheduleMode === "fixed") {
                const { date, time } = await inquirer.prompt([
                    { type: "input", name: "date", message: "Tanggal (YYYY-MM-DD, kosongkan = hari ini):", default: "" },
                    { type: "input", name: "time", message: "Jam (e.g. 13:00):", default: "13:00" }
                ]);
                const d = parseTime(time, date || todayStr);
                if (!d) {
                    console.log(chalk.red("⚠️ Format jam tidak valid. Penjadwalan dibatalkan."));
                    return null;
                }
                for (let i = 0; i < count; i++) scheduleTimes.push(new Date(d));

            } else if (scheduleMode === "range") {
                const { date, start, end } = await inquirer.prompt([
                    { type: "input", name: "date", message: "Tanggal rentang (YYYY-MM-DD, kosongkan = hari ini):", default: "" },
                    { type: "input", name: "start", message: "Dari Jam:", default: "13:00" },
                    { type: "input", name: "end", message: "Sampai Jam:", default: "17:00" }
                ]);
                const baseDate = date || todayStr;
                const sd = parseTime(start, baseDate);
                const ed = parseTime(end, baseDate);
                if (!sd || !ed) {
                    console.log(chalk.red("⚠️ Format jam tidak valid. Penjadwalan dibatalkan."));
                    return null;
                }
                if (ed <= sd) ed.setDate(ed.getDate() + 1); // lewat tengah malam
                const diff = ed.getTime() - sd.getTime();
                for (let i = 0; i < count; i++) {
                    scheduleTimes.push(new Date(sd.getTime() + Math.random() * diff));
                }
                scheduleTimes.sort((a, b) => a - b);

            } else if (scheduleMode === "list") {
                const { date, listStr } = await inquirer.prompt([
                    { type: "input", name: "date", message: "Tanggal (YYYY-MM-DD, kosongkan = hari ini):", default: "" },
                    { type: "input", name: "listStr", message: `Masukkan ${count} jam (e.g. 13:00, 15:00...):` }
                ]);
                const baseDate = date || todayStr;
                const list = listStr.split(",").map(s => s.trim());
                for (const t of list) {
                    const d = parseTime(t, baseDate);
                    if (d) scheduleTimes.push(d);
                }
                if (scheduleTimes.length === 0) {
                    console.log(chalk.red("⚠️ Tidak ada waktu valid. Penjadwalan dibatalkan."));
                    return null;
                }
            }
            if (useCaptions && !hookContext) {
                const { context } = await inquirer.prompt([{ type: "input", name: "context", message: "Konteks Video (untuk AI Caption):" }]);
                hookContext = context;
            }
            uploadConfig = { mergeSettings, musicAns, hookContext, replizConfig: true, scheduleTimes, useCaptions };
        } else {
            // User tidak mau upload, tapi tetap return mergeSettings untuk menghindari duplikasi prompt
            uploadConfig = { mergeSettings, musicAns, hookContext, replizConfig: false };
        }
    } else {
        // Repliz belum dikonfigurasi, tetap return mergeSettings
        uploadConfig = { mergeSettings, musicAns, hookContext, replizConfig: false };
    }
    return uploadConfig;
}


// --- HELPER: STANDARDIZE VIDEO ---
async function standardizeVideo(inputPath, outputPath) {
    const { width, height, fps } = config.video.standardization;
    // Fix: Ensure even dimensions after scaling to prevent "pad" errors
    // Fix Color Shift: Re-map color matrix to prevent DSLR videos from looking reddish
    const filter = `scale=${width}:${height}:force_original_aspect_ratio=decrease,scale=trunc(iw/2)*2:trunc(ih/2)*2,pad=${width}:${height}:(ow-iw)/2:(oh-ih)/2,setsar=1,colormatrix=bt601:bt709`;

    // Gunakan ffmpeg untuk re-encode
    // -r sets frame rate
    const cmd = `ffmpeg -y -i "${inputPath}" -vf "${filter}" -r ${fps} -c:v libx264 -preset fast -crf 26 -c:a aac -ar 44100 -ac 2 "${outputPath}"`;
    try {
        await runCommand(cmd);
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
async function processHooksForFolderCore(sourceDir, finalDir, context, geminiKey, brandName = "", brandContentHooks = "", captionMode = "standard", storySummary = "", useCaptions = false, personaKey = "default", hookTimingMode = "full", hookStartTime = null, hookDuration = null) {
    await ensureDirectoryExists(finalDir);

    const files = await fs.readdir(sourceDir);
    const videoFiles = files.filter(f => [".mp4", ".mkv", ".mov"].includes(path.extname(f).toLowerCase()));

    if (videoFiles.length === 0) {
        console.log(chalk.red("Folder kosong atau tidak ada video."));
        return;
    }

    console.log(chalk.cyan(`\n🤖 Meng-generate ${videoFiles.length} hook (Mode: ${captionMode}) dengan AI...`));
    const hooks = await generateHooksByPersonaPlan({
        apiKey: geminiKey,
        context,
        count: videoFiles.length,
        brandName,
        brandContentHooks,
        personaKey,
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
            fallbackCaptionMode: captionMode,
            storySourceContent: storySummary,
            hooksArray: hooks
        });

        const { wrapText } = require("../utils/ffmpeg");
        const captionsMap = {};
        for (let i = 0; i < finalVideos.length; i++) {
            captionsMap[path.basename(finalVideos[i])] = {
                caption: aiCaptions[i] || "Generated by Video Toolkit",
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

// --- CORE LOGIC: STANDALONE REPLIZ UPLOAD ---
async function processStandaloneUpload(uploadDir, scheduleSettings) {
    refreshConfig();
    let { scheduleTimes } = scheduleSettings;
    const { scheduleReplizVideo } = require("../utils/repliz_api");
    const { uploadToStorage } = require("../utils/file_uploader");

    console.log(chalk.magenta.bold(`\n--- Memulai Upload Repliz Standalone dari: ${uploadDir} ---`));

    if (!(await fs.stat(uploadDir).catch(() => false))) {
        throw new Error(`Folder tidak ditemukan: ${uploadDir}`);
    }

    const files = await fs.readdir(uploadDir);
    const videoFiles = files.filter(f => f.endsWith(".mp4")).map(f => path.join(uploadDir, f));

    if (videoFiles.length === 0) {
        throw new Error("Tidak ada file .mp4 di folder tersebut.");
    }

    if ((!scheduleTimes || scheduleTimes.length === 0) && scheduleSettings.scheduleMode === "range") {
        const today = new Date();
        const todayStr = today.toISOString().split("T")[0];
        const startDate = new Date(`${scheduleSettings.rangeStartDate || todayStr}T00:00:00`);
        const endDate = new Date(`${scheduleSettings.rangeEndDate || scheduleSettings.rangeStartDate || todayStr}T00:00:00`);
        const parseMinutes = (value, fallback) => {
            const source = value || fallback;
            const [h, m] = String(source).split(":").map(Number);
            return ((Number.isFinite(h) ? h : 0) * 60) + (Number.isFinite(m) ? m : 0);
        };
        const startMinutes = parseMinutes(scheduleSettings.rangeStart, "13:00");
        const endMinutes = parseMinutes(scheduleSettings.rangeEnd, "17:00");
        const safeStartMinutes = Math.min(startMinutes, endMinutes);
        const safeEndMinutes = Math.max(startMinutes, endMinutes);
        const dates = [];

        for (let cursor = new Date(startDate); cursor <= endDate; cursor.setDate(cursor.getDate() + 1)) {
            dates.push(new Date(cursor));
        }

        const totalDays = Math.max(1, dates.length);
        const basePerDay = Math.floor(videoFiles.length / totalDays);
        const extra = videoFiles.length % totalDays;
        scheduleTimes = [];

        dates.forEach((day, dayIndex) => {
            const itemsForDay = basePerDay + (dayIndex < extra ? 1 : 0);
            if (itemsForDay <= 0) return;

            const totalWindow = Math.max(1, safeEndMinutes - safeStartMinutes);
            const step = totalWindow / itemsForDay;

            for (let itemIndex = 0; itemIndex < itemsForDay; itemIndex += 1) {
                const minuteOffset = safeStartMinutes + Math.floor((itemIndex + 0.5) * step);
                const scheduled = new Date(day);
                scheduled.setHours(0, 0, 0, 0);
                scheduled.setMinutes(Math.min(safeEndMinutes, minuteOffset));
                scheduleTimes.push(scheduled);
            }
        });
    }

    let captionsMap = {};
    const captionsPath = path.join(uploadDir, "captions.json");
    if (await fs.stat(captionsPath).catch(() => false)) {
        try {
            const rawCaptions = await fs.readFile(captionsPath, 'utf8');
            captionsMap = JSON.parse(rawCaptions);
            console.log(chalk.green(`✅ Berhasil memuat captions.json`));
        } catch (e) {
            console.log(chalk.yellow(`⚠️ Gagal mem-parsing captions.json, menggunakan caption default. Error: ${e.message}`));
        }
    } else {
        console.log(chalk.yellow(`⚠️ File captions.json tidak ditemukan, menggunakan caption default.`));
    }

    // Round-Robin Logic Prep
    const selectedAccountIds = Array.isArray(scheduleSettings.selectedReplizAccountIds)
        ? scheduleSettings.selectedReplizAccountIds.filter(Boolean)
        : [];
    const accountIds = selectedAccountIds.length > 0
        ? selectedAccountIds
        : ((Array.isArray(config.repliz.accountId) && config.repliz.accountId.length > 0)
            ? config.repliz.accountId
            : (config.repliz.accountId ? [config.repliz.accountId] : []));

    if (accountIds.length === 0) {
        throw new Error("Tidak ada Repliz Account ID yang dikonfigurasi di Settings.");
    }

    const videosPerAccount = Math.ceil(videoFiles.length / accountIds.length);
    if (videosPerAccount > 20) {
        console.log(chalk.yellow.bold(`\n⚠️  PERINGATAN: Estimasi ${videosPerAccount} video per akun. Batas aman API Repliz mungkin terlampaui (Max 10-20/jam).`));
    }

    const usageCounter = {};
    accountIds.forEach(id => usageCounter[id] = 0);

    for (let i = 0; i < videoFiles.length; i++) {
        const file = videoFiles[i];
        const baseName = path.basename(file);
        const sched = scheduleTimes[i] || scheduleTimes[0];

        let captionData = captionsMap[baseName];
        let caption = (typeof captionData === 'object' && captionData !== null) ? captionData.caption : captionData;
        caption = caption || "Video Content - Please Add Caption";

        const accountId = accountIds[i % accountIds.length];
        usageCounter[accountId]++;

        if (usageCounter[accountId] > 20) {
            console.log(chalk.red.bold(`⚠️  PERINGATAN SISIPAN: Akun ${accountId} telah mencapai limit 20 video! API mungkin menolak.`));
        } else if (usageCounter[accountId] > 10) {
            console.log(chalk.yellow(`⚠️  Info: Akun ${accountId} telah antri ${usageCounter[accountId]} video.`));
        }

        try {
            console.log(chalk.cyan(`\n[${i + 1}/${videoFiles.length}] Menangani: ${baseName}`));
            console.log(chalk.blue(`   👤 Menggunakan Akun Repliz: ${accountId} (Antrian #${usageCounter[accountId]})`));

            const publicUrl = await uploadToStorage(file);

            let finalSched = new Date(sched);
            if (!finalSched || isNaN(finalSched.getTime())) {
                console.log(chalk.red(`   > Skipping Repliz: Waktu tidak valid untuk ${file}`));
                continue;
            }

            if (finalSched < new Date()) {
                console.log(chalk.yellow(`   > Waktu ${finalSched.toLocaleString()} sudah lewat. Upload SEKARANG.`));
                finalSched = new Date();
                finalSched.setSeconds(finalSched.getSeconds() + 10);
            }

            console.log(chalk.yellow(`   > Menjadwalkan di Repliz untuk: ${finalSched.toLocaleString()}`));
            await scheduleReplizVideo(config.repliz.accessKey, config.repliz.secretKey, {
                title: `Video Content - ${baseName}`,
                description: caption,
                videoUrl: publicUrl,
                accountId: accountId,
                scheduleAt: finalSched
            });
        } catch (e) {
            console.log(chalk.red(`❌ Gagal upload/jadwal untuk ${file}: ${e.message}`));
        }
    }
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
        // Kenapa tidak pakai metadata? Karena metadata rotasi seringkali diabaikan oleh video player (termasuk Windows)
        // dan bisa bikin berantakan saat diedit lagi pakai Premiere atau dipotong lagi pakai FFmpeg.
        // Solusinya: Kita render pixelnya secara fisik, TAPI menggunakan preset "ultrafast" agar proses sangat cepat dan CPU ringan.
        const cmd = `ffmpeg -y -i "${inputPath}" -vf "transpose=2" -c:v libx264 -preset ultrafast -crf 23 -c:a copy "${tempPath}"`;

        try {
            await runCommand(cmd);

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

// --- CORE LOGIC: BATCH COMPRESS VIDEO ---
async function compressVideos(guiSourceDir = null) {
    console.log(chalk.magenta.bold("\n--- 🗜️ Kompresi Ukuran Video (Timpa Asli) ---"));
    console.log(chalk.bgRed.white(" ⚠️ PERINGATAN! ⚠️ "));
    console.log(chalk.red("Fitur ini akan MENIMPA video aslinya secara permanen."));
    console.log(chalk.red("Pastikan kamu mencoba compress 1 video copy-an dulu sebelum memproses 1 folder penuh!\n"));

    let sourceDir = guiSourceDir;

    if (!sourceDir) {
        const answers = await inquirer.prompt([
            { type: "input", name: "src", message: "Folder Sumber Video Besar:", default: "sumber_mentahan" }
        ]);
        sourceDir = answers.src;

        const confirm = await inquirer.prompt([
            { type: "confirm", name: "proceed", message: "Apakah kamu YAKIN ingin menimpa asli semua video di folder ini?", default: false }
        ]);
        if (!confirm.proceed) {
            return console.log(chalk.yellow("Dibatalkan."));
        }
    }

    if (!(await fs.stat(sourceDir).catch(() => false))) {
        return console.log(chalk.red(`❌ Folder sumber tidak ditemukan: ${sourceDir}`));
    }

    const files = await fs.readdir(sourceDir);
    const videoFiles = files.filter(f => [".mp4", ".mkv", ".mov"].includes(path.extname(f).toLowerCase()));

    if (videoFiles.length === 0) {
        return console.log(chalk.red("❌ Tidak ada video di folder tersebut."));
    }

    console.log(chalk.cyan(`\nMemulai kompresi ${videoFiles.length} video (Ini akan menimpa file asli)...`));

    for (let i = 0; i < videoFiles.length; i++) {
        const file = videoFiles[i];
        const inputPath = path.join(sourceDir, file);

        // Buat file temporary di folder yang sama
        const tempName = `temp_compress_${Date.now()}_${file}`;
        const tempPath = path.join(sourceDir, tempName);

        console.log(chalk.gray(`\n[${i + 1}/${videoFiles.length}] Mengkompres: ${file}`));
        // Menggunakan libx264, preset veryfast, crf 28 untuk kompresi size efektif tanpa turun resolusi
        const cmd = `ffmpeg -y -i "${inputPath}" -c:v libx264 -preset veryfast -crf 28 -c:a aac -b:a 128k "${tempPath}"`;

        try {
            await runCommand(cmd);

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
    processStandaloneUpload,
    compressVideos
};
