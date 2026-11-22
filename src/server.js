const express = require('express');
const http = require('http');
const socketIo = require('socket.io');
const path = require('path');
const open = require('open');
const chalk = require('chalk');
const {
    processMultiCut,
    performMergeLogic,
    processHooksForFolderCore,
    rotateVideosToPortrait,
    compressVideos
} = require('./core/processor');
const { downloadYoutubeCore } = require('./core/downloader');
const { analyzeVideo } = require('./core/analyzer');
const { getPersonas, savePersonas, resetPersonas, resolvePersona } = require('./core/personas');
const { loadAddons } = require('./core/addons');
const { getEncoderSummary } = require('./utils/encoder');
const { getEngineStatus, ensureEngine, ensureModel, transcribe } = require('./core/transcriber');
const { groupWords, buildAss, getTargetMediaDimensions, burnSubtitles } = require('./core/subtitle_render');
const { normalizeSubtitleAiSettings } = require('./utils/ass_helpers');
const { ensureDirectoryExists } = require('./utils/shell');
const { getSettings, saveSettings } = require('./utils/settings_manager');
const config = require('./config');
const fs = require('fs/promises');

const app = express();
const server = http.createServer(app);
const io = socketIo(server);

app.use(express.static(path.join(__dirname, '../public')));
app.use(express.json({ limit: '10mb' }));

// --- LOGGING INTERCEPTION ---
const originalLog = console.log;
const originalError = console.error;

