const fs = require("fs");
const fsp = require("fs/promises");
const path = require("path");
const chalk = require("chalk");
const { getApiKeyList, callWithFallback, buildModel } = require("./ai_hook");
const { resolvePersona } = require("./personas");
const { groupWords, buildAss } = require("./subtitle_render");
const { synthesizeEdgeTTS } = require("../utils/edge_tts");
const { searchStockImage } = require("../utils/stock_media");
const { getAudioFiles, getRandomAudio } = require("../utils/audio");
const { runEncode } = require("../utils/encoder");
const { runCommand, ensureDirectoryExists } = require("../utils/shell");
const { getSettings } = require("../utils/settings_manager");
const { escapeAssFilterPath, normalizeSubtitleAiSettings } = require("../utils/ass_helpers");

const IMAGE_EXTS = new Set([".jpg", ".jpeg", ".png", ".webp"]);
const VIDEO_EXTS = new Set([".mp4", ".mkv", ".mov"]);

function slugifyName(str, fallback = "forge_video") {
    const clean = String(str || "")
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, "_")
        .replace(/^_+|_+$/g, "")
        .slice(0, 42);
    return clean || fallback;
}

function getMimeType(filePath) {
    const ext = path.extname(filePath).toLowerCase();
    if (ext === ".png") return "image/png";
    if (ext === ".webp") return "image/webp";
    return "image/jpeg";
}

function parseForgeScriptJson(rawText) {
    const cleaned = String(rawText || "")
        .replace(/```json\s*/gi, "")
        .replace(/```/g, "")
        .trim();

    const startObj = cleaned.indexOf("{");
    const endObj = cleaned.lastIndexOf("}");
    if (startObj === -1 || endObj === -1 || endObj <= startObj) {
        throw new Error("Respon AI tidak berisi JSON skrip yang valid.");
    }

    const parsed = JSON.parse(cleaned.slice(startObj, endObj + 1));
    if (!parsed || !Array.isArray(parsed.scenes) || parsed.scenes.length === 0) {
        throw new Error("Skrip AI tidak memiliki array scenes yang valid.");
    }

    return {
        title: String(parsed.title || "Video Konten").trim(),
        hook: String(parsed.hook || "").trim(),
        caption: String(parsed.caption || "").trim(),
        scenes: parsed.scenes.map((sc, i) => ({
            narration: String(sc?.narration || "").trim(),
            visualQuery: String(sc?.visualQuery || "minimalist lifestyle background").trim(),
            useProductImage: Boolean(sc?.useProductImage ?? (i === 0 || i === parsed.scenes.length - 1))
        })).filter((sc) => sc.narration !== "")
    };
}

