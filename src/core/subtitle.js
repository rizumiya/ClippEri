const path = require("path");
const fs = require("fs/promises");
const chalk = require("chalk");
const { GoogleGenerativeAI } = require("@google/generative-ai");
const { runCommand, ensureDirectoryExists } = require("../utils/shell");
const { getSettings } = require("../utils/settings_manager");
const TikTokTTS = require("tiktok-tts-node").default;

function getApiKeyList(customKey) {
    if (customKey) return [customKey];
    const settings = getSettings();
    if (Array.isArray(settings.gemini_api_key)) return settings.gemini_api_key;
    if (typeof settings.gemini_api_key === "string" && settings.gemini_api_key.trim() !== "") {
        return [settings.gemini_api_key.trim()];
    }
    return [];
}

async function getVideoDuration(filePath) {
    try {
        const command = `ffprobe -v error -show_entries format=duration -of default=noprint_wrappers=1:nokey=1 "${filePath}"`;
        const result = await runCommand(command);
        return parseFloat(result.trim()) || 0;
    } catch (error) {
        return 0;
    }
}

function formatAssTime(seconds) {
    const safeSeconds = Math.max(0, seconds);
    const h = Math.floor(safeSeconds / 3600);
    const m = Math.floor((safeSeconds % 3600) / 60);
    const s = Math.floor(safeSeconds % 60);
    const cs = Math.floor((safeSeconds % 1) * 100);
    return `${h}:${m.toString().padStart(2, "0")}:${s.toString().padStart(2, "0")}.${cs.toString().padStart(2, "0")}`;
}

function assTimeToSeconds(time) {
    const match = String(time).trim().match(/^(\d+):(\d{2}):(\d{2})\.(\d{2})$/);
    if (!match) return 0;
    const [, h, m, s, cs] = match;
    return Number(h) * 3600 + Number(m) * 60 + Number(s) + Number(cs) / 100;
}

function normalizeSubtitleAiSettings(raw = {}) {
    const fontSize = Number(raw.fontSize);
    const lineSpacing = Number(raw.lineSpacing);
    const maxLines = Number(raw.maxLines);
    const maxWordsPerLine = Number(raw.maxWordsPerLine);
    const positionBottom = Number(raw.positionBottom);

    return {
        fontFamily: String(raw.fontFamily || "Poppins").trim() || "Poppins",
        fontSize: Math.max(24, Number.isFinite(fontSize) ? fontSize : 80),
        lineSpacing: Number.isFinite(lineSpacing) ? lineSpacing : 0,
        outlineColor: /^#[0-9a-fA-F]{6}$/.test(String(raw.outlineColor || "")) ? String(raw.outlineColor) : "#ff0000",
        maxLines: Math.min(2, Math.max(1, Number.isFinite(maxLines) ? maxLines : 2)),
        maxWordsPerLine: Math.max(1, Number.isFinite(maxWordsPerLine) ? maxWordsPerLine : 3),
        positionBottom: Math.max(20, Number.isFinite(positionBottom) ? positionBottom : 300)
    };
}

function getSubtitleAiSettings() {
    return normalizeSubtitleAiSettings(getSettings().subtitle_ai || {});
}

function hexToAssColor(hex) {
    const normalized = String(hex || "").replace("#", "").trim();
    if (!/^[0-9a-fA-F]{6}$/.test(normalized)) {
        return "&H000000FF";
    }

    const r = normalized.slice(0, 2).toUpperCase();
    const g = normalized.slice(2, 4).toUpperCase();
    const b = normalized.slice(4, 6).toUpperCase();
    return `&H00${b}${g}${r}`;
}

function buildAssStyleLine(subtitleSettings) {
    const outlineWidth = 2;
    const textColor = "&H00FFFFFF";
    const borderColor = hexToAssColor(subtitleSettings.outlineColor);
    const marginV = subtitleSettings.positionBottom;
    const spacing = -1;
    return `Style: Default,${subtitleSettings.fontFamily},${subtitleSettings.fontSize},${textColor},&H000000FF,${borderColor},&H00000000,-1,0,0,0,100,100,${spacing},0,1,${outlineWidth},0,2,10,10,${marginV},1`;
}

