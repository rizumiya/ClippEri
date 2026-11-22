const fs = require("fs");
const fsp = require("fs/promises");
const path = require("path");
const os = require("os");
const axios = require("axios");
const chalk = require("chalk");
const { execFile } = require("child_process");
const { promisify } = require("util");
const { runCommand, ensureDirectoryExists } = require("../utils/shell");
const { getSettings, saveSettings } = require("../utils/settings_manager");

const execFilePromise = promisify(execFile);

const WHISPER_ROOT = path.join(process.cwd(), "tools", "whisper");
const WHISPER_BIN_DIR = path.join(WHISPER_ROOT, "bin");
const WHISPER_MODELS_DIR = path.join(WHISPER_ROOT, "models");

const MODEL_CATALOG = [
    { name: "base-q5_1", label: "Base Q5_1 (~60 MB) - Cepat", sizeMB: 60 },
    { name: "small-q5_1", label: "Small Q5_1 (~190 MB) - Rekomendasi", sizeMB: 190 },
    { name: "medium-q5_0", label: "Medium Q5_0 (~540 MB) - Akurat", sizeMB: 540 }
];

function findExecutableRecursive(dir, targets = ["whisper-cli.exe", "main.exe"]) {
    if (!fs.existsSync(dir)) return null;
    const entries = fs.readdirSync(dir, { withFileTypes: true });
    for (const target of targets) {
        const direct = entries.find((e) => e.isFile() && e.name.toLowerCase() === target.toLowerCase());
        if (direct) return path.join(dir, direct.name);
    }
    for (const entry of entries) {
        if (!entry.isDirectory()) continue;
        const found = findExecutableRecursive(path.join(dir, entry.name), targets);
        if (found) return found;
    }
    return null;
}

function resolveBinPath() {
    const settings = getSettings();
    const saved = settings.subtitle_engine?.binPath;
    if (saved && fs.existsSync(saved)) {
        return saved;
    }
    const found = findExecutableRecursive(WHISPER_ROOT);
    if (found) {
        settings.subtitle_engine = {
            ...(settings.subtitle_engine || {}),
            binPath: found
        };
        saveSettings(settings);
    }
    return found;
}

function getModelPath(modelName) {
    return path.join(WHISPER_MODELS_DIR, `ggml-${modelName}.bin`);
}

function getEngineStatus() {
    const settings = getSettings();
    const binPath = resolveBinPath();
    const models = MODEL_CATALOG.map((m) => {
        const modelFile = getModelPath(m.name);
        let downloaded = false;
        let sizeBytes = 0;
        if (fs.existsSync(modelFile)) {
            const stat = fs.statSync(modelFile);
            sizeBytes = stat.size;
            downloaded = stat.size > 1024 * 1024;
        }
        return {
            ...m,
            downloaded,
            sizeBytes
        };
    });

    return {
        binReady: Boolean(binPath && fs.existsSync(binPath)),
        binPath: binPath || "",
        defaultModel: settings.subtitle_engine?.defaultModel || "small-q5_1",
        models
    };
}

async function downloadFileStream(url, destPath, onProgress, stageInfo = {}) {
    await ensureDirectoryExists(path.dirname(destPath));
    const partPath = `${destPath}.part`;

    const response = await axios.get(url, {
        responseType: "stream",
        headers: { "User-Agent": "VideoToolkit" },
        maxRedirects: 10,
        timeout: 60000
    });

    const totalBytes = parseInt(response.headers["content-length"] || "0", 10);
    let downloadedBytes = 0;
    let lastReport = 0;

    const writer = fs.createWriteStream(partPath);

    await new Promise((resolve, reject) => {
        response.data.on("data", (chunk) => {
            downloadedBytes += chunk.length;
            const now = Date.now();
            if (onProgress && (now - lastReport > 250 || (totalBytes > 0 && downloadedBytes >= totalBytes))) {
                lastReport = now;
                const percent = totalBytes > 0 ? Math.min(100, Math.round((downloadedBytes / totalBytes) * 100)) : 0;
                onProgress({
                    ...stageInfo,
                    percent,
                    downloadedMB: (downloadedBytes / (1024 * 1024)).toFixed(1),
                    totalMB: totalBytes > 0 ? (totalBytes / (1024 * 1024)).toFixed(1) : "?"
                });
            }
        });
        response.data.on("error", reject);
        writer.on("error", reject);
        writer.on("finish", resolve);
        response.data.pipe(writer);
    });

    await fsp.rename(partPath, destPath);
    return destPath;
}

