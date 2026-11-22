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
    multiFileCutAndMerge, // Just in case
    rotateVideosToPortrait,
    compressVideos
} = require('./core/processor');
const { downloadYoutubeCore } = require('./core/downloader');
const { analyzeVideo } = require('./core/analyzer');
const config = require('./config');
const fs = require('fs/promises');

const app = express();
const server = http.createServer(app);
const io = socketIo(server);

app.use(express.static(path.join(__dirname, '../public')));
app.use(express.json());

// --- LOGGING INTERCEPTION ---
const originalLog = console.log;
const originalError = console.error;
const originalWrite = process.stdout.write;

function broadcastLog(message, type = 'info') {
    // Strip ANSI codes for web display if needed, but xterm.js handles them well.
    // For simple HTML display, stripping is better.
    // Let's send raw for now, frontend can handle it or we use a basic pre block.
    // Actually, simple text is safer for basic display.
    // But we want colors? Let's just send text.
    // For now, let's strip colors for the GUI to keep it simple.
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

// Override process.stdout.write to capture progress bars etc.
// But this might duplicate console.log calls if they use stdout under the hood.
// console.log usually writes to stdout with newline.
// We'll skip this for now to avoid complexity/duplication, relying on console.log.


// --- API ENDPOINTS ---

app.get('/api/config', (req, res) => {
    // Reload settings to ensure fresh data
    const currentSettings = getSettings();
    config.brands = currentSettings.brands || [];
    // Ensure repliz_account_id is always an array for frontend consistency
    if (currentSettings.repliz_account_id && !Array.isArray(currentSettings.repliz_account_id)) {
        currentSettings.repliz_account_id = [currentSettings.repliz_account_id];
    }
    res.json(currentSettings); // Send full settings, not just config object
});

const { getSettings, saveSettings } = require("./utils/settings_manager");

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
        const newBrands = req.body; // Expect array of brands
        if (!Array.isArray(newBrands)) {
            return res.status(400).json({ error: "Invalid format. Expected array." });
        }

        const currentSettings = getSettings();

        // Update brands in settings
        currentSettings.brands = newBrands;

        if (saveSettings(currentSettings)) {
            // Hot-reload config
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

app.post('/api/settings', (req, res) => {
    try {
        const newSettings = req.body;
        const currentSettings = getSettings();

        // Merge new settings into current settings
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

        // Run async to not block response
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

        // Use helper to run sequential logic
        (async () => {
            try {
                // 1. MULTI-CUT
                console.log(chalk.cyan("\n[Phase 1/2] Executing Multi-Cut..."));
                const files = await fs.readdir(multicut.sourceDir);
                const videoFiles = files.filter(f => [".mp4", ".mkv", ".mov"].includes(path.extname(f).toLowerCase()));

                if (videoFiles.length === 0) throw new Error("No video files found in source directory.");

                await processMultiCut(videoFiles, multicut.sourceDir, multicut.clipsDir, multicut.settings, multicut.fastMode);
                console.log(chalk.green("✅ [Phase 1/2] Multi-Cut Completed."));

                // 2. MERGE & UPLOAD
                console.log(chalk.cyan("\n[Phase 2/2] Executing Merge & Upload..."));
                const { sourceDir, finalDir, uploadConfig } = merge;

                if (uploadConfig && uploadConfig.scheduleTimes) {
                    uploadConfig.scheduleTimes = uploadConfig.scheduleTimes.map(t => new Date(t));
                }

                // Enrich uploadConfig with brand settings (copying logic from /api/run/merge)
                const currentSettings = getSettings();
                const brands = currentSettings.brands || [];
                const brandIdx = uploadConfig && (uploadConfig.captionBrandIndex !== undefined && uploadConfig.captionBrandIndex !== "")
                    ? uploadConfig.captionBrandIndex
                    : (uploadConfig ? uploadConfig.brandIndex : undefined);

                const brand = (brandIdx !== undefined && brands[brandIdx]) ? brands[brandIdx] : {};
                uploadConfig.captionMode = brand.captionMode || 'standard';
                if (uploadConfig.captionMode === 'story' && brand.storySourceFile) {
                    try {
                        uploadConfig.storySourceContent = await fs.readFile(brand.storySourceFile, 'utf8');
                        console.log(chalk.cyan(`📖 Story file loaded: ${brand.storySourceFile}`));
                    } catch (e) {
                        console.log(chalk.yellow(`⚠️ Story file not found: ${brand.storySourceFile}. Proceeding without story content.`));
                        uploadConfig.storySourceContent = '';
                    }
                } else {
                    uploadConfig.storySourceContent = '';
                }

                await performMergeLogic(sourceDir, finalDir, uploadConfig);
                console.log(chalk.green("✅ [Phase 2/2] Merge & Upload Completed."));

                console.log(chalk.green.bold("\n✨ ALL-IN-ONE Workflow Finished Successfully!"));
                io.emit('process-complete', { success: true });
            } catch (err) {
                console.error(`❌ [GUI] All-In-One Error: ${err.message}`);
                io.emit('process-complete', { success: false, error: err.message });
            } finally {
                // Cleanup temp folder
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

        // Enrich uploadConfig with captionMode + storySourceContent from brand
        const currentSettings = getSettings();
        const brands = currentSettings.brands || [];
        const brandIdx = uploadConfig && (uploadConfig.captionBrandIndex !== undefined && uploadConfig.captionBrandIndex !== "")
            ? uploadConfig.captionBrandIndex
            : (uploadConfig ? uploadConfig.brandIndex : undefined);

        if (uploadConfig && brandIdx !== undefined && brandIdx !== "" && brands[brandIdx]) {
            const brand = brands[brandIdx];
            uploadConfig.captionMode = brand.captionMode || 'standard';
            // Read story file if story mode
            if (uploadConfig.captionMode === 'story' && brand.storySourceFile) {
                try {
                    uploadConfig.storySourceContent = await fs.readFile(brand.storySourceFile, 'utf8');
                    console.log(chalk.cyan(`📖 Story file loaded: ${brand.storySourceFile}`));
                } catch (e) {
                    console.log(chalk.yellow(`⚠️ Story file not found: ${brand.storySourceFile}. Proceeding without story content.`));
                    uploadConfig.storySourceContent = '';
                }
            } else {
                uploadConfig.storySourceContent = '';
            }
        }

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

app.post('/api/run/upload-repliz', async (req, res) => {
    try {
        const { uploadDir, scheduleSettings } = req.body;
        console.log(chalk.magenta("\n--- [GUI] Starting Standalone Repliz Upload ---"));

        if (scheduleSettings && scheduleSettings.scheduleTimes) {
            scheduleSettings.scheduleTimes = scheduleSettings.scheduleTimes.map(t => new Date(t));
        }

        (async () => {
            try {
                const { processStandaloneUpload } = require('./core/processor');
                await processStandaloneUpload(uploadDir, scheduleSettings);
                console.log(chalk.green.bold("\n✨ Standalone Upload Workflow Finished Successfully!"));
                io.emit('process-complete', { success: true });
            } catch (err) {
                console.error(`❌ [GUI] Upload Error: ${err.message}`);
                io.emit('process-complete', { success: false, error: err.message });
            }
        })();

        res.json({ message: "Upload process started" });
    } catch (e) {
        res.status(500).json({ error: e.message });
    }
});

app.post('/api/run/hooks', async (req, res) => {
    try {
        const { sourceDir, finalDir, context, apiKey, brandIndex, useCaptions, systemPersona, hookTimingMode, hookStartTime, hookDuration } = req.body;
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
            // For story mode, a simple summary is the content focus (used as storySummary for hook alignment)
            storySummary = b.hooks || '';
            console.log(chalk.blue(`ℹ️  Using Brand: ${brandName} (Mode: ${captionMode})`));
        }

        // Parse timing parameters
        const timingMode = hookTimingMode || 'full';
        const startTime = hookStartTime !== undefined && hookStartTime !== null ? parseFloat(hookStartTime) : null;
        const duration = hookDuration !== undefined && hookDuration !== null ? parseFloat(hookDuration) : null;

        console.log(chalk.blue(`ℹ️  Hook Timing: ${timingMode === 'custom' ? `Detik ${startTime} selama ${duration} detik` : 'Seluruh video (awal sampai akhir)'}`));

        processHooksForFolderCore(sourceDir, finalDir, context, apiKey, brandName, brandContentHooks, captionMode, storySummary, !!useCaptions, systemPersona || "default", timingMode, startTime, duration)
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

app.post('/api/run/subtitle', async (req, res) => {
    try {
        const { sourceDir, finalDir, context, srtWavDir } = req.body;
        console.log(chalk.magenta("\n--- [GUI] Starting Subtitle Generation ---"));

        const { processSubtitleForFolderCore } = require('./core/subtitle');

        // Read voice from settings
        const currentSettings = getSettings();
        const voice = currentSettings.tiktok_voice || 'id_001';

        processSubtitleForFolderCore(sourceDir, finalDir, context, voice, srtWavDir)
            .then(() => {
                console.log(chalk.green("✅ [GUI] Subtitle Process Completed"));
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

        // Split URLs by newline and filter empty ones
        const urls = url.split(/\r?\n/).map(u => u.trim()).filter(u => u !== "");

        if (urls.length === 0) {
            return res.status(400).json({ error: "No URLs provided" });
        }

        console.log(chalk.cyan(`Target Folder: ${outputDir}`));
        console.log(chalk.cyan(`Processing ${urls.length} URLs...`));

        // Process sequentially
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

        // Execute rotation asynchronously
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
        console.log(chalk.magenta("\n--- [GUI] Starting Video Compression ---"));
        console.log(chalk.cyan(`Source: ${sourceDir} | Dest: Replace Original`));

        // Execute compression asynchronously
        compressVideos(sourceDir)
            .then(() => {
                console.log(chalk.green("✅ [GUI] Video Compression Completed"));
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

const PORT = 3000;
server.listen(PORT, () => {
    console.log(chalk.green.bold(`\n🌐 GUI Server running at http://localhost:${PORT}`));
    open(`http://localhost:${PORT}`);
});
