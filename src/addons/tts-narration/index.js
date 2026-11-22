const path = require("path");
const fs = require("fs/promises");
const chalk = require("chalk");
const { processSubtitleForFolderCore } = require("./tts_subtitle");
const { ensureDirectoryExists } = require("../../utils/shell");

module.exports = {
    id: "tts-narration",
    name: "TikTok TTS & Narasi AI",
    description: "Generate monolog AI dengan suara TikTok TTS serta sinkronisasi pasangan file .srt dan .wav eksternal.",
    icon: "fa-microphone-alt",
    defaultSettings: {
        enabled: false,
        tiktok_session_id: "",
        tiktok_voice: "id_001"
    },

    register({ app, io, registerHook, getSettings, saveSettings }) {
        const readAddon = () => {
            const s = getSettings();
            return {
                ...this.defaultSettings,
                ...(s.addons?.["tts-narration"] || {})
            };
        };

        registerHook("afterMergeMedia", async ({ finalVideos = [], finalDir, uploadConfig = {} }) => {
            const wantsTts = Boolean(uploadConfig?.addons?.["tts-narration"] || uploadConfig?.useSubtitles);
            if (!wantsTts || finalVideos.length === 0) return;

            const cfg = readAddon();
            const subtitleTempDir = path.join(finalDir, "_temp_tts_subtitled");
            await ensureDirectoryExists(subtitleTempDir);

            try {
                console.log(chalk.cyan(`\n🎙️ [Addon TTS Narration] Memproses ${finalVideos.length} video...`));
                await processSubtitleForFolderCore(
                    finalDir,
                    subtitleTempDir,
                    uploadConfig.captionContext || uploadConfig.hookContext || "",
                    cfg.tiktok_voice || "id_001",
                    uploadConfig.srtWavDir || ""
                );

                const subbedFiles = await fs.readdir(subtitleTempDir);
                for (const originalFile of finalVideos) {
                    const originalBase = path.basename(originalFile, path.extname(originalFile));
                    const expectedSubFile = `${originalBase}_subtitled.mp4`;
                    if (subbedFiles.includes(expectedSubFile)) {
                        await fs.copyFile(path.join(subtitleTempDir, expectedSubFile), originalFile);
                    }
                }
                console.log(chalk.green("✅ [Addon TTS Narration] Selesai."));
            } catch (err) {
                console.error(chalk.red(`❌ [Addon TTS Narration] Gagal: ${err.message}`));
            } finally {
                await fs.rm(subtitleTempDir, { recursive: true, force: true }).catch(() => {});
            }
        });

        app.get("/api/addons/tts-narration/settings", (req, res) => {
            res.json(readAddon());
        });

        app.post("/api/addons/tts-narration/settings", (req, res) => {
            try {
                const body = req.body || {};
                const settings = getSettings();
                if (!settings.addons || typeof settings.addons !== "object") {
                    settings.addons = {};
                }
                const next = {
                    ...readAddon(),
                    tiktok_session_id: body.tiktok_session_id !== undefined ? String(body.tiktok_session_id).trim() : readAddon().tiktok_session_id,
                    tiktok_voice: body.tiktok_voice !== undefined ? String(body.tiktok_voice).trim() : readAddon().tiktok_voice
                };
                settings.addons["tts-narration"] = next;
                if (!saveSettings(settings)) {
                    throw new Error("Gagal menyimpan pengaturan TTS.");
                }
                res.json({ success: true, settings: next });
            } catch (err) {
                res.status(500).json({ error: err.message });
            }
        });

        const handleRun = (req, res) => {
            try {
                const { sourceDir, finalDir, context, srtWavDir, voice } = req.body || {};
                if (!sourceDir || !finalDir) {
                    return res.status(400).json({ error: "sourceDir dan finalDir wajib diisi." });
                }
                const cfg = readAddon();
                const chosenVoice = voice || cfg.tiktok_voice || "id_001";

                console.log(chalk.magenta("\n--- [Addon TTS Narration] Starting Process ---"));
                processSubtitleForFolderCore(sourceDir, finalDir, context, chosenVoice, srtWavDir)
                    .then(() => {
                        console.log(chalk.green("✅ [Addon TTS Narration] Completed"));
                        io.emit("process-complete", { success: true });
                    })
                    .catch((err) => {
                        console.error(`❌ [Addon TTS Narration] Error: ${err.message}`);
                        io.emit("process-complete", { success: false, error: err.message });
                    });

                res.json({ message: "TTS Narration process started" });
            } catch (err) {
                res.status(500).json({ error: err.message });
            }
        };

        app.post("/api/addons/tts-narration/run", handleRun);
        app.post("/api/run/subtitle", handleRun);
    }
};
