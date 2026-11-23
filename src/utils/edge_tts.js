const fs = require("fs");
const fsp = require("fs/promises");
const path = require("path");
const { MsEdgeTTS, OUTPUT_FORMAT } = require("msedge-tts");
const { runCommand, ensureDirectoryExists } = require("./shell");

const EDGE_VOICES = [
    { id: "id-ID-GadisNeural", label: "Indonesia — Gadis (Wanita, Default)", lang: "id-ID", gender: "Female" },
    { id: "id-ID-ArdiNeural", label: "Indonesia — Ardi (Pria)", lang: "id-ID", gender: "Male" },
    { id: "en-US-AriaNeural", label: "English US — Aria (Female)", lang: "en-US", gender: "Female" },
    { id: "en-US-GuyNeural", label: "English US — Guy (Male)", lang: "en-US", gender: "Male" },
    { id: "en-US-JennyNeural", label: "English US — Jenny (Conversational)", lang: "en-US", gender: "Female" }
];

function escapeXml(str) {
    return String(str || "")
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;")
        .replace(/"/g, "&quot;")
        .replace(/'/g, "&apos;");
}

async function probeAudioDuration(filePath) {
    try {
        const out = await runCommand(`ffprobe -v error -show_entries format=duration -of default=noprint_wrappers=1:nokey=1 "${filePath}"`);
        return parseFloat(out.trim()) || 0;
    } catch {
        return 0;
    }
}

function buildProportionalWords(text, totalDuration) {
    const tokens = String(text || "").trim().split(/\s+/).filter(Boolean);
    if (tokens.length === 0 || totalDuration <= 0) return [];
    const weights = tokens.map((t) => Math.max(2, t.replace(/[^a-zA-Z0-9]/g, "").length));
    const totalWeight = weights.reduce((a, b) => a + b, 0) || tokens.length;

    let cursor = 0;
    return tokens.map((token, idx) => {
        const span = totalDuration * (weights[idx] / totalWeight);
        const start = cursor;
        const end = idx === tokens.length - 1 ? totalDuration : Math.min(totalDuration, cursor + span);
        cursor = end;
        return {
            text: token,
            start: Number(start.toFixed(3)),
            end: Number(Math.max(start + 0.04, end).toFixed(3))
        };
    });
}

function parseMetadataBoundaries(metadataItems, fallbackText, totalDuration) {
    const wordEvents = metadataItems.filter((m) => m?.Type === "WordBoundary");
    const sentenceEvents = metadataItems.filter((m) => m?.Type === "SentenceBoundary");

    if (wordEvents.length > 0) {
        const words = [];
        for (const ev of wordEvents) {
            const txt = String(ev?.Data?.text?.Text || "").trim();
            if (!txt) continue;
            const start = Math.max(0, Number(ev?.Data?.Offset || 0) / 10_000_000);
            const dur = Math.max(0.04, Number(ev?.Data?.Duration || 0) / 10_000_000);
            const end = start + dur;

            if (/^[.,;:!?…]+$/.test(txt) && words.length > 0) {
                words[words.length - 1].text += txt;
                words[words.length - 1].end = Number(Math.max(words[words.length - 1].end, end).toFixed(3));
                continue;
            }
            words.push({
                text: txt,
                start: Number(start.toFixed(3)),
                end: Number(end.toFixed(3))
            });
        }
        if (words.length > 0) return words;
    }

    if (sentenceEvents.length > 0) {
        const words = [];
        for (const ev of sentenceEvents) {
            const sText = String(ev?.Data?.text?.Text || "").trim();
            const sStart = Math.max(0, Number(ev?.Data?.Offset || 0) / 10_000_000);
            const sDur = Math.max(0.1, Number(ev?.Data?.Duration || 0) / 10_000_000);
            const subWords = buildProportionalWords(sText, sDur);
            for (const sw of subWords) {
                words.push({
                    text: sw.text,
                    start: Number((sStart + sw.start).toFixed(3)),
                    end: Number((sStart + sw.end).toFixed(3))
                });
            }
        }
        if (words.length > 0) return words;
    }

    return buildProportionalWords(fallbackText, totalDuration);
}

/**
 * Synthesize text to MP3 via free Microsoft Edge TTS and extract word timestamps.
 */
async function synthesizeEdgeTTS(text, outputMp3Path, { voice = "id-ID-GadisNeural", rate = "+0%", pitch = "+0Hz" } = {}) {
    const cleanText = String(text || "").trim();
    if (!cleanText) {
        throw new Error("Teks narasi TTS tidak boleh kosong.");
    }

    const absOut = path.resolve(outputMp3Path);
    await ensureDirectoryExists(path.dirname(absOut));

    const tts = new MsEdgeTTS();
    const metadataItems = [];

    try {
        await tts.setMetadata(voice, OUTPUT_FORMAT.AUDIO_24KHZ_48KBITRATE_MONO_MP3, {
            wordBoundaryEnabled: true,
            sentenceBoundaryEnabled: true
        });

        const safeXmlInput = escapeXml(cleanText);
        const { audioStream, metadataStream } = tts.toStream(safeXmlInput, { rate, pitch });

        let metaBuffer = "";
        if (metadataStream) {
            metadataStream.on("data", (chunk) => {
                metaBuffer += chunk.toString();
                try {
                    const parsed = JSON.parse(metaBuffer);
                    metaBuffer = "";
                    if (Array.isArray(parsed?.Metadata)) {
                        metadataItems.push(...parsed.Metadata);
                    }
                } catch {
                    // Wait for full JSON chunk
                }
            });
            metadataStream.on("error", () => {});
        }

        await new Promise((resolve, reject) => {
            const writer = fs.createWriteStream(absOut);
            audioStream.once("error", (err) => {
                writer.destroy();
                reject(err);
            });
            writer.once("error", reject);
            writer.once("finish", () => {
                if (writer.bytesWritten > 0) resolve();
                else reject(new Error("Edge TTS tidak menghasilkan data audio."));
            });
            audioStream.pipe(writer);
        });
    } finally {
        try { tts.close(); } catch { /* ignore */ }
    }

    const duration = await probeAudioDuration(absOut);
    if (duration <= 0) {
        await fsp.unlink(absOut).catch(() => {});
        throw new Error("Audio hasil Edge TTS tidak valid (durasi 0 detik).");
    }

    const words = parseMetadataBoundaries(metadataItems, cleanText, duration);
    return {
        audioPath: absOut,
        duration,
        words
    };
}

module.exports = {
    EDGE_VOICES,
    synthesizeEdgeTTS,
    buildProportionalWords
};
