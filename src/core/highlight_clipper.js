const path = require("path");
const fs = require("fs");
const fsp = require("fs/promises");
const chalk = require("chalk");
const { downloadYoutubeCore } = require("./downloader");
const { transcribe } = require("./transcriber");
const { groupWords, buildAss, buildBottomGradientFilter, getTargetMediaDimensions } = require("./subtitle_render");
const { getApiKeyList, callWithFallback, buildModel } = require("./ai_hook");
const { runEncode } = require("../utils/encoder");
const { getSettings } = require("../utils/settings_manager");
const { ensureDirectoryExists } = require("../utils/shell");
const { escapeAssFilterPath, normalizeSubtitleAiSettings } = require("../utils/ass_helpers");

function formatMinSec(sec) {
    const safe = Math.max(0, Number(sec) || 0);
    const m = Math.floor(safe / 60);
    const s = (safe % 60).toFixed(1).padStart(4, "0");
    return `${String(m).padStart(2, "0")}:${s}`;
}

function slugifyTitle(str, fallback = "highlight") {
    const clean = String(str || "")
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, "_")
        .replace(/^_+|_+$/g, "")
        .slice(0, 40);
    return clean || fallback;
}

/**
 * Group word-level timestamps into readable timed transcript lines
 * breaking on sentence punctuation or ~10s chunks.
 */
function buildTimedTranscript(words = []) {
    if (!Array.isArray(words) || words.length === 0) return "";
    const lines = [];
    let chunk = [];

    const flush = () => {
        if (chunk.length === 0) return;
        const start = chunk[0].start;
        const end = chunk[chunk.length - 1].end;
        const text = chunk.map((w) => w.text).join(" ");
        lines.push(`[${formatMinSec(start)} - ${formatMinSec(end)}] (${start.toFixed(1)}s - ${end.toFixed(1)}s) ${text}`);
        chunk = [];
    };

    for (const w of words) {
        if (!w || !String(w.text || "").trim()) continue;
        chunk.push(w);
        const span = w.end - chunk[0].start;
        const endsSentence = /[.!?]$/.test(String(w.text).trim());
        if ((endsSentence && span >= 3) || span >= 10 || chunk.length >= 28) {
            flush();
        }
    }
    flush();
    return lines.join("\n");
}

function findNearestWordBoundary(words, targetSec, field = "start") {
    if (!Array.isArray(words) || words.length === 0) return targetSec;
    let best = words[0][field];
    let bestDiff = Math.abs(best - targetSec);
    for (const w of words) {
        const val = Number(w[field]);
        if (!Number.isFinite(val)) continue;
        const diff = Math.abs(val - targetSec);
        if (diff < bestDiff) {
            bestDiff = diff;
            best = val;
        }
    }
    return best;
}

/**
 * Clamp highlight ranges, snap boundaries to nearest words so clips never cut mid-word,
 * enforce min/max duration, remove heavy overlaps, and sort by score descending.
 */
function snapHighlightsToWords(rawHighlights = [], words = [], videoDuration = 0, { minDuration = 15, maxDuration = 60 } = {}) {
    const safeMin = Math.max(1, Number(minDuration) || 15);
    const safeMax = Math.max(safeMin, Number(maxDuration) || 60);
    const totalDur = Number(videoDuration) > 0
        ? Number(videoDuration)
        : (words.length ? Number(words[words.length - 1].end) || 0 : 0);

    const effectiveMin = totalDur > 0 && totalDur < safeMin ? Math.max(1, totalDur * 0.5) : safeMin;
    const cleaned = [];

    for (let i = 0; i < rawHighlights.length; i++) {
        const item = rawHighlights[i] || {};
        let start = Number(item.start);
        let end = Number(item.end);
        if (!Number.isFinite(start) || !Number.isFinite(end)) continue;

        if (totalDur > 0) {
            start = Math.max(0, Math.min(start, totalDur - 1));
            end = Math.max(start + 0.5, Math.min(end, totalDur));
        }

        if (words.length > 0) {
            start = findNearestWordBoundary(words, start, "start");
            end = findNearestWordBoundary(words, end, "end");
            if (end <= start) continue;
        }

        // Enforce maxDuration by trimming end back to nearest word end
        if (end - start > safeMax) {
            const cappedEnd = start + safeMax;
            end = words.length > 0
                ? findNearestWordBoundary(words.filter((w) => w.end <= cappedEnd + 0.5), cappedEnd, "end")
                : cappedEnd;
        }

        // Expand slightly if under effectiveMin and room exists
        if (end - start < effectiveMin && totalDur >= effectiveMin) {
            const neededEnd = Math.min(totalDur, start + effectiveMin);
            end = words.length > 0 ? findNearestWordBoundary(words, neededEnd, "end") : neededEnd;
            if (end - start < effectiveMin) {
                const neededStart = Math.max(0, end - effectiveMin);
                start = words.length > 0 ? findNearestWordBoundary(words, neededStart, "start") : neededStart;
            }
        }

        if (end - start < 1) continue;

        const score = Math.max(1, Math.min(100, Math.round(Number(item.score) || 75)));
        cleaned.push({
            title: String(item.title || `Highlight ${i + 1}`).trim(),
            hook: String(item.hook || "").trim(),
            reason: String(item.reason || "").trim(),
            score,
            start: Number(Math.max(0, start).toFixed(2)),
            end: Number(Math.min(totalDur || end, end).toFixed(2)),
            caption: String(item.caption || "").trim()
        });
    }

    cleaned.sort((a, b) => b.score - a.score);

    // Filter out ranges that overlap > 50% with a higher-scored highlight
    const selected = [];
    for (const cand of cleaned) {
        const candDur = cand.end - cand.start;
        const heavilyOverlaps = selected.some((kept) => {
            const overlap = Math.max(0, Math.min(cand.end, kept.end) - Math.max(cand.start, kept.start));
            const minSpan = Math.min(candDur, kept.end - kept.start);
            return minSpan > 0 && (overlap / minSpan) > 0.5;
        });
        if (!heavilyOverlaps) {
            selected.push(cand);
        }
    }

    return selected;
}