function splitDialogueFields(line) {
    if (!line.startsWith("Dialogue:")) return null;

    const raw = line.slice("Dialogue:".length).trimStart();
    const fields = [];
    let current = "";
    let commaCount = 0;

    for (const char of raw) {
        if (char === "," && commaCount < 9) {
            fields.push(current);
            current = "";
            commaCount += 1;
        } else {
            current += char;
        }
    }

    fields.push(current);
    while (fields.length < 10) fields.push("");
    return fields;
}

function buildDialogueLine(fields) {
    return `Dialogue: ${fields.slice(0, 9).join(",")},${fields[9]}`;
}

function normalizeDialogueText(text) {
    return String(text || "")
        .replace(/\{[^}]*\}/g, " ")
        .replace(/\\N/g, " ")
        .replace(/\\n/g, " ")
        .replace(/\s+/g, " ")
        .trim();
}

function prependAssTag(text, tag) {
    const raw = String(text || "");
    if (raw.startsWith("{")) {
        const endIndex = raw.indexOf("}");
        if (endIndex !== -1) {
            return `${raw.slice(0, endIndex)}${tag}${raw.slice(endIndex)}`;
        }
    }
    return `{${tag}}${raw}`;
}

function isWeakBoundaryWord(word) {
    return /^(dan|atau|yang|di|ke|dari|untuk|karena|kalau|biar|supaya|sampai)$/i.test(String(word || ""));
}

function isLeadPhraseWord(word) {
    return /^(tapi|tetapi|karena|jadi|dan|terus|namun|bahkan|makanya|soalnya|sedangkan|padahal)$/i.test(String(word || ""));
}

function maybeSwapTwoLines(lines) {
    if (!Array.isArray(lines) || lines.length !== 2) return lines;

    const firstWords = lines[0].split(/\s+/).filter(Boolean);
    const secondWords = lines[1].split(/\s+/).filter(Boolean);
    if (firstWords.length === 0 || secondWords.length === 0) return lines;

    const firstStartsLead = isLeadPhraseWord(firstWords[0]);
    const secondStartsLead = isLeadPhraseWord(secondWords[0]);

    if (!firstStartsLead && secondStartsLead) {
        return [lines[1], lines[0]];
    }

    return lines;
}

function chooseTwoLineSplit(words, maxWordsPerLine) {
    const minFirst = Math.max(1, words.length - maxWordsPerLine);
    const maxFirst = Math.min(maxWordsPerLine, words.length - 1);
    let bestIndex = minFirst;
    let bestScore = Number.POSITIVE_INFINITY;

    for (let splitIndex = minFirst; splitIndex <= maxFirst; splitIndex += 1) {
        const firstLine = words.slice(0, splitIndex);
        const secondLine = words.slice(splitIndex);
        const firstText = firstLine.join(" ");
        const secondText = secondLine.join(" ");
        let score = Math.abs(firstText.length - secondText.length);

        if (firstLine.length === 1 || secondLine.length === 1) score += 100;
        if (/[,.!?]$/.test(firstLine[firstLine.length - 1] || "")) score -= 8;
        if (isWeakBoundaryWord(secondLine[0])) score += 10;
        if (isWeakBoundaryWord(firstLine[firstLine.length - 1])) score += 6;

        if (score < bestScore) {
            bestScore = score;
            bestIndex = splitIndex;
        }
    }

    return bestIndex;
}

function buildDialogueGroups(text, subtitleSettings) {
    const normalized = normalizeDialogueText(text);
    if (!normalized) return [[""]];

    const words = normalized.split(/\s+/).filter(Boolean);
    const groups = [];
    const maxLines = subtitleSettings.maxLines;
    const maxWordsPerLine = subtitleSettings.maxWordsPerLine;
    const blockCapacity = maxLines * maxWordsPerLine;

    for (let i = 0; i < words.length; i += blockCapacity) {
        const blockWords = words.slice(i, i + blockCapacity);

        if (blockWords.length <= maxWordsPerLine || maxLines === 1) {
            groups.push([blockWords.join(" ")]);
            continue;
        }

        if (maxLines === 2) {
            const splitIndex = chooseTwoLineSplit(blockWords, maxWordsPerLine);
            groups.push(maybeSwapTwoLines([
                blockWords.slice(0, splitIndex).join(" "),
                blockWords.slice(splitIndex).join(" ")
            ]));
            continue;
        }

        const fallbackLines = [];
        for (let lineIndex = 0; lineIndex < blockWords.length; lineIndex += maxWordsPerLine) {
            fallbackLines.push(blockWords.slice(lineIndex, lineIndex + maxWordsPerLine).join(" "));
        }
        groups.push(fallbackLines);
    }

    return groups.length > 0 ? groups : [[""]];
}