function broadcastLog(message, type = 'info') {
    const cleanMsg = message.replace(/[\u001b\u009b][[()#;?]*(?:[0-9]{1,4}(?:;[0-9]{0,4})*)?[0-9A-ORZcf-nqry=><]/g, '');
    io.emit('log', { message: cleanMsg, type });
}

console.log = function (...args) {
    const msg = args.map(a => String(a)).join(' ');
    originalLog.apply(console, args);
    broadcastLog(msg, 'info');
};

console.error = function (...args) {
    const msg = args.map(a => String(a)).join(' ');
    originalError.apply(console, args);
    broadcastLog(msg, 'error');
};

// --- HELPER: ENRICH MERGE / AIO CONFIG ---
async function enrichUploadConfigWithBrand(uploadConfig) {
    if (!uploadConfig) return;
    const currentSettings = getSettings();
    const brands = currentSettings.brands || [];
    const brandIdx = (uploadConfig.captionBrandIndex !== undefined && uploadConfig.captionBrandIndex !== "")
        ? uploadConfig.captionBrandIndex
        : uploadConfig.brandIndex;

    const brand = (brandIdx !== undefined && brandIdx !== "" && brands[brandIdx]) ? brands[brandIdx] : null;
    if (!brand) return;

    uploadConfig.captionMode = brand.captionMode || 'standard';
    const personaId = uploadConfig.personaId || uploadConfig.systemPersona || 'default';
    const resolvedPersona = resolvePersona({ personaId, customPrompt: uploadConfig.customPersonaPrompt });
    const needsStory = uploadConfig.captionMode === 'story' || resolvedPersona.mode === 'story' || String(personaId).toLowerCase() === 'mixed';

    if (needsStory && brand.storySourceFile) {
        try {
            uploadConfig.storySourceContent = await fs.readFile(brand.storySourceFile, 'utf8');
            console.log(chalk.cyan(`📖 Story file loaded: ${brand.storySourceFile}`));
        } catch {
            console.log(chalk.yellow(`⚠️ Story file not found: ${brand.storySourceFile}. Proceeding without story content.`));
            uploadConfig.storySourceContent = '';
        }
    } else {
        uploadConfig.storySourceContent = '';
    }
}

// --- API ENDPOINTS ---

app.get('/api/config', (req, res) => {
    const currentSettings = getSettings();
    config.brands = currentSettings.brands || [];
    res.json(currentSettings);
});

app.get('/api/brands', (req, res) => {
    try {
        const currentSettings = getSettings();
        res.json(currentSettings.brands || []);
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

app.post('/api/brands', (req, res) => {
    try {
        const newBrands = req.body;
        if (!Array.isArray(newBrands)) {
            return res.status(400).json({ error: "Invalid format. Expected array." });
        }

        const currentSettings = getSettings();
        currentSettings.brands = newBrands;

        if (saveSettings(currentSettings)) {
            config.brands = newBrands;
            console.log(chalk.green("✅ Brands updated via GUI (Settings.json)"));
            res.json({ success: true, count: newBrands.length });
        } else {
            throw new Error("Failed to save settings file");
        }
    } catch (error) {
        console.error("Failed to save brands:", error);
        res.status(500).json({ error: error.message });
    }
});

app.get('/api/personas', (req, res) => {
    try {
        res.json(getPersonas());
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

app.post('/api/personas', (req, res) => {
    try {
        const list = Array.isArray(req.body) ? req.body : req.body?.personas;
        if (!Array.isArray(list)) {
            return res.status(400).json({ error: "Invalid format. Expected array of personas." });
        }
        const saved = savePersonas(list);
        console.log(chalk.green(`✅ AI Personas updated (${saved.length} persona)`));
        res.json({ success: true, personas: saved });
    } catch (error) {
        console.error("Failed to save personas:", error);
        res.status(500).json({ error: error.message });
    }
});

app.post('/api/personas/reset', (req, res) => {
    try {
        const saved = resetPersonas();
        console.log(chalk.green("✅ AI Personas reset to defaults"));
        res.json({ success: true, personas: saved });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

app.get('/api/encoders', async (req, res) => {
    try {
        const summary = await getEncoderSummary();
        res.json(summary);
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

app.post('/api/settings', (req, res) => {
    try {
        const newSettings = req.body;
        const currentSettings = getSettings();
        const updatedSettings = { ...currentSettings, ...newSettings };

        if (saveSettings(updatedSettings)) {
            console.log(chalk.green("✅ Settings updated via GUI"));
            res.json({ success: true });
        } else {
            throw new Error("Failed to save settings file");
        }
    } catch (error) {
        console.error("Failed to save settings:", error);
        res.status(500).json({ error: error.message });
    }
});

app.post('/api/settings/aio', (req, res) => {
    try {
        const { aio_defaults } = req.body;
        const currentSettings = getSettings();
        const updatedSettings = { ...currentSettings, aio_defaults };

        if (saveSettings(updatedSettings)) {
            console.log(chalk.green("✅ All-In-One Defaults updated via GUI"));
            res.json({ success: true });
        } else {
            throw new Error("Failed to save settings file");
        }
    } catch (error) {
        console.error("Failed to save AIO settings:", error);
        res.status(500).json({ error: error.message });
    }
});

app.post('/api/run/multicut', async (req, res) => {
    try {
        const { sourceDir, clipsDir, settings, fastMode } = req.body;
        console.log(chalk.magenta("\n--- [GUI] Starting Multi-Cut Process ---"));

        const files = await fs.readdir(sourceDir);
        const videoFiles = files.filter(f => [".mp4", ".mkv", ".mov"].includes(path.extname(f).toLowerCase()));

        if (videoFiles.length === 0) {
            console.error("No video files found in source directory.");
            return res.status(400).json({ error: "No video files found" });
        }

        processMultiCut(videoFiles, sourceDir, clipsDir, settings, fastMode)
            .then(() => {
                console.log(chalk.green("✅ [GUI] Multi-Cut Process Completed"));
                io.emit('process-complete', { success: true });
            })
            .catch(err => {
                console.error(`❌ [GUI] Error: ${err.message}`);
                io.emit('process-complete', { success: false, error: err.message });
            });

        res.json({ message: "Process started" });
    } catch (e) {
        res.status(500).json({ error: e.message });
    }
});

app.post('/api/run/all-in-one', async (req, res) => {
    try {
        const { multicut, merge } = req.body;
        console.log(chalk.magenta.bold("\n--- [GUI] Starting ALL-IN-ONE Workflow ---"));

        (async () => {
            try {
                console.log(chalk.cyan("\n[Phase 1/2] Executing Multi-Cut..."));
                const files = await fs.readdir(multicut.sourceDir);
                const videoFiles = files.filter(f => [".mp4", ".mkv", ".mov"].includes(path.extname(f).toLowerCase()));

                if (videoFiles.length === 0) throw new Error("No video files found in source directory.");

                await processMultiCut(videoFiles, multicut.sourceDir, multicut.clipsDir, multicut.settings, multicut.fastMode);
                console.log(chalk.green("✅ [Phase 1/2] Multi-Cut Completed."));

                console.log(chalk.cyan("\n[Phase 2/2] Executing Merge..."));
                const { sourceDir, finalDir, uploadConfig } = merge;

                if (uploadConfig && uploadConfig.scheduleTimes) {
                    uploadConfig.scheduleTimes = uploadConfig.scheduleTimes.map(t => new Date(t));
                }
                await enrichUploadConfigWithBrand(uploadConfig);

                await performMergeLogic(sourceDir, finalDir, uploadConfig);
                console.log(chalk.green("✅ [Phase 2/2] Merge Completed."));

                console.log(chalk.green.bold("\n✨ ALL-IN-ONE Workflow Finished Successfully!"));
                io.emit('process-complete', { success: true });
            } catch (err) {
                console.error(`❌ [GUI] All-In-One Error: ${err.message}`);
                io.emit('process-complete', { success: false, error: err.message });
            } finally {
                try {
                    if (multicut.clipsDir && multicut.clipsDir.includes('temp')) {
                        await fs.rm(multicut.clipsDir, { recursive: true, force: true });
                        console.log(chalk.gray(`🧹 Cleaned up temporary folder: ${multicut.clipsDir}`));
                    }
                } catch (cleanupErr) {
                    console.log(chalk.yellow(`⚠️ Cleanup failed: ${cleanupErr.message}`));
                }
            }
        })();

        res.json({ message: "All-In-One process started" });
    } catch (e) {
        res.status(500).json({ error: e.message });
    }
});

app.post('/api/run/merge', async (req, res) => {
    try {
        const { sourceDir, finalDir, uploadConfig } = req.body;
        console.log(chalk.magenta("\n--- [GUI] Starting Merge Process ---"));

        if (uploadConfig && uploadConfig.scheduleTimes) {
            uploadConfig.scheduleTimes = uploadConfig.scheduleTimes.map(t => new Date(t));
        }
        await enrichUploadConfigWithBrand(uploadConfig);

        performMergeLogic(sourceDir, finalDir, uploadConfig)
            .then(() => {
                console.log(chalk.green("✅ [GUI] Merge Process Completed"));
                io.emit('process-complete', { success: true });
            })
            .catch(err => {
                console.error(`❌ [GUI] Error: ${err.message}`);
                io.emit('process-complete', { success: false, error: err.message });
            });

        res.json({ message: "Process started" });
    } catch (e) {
        res.status(500).json({ error: e.message });
    }
});

app.post('/api/run/hooks', async (req, res) => {
    try {
        const {
            sourceDir,
            finalDir,
            context,
            apiKey,
            brandIndex,
            useCaptions,
            personaId,
            customPersonaPrompt,
            systemPersona,
            hookTimingMode,
            hookStartTime,
            hookDuration
        } = req.body;
        console.log(chalk.magenta("\n--- [GUI] Starting Hook Generation ---"));

        const currentSettings = getSettings();
        const brands = currentSettings.brands || [];

        let brandName = "";
        let brandContentHooks = "";
        let captionMode = "standard";
        let storySummary = "";

        if (brandIndex !== "" && brandIndex !== undefined && brands[brandIndex]) {
            const b = brands[brandIndex];
            brandName = b.name;
            brandContentHooks = b.hooks || "";
            captionMode = b.captionMode || 'standard';
            storySummary = b.hooks || '';
            console.log(chalk.blue(`ℹ️  Using Brand: ${brandName} (Mode: ${captionMode})`));
        }

        const effectivePersonaId = personaId || systemPersona || "default";
        const timingMode = hookTimingMode || 'full';
        const startTime = hookStartTime !== undefined && hookStartTime !== null ? parseFloat(hookStartTime) : null;
        const duration = hookDuration !== undefined && hookDuration !== null ? parseFloat(hookDuration) : null;

        console.log(chalk.blue(`ℹ️  Hook Timing: ${timingMode === 'custom' ? `Detik ${startTime} selama ${duration} detik` : 'Seluruh video (awal sampai akhir)'}`));

        processHooksForFolderCore(
            sourceDir,
            finalDir,
            context,
            apiKey,
            brandName,
            brandContentHooks,
            captionMode,
            storySummary,
            !!useCaptions,
            effectivePersonaId,
            timingMode,
            startTime,
            duration,
            customPersonaPrompt || ""
        )
            .then(() => {
                console.log(chalk.green("✅ [GUI] Hook Process Completed"));
                io.emit('process-complete', { success: true });
            })
            .catch(err => {
                console.error(`❌ [GUI] Error: ${err.message}`);
                io.emit('process-complete', { success: false, error: err.message });
            });

        res.json({ message: "Process started" });
    } catch (e) {
        res.status(500).json({ error: e.message });
    }
});

app.post('/api/run/youtube', async (req, res) => {
    try {
        const { url, outputDir, quality } = req.body;
        console.log(chalk.magenta("\n--- [GUI] Starting YouTube Download Process ---"));

        const urls = url.split(/\r?\n/).map(u => u.trim()).filter(u => u !== "");
        if (urls.length === 0) {
            return res.status(400).json({ error: "No URLs provided" });
        }

        console.log(chalk.cyan(`Target Folder: ${outputDir}`));
        console.log(chalk.cyan(`Processing ${urls.length} URLs...`));

        (async () => {
            let successCount = 0;
            let failCount = 0;

            for (let i = 0; i < urls.length; i++) {
                const currentUrl = urls[i];
                console.log(chalk.blue(`\n[${i + 1}/${urls.length}] Downloading: ${currentUrl}`));

                try {
                    await downloadYoutubeCore(currentUrl, { outputDir, quality });
                    successCount++;
                    console.log(chalk.green(`✓ Done (${i + 1}/${urls.length})`));
                } catch (err) {
                    failCount++;
                    console.error(chalk.red(`✗ Failed: ${currentUrl} - ${err.message}`));
                }
            }

            console.log(chalk.green.bold(`\n✨ YouTube Download Process Finished!`));
            console.log(chalk.cyan(`Total: ${urls.length} | Success: ${successCount} | Failed: ${failCount}`));

            io.emit('process-complete', {
                success: failCount === 0,
                message: `Downloaded ${successCount} videos. ${failCount > 0 ? `${failCount} failed.` : ''}`
            });
        })();

        res.json({ message: `Started batch download for ${urls.length} videos` });
    } catch (e) {
        res.status(500).json({ error: e.message });
    }
});

app.post('/api/run/analyze-video', async (req, res) => {
    try {
        const { url } = req.body;
        console.log(chalk.magenta("\n--- [GUI] Starting AI Video Analysis ---"));
        console.log(chalk.cyan(`URL: ${url}`));

        const analysis = await analyzeVideo(url);

        console.log(chalk.green("✅ [GUI] AI Video Analysis Completed"));
        res.json({ success: true, analysis });
    } catch (e) {
        console.error(`❌ [GUI] Error: ${e.message}`);
        res.status(500).json({ error: e.message });
    }
});

app.post('/api/run/rotate-portrait', async (req, res) => {
    try {
        const { sourceDir } = req.body;
        console.log(chalk.magenta("\n--- [GUI] Starting Batch Auto Portrait ---"));
        console.log(chalk.cyan(`Source: ${sourceDir} | Dest: Replace Original`));

        rotateVideosToPortrait(sourceDir)
            .then(() => {
                console.log(chalk.green("✅ [GUI] Batch Auto Portrait Completed"));
                io.emit('process-complete', { success: true });
            })
            .catch(err => {
                console.error(`❌ [GUI] Error: ${err.message}`);
                io.emit('process-complete', { success: false, error: err.message });
            });

        res.json({ message: "Rotation process started" });
    } catch (e) {
        res.status(500).json({ error: e.message });
    }
});

app.post('/api/run/compress-video', async (req, res) => {
    try {
        const { sourceDir } = req.body;
        console.log(chalk.magenta("\n--- [GUI] Starting Video & Audio Compression ---"));
        console.log(chalk.cyan(`Source: ${sourceDir} | Dest: Replace Original (if smaller)`));

        compressVideos(sourceDir)
            .then(() => {
                console.log(chalk.green("✅ [GUI] Video & Audio Compression Completed"));
                io.emit('process-complete', { success: true });
            })
            .catch(err => {
                console.error(`❌ [GUI] Error: ${err.message}`);
                io.emit('process-complete', { success: false, error: err.message });
            });

        res.json({ message: "Compression process started" });
    } catch (e) {
        res.status(500).json({ error: e.message });
    }
});

// --- AUTO SUBTITLE & MEDIA BROWSER ENDPOINTS ---

const MEDIA_VIDEO_EXTS = new Set(['.mp4', '.mkv', '.mov']);
const MEDIA_AUDIO_EXTS = new Set(['.mp3', '.m4a', '.wav', '.aac', '.flac', '.ogg']);
const ALL_MEDIA_EXTS = new Set([...MEDIA_VIDEO_EXTS, ...MEDIA_AUDIO_EXTS]);

async function renderSubtitledFile({ filePath, outputDir, language = 'id', model, style = {}, onProgress }) {
    const absInput = path.resolve(filePath);
    const outDir = path.resolve(outputDir || path.dirname(absInput));
    await ensureDirectoryExists(outDir);

    const wordsPath = `${absInput}.words.json`;
    let transcriptData = null;
    try {
        const raw = await fs.readFile(wordsPath, 'utf8');
        transcriptData = JSON.parse(raw);
    } catch {
        transcriptData = await transcribe(absInput, { language, model, onProgress });
    }

    const words = Array.isArray(transcriptData?.words) ? transcriptData.words : [];
    if (words.length === 0) {
        throw new Error(`Tidak ada kata terdeteksi pada ${path.basename(absInput)}`);
    }

    const activeSettings = getSettings();
    const mergedStyle = normalizeSubtitleAiSettings({ ...(activeSettings.subtitle_ai || {}), ...(style || {}) });
    const captions = groupWords(words, {
        maxWordsPerLine: mergedStyle.maxWordsPerLine,
        maxLines: mergedStyle.maxLines
    });

    const dims = await getTargetMediaDimensions(absInput);
    const assContent = buildAss(captions, mergedStyle, { width: dims.width, height: dims.height });

    const baseName = path.basename(absInput, path.extname(absInput));
    const assPath = path.join(outDir, `${baseName}_auto.ass`);
    const outputPath = path.join(outDir, `${baseName}_subtitled.mp4`);

    await fs.writeFile(assPath, assContent, 'utf8');
    await burnSubtitles(absInput, assPath, outputPath);
    return outputPath;
}

app.get('/api/subtitle/engine', (req, res) => {
    try {
        res.json(getEngineStatus());
    } catch (e) {
        res.status(500).json({ error: e.message });
    }
});

app.post('/api/subtitle/engine/install', async (req, res) => {
    try {
        const { model = 'small-q5_1' } = req.body || {};
        console.log(chalk.magenta(`\n--- [GUI] Installing Subtitle Engine & Model (${model}) ---`));

        (async () => {
            try {
                const emitProgress = (data) => io.emit('subtitle-progress', data);
                await ensureEngine(emitProgress);
                await ensureModel(model, emitProgress);
                console.log(chalk.green(`✅ Subtitle Engine & Model (${model}) siap digunakan!`));
                io.emit('subtitle-progress', { stage: 'done', model, percent: 100, message: 'Instalasi selesai.' });
                io.emit('process-complete', { success: true, message: `Engine & model ${model} siap.` });
            } catch (err) {
                console.error(chalk.red(`❌ Gagal install subtitle engine: ${err.message}`));
                io.emit('subtitle-progress', { stage: 'error', percent: 0, message: err.message });
                io.emit('process-complete', { success: false, error: err.message });
            }
        })();

        res.json({ message: 'Engine installation started' });
    } catch (e) {
        res.status(500).json({ error: e.message });
    }
});

app.post('/api/subtitle/transcribe', async (req, res) => {
    try {
        const { filePath, language = 'id', model, force = false } = req.body || {};
        if (!filePath) {
            return res.status(400).json({ error: 'filePath wajib diisi.' });
        }
        const result = await transcribe(filePath, {
            language,
            model,
            force: Boolean(force),
            onProgress: (data) => io.emit('subtitle-progress', data)
        });
        res.json({ success: true, ...result });
    } catch (e) {
        console.error(chalk.red(`❌ Transcribe error: ${e.message}`));
        res.status(500).json({ error: e.message });
    }
});

app.post('/api/subtitle/words', async (req, res) => {
    try {
        const { filePath, words } = req.body || {};
        if (!filePath || !Array.isArray(words)) {
            return res.status(400).json({ error: 'filePath dan words array wajib diisi.' });
        }
        const absInput = path.resolve(filePath);
        const cachePath = `${absInput}.words.json`;

        let existing = {};
        try {
            existing = JSON.parse(await fs.readFile(cachePath, 'utf8'));
        } catch { /* create new */ }

        const updated = {
            ...existing,
            words,
            updatedAt: new Date().toISOString()
        };
        await fs.writeFile(cachePath, JSON.stringify(updated, null, 2), 'utf8');
        res.json({ success: true, words });
    } catch (e) {
        res.status(500).json({ error: e.message });
    }
});

app.post('/api/subtitle/burn', async (req, res) => {
    try {
        const { filePath, outputDir, language = 'id', model, style } = req.body || {};
        if (!filePath) {
            return res.status(400).json({ error: 'filePath wajib diisi.' });
        }
        const outputPath = await renderSubtitledFile({
            filePath,
            outputDir,
            language,
            model,
            style,
            onProgress: (data) => io.emit('subtitle-progress', data)
        });
        res.json({ success: true, outputPath });
    } catch (e) {
        console.error(chalk.red(`❌ Burn subtitle error: ${e.message}`));
        res.status(500).json({ error: e.message });
    }
});

app.post('/api/run/subtitle-batch', async (req, res) => {
    try {
        const { sourceDir, finalDir, language = 'id', model, style } = req.body || {};
        if (!sourceDir || !finalDir) {
            return res.status(400).json({ error: 'sourceDir dan finalDir wajib diisi.' });
        }

        const absSource = path.resolve(sourceDir);
        const entries = await fs.readdir(absSource, { withFileTypes: true });
        const mediaFiles = entries
            .filter((ent) => ent.isFile() && ALL_MEDIA_EXTS.has(path.extname(ent.name).toLowerCase()))
            .map((ent) => path.join(absSource, ent.name));

        if (mediaFiles.length === 0) {
            return res.status(400).json({ error: 'Tidak ada file video atau audio di folder sumber.' });
        }

        console.log(chalk.magenta(`\n--- [GUI] Starting Auto Subtitle Batch (${mediaFiles.length} files) ---`));

        (async () => {
            let successCount = 0;
            let failCount = 0;
            for (let i = 0; i < mediaFiles.length; i++) {
                const f = mediaFiles[i];
                console.log(chalk.cyan(`\n[${i + 1}/${mediaFiles.length}] Memproses: ${path.basename(f)}`));
                try {
                    await renderSubtitledFile({
                        filePath: f,
                        outputDir: finalDir,
                        language,
                        model,
                        style,
                        onProgress: (data) => io.emit('subtitle-progress', { ...data, fileIndex: i + 1, totalFiles: mediaFiles.length })
                    });
                    successCount++;
                } catch (err) {
                    failCount++;
                    console.error(chalk.red(`   ❌ Gagal (${path.basename(f)}): ${err.message}`));
                }
            }
            console.log(chalk.green.bold(`\n🎉 Auto Subtitle Batch selesai! Sukses: ${successCount}, Gagal: ${failCount}`));
            io.emit('process-complete', {
                success: failCount === 0,
                message: `Subtitle batch selesai (${successCount}/${mediaFiles.length} berhasil).`
            });
        })();

        res.json({ message: `Started batch auto-subtitle for ${mediaFiles.length} files` });
    } catch (e) {
        res.status(500).json({ error: e.message });
    }
});

app.get('/api/media', async (req, res) => {
    try {
        const rawPath = String(req.query.path || '').trim();
        if (!rawPath) {
            return res.status(400).json({ error: 'Parameter path wajib diisi.' });
        }
        const absPath = path.resolve(rawPath);
        const ext = path.extname(absPath).toLowerCase();
        if (!ALL_MEDIA_EXTS.has(ext)) {
            return res.status(403).json({ error: 'Ekstensi file tidak didukung untuk preview media.' });
        }
        const stat = await fs.stat(absPath).catch(() => null);
        if (!stat || !stat.isFile()) {
            return res.status(404).json({ error: 'File media tidak ditemukan.' });
        }
        res.sendFile(absPath);
    } catch (e) {
        res.status(500).json({ error: e.message });
    }
});

app.get('/api/fs/list', async (req, res) => {
    try {
        const rawDir = String(req.query.dir || '').trim();
        if (!rawDir) {
            return res.status(400).json({ error: 'Parameter dir wajib diisi.' });
        }
        const absDir = path.resolve(rawDir);
        const statDir = await fs.stat(absDir).catch(() => null);
        if (!statDir || !statDir.isDirectory()) {
            return res.json({ dir: absDir, exists: false, files: [] });
        }
        const entries = await fs.readdir(absDir, { withFileTypes: true });
        const results = [];

        for (const ent of entries) {
            if (!ent.isFile()) continue;
            const ext = path.extname(ent.name).toLowerCase();
            if (!ALL_MEDIA_EXTS.has(ext)) continue;

            const fullPath = path.join(absDir, ent.name);
            const stat = await fs.stat(fullPath).catch(() => null);
            const hasTranscript = await fs.access(`${fullPath}.words.json`).then(() => true).catch(() => false);
            results.push({
                name: ent.name,
                path: fullPath,
                ext,
                type: MEDIA_AUDIO_EXTS.has(ext) ? 'audio' : 'video',
                size: stat ? stat.size : 0,
                hasTranscript
            });
        }

        res.json({ dir: absDir, exists: true, files: results });
    } catch (e) {
        res.status(500).json({ error: e.message });
    }
});

// Load enabled addons
loadAddons({ app, io });

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
    console.log(chalk.green.bold(`\n🌐 GUI Server running at http://localhost:${PORT}`));
    if (!process.env.NO_OPEN) {
        open(`http://localhost:${PORT}`);
    }
});