async function ensureEngine(onProgress) {
    const existing = resolveBinPath();
    if (existing && fs.existsSync(existing)) {
        return existing;
    }

    await ensureDirectoryExists(WHISPER_BIN_DIR);
    if (onProgress) onProgress({ stage: "engine", percent: 0, message: "Mencari rilis terbaru whisper.cpp..." });

    const releaseRes = await axios.get("https://api.github.com/repos/ggml-org/whisper.cpp/releases?per_page=10", {
        headers: { "User-Agent": "VideoToolkit" },
        timeout: 20000
    });

    const releases = Array.isArray(releaseRes.data) ? releaseRes.data : [];
    let asset = null;
    for (const rel of releases) {
        const assets = Array.isArray(rel?.assets) ? rel.assets : [];
        asset = assets.find((a) => /^whisper-bin-x64\.zip$/i.test(a.name))
            || assets.find((a) => /^whisper-blas-bin-x64\.zip$/i.test(a.name));
        if (asset) break;
    }

    if (!asset) {
        throw new Error("Asset whisper-bin-x64.zip tidak ditemukan di rilis whisper.cpp.");
    }

    const zipPath = path.join(WHISPER_ROOT, asset.name);
    console.log(chalk.cyan(`⬇️  Mengunduh ${asset.name}...`));
    await downloadFileStream(asset.browser_download_url, zipPath, onProgress, {
        stage: "engine",
        message: `Mengunduh ${asset.name}...`
    });

    if (onProgress) onProgress({ stage: "engine", percent: 95, message: "Mengekstrak binary whisper.cpp..." });
    console.log(chalk.cyan("📦 Mengekstrak whisper.cpp..."));

    try {
        await execFilePromise("tar", ["-xf", zipPath, "-C", WHISPER_BIN_DIR]);
    } catch {
        await execFilePromise("powershell", [
            "-NoProfile",
            "-Command",
            `Expand-Archive -LiteralPath '${zipPath.replace(/'/g, "''")}' -DestinationPath '${WHISPER_BIN_DIR.replace(/'/g, "''")}' -Force`
        ]);
    }

    await fsp.unlink(zipPath).catch(() => {});

    const binPath = findExecutableRecursive(WHISPER_BIN_DIR);
    if (!binPath) {
        throw new Error("whisper-cli.exe tidak ditemukan setelah ekstraksi.");
    }

    const settings = getSettings();
    settings.subtitle_engine = {
        ...(settings.subtitle_engine || {}),
        binPath
    };
    saveSettings(settings);

    if (onProgress) onProgress({ stage: "engine", percent: 100, message: "Engine whisper.cpp siap." });
    console.log(chalk.green(`✅ Engine whisper.cpp siap: ${binPath}`));
    return binPath;
}

async function ensureModel(name = "small-q5_1", onProgress) {
    const valid = MODEL_CATALOG.find((m) => m.name === name);
    const modelName = valid ? valid.name : "small-q5_1";
    const destPath = getModelPath(modelName);

    if (fs.existsSync(destPath)) {
        const stat = fs.statSync(destPath);
        if (stat.size > 1024 * 1024) {
            return destPath;
        }
    }

    const url = `https://huggingface.co/ggerganov/whisper.cpp/resolve/main/ggml-${modelName}.bin`;
    console.log(chalk.cyan(`⬇️  Mengunduh model whisper: ggml-${modelName}.bin...`));
    await downloadFileStream(url, destPath, onProgress, {
        stage: "model",
        model: modelName,
        message: `Mengunduh model ${modelName}...`
    });

    if (onProgress) onProgress({ stage: "model", model: modelName, percent: 100, message: `Model ${modelName} siap.` });
    console.log(chalk.green(`✅ Model ${modelName} siap: ${destPath}`));
    return destPath;
}

async function probeMediaDuration(filePath) {
    try {
        const out = await runCommand(`ffprobe -v error -show_entries format=duration -of default=noprint_wrappers=1:nokey=1 "${filePath}"`);
        return parseFloat(out.trim()) || 0;
    } catch {
        return 0;
    }
}