async function generateForgeScript({
    mode = "product",
    productName = "",
    sellingPoints = "",
    topic = "",
    cta = "",
    durationSec = 25,
    sceneCount = 4,
    personaId = "default",
    customPersonaPrompt = "",
    productImagePath = ""
} = {}) {
    const keys = getApiKeyList();
    if (keys.length === 0) {
        throw new Error("Gemini API Key belum diatur di Pengaturan -> AI & API Key.");
    }

    const persona = resolvePersona({ personaId, customPrompt: customPersonaPrompt });
    const safeDur = Math.max(10, Math.min(90, parseInt(durationSec, 10) || 25));
    const safeScenes = Math.max(2, Math.min(8, parseInt(sceneCount, 10) || 4));
    const targetWords = Math.max(18, Math.round(safeDur * 2.3));

    const modeBlock = mode === "product"
        ? `MODE: VIDEO PROMOSI PRODUK (TikTok Shop / Reels / Shorts)
- Nama Produk: "${productName || "Produk Unggulan"}"
- Keunggulan / Detail: "${sellingPoints || "Analisa keunggulan produk dari foto terlampir jika ada"}"
- CTA Akhir: "${cta || "Cek keranjang sekarang sebelum kehabisan"}"
- Buat alur: Scene 1 Hook (stop scrolling) -> Scene tengah Masalah & Solusi/Keunggulan -> Scene terakhir CTA kuat.
- Set "useProductImage": true untuk scene yang wajib menampilkan foto asli produk (minimal Scene 1 dan Scene terakhir), dan false untuk scene B-roll pendukung.`
        : `MODE: VIDEO TOPIK / EDUKASI / CERITA
- Topik / Ide Utama: "${topic || "Fakta menarik kehidupan sehari-hari"}"
- CTA / Penutup: "${cta || "Follow untuk info menarik lainnya"}"
- Set "useProductImage": false pada semua scene.`;

    const promptText = `${persona.systemPrompt || ""}

TUGAS UTAMA:
Buat skrip video vertikal siap voiceover (Bahasa Indonesia natural, mudah diucapkan TTS, tanpa emoji di narasi) sebanyak tepat ${safeScenes} scene.
Total seluruh kata dari gabungan "narration" semua scene HARUS sekitar ${targetWords} kata (cocok untuk durasi ~${safeDur} detik).

${modeBlock}

ATURAN FORMAT OUTPUT:
- Untuk setiap scene, berikan:
  - "narration": teks yang akan dibacakan voiceover (tanpa tanda kurung instruksi panggung, tanpa emoji, tanda baca rapi agar intonasi TTS alami)
  - "visualQuery": kata kunci pencarian gambar B-roll dalam BAHASA INGGRIS (2-4 kata spesifik, misal "cozy coffee shop morning", "happy woman skincare")
  - "useProductImage": boolean
- Kembalikan HANYA JSON objek valid tanpa blok markdown dengan struktur persis:
{
  "title": "Judul singkat video",
  "hook": "Hook pembuka singkat",
  "caption": "Caption sosmed lengkap + 5 hashtag",
  "scenes": [
    { "narration": "...", "visualQuery": "...", "useProductImage": true }
  ]
}`;

    const parts = [{ text: promptText }];
    if (mode === "product" && productImagePath && fs.existsSync(productImagePath)) {
        try {
            const imgBuf = await fsp.readFile(productImagePath);
            parts.push({
                inlineData: {
                    data: imgBuf.toString("base64"),
                    mimeType: getMimeType(productImagePath)
                }
            });
            console.log(chalk.cyan(`🖼️  Foto produk dilampirkan ke Gemini Vision: ${path.basename(productImagePath)}`));
        } catch (err) {
            console.log(chalk.yellow(`⚠️ Gagal membaca foto produk untuk Gemini: ${err.message}`));
        }
    }

    console.log(chalk.cyan(`✍️  Membuat skrip ${safeScenes} scene (~${targetWords} kata) dengan Gemini...`));
    return callWithFallback(keys, async (key) => {
        const aiModel = buildModel(key);
        const result = await aiModel.generateContent(parts);
        return parseForgeScriptJson(result.response.text());
    });
}

async function listLocalVisualAssets(dirPath) {
    if (!dirPath || !fs.existsSync(dirPath)) return [];
    const entries = await fsp.readdir(dirPath, { withFileTypes: true });
    return entries
        .filter((e) => {
            if (!e.isFile()) return false;
            const ext = path.extname(e.name).toLowerCase();
            return IMAGE_EXTS.has(ext) || VIDEO_EXTS.has(ext);
        })
        .map((e) => path.join(path.resolve(dirPath), e.name));
}

