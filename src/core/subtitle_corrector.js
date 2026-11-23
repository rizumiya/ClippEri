const fs = require("fs");
const fsp = require("fs/promises");
const path = require("path");
const chalk = require("chalk");
const { GoogleGenerativeAI } = require("@google/generative-ai");
const config = require("../config");
const { runCommand, ensureDirectoryExists } = require("../utils/shell");
const { getApiKeyList, callWithFallback } = require("./ai_hook");

function parseGeminiPatchesJson(rawText) {
    const cleaned = String(rawText || "")
        .replace(/```json\s*/gi, "")
        .replace(/```/g, "")
        .trim();

    try {
        const direct = JSON.parse(cleaned);
        if (Array.isArray(direct)) return direct;
        if (Array.isArray(direct?.patches)) return direct.patches;
    } catch {
        // Fallback to extracting outermost JSON array below
    }

    const startIdx = cleaned.indexOf("[");
    const endIdx = cleaned.lastIndexOf("]");
    if (startIdx !== -1 && endIdx > startIdx) {
        const sliced = JSON.parse(cleaned.slice(startIdx, endIdx + 1));
        if (Array.isArray(sliced)) return sliced;
    }

    throw new Error("Respon koreksi Gemini tidak berisi array JSON yang valid.");
}

function applyWordPatches(chunkWords = [], patches = []) {
    if (!Array.isArray(chunkWords) || chunkWords.length === 0) {
        return { words: [], changes: [] };
    }
    if (!Array.isArray(patches) || patches.length === 0) {
        return {
            words: chunkWords.map((w) => ({
                text: String(w.text || ""),
                start: Number(w.start) || 0,
                end: Math.max((Number(w.start) || 0) + 0.04, Number(w.end) || 0.04)
            })),
            changes: []
        };
    }

    const patchMap = new Map();
    for (const p of patches) {
        if (!p || typeof p !== "object") continue;
        const idx = Number(p.i);
        if (!Number.isInteger(idx) || idx < 0 || idx >= chunkWords.length) continue;
        if (typeof p.t !== "string") continue;
        patchMap.set(idx, p.t);
    }

    const outWords = [];
    const changes = [];

    for (let idx = 0; idx < chunkWords.length; idx++) {
        const w = chunkWords[idx];
        const before = String(w.text || "");
        const start = Math.max(0, Number(w.start) || 0);
        const end = Math.max(start + 0.04, Number(w.end) || start + 0.04);

        if (!patchMap.has(idx)) {
            outWords.push({
                text: before,
                start: Number(start.toFixed(3)),
                end: Number(end.toFixed(3))
            });
            continue;
        }

        const afterClean = String(patchMap.get(idx)).replace(/[\r\n]+/g, " ").trim();
        if (afterClean !== before) {
            changes.push({ index: idx, before, after: afterClean });
        }

        if (afterClean === "") {
            if (outWords.length > 0) {
                const prev = outWords[outWords.length - 1];
                if (end > prev.end) {
                    prev.end = Number(end.toFixed(3));
                }
            }
            continue;
        }

        const parts = afterClean.split(/\s+/).filter(Boolean);
        if (parts.length === 1) {
            outWords.push({
                text: parts[0],
                start: Number(start.toFixed(3)),
                end: Number(end.toFixed(3))
            });
            continue;
        }

        const totalChars = parts.reduce((sum, p) => sum + Math.max(1, p.length), 0);
        const span = Math.max(0.04 * parts.length, end - start);
        let cursor = start;
        for (let pi = 0; pi < parts.length; pi++) {
            const share = Math.max(1, parts[pi].length) / totalChars;
            const partStart = cursor;
            const partEnd = pi === parts.length - 1 ? Math.max(partStart + 0.04, end) : Math.max(partStart + 0.04, cursor + span * share);
            cursor = partEnd;
            outWords.push({
                text: parts[pi],
                start: Number(partStart.toFixed(3)),
                end: Number(partEnd.toFixed(3))
            });
        }
    }

    if (outWords.length === 0 && chunkWords.length > 0) {
        return {
            words: chunkWords.map((w) => ({
                text: String(w.text || ""),
                start: Number(w.start) || 0,
                end: Math.max((Number(w.start) || 0) + 0.04, Number(w.end) || 0.04)
            })),
            changes: []
        };
    }

    return { words: outWords, changes };
}

function partitionWordsIntoChunks(words = [], { maxWords = 350, maxSpanSec = 180 } = {}) {
    const chunks = [];
    let current = [];
    for (const w of words) {
        if (current.length > 0) {
            const span = (Number(w.end) || Number(w.start) || 0) - (Number(current[0].start) || 0);
            if (current.length >= maxWords || span >= maxSpanSec) {
                chunks.push(current);
                current = [];
            }
        }
        current.push(w);
    }
    if (current.length > 0) chunks.push(current);
    return chunks;
}