function parseWhisperTranscriptionJson(jsonObj) {
    const items = Array.isArray(jsonObj?.transcription) ? jsonObj.transcription : [];
    const words = [];

    for (const item of items) {
        const rawText = String(item.text || "").trim();
        if (!rawText) continue;
        if (/^\[.*\]$/.test(rawText) || /^<.*>$/.test(rawText)) continue;

        const fromMs = Number(item.offsets?.from);
        const toMs = Number(item.offsets?.to);
        if (!Number.isFinite(fromMs) || !Number.isFinite(toMs)) continue;

        const start = Math.max(0, fromMs / 1000);
        const end = Math.max(start + 0.04, toMs / 1000);

        if (/^[.,;:!?…]+$/.test(rawText) && words.length > 0) {
            const prev = words[words.length - 1];
            prev.text += rawText;
            prev.end = Math.max(prev.end, end);
            continue;
        }

        words.push({
            text: rawText,
            start: Number(start.toFixed(3)),
            end: Number(end.toFixed(3))
        });
    }

    return words;
}

async function transcribe(inputPath, { language = "id", model, force = false, onProgress } = {}) {
    const absInput = path.resolve(inputPath);
    if (!fs.existsSync(absInput)) {
        throw new Error(`File media tidak ditemukan: ${absInput}`);
    }

    const cachePath = `${absInput}.words.json`;
    if (!force && fs.existsSync(cachePath)) {
        const cachedRaw = await fsp.readFile(cachePath, "utf8");
        const cached = JSON.parse(cachedRaw);
        if (Array.isArray(cached.words)) {
            return cached;
        }
    }

    const settings = getSettings();
    const modelName = model || settings.subtitle_engine?.defaultModel || "small-q5_1";
    const binPath = await ensureEngine(onProgress);
    const modelPath = await ensureModel(modelName, onProgress);

    const tempDir = path.join(process.cwd(), "temp");
    await ensureDirectoryExists(tempDir);
    const stamp = `${Date.now()}_${Math.floor(Math.random() * 1000)}`;
    const tempWav = path.join(tempDir, `sub_${stamp}.wav`);
    const tempBase = path.join(tempDir, `sub_${stamp}`);
    const tempJson = `${tempBase}.json`;

    try {
        if (onProgress) onProgress({ stage: "transcribe", percent: 15, message: "Mengekstrak audio 16kHz..." });
        await runCommand(`ffmpeg -y -i "${absInput}" -vn -ac 1 -ar 16000 -c:a pcm_s16le "${tempWav}"`);

        if (onProgress) onProgress({ stage: "transcribe", percent: 45, message: `Transkripsi audio (${modelName}, lang=${language || "id"})...` });
        const threads = Math.min(4, os.cpus().length || 4);
        const binDir = path.dirname(binPath);
        const args = [
            "-m", modelPath,
            "-f", tempWav,
            "-l", language || "id",
            "-ml", "1",
            "-sow",
            "-oj",
            "-of", tempBase,
            "-t", String(threads)
        ];

        await execFilePromise(binPath, args, {
            cwd: binDir,
            env: {
                ...process.env,
                PATH: `${binDir}${path.delimiter}${process.env.PATH || ""}`
            },
            maxBuffer: 20 * 1024 * 1024
        });

        if (!fs.existsSync(tempJson)) {
            throw new Error("File output JSON dari whisper.cpp tidak ditemukan.");
        }

        const rawJson = JSON.parse(await fsp.readFile(tempJson, "utf8"));
        const words = parseWhisperTranscriptionJson(rawJson);
        const duration = await probeMediaDuration(absInput);

        const result = {
            words,
            language: language || "id",
            model: modelName,
            duration,
            updatedAt: new Date().toISOString()
        };

        await fsp.writeFile(cachePath, JSON.stringify(result, null, 2), "utf8");
        if (onProgress) onProgress({ stage: "transcribe", percent: 100, message: `Selesai (${words.length} kata)` });
        return result;
    } finally {
        await fsp.unlink(tempWav).catch(() => {});
        await fsp.unlink(tempJson).catch(() => {});
    }
}

module.exports = {
    MODEL_CATALOG,
    getEngineStatus,
    ensureEngine,
    ensureModel,
    transcribe,
    parseWhisperTranscriptionJson
};