function expandDialogueLine(line, subtitleSettings) {
    const fields = splitDialogueFields(line);
    if (!fields) return [line];

    const groups = buildDialogueGroups(fields[9], subtitleSettings);
    const start = assTimeToSeconds(fields[1]);
    const end = assTimeToSeconds(fields[2]);
    const totalDuration = Math.max(0.01, end - start);
    const weights = groups.map((group) => group.join(" ").split(/\s+/).filter(Boolean).length || 1);
    const totalWeight = weights.reduce((sum, value) => sum + value, 0) || groups.length;
    const baseMarginV = subtitleSettings.positionBottom;
    const baseLineOffset = Math.max(18, Math.round(subtitleSettings.fontSize * 0.62));
    const lineOffset = Math.max(4, baseLineOffset + Math.round(subtitleSettings.lineSpacing));
    const basePosY = 1920 - baseMarginV;
    const centerPosX = 540;

    let cursor = start;
    const expanded = [];

    groups.forEach((group, index) => {
        const isLast = index === groups.length - 1;
        const proportionalDuration = totalDuration * (weights[index] / totalWeight);
        const chunkStart = cursor;
        const chunkEnd = isLast ? end : Math.min(end, cursor + Math.max(0.01, proportionalDuration));
        cursor = chunkEnd;

        if (group.length === 1) {
            const single = [...fields];
            single[1] = formatAssTime(chunkStart);
            single[2] = formatAssTime(chunkEnd);
            single[7] = "0";
            single[9] = prependAssTag(group[0], `\\an2\\pos(${centerPosX},${basePosY})`);
            expanded.push(buildDialogueLine(single));
            return;
        }

        group.forEach((text, lineIndex) => {
            const perLine = [...fields];
            perLine[1] = formatAssTime(chunkStart);
            perLine[2] = formatAssTime(chunkEnd);
            perLine[7] = "0";
            const linePosY = basePosY - ((group.length - 1 - lineIndex) * lineOffset);
            perLine[9] = prependAssTag(text, `\\an2\\pos(${centerPosX},${linePosY})`);
            expanded.push(buildDialogueLine(perLine));
        });
    });

    return expanded;
}

function applySubtitleSettingsToAss(assContent, subtitleSettings) {
    let result = String(assContent || "");
    const styleRegex = /\[V4\+ Styles\][\s\S]*?(?=\[Events\])/i;
    const newStyleBlock = `[V4+ Styles]
Format: Name, Fontname, Fontsize, PrimaryColour, SecondaryColour, OutlineColour, BackColour, Bold, Italic, Underline, StrikeOut, ScaleX, ScaleY, Spacing, Angle, BorderStyle, Outline, Shadow, Alignment, MarginL, MarginR, MarginV, Encoding
${buildAssStyleLine(subtitleSettings)}

`;

    result = result.replace(/PlayResX:\s*\d+/gi, "PlayResX: 1080");
    result = result.replace(/PlayResY:\s*\d+/gi, "PlayResY: 1920");

    if (styleRegex.test(result)) {
        result = result.replace(styleRegex, newStyleBlock);
    }

    return result
        .split(/\r?\n/)
        .flatMap((line) => (line.startsWith("Dialogue:") ? expandDialogueLine(line, subtitleSettings) : [line]))
        .join("\n");
}

function splitTextForTTS(text, maxLen = 290) {
    const words = text.split(/\s+/);
    const chunks = [];
    let current = "";

    for (const word of words) {
        if ((current + " " + word).trim().length > maxLen) {
            if (current) chunks.push(current.trim());
            current = word;
        } else {
            current = (current + " " + word).trim();
        }
    }

    if (current) chunks.push(current.trim());
    return chunks;
}