async function renderSceneVisual({ assetPath, isProductLock, duration, outputPath }) {
    const frames = Math.max(30, Math.round(duration * 30));

    if (!assetPath) {
        await runEncode(
            (encArgs) => `ffmpeg -y -f lavfi -i color=c=0x161b26:s=1080x1920:r=30:d=${duration.toFixed(3)} ${encArgs} -an "${outputPath}"`,
            { quality: 23, preset: "fast" }
        );
        return outputPath;
    }

    const ext = path.extname(assetPath).toLowerCase();
    const isVideo = VIDEO_EXTS.has(ext);

    if (isVideo) {
        await runEncode(
            (encArgs) => `ffmpeg -y -stream_loop -1 -t ${duration.toFixed(3)} -i "${assetPath}" -vf "scale=1080:1920:force_original_aspect_ratio=increase,crop=1080:1920,setsar=1,fps=30" ${encArgs} -an "${outputPath}"`,
            { quality: 23, preset: "fast" }
        );
        return outputPath;
    }

    if (isProductLock) {
        const fc = `[0:v]scale=1080:1920:force_original_aspect_ratio=increase,crop=1080:1920,boxblur=25:8[bg];[0:v]scale=900:1100:force_original_aspect_ratio=decrease,scale=trunc(iw/2)*2:trunc(ih/2)*2[fg];[bg][fg]overlay=(W-w)/2:(H-h)/2,zoompan=z='min(zoom+0.0007,1.07)':d=${frames}:x='iw/2-(iw/zoom/2)':y='ih/2-(ih/zoom/2)':s=1080x1920:fps=30[v]`;
        await runEncode(
            (encArgs) => `ffmpeg -y -i "${assetPath}" -filter_complex "${fc}" -map "[v]" -frames:v ${frames} ${encArgs} -an "${outputPath}"`,
            { quality: 23, preset: "fast" }
        );
        return outputPath;
    }

    // Standard image (stock or local image) pre-scaled before zoompan
    const vf = `scale=1080:1920:force_original_aspect_ratio=increase,crop=1080:1920,setsar=1,zoompan=z='min(zoom+0.0007,1.07)':d=${frames}:x='iw/2-(iw/zoom/2)':y='ih/2-(ih/zoom/2)':s=1080x1920:fps=30`;
    await runEncode(
        (encArgs) => `ffmpeg -y -i "${assetPath}" -vf "${vf}" -frames:v ${frames} ${encArgs} -an "${outputPath}"`,
        { quality: 23, preset: "fast" }
    );
    return outputPath;
}