function parseAiHighlightsJson(rawText) {
    const cleaned = String(rawText || "")
        .replace(/```json\s*/gi, "")
        .replace(/```/g, "")
        .trim();

    const startBracket = cleaned.indexOf("[");
    const endBracket = cleaned.lastIndexOf("]");
    if (startBracket === -1 || endBracket === -1 || endBracket <= startBracket) {
        throw new Error("Respon AI tidak berisi array JSON yang valid.");
    }

    const parsed = JSON.parse(cleaned.slice(startBracket, endBracket + 1));
    if (!Array.isArray(parsed)) {
        throw new Error("Format highlights dari AI bukan array.");
    }
    return parsed;
}

async function analyzeHighlights({
    filePath = "",
    youtubeUrl = "",
    outputDir = "hasil_highlight",
    language = "id",
    model,
    clipCount = 3,
    minDuration = 15,
    maxDuration = 60,
    context = "",
    onProgress
} = {}) {
    let resolvedVideoPath = filePath ? path.resolve(filePath) : "";

    if (youtubeUrl && String(youtubeUrl).trim()) {
        if (onProgress) onProgress({ stage: "download", percent: 10, message: "Mengunduh video YouTube..." });
        const sourceDir = path.join(path.resolve(outputDir || "hasil_highlight"), "_source");
        const dlRes = await downloadYoutubeCore(String(youtubeUrl).trim(), {
            outputDir: sourceDir,
            quality: "1080p"
        });
        resolvedVideoPath = path.resolve(dlRes.outputFile);
    }

    if (!resolvedVideoPath || !fs.existsSync(resolvedVideoPath)) {
        throw new Error(`File video tidak ditemukan: ${resolvedVideoPath || "(kosong)"}`);
    }

    if (onProgress) onProgress({ stage: "transcribe", percent: 30, message: "Mentranskrip audio dengan Whisper..." });
    const transcript = await transcribe(resolvedVideoPath, {
        language: language || "id",
        model,
        onProgress: (p) => {
            if (onProgress) {
                onProgress({
                    stage: "transcribe",
                    percent: Math.min(65, 30 + Math.round((Number(p.percent) || 0) * 0.35)),
                    message: p.message || "Mentranskrip audio..."
                });
            }
        }
    });

    const words = Array.isArray(transcript.words) ? transcript.words : [];
    if (words.length === 0) {
        throw new Error("Transkrip kosong — tidak ada ucapan terdeteksi dalam video.");
    }

    const duration = Number(transcript.duration) || words[words.length - 1].end;
    const timedTranscript = buildTimedTranscript(words);

    const keys = getApiKeyList();
    if (keys.length === 0) {
        throw new Error("Gemini API Key belum diatur di Pengaturan -> AI & API Key.");
    }

    if (onProgress) onProgress({ stage: "analyze", percent: 75, message: "Menganalisis momen highlight dengan Gemini AI..." });
    console.log(chalk.cyan(`🧠 Menganalisis ${words.length} kata (${duration.toFixed(1)}s) untuk mencari ${clipCount} highlight...`));

    const safeCount = Math.max(1, Math.min(12, parseInt(clipCount, 10) || 3));
    const safeMin = Math.max(3, parseInt(minDuration, 10) || 15);
    const safeMax = Math.max(safeMin, parseInt(maxDuration, 10) || 60);

    const prompt = `Kamu adalah editor video profesional khusus konten pendek viral (TikTok, Instagram Reels, YouTube Shorts).

INFO VIDEO:
- Total durasi: ${duration.toFixed(1)} detik
${context ? `- Konteks / Fokus Topik: ${context}\n` : ""}- Target jumlah klip: ${safeCount} klip terbaik
- Durasi tiap klip: antara ${safeMin} sampai ${safeMax} detik (atau proporsional jika video pendek)

TRANSKRIP BER-TIMESTAMP:
---
${timedTranscript.slice(0, 35000)}
---

TUGAS:
Pilih maksimal ${safeCount} potongan momen paling menarik, informatif, kontroversial, lucu, atau punya nilai cerita utuh.
- Pastikan "start" dan "end" adalah angka detik (number, misal 12.4) sesuai timestamp di transkrip.
- Jangan memotong di tengah kalimat yang menggantung.
- Beri skor viralitas 1-100.
- Untuk tiap klip, buat:
  - "title": judul singkat menarik (maks 8 kata, bahasa Indonesia)
  - "hook": kalimat hook pembuka singkat
  - "reason": alasan singkat kenapa bagian ini bagus
  - "score": angka 1-100
  - "start": angka detik mulai
  - "end": angka detik selesai
  - "caption": caption siap posting lengkap dengan 4-6 hashtag relevan

OUTPUT WAJIB:
Kembalikan HANYA JSON array valid tanpa markdown atau teks tambahan.`;

    let rawHighlights = [];
    try {
        rawHighlights = await callWithFallback(keys, async (key) => {
            const aiModel = buildModel(key);
            const res = await aiModel.generateContent(prompt);
            return parseAiHighlightsJson(res.response.text());
        });
    } catch (err) {
        console.log(chalk.yellow(`⚠️ Gagal analisis AI (${err.message}), menggunakan segmentasi otomatis fallback.`));
        rawHighlights = [{
            title: "Momen Utama Video",
            hook: "",
            reason: "Fallback otomatis karena analisis AI gagal.",
            score: 70,
            start: words[0].start,
            end: Math.min(duration, words[0].start + safeMax),
            caption: context || "Video highlight"
        }];
    }

    let highlights = snapHighlightsToWords(rawHighlights, words, duration, {
        minDuration: safeMin,
        maxDuration: safeMax
    });

    if (highlights.length === 0 && words.length > 0) {
        highlights = snapHighlightsToWords([{
            title: "Cuplikan Video",
            hook: "",
            reason: "Segmen pembuka video",
            score: 70,
            start: words[0].start,
            end: Math.min(duration, words[0].start + safeMax),
            caption: context || "Video highlight"
        }], words, duration, { minDuration: safeMin, maxDuration: safeMax });
    }

    if (onProgress) onProgress({ stage: "done", percent: 100, message: `Ditemukan ${highlights.length} highlight.` });

    return {
        videoPath: resolvedVideoPath,
        duration,
        wordsCount: words.length,
        highlights
    };
}