async function generateTikTokTTS(text, sessionId, voice, outputDir, baseName) {
    const speaker = new TikTokTTS(sessionId);
    speaker.sessionId = sessionId;
    const chunks = splitTextForTTS(text);
    console.log(chalk.blue(`Jumlah chunk TTS: ${chunks.length}`));

    const chunkPaths = [];
    for (let i = 0; i < chunks.length; i += 1) {
        const chunkOutputBase = path.join(outputDir, `${baseName}_tts_chunk_${i}`);
        console.log(chalk.gray(`   -> Chunk ${i + 1}/${chunks.length}: "${chunks[i].substring(0, 50)}..."`));
        await speaker.tts(chunks[i], voice || "id_001", chunkOutputBase);
        chunkPaths.push(`${chunkOutputBase}.mp3`);
    }

    if (chunkPaths.length === 1) {
        const finalPath = path.join(outputDir, `${baseName}_tts.mp3`);
        await fs.rename(chunkPaths[0], finalPath);
        return finalPath;
    }

    const concatListPath = path.join(outputDir, `${baseName}_tts_list.txt`);
    const concatContent = chunkPaths.map((filePath) => `file '${filePath.replace(/\\/g, "/")}'`).join("\n");
    await fs.writeFile(concatListPath, concatContent, "utf8");

    const finalMp3 = path.join(outputDir, `${baseName}_tts.mp3`);
    const mergeCmd = `ffmpeg -y -f concat -safe 0 -i "${concatListPath}" -c copy "${finalMp3}"`;
    await runCommand(mergeCmd);

    for (const filePath of chunkPaths) {
        try {
            await fs.unlink(filePath);
        } catch (error) {
        }
    }

    try {
        await fs.unlink(concatListPath);
    } catch (error) {
    }

    return finalMp3;
}

function extractDialoguePlainText(assContent) {
    return String(assContent || "")
        .split(/\r?\n/)
        .map((line) => splitDialogueFields(line))
        .filter(Boolean)
        .map((fields) => normalizeDialogueText(fields[9]))
        .filter(Boolean)
        .join(" ");
}