async function correctWordsWithGemini({
    mediaPath,
    words = [],
    startSec = 0,
    durationSec = null,
    language = "id",
    context = "",
    onProgress
} = {}) {
    const t0 = Date.now();
    if (!Array.isArray(words) || words.length === 0) {
        return { words: [], changedCount: 0, changes: [], elapsedMs: 0 };
    }

    const absMedia = path.resolve(mediaPath || "");
    if (!absMedia || !fs.existsSync(absMedia)) {
        throw new Error(`File media tidak ditemukan untuk koreksi AI: ${absMedia}`);
    }

    const keys = getApiKeyList();
    if (keys.length === 0) {
        throw new Error("Gemini API Key belum diatur di Pengaturan -> AI & API Key.");
    }

    const tempDir = path.join(process.cwd(), "temp");
    await ensureDirectoryExists(tempDir);

    const chunks = partitionWordsIntoChunks(words, { maxWords: 350, maxSpanSec: 180 });
    const correctedAll = [];
    const allChanges = [];
    let globalOffset = 0;

    for (let ci = 0; ci < chunks.length; ci++) {
        const chunk = chunks[ci];
        if (onProgress) {
            const pct = Math.min(95, 10 + Math.round((ci / chunks.length) * 80));
            onProgress({
                stage: "ai_correct",
                percent: pct,
                message: `Mengoreksi subtitle via Gemini AI (bagian ${ci + 1}/${chunks.length})...`
            });
        }

        const firstStart = Math.max(0, Number(chunk[0].start) || 0);
        const lastEnd = Math.max(firstStart + 0.5, Number(chunk[chunk.length - 1].end) || firstStart + 1);
        const relStart = Math.max(0, firstStart - 0.15);
        const relEnd = durationSec && Number(durationSec) > 0
            ? Math.min(Number(durationSec) + 0.25, lastEnd + 0.25)
            : lastEnd + 0.25;
        const absStart = Math.max(0, (Number(startSec) || 0) + relStart);
        const sliceDur = Math.max(0.6, Number((relEnd - relStart).toFixed(3)));

        const tempMp3 = path.join(tempDir, `ai_corr_${Date.now()}_${ci}_${Math.floor(Math.random() * 1000)}.mp3`);

        try {
            await runCommand(
                `ffmpeg -y -ss ${absStart.toFixed(3)} -i "${absMedia}" -t ${sliceDur} -vn -ac 1 -ar 16000 -b:a 48k "${tempMp3}"`
            );
            const audioBuf = await fsp.readFile(tempMp3);
            const base64Audio = audioBuf.toString("base64");

            const numberedWords = chunk.map((w, idx) => `${idx}: ${w.text}`).join("\n");
            const langHint = language === "en" ? "English" : language === "auto" ? "Indonesian/English mixed" : "Indonesian (casual/conversational, often mixed with English tech/creator terms)";

            const prompt = `Kamu adalah editor transkrip subtitle profesional. Dengarkan audio terlampir dengan cermat lalu perbaiki kesalahan dengar pada daftar kata Whisper di bawah ini.
Bahasa utama: ${langHint}.${context ? `\nKonteks topik: ${context}` : ""}

ATURAN KETAT:
1. Bandingkan tiap kata dengan suara ASLI pada audio. Perbaiki kata salah dengar, kata rusak/bukan kata baku maupun gaul (contoh: "ngakusin" -> "ngehapusin", "parangnya" -> "orangnya", "kat" -> "cut", "Fill our words"/"Filler World" -> "filler words"), serta istilah Inggris/Indonesia yang keliru eja.
2. Kembalikan HANYA array JSON berisi kata-kata yang PERLU DIUBAH dalam format:
   [{"i": <index_angka>, "t": "<teks_perbaikan>"}]
3. JANGAN sertakan kata yang sudah benar.
4. Gunakan "t": "" HANYA jika Whisper berhalusinasi menambah kata ekstra yang sebenarnya tidak diucapkan atau terpecah ganda (misal jika index 5 "Fill" -> "filler", index 6 "our" -> "", index 7 "words" -> "words").
5. Pertahankan gaya percakapan asli pembicara (tetap natural, jangan terjemahkan ke bahasa formal kaku, jangan menambah kata baru di luar apa yang benar-benar diucapkan).

DAFTAR KATA BERNOMOR:
${numberedWords}`;

            const patches = await callWithFallback(keys, async (key) => {
                const model = new GoogleGenerativeAI(key).getGenerativeModel({
                    model: config.ai.model,
                    generationConfig: {
                        responseMimeType: "application/json",
                        temperature: 0.1
                    }
                });

                const res = await model.generateContent([
                    {
                        inlineData: {
                            mimeType: "audio/mp3",
                            data: base64Audio
                        }
                    },
                    { text: prompt }
                ]);
                return parseGeminiPatchesJson(res.response.text());
            });

            const { words: fixedChunk, changes } = applyWordPatches(chunk, patches);
            correctedAll.push(...fixedChunk);
            for (const ch of changes) {
                allChanges.push({
                    index: globalOffset + ch.index,
                    before: ch.before,
                    after: ch.after
                });
            }
        } finally {
            await fsp.unlink(tempMp3).catch(() => {});
        }

        globalOffset += chunk.length;
    }

    const elapsedMs = Date.now() - t0;
    console.log(chalk.cyan(`🧠 Gemini Audio Corrector: ${allChanges.length} kata diperbaiki dalam ${(elapsedMs / 1000).toFixed(2)}s`));
    if (onProgress) {
        onProgress({
            stage: "ai_correct",
            percent: 100,
            message: `Koreksi AI selesai (${allChanges.length} kata diperbaiki).`
        });
    }

    return {
        words: correctedAll,
        changedCount: allChanges.length,
        changes: allChanges,
        elapsedMs
    };
}

module.exports = {
    applyWordPatches,
    parseGeminiPatchesJson,
    correctWordsWithGemini
};