async function renderHighlights({
    videoPath,
    outputDir = "hasil_highlight",
    highlights = [],
    aspectMode = "portrait_blur",
    burnSubtitles = true,
    style = {},
    onProgress
} = {}) {
    const absVideo = path.resolve(videoPath);
    if (!fs.existsSync(absVideo)) {
        throw new Error(`File video tidak ditemukan: ${absVideo}`);
    }
    if (!Array.isArray(highlights) || highlights.length === 0) {
        throw new Error("Tidak ada highlight yang dipilih untuk dirender.");
    }

    const outDir = path.resolve(outputDir || "hasil_highlight");
    await ensureDirectoryExists(outDir);

    let allWords = [];
    let transcriptLang = "id";
    const wordsCachePath = `${absVideo}.words.json`;
    if (burnSubtitles && fs.existsSync(wordsCachePath)) {
        try {
            const parsed = JSON.parse(await fsp.readFile(wordsCachePath, "utf8"));
            allWords = Array.isArray(parsed.words) ? parsed.words : [];
            transcriptLang = parsed.language || "id";
        } catch { /* ignore */ }
    }

    const settings = getSettings();
    const mergedStyle = normalizeSubtitleAiSettings({ ...(settings.subtitle_ai || {}), ...(style || {}) });
    const origDims = aspectMode === "original"
        ? await getTargetMediaDimensions(absVideo)
        : { width: 1080, height: 1920 };

    const renderedClips = [];

    for (let i = 0; i < highlights.length; i++) {
        const hl = highlights[i];
        const start = Math.max(0, Number(hl.start) || 0);
        const end = Math.max(start + 0.5, Number(hl.end) || start + 5);
        const dur = Number((end - start).toFixed(3));
        const numPrefix = String(i + 1).padStart(2, "0");
        const slug = slugifyTitle(hl.title, `clip_${numPrefix}`);
        const outFileName = `clip_${numPrefix}_${slug}.mp4`;
        const outPath = path.join(outDir, outFileName);
        const tempAssPath = path.join(outDir, `_temp_${numPrefix}_${Date.now()}.ass`);

        if (onProgress) {
            onProgress({
                stage: "render",
                percent: Math.round((i / highlights.length) * 100),
                message: `Merender klip ${i + 1}/${highlights.length}: ${hl.title || outFileName}`
            });
        }
        console.log(chalk.cyan(`✂️  [${i + 1}/${highlights.length}] Merender ${outFileName} (${start.toFixed(2)}s - ${end.toFixed(2)}s)...`));

        // Shift words into clip-relative timeline [0, dur]
        const clipWords = allWords
            .filter((w) => Number(w.end) > start + 0.03 && Number(w.start) < end - 0.03)
            .map((w) => {
                const wStart = Math.max(0, Number(w.start) - start);
                const wEnd = Math.min(dur, Math.max(wStart + 0.04, Number(w.end) - start));
                return {
                    text: w.text,
                    start: Number(wStart.toFixed(3)),
                    end: Number(wEnd.toFixed(3))
                };
            });

        if (clipWords.length > 0) {
            await fsp.writeFile(`${outPath}.words.json`, JSON.stringify({
                words: clipWords,
                language: transcriptLang,
                duration: dur,
                updatedAt: new Date().toISOString()
            }, null, 2), "utf8");
        }

        let hasAss = false;
        if (burnSubtitles && clipWords.length > 0) {
            const captions = groupWords(clipWords, {
                maxWordsPerLine: mergedStyle.maxWordsPerLine,
                maxLines: mergedStyle.maxLines
            });
            const assContent = buildAss(captions, mergedStyle, {
                width: origDims.width,
                height: origDims.height
            });
            await fsp.writeFile(tempAssPath, assContent, "utf8");
            hasAss = true;
        }

        try {
            const escapedAss = hasAss ? escapeAssFilterPath(tempAssPath) : "";
            const gradFilter = mergedStyle.bottomGradient ? buildBottomGradientFilter() : "";
            const overlayParts = [];
            if (gradFilter) overlayParts.push(gradFilter);
            if (hasAss) overlayParts.push(`ass='${escapedAss}'`);
            const postChain = overlayParts.join(",");
            const postSuffix = postChain ? `,${postChain}` : "";

            await runEncode((encArgs) => {
                if (aspectMode === "original") {
                    const vfArg = postChain ? `-vf "${postChain}"` : "";
                    return `ffmpeg -y -ss ${start} -i "${absVideo}" -t ${dur} ${vfArg} ${encArgs} -c:a aac -b:a 128k "${outPath}"`;
                }
                if (aspectMode === "portrait_crop") {
                    return `ffmpeg -y -ss ${start} -i "${absVideo}" -t ${dur} -vf "scale=1080:1920:force_original_aspect_ratio=increase,crop=1080:1920${postSuffix}" ${encArgs} -c:a aac -b:a 128k "${outPath}"`;
                }
                // Default: portrait_blur
                const fc = `[0:v]scale=1080:1920:force_original_aspect_ratio=increase,crop=1080:1920,boxblur=25:8[bg];[0:v]scale=1080:1920:force_original_aspect_ratio=decrease[fg];[bg][fg]overlay=(W-w)/2:(H-h)/2${postSuffix}[v]`;
                return `ffmpeg -y -ss ${start} -i "${absVideo}" -t ${dur} -filter_complex "${fc}" -map "[v]" -map "0:a?" ${encArgs} -c:a aac -b:a 128k "${outPath}"`;
            }, { quality: 23, preset: "fast" });

            renderedClips.push({
                path: outPath,
                name: outFileName,
                title: hl.title || outFileName,
                score: hl.score || 0,
                start,
                end,
                duration: dur,
                caption: hl.caption || ""
            });
            console.log(chalk.green(`   ✅ Selesai: ${outFileName}`));
        } finally {
            if (hasAss) {
                await fsp.unlink(tempAssPath).catch(() => {});
            }
        }
    }

    const manifestPath = path.join(outDir, "highlights_manifest.json");
    await fsp.writeFile(manifestPath, JSON.stringify({
        sourceVideo: absVideo,
        aspectMode,
        burnSubtitles: Boolean(burnSubtitles),
        createdAt: new Date().toISOString(),
        clips: renderedClips
    }, null, 2), "utf8");

    if (onProgress) onProgress({ stage: "done", percent: 100, message: `Selesai merender ${renderedClips.length} klip.` });
    console.log(chalk.green.bold(`\n🎉 Highlight Clipper selesai! ${renderedClips.length} klip tersimpan di ${outDir}`));

    return {
        outputDir: outDir,
        manifestPath,
        clips: renderedClips
    };
}

module.exports = {
    buildTimedTranscript,
    snapHighlightsToWords,
    analyzeHighlights,
    renderHighlights
};