async function processSubtitleForFolderCore(sourceDir, finalDir, context, voice, srtWavDir) {
    let keys = [];
    if (!srtWavDir) {
        keys = getApiKeyList();
        if (keys.length === 0) {
            throw new Error("API Key Gemini tidak ditemukan. Silakan isi di menu Settings.");
        }
    }

    const settings = getSettings();
    const subtitleSettings = getSubtitleAiSettings();
    const sessionId = settings.tiktok_session_id;
    const useTTS = Boolean(sessionId);

    if (!srtWavDir && !useTTS) {
        console.log(chalk.yellow("TikTok Session ID tidak ditemukan. Subtitle akan dibuat tanpa audio TTS."));
        console.log(chalk.yellow("Silakan tambahkan session ID di menu Settings -> TikTok TTS Settings."));
    }

    await ensureDirectoryExists(finalDir);

    console.log(chalk.cyan(`Mencari video di folder: ${sourceDir}`));
    const files = await fs.readdir(sourceDir);
    const videoFiles = files.filter((file) => [".mp4", ".mkv", ".mov"].includes(path.extname(file).toLowerCase()));

    if (videoFiles.length === 0) {
        throw new Error("Tidak ada file video ditemukan di folder tersebut.");
    }

    if (srtWavDir) {
        console.log(chalk.cyan(`Mode external sinkronisasi aktif. Scan pasangan .srt dan .wav di: ${srtWavDir}`));

        let srtWavFiles = [];
        try {
            srtWavFiles = await fs.readdir(srtWavDir);
        } catch (error) {
            throw new Error(`Gagal membaca folder SRT/WAV eksternal: ${error.message}`);
        }

        const srtFiles = srtWavFiles.filter((file) => file.toLowerCase().endsWith(".srt"));
        const wavFiles = srtWavFiles.filter((file) => file.toLowerCase().endsWith(".wav"));
        const pairs = [];

        for (const srt of srtFiles) {
            const baseName = path.basename(srt, ".srt").toLowerCase();
            const matchingWav = wavFiles.find((wav) => path.basename(wav, ".wav").toLowerCase() === baseName);
            if (matchingWav) {
                pairs.push({
                    srtPath: path.join(srtWavDir, srt),
                    wavPath: path.join(srtWavDir, matchingWav)
                });
            }
        }

        console.log(chalk.green(`Ditemukan ${pairs.length} pasangan SRT dan WAV.`));

        if (pairs.length === 0) {
            throw new Error("Tidak ditemukan pasangan .srt dan .wav yang namanya persis sama di folder tersebut.");
        }

        const processCount = Math.min(pairs.length, videoFiles.length);
        console.log(chalk.blue(`Akan memproses ${processCount} video dengan subtitle eksternal...`));

        for (let i = 0; i < processCount; i += 1) {
            const file = videoFiles[i];
            const pair = pairs[i];
            console.log(chalk.magenta(`Memproses: ${file}`));
            console.log(chalk.gray(`   SRT: ${path.basename(pair.srtPath)}`));
            console.log(chalk.gray(`   WAV: ${path.basename(pair.wavPath)}`));

            const inputPath = path.join(sourceDir, file);
            const baseName = path.basename(file, path.extname(file));
            const outputPath = path.join(finalDir, `${baseName}_subtitled.mp4`);
            const assPath = path.join(finalDir, `${baseName}_external.ass`);
            const escapedInputSrt = pair.srtPath.replace(/\\/g, "/");
            const convertCmd = `ffmpeg -y -i "${escapedInputSrt}" "${assPath}"`;

            try {
                await runCommand(convertCmd);
            } catch (error) {
                console.error(chalk.red(`Gagal convert SRT ke ASS: ${error.message}`));
                continue;
            }

            try {
                const assContent = await fs.readFile(assPath, "utf8");
                const normalizedAss = applySubtitleSettingsToAss(assContent, subtitleSettings);
                await fs.writeFile(assPath, normalizedAss, "utf8");
                console.log(chalk.green("Style subtitle eksternal berhasil diperbarui."));
            } catch (error) {
                console.error(chalk.red(`Gagal memodifikasi file ASS hasil convert: ${error.message}`));
                continue;
            }

            const escapedAssPath = assPath.replace(/\\/g, "/").replace(/:/g, "\\:");
            const escapedWavPath = path.resolve(pair.wavPath);
            const command = `ffmpeg -y -i "${inputPath}" -i "${escapedWavPath}" -filter_complex "[0:v]ass='${escapedAssPath}'[v];[1:a]anull[a]" -map "[v]" -map "[a]" -c:v libx264 -preset fast -crf 23 -r 30 -c:a aac -b:a 128k -async 1 -vsync 1 -shortest "${outputPath}"`;

            try {
                await runCommand(command);
                console.log(chalk.green.bold(`Video subtitle berhasil dibuat: ${outputPath}`));
            } catch (error) {
                console.error(chalk.red(`Gagal render video: ${error.message}`));
            }
        }

        return;
    }

    const genAI = new GoogleGenerativeAI(keys[0]);
    const model = genAI.getGenerativeModel({ model: "gemini-2.5-flash" });

    for (const file of videoFiles) {
        console.log(chalk.magenta(`Memproses: ${file}`));
        const inputPath = path.join(sourceDir, file);
        const duration = await getVideoDuration(inputPath);

        if (duration === 0) {
            console.log(chalk.yellow(`Gagal mendapatkan durasi untuk ${file}, dilewati.`));
            continue;
        }

        const maxWords = Math.floor(duration / 0.4);
        console.log(chalk.blue(`Durasi video: ${duration.toFixed(2)} detik. Target kata: sekitar ${maxWords}.`));

        const promptContext = context ? `Konteks/Tema: ${context}.` : "Buat cerita atau narasi menarik.";
        const prompt = `
            ${promptContext}
            Buat sebuah monolog pendek untuk 1 orang narator dalam Bahasa Indonesia.
            Sangat penting: Panjang teks HARUS sekitar ${maxWords} kata dan pas dengan durasi ${duration.toFixed(2)} detik.

            Kembalikan output langsung dalam format .ASS (Advanced SubStation Alpha).
            Gunakan template berikut persis untuk strukturnya:

            [Script Info]
            ScriptType: v4.00+
            PlayResX: 1080
            PlayResY: 1920

            [V4+ Styles]
            Format: Name, Fontname, Fontsize, PrimaryColour, SecondaryColour, OutlineColour, BackColour, Bold, Italic, Underline, StrikeOut, ScaleX, ScaleY, Spacing, Angle, BorderStyle, Outline, Shadow, Alignment, MarginL, MarginR, MarginV, Encoding
            ${buildAssStyleLine(subtitleSettings)}

            [Events]
            Format: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text
            Dialogue: 0,0:00:00.00,0:00:03.00,Default,,0,0,0,,Baris kalimat pertama
            Dialogue: 0,0:00:03.00,0:00:06.00,Default,,0,0,0,,Baris kalimat kedua

            Aturan:
            1. Jangan beri judul, penjelasan, atau blok markdown. Langsung output teks mentah.
            2. Gunakan durasi ${duration.toFixed(2)} detik sebagai acuan timing.
            3. Pastikan format jam adalah H:MM:SS.cs, contoh 0:00:01.50.
            4. Bahasa santai, tidak kaku, cocok untuk gen z.
            5. Gunakan font ${subtitleSettings.fontFamily} ukuran ${subtitleSettings.fontSize}.
            6. Maksimal ${subtitleSettings.maxLines} baris per subtitle.
            7. Maksimal ${subtitleSettings.maxWordsPerLine} kata per baris.
        `;

        let resultText = "";
        try {
            console.log(chalk.cyan("Meminta Gemini generate monolog dalam format ASS..."));
            const result = await model.generateContent(prompt);
            resultText = result.response.text().trim();
            if (resultText.startsWith("```ass")) {
                resultText = resultText.replace(/```ass/, "").replace(/```$/, "").trim();
            } else if (resultText.startsWith("```")) {
                resultText = resultText.replace(/```/, "").replace(/```$/, "").trim();
            }
        } catch (error) {
            console.error(chalk.red(`Gagal generate monolog untuk ${file}: ${error.message}`));
            continue;
        }

        resultText = applySubtitleSettingsToAss(resultText, subtitleSettings);
        console.log(chalk.green("Subtitle AI berhasil dibuat."));

        const baseName = path.basename(file, path.extname(file));
        const assPath = path.join(finalDir, `${baseName}_subs.ass`);
        const outputPath = path.join(finalDir, `${baseName}_subtitled.mp4`);
        await fs.writeFile(assPath, resultText, "utf8");

        const escapedAssPath = assPath.replace(/\\/g, "/").replace(/:/g, "\\:");
        let ttsPath = null;

        if (useTTS) {
            try {
                const cleanText = extractDialoguePlainText(resultText);
                console.log(chalk.cyan(`Membuat audio TTS menggunakan TikTok voice "${voice || "id_001"}"...`));
                ttsPath = await generateTikTokTTS(cleanText, sessionId, voice || "id_001", finalDir, baseName);
                console.log(chalk.green(`Audio TTS berhasil dibuat: ${ttsPath}`));
            } catch (error) {
                console.error(chalk.red(`Gagal membuat TTS, video akan dibuat tanpa suara baru: ${error.message}`));
                ttsPath = null;
            }
        }

        console.log(chalk.cyan("Rendering subtitle ke video..."));
        let command;

        if (ttsPath) {
            const escapedTtsPath = path.resolve(ttsPath);
            command = `ffmpeg -y -i "${inputPath}" -i "${escapedTtsPath}" -filter_complex "[0:v]ass='${escapedAssPath}'[v];[1:a]atrim=0:${duration},asetpts=PTS-STARTPTS[a]" -map "[v]" -map "[a]" -c:v libx264 -preset fast -crf 23 -c:a aac -b:a 128k -shortest "${outputPath}"`;
        } else {
            command = `ffmpeg -y -i "${inputPath}" -vf "ass='${escapedAssPath}'" -c:v libx264 -preset fast -crf 23 -c:a copy "${outputPath}"`;
        }

        try {
            await runCommand(command);
            console.log(chalk.green.bold(`Video subtitle berhasil dibuat: ${outputPath}`));
        } catch (error) {
            console.error(chalk.red(`Gagal render video: ${error.message}`));
        }
    }
}

module.exports = { processSubtitleForFolderCore };