async function renderForgeVideo({
    mode = "product",
    script,
    productImagePaths = [],
    visualSource = "auto_stock",
    localMediaDir = "",
    voice = "id-ID-GadisNeural",
    rate = "+0%",
    backsoundDir = "",
    backsoundVolume = 0.14,
    burnSubtitles = true,
    subtitleStyle = {},
    outputDir = "hasil_forge",
    onProgress
} = {}) {
    if (!script || !Array.isArray(script.scenes) || script.scenes.length === 0) {
        throw new Error("Skrip video harus memiliki minimal 1 scene.");
    }

    const validScenes = script.scenes.filter((s) => String(s?.narration || "").trim() !== "");
    if (validScenes.length === 0) {
        throw new Error("Semua narasi scene kosong.");
    }

    const outDir = path.resolve(outputDir || "hasil_forge");
    await ensureDirectoryExists(outDir);

    const workDir = path.resolve(process.cwd(), "temp", `forge_${Date.now()}`);
    await ensureDirectoryExists(workDir);

    const safeProducts = (Array.isArray(productImagePaths) ? productImagePaths : [])
        .map((p) => path.resolve(p))
        .filter((p) => fs.existsSync(p));

    const localAssets = visualSource === "local_folder" ? await listLocalVisualAssets(localMediaDir) : [];

    try {
        // 1. Synthesize per-scene Edge TTS audio
        const sceneAudios = [];
        const globalWords = [];
        let cursorSec = 0;

        for (let i = 0; i < validScenes.length; i++) {
            const sc = validScenes[i];
            if (onProgress) {
                onProgress({
                    stage: "tts",
                    percent: Math.round((i / validScenes.length) * 30),
                    message: `Membuat voiceover scene ${i + 1}/${validScenes.length}...`
                });
            }
            console.log(chalk.cyan(`🎙️  [Scene ${i + 1}/${validScenes.length}] Synthesizing Edge TTS (${voice})...`));
            const mp3Path = path.join(workDir, `scene_${i}.mp3`);
            const ttsRes = await synthesizeEdgeTTS(sc.narration, mp3Path, { voice, rate });
            const dur = Math.max(1.2, ttsRes.duration);

            for (const w of ttsRes.words) {
                globalWords.push({
                    text: w.text,
                    start: Number((cursorSec + w.start).toFixed(3)),
                    end: Number((cursorSec + w.end).toFixed(3))
                });
            }

            sceneAudios.push({ path: mp3Path, duration: dur });
            cursorSec += dur;
        }

        // Concatenate all scene MP3s sample-accurately into voiceover_full.wav
        const fullVoiceWav = path.join(workDir, "voiceover_full.wav");
        if (sceneAudios.length === 1) {
            await runCommand(`ffmpeg -y -i "${sceneAudios[0].path}" -ar 44100 -ac 2 -c:a pcm_s16le "${fullVoiceWav}"`);
        } else {
            const inputs = sceneAudios.map((a) => `-i "${a.path}"`).join(" ");
            const concatInputs = sceneAudios.map((_, idx) => `[${idx}:a]`).join("");
            await runCommand(`ffmpeg -y ${inputs} -filter_complex "${concatInputs}concat=n=${sceneAudios.length}:v=0:a=1[a]" -map "[a]" -ar 44100 -ac 2 -c:a pcm_s16le "${fullVoiceWav}"`);
        }

        // 2. Render per-scene visuals
        const sceneVideos = [];
        let productIdx = 0;
        let localIdx = 0;

        for (let i = 0; i < validScenes.length; i++) {
            const sc = validScenes[i];
            const dur = sceneAudios[i].duration;
            if (onProgress) {
                onProgress({
                    stage: "visual",
                    percent: 30 + Math.round((i / validScenes.length) * 45),
                    message: `Menyiapkan & merender visual scene ${i + 1}/${validScenes.length}...`
                });
            }

            let assetPath = null;
            let isProductLock = false;

            const wantsProduct = mode === "product" && safeProducts.length > 0 && (sc.useProductImage || visualSource === "product_only");
            if (wantsProduct) {
                assetPath = safeProducts[productIdx % safeProducts.length];
                productIdx += 1;
                isProductLock = true;
            } else if (visualSource === "local_folder" && localAssets.length > 0) {
                assetPath = localAssets[localIdx % localAssets.length];
                localIdx += 1;
            } else if (visualSource === "auto_stock") {
                console.log(chalk.gray(`   🔍 Mencari stok gambar: "${sc.visualQuery}"...`));
                assetPath = await searchStockImage(sc.visualQuery, path.join(workDir, `stock_${i}`));
                if (!assetPath && safeProducts.length > 0) {
                    assetPath = safeProducts[productIdx % safeProducts.length];
                    productIdx += 1;
                    isProductLock = true;
                }
            }

            console.log(chalk.cyan(`🎞️  [Scene ${i + 1}/${validScenes.length}] Render visual (${dur.toFixed(2)}s, ${isProductLock ? "Product Lock" : (assetPath ? path.basename(assetPath) : "Studio BG")})...`));
            const sceneMp4 = path.join(workDir, `scene_vis_${i}.mp4`);
            await renderSceneVisual({ assetPath, isProductLock, duration: dur, outputPath: sceneMp4 });
            sceneVideos.push(sceneMp4);
        }

        // 3. Concat scene visual clips
        const mergedVisual = path.join(workDir, "merged_visual.mp4");
        if (sceneVideos.length === 1) {
            await fsp.copyFile(sceneVideos[0], mergedVisual);
        } else {
            const concatList = path.join(workDir, "vis_concat.txt");
            await fsp.writeFile(
                concatList,
                sceneVideos.map((p) => `file '${p.replace(/\\/g, "/")}'`).join("\n"),
                "utf8"
            );
            await runCommand(`ffmpeg -y -f concat -safe 0 -i "${concatList}" -c copy "${mergedVisual}"`);
        }

        // 4. Optional backsound + subtitle burn in final pass
        if (onProgress) onProgress({ stage: "compose", percent: 82, message: "Menggabungkan audio, musik & subtitle..." });

        const settings = getSettings();
        const mergedStyle = normalizeSubtitleAiSettings({ ...(settings.subtitle_ai || {}), ...(subtitleStyle || {}) });
        const lang = voice.toLowerCase().startsWith("en-") ? "en" : "id";

        const slug = slugifyName(script.title || (mode === "product" ? "produk" : "topik"), "forge");
        const stamp = Date.now().toString().slice(-5);
        const finalMp4 = path.join(outDir, `${slug}_${stamp}.mp4`);
        const wordsJsonPath = `${finalMp4}.words.json`;
        const captionTxtPath = path.join(outDir, `${slug}_${stamp}.txt`);

        await fsp.writeFile(wordsJsonPath, JSON.stringify({
            words: globalWords,
            language: lang,
            model: `edge-tts:${voice}`,
            duration: Number(cursorSec.toFixed(3)),
            updatedAt: new Date().toISOString()
        }, null, 2), "utf8");

        const txtContent = [script.title, script.hook, "", script.caption].filter((l) => l !== undefined).join("\n");
        await fsp.writeFile(captionTxtPath, txtContent, "utf8");

        let assPath = null;
        if (burnSubtitles && globalWords.length > 0) {
            const captions = groupWords(globalWords, {
                maxWordsPerLine: mergedStyle.maxWordsPerLine,
                maxLines: mergedStyle.maxLines
            });
            const assContent = buildAss(captions, mergedStyle, { width: 1080, height: 1920 });
            assPath = path.join(workDir, "subs.ass");
            await fsp.writeFile(assPath, assContent, "utf8");
        }

        let selectedBacksound = null;
        if (backsoundDir && fs.existsSync(backsoundDir)) {
            const musicFiles = await getAudioFiles(backsoundDir);
            selectedBacksound = getRandomAudio(musicFiles);
        }

        const safeVol = Math.max(0.02, Math.min(0.6, Number(backsoundVolume) || 0.14));

        if (assPath) {
            const escapedAss = escapeAssFilterPath(assPath);
            if (selectedBacksound) {
                const fc = `[0:v]ass='${escapedAss}'[v];[2:a]volume=${safeVol}[bg];[1:a][bg]amix=inputs=2:duration=first:dropout_transition=2[aout]`;
                await runEncode(
                    (encArgs) => `ffmpeg -y -i "${mergedVisual}" -i "${fullVoiceWav}" -stream_loop -1 -i "${selectedBacksound}" -filter_complex "${fc}" -map "[v]" -map "[aout]" ${encArgs} -c:a aac -b:a 128k -shortest "${finalMp4}"`,
                    { quality: 23, preset: "fast" }
                );
            } else {
                await runEncode(
                    (encArgs) => `ffmpeg -y -i "${mergedVisual}" -i "${fullVoiceWav}" -vf "ass='${escapedAss}'" -map 0:v -map 1:a ${encArgs} -c:a aac -b:a 128k -shortest "${finalMp4}"`,
                    { quality: 23, preset: "fast" }
                );
            }
        } else if (selectedBacksound) {
            const fc = `[2:a]volume=${safeVol}[bg];[1:a][bg]amix=inputs=2:duration=first:dropout_transition=2[aout]`;
            await runCommand(`ffmpeg -y -i "${mergedVisual}" -i "${fullVoiceWav}" -stream_loop -1 -i "${selectedBacksound}" -filter_complex "${fc}" -map 0:v -map "[aout]" -c:v copy -c:a aac -b:a 128k -shortest "${finalMp4}"`);
        } else {
            await runCommand(`ffmpeg -y -i "${mergedVisual}" -i "${fullVoiceWav}" -map 0:v -map 1:a -c:v copy -c:a aac -b:a 128k -shortest "${finalMp4}"`);
        }

        if (onProgress) onProgress({ stage: "done", percent: 100, message: `Video selesai dibuat: ${path.basename(finalMp4)}` });
        console.log(chalk.green.bold(`\n🎉 Video Forge selesai: ${finalMp4}`));

        return {
            outputPath: finalMp4,
            wordsPath: wordsJsonPath,
            txtPath: captionTxtPath,
            duration: Number(cursorSec.toFixed(2)),
            wordsCount: globalWords.length
        };
    } finally {
        await fsp.rm(workDir, { recursive: true, force: true }).catch(() => {});
    }
}

module.exports = {
    generateForgeScript,
    renderForgeVideo
};
