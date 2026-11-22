const path = require("path");
const fs = require("fs/promises");
const chalk = require("chalk");
const { GoogleGenerativeAI } = require("@google/generative-ai");
const { runCommand, ensureDirectoryExists } = require("../../utils/shell");
const { getSettings } = require("../../utils/settings_manager");
const { getApiKeyList } = require("../../core/ai_hook");
const { runEncode } = require("../../utils/encoder");
const {
    formatAssTime,
    assTimeToSeconds,
    hexToAssColor,
    escapeAssFilterPath,
    normalizeSubtitleAiSettings
} = require("../../utils/ass_helpers");
const TikTokTTS = require("tiktok-tts-node").default;

async function getVideoDuration(filePath) {
    try {
        const command = `ffprobe -v error -show_entries format=duration -of default=noprint_wrappers=1:nokey=1 "${filePath}"`;
        const result = await runCommand(command);
        return parseFloat(result.trim()) || 0;
    } catch {
        return 0;
    }
}

function getSubtitleAiSettings() {
    return normalizeSubtitleAiSettings(getSettings().subtitle_ai || {});
}

function buildAssStyleLine(subtitleSettings) {
    const outlineWidth = 2;
    const textColor = hexToAssColor(subtitleSettings.primaryColor, "&H00FFFFFF");
    const borderColor = hexToAssColor(subtitleSettings.outlineColor, "&H000000FF");
    const marginV = subtitleSettings.positionBottom;
    const boldFlag = subtitleSettings.bold ? -1 : 0;
    return `Style: Default,${subtitleSettings.fontFamily},${subtitleSettings.fontSize},${textColor},&H000000FF,${borderColor},&H00000000,${boldFlag},0,0,0,100,100,-1,0,1,${outlineWidth},0,2,10,10,${marginV},1`;
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

    if (!isLeadPhraseWord(firstWords[0]) && isLeadPhraseWord(secondWords[0])) {
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
        let score = Math.abs(firstLine.join(" ").length - secondLine.join(" ").length);

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
    await runCommand(`ffmpeg -y -f concat -safe 0 -i "${concatListPath}" -c copy "${finalMp3}"`);

    for (const filePath of chunkPaths) {
        await fs.unlink(filePath).catch(() => {});
    }
    await fs.unlink(concatListPath).catch(() => {});
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
            throw new Error("API Key Gemini tidak ditemukan. Silakan isi di menu Pengaturan.");
        }
    }

    const settings = getSettings();
    const ttsAddonCfg = settings.addons?.["tts-narration"] || {};
    const subtitleSettings = getSubtitleAiSettings();
    const sessionId = ttsAddonCfg.tiktok_session_id || settings.tiktok_session_id || "";
    const activeVoice = voice || ttsAddonCfg.tiktok_voice || settings.tiktok_voice || "id_001";
    const useTTS = Boolean(sessionId);

    if (!srtWavDir && !useTTS) {
        console.log(chalk.yellow("TikTok Session ID tidak ditemukan. Subtitle akan dibuat tanpa audio TTS."));
    }

    await ensureDirectoryExists(finalDir);
    const files = await fs.readdir(sourceDir);
    const videoFiles = files.filter((file) => [".mp4", ".mkv", ".mov"].includes(path.extname(file).toLowerCase()));
    if (videoFiles.length === 0) {
        throw new Error("Tidak ada file video ditemukan di folder tersebut.");
    }

    if (srtWavDir) {
        const srtWavFiles = await fs.readdir(srtWavDir);
        const srtFiles = srtWavFiles.filter((file) => file.toLowerCase().endsWith(".srt"));
        const wavFiles = srtWavFiles.filter((file) => file.toLowerCase().endsWith(".wav"));
        const pairs = [];

        for (const srt of srtFiles) {
            const baseName = path.basename(srt, ".srt").toLowerCase();
            const matchingWav = wavFiles.find((wav) => path.basename(wav, ".wav").toLowerCase() === baseName);
            if (matchingWav) {
                pairs.push({ srtPath: path.join(srtWavDir, srt), wavPath: path.join(srtWavDir, matchingWav) });
            }
        }
        if (pairs.length === 0) {
            throw new Error("Tidak ditemukan pasangan .srt dan .wav yang namanya persis sama.");
        }

        const processCount = Math.min(pairs.length, videoFiles.length);
        for (let i = 0; i < processCount; i += 1) {
            const file = videoFiles[i];
            const pair = pairs[i];
            const inputPath = path.join(sourceDir, file);
            const baseName = path.basename(file, path.extname(file));
            const outputPath = path.join(finalDir, `${baseName}_subtitled.mp4`);
            const assPath = path.join(finalDir, `${baseName}_external.ass`);
            const escapedInputSrt = pair.srtPath.replace(/\\/g, "/");

            try {
                await runCommand(`ffmpeg -y -i "${escapedInputSrt}" "${assPath}"`);
                const assContent = await fs.readFile(assPath, "utf8");
                await fs.writeFile(assPath, applySubtitleSettingsToAss(assContent, subtitleSettings), "utf8");

                const escapedAssPath = escapeAssFilterPath(assPath);
                const escapedWavPath = path.resolve(pair.wavPath);
                await runEncode(
                    (encArgs) => `ffmpeg -y -i "${inputPath}" -i "${escapedWavPath}" -filter_complex "[0:v]ass='${escapedAssPath}'[v];[1:a]anull[a]" -map "[v]" -map "[a]" ${encArgs} -r 30 -c:a aac -b:a 128k -async 1 -vsync 1 -shortest "${outputPath}"`,
                    { quality: 23, preset: "fast" }
                );
                console.log(chalk.green.bold(`✅ Video subtitle dibuat: ${outputPath}`));
            } catch (error) {
                console.error(chalk.red(`❌ Gagal memproses ${file}: ${error.message}`));
            }
        }
        return;
    }

    const genAI = new GoogleGenerativeAI(keys[0]);
    const model = genAI.getGenerativeModel({ model: "gemini-2.5-flash" });

    for (const file of videoFiles) {
        const inputPath = path.join(sourceDir, file);
        const duration = await getVideoDuration(inputPath);
        if (duration === 0) {
            console.log(chalk.yellow(`Gagal mendapatkan durasi untuk ${file}, dilewati.`));
            continue;
        }

        const maxWords = Math.floor(duration / 0.4);
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

            Aturan:
            1. Jangan beri judul, penjelasan, atau blok markdown.
            2. Gunakan durasi ${duration.toFixed(2)} detik sebagai acuan timing.
            3. Format jam H:MM:SS.cs, bahasa santai cocok untuk gen z.
            4. Font ${subtitleSettings.fontFamily} ukuran ${subtitleSettings.fontSize}, maksimal ${subtitleSettings.maxLines} baris, ${subtitleSettings.maxWordsPerLine} kata/baris.
        `;

        let resultText = "";
        try {
            const result = await model.generateContent(prompt);
            resultText = result.response.text().trim()
                .replace(/^```(?:ass)?/i, "")
                .replace(/```$/, "")
                .trim();
        } catch (error) {
            console.error(chalk.red(`Gagal generate monolog untuk ${file}: ${error.message}`));
            continue;
        }

        resultText = applySubtitleSettingsToAss(resultText, subtitleSettings);
        const baseName = path.basename(file, path.extname(file));
        const assPath = path.join(finalDir, `${baseName}_subs.ass`);
        const outputPath = path.join(finalDir, `${baseName}_subtitled.mp4`);
        await fs.writeFile(assPath, resultText, "utf8");

        const escapedAssPath = escapeAssFilterPath(assPath);
        let ttsPath = null;
        if (useTTS) {
            try {
                const cleanText = extractDialoguePlainText(resultText);
                ttsPath = await generateTikTokTTS(cleanText, sessionId, activeVoice, finalDir, baseName);
            } catch (error) {
                console.error(chalk.red(`Gagal TTS: ${error.message}`));
                ttsPath = null;
            }
        }

        try {
            if (ttsPath) {
                const escapedTtsPath = path.resolve(ttsPath);
                await runEncode(
                    (encArgs) => `ffmpeg -y -i "${inputPath}" -i "${escapedTtsPath}" -filter_complex "[0:v]ass='${escapedAssPath}'[v];[1:a]atrim=0:${duration},asetpts=PTS-STARTPTS[a]" -map "[v]" -map "[a]" ${encArgs} -c:a aac -b:a 128k -shortest "${outputPath}"`,
                    { quality: 23, preset: "fast" }
                );
            } else {
                await runEncode(
                    (encArgs) => `ffmpeg -y -i "${inputPath}" -vf "ass='${escapedAssPath}'" ${encArgs} -c:a copy "${outputPath}"`,
                    { quality: 23, preset: "fast" }
                );
            }
            console.log(chalk.green.bold(`✅ Video subtitle dibuat: ${outputPath}`));
        } catch (error) {
            console.error(chalk.red(`❌ Gagal render video: ${error.message}`));
        }
    }
}

module.exports = { processSubtitleForFolderCore };
