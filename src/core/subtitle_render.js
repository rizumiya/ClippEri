const path = require("path");
const fs = require("fs/promises");
const chalk = require("chalk");
const { runEncode } = require("../utils/encoder");
const { getVideoDimensions } = require("../utils/video_orientation");
const {
    formatAssTime,
    hexToAssColor,
    escapeAssFilterPath,
    normalizeSubtitleAiSettings
} = require("../utils/ass_helpers");

const AUDIO_EXTS = new Set([".mp3", ".m4a", ".wav", ".aac", ".flac", ".ogg"]);

function splitIntoLines(captionWords, maxWordsPerLine, maxLines) {
    if (maxLines <= 1 || captionWords.length <= maxWordsPerLine) {
        return [captionWords];
    }
    if (maxLines === 2) {
        const firstCount = Math.min(maxWordsPerLine, Math.ceil(captionWords.length / 2));
        return [
            captionWords.slice(0, firstCount),
            captionWords.slice(firstCount)
        ].filter((line) => line.length > 0);
    }
    const lines = [];
    for (let i = 0; i < captionWords.length; i += maxWordsPerLine) {
        lines.push(captionWords.slice(i, i + maxWordsPerLine));
    }
    return lines;
}

function groupWords(words = [], { maxWordsPerLine = 3, maxLines = 2, maxGapSec = 0.6 } = {}) {
    if (!Array.isArray(words) || words.length === 0) return [];

    const safeMaxWords = Math.max(1, Number(maxWordsPerLine) || 3);
    const safeMaxLines = Math.min(3, Math.max(1, Number(maxLines) || 2));
    const capacity = safeMaxWords * safeMaxLines;

    const captions = [];
    let current = [];

    const flush = () => {
        if (current.length === 0) return;
        const lines = splitIntoLines(current, safeMaxWords, safeMaxLines);
        captions.push({
            start: current[0].start,
            end: current[current.length - 1].end,
            words: current,
            lines,
            text: current.map((w) => w.text).join(" ")
        });
        current = [];
    };

    for (let i = 0; i < words.length; i++) {
        const w = words[i];
        if (!w || !String(w.text || "").trim()) continue;

        if (current.length > 0) {
            const prev = current[current.length - 1];
            const gap = (Number(w.start) || 0) - (Number(prev.end) || 0);
            const endsSentence = /[.!?]$/.test(String(prev.text || "").trim());

            if (
                current.length >= capacity ||
                gap > maxGapSec ||
                (endsSentence && current.length >= safeMaxWords)
            ) {
                flush();
            }
        }
        current.push(w);
    }
    flush();

    return captions;
}

function escapeAssText(text) {
    return String(text || "")
        .replace(/\{/g, "\\{")
        .replace(/\}/g, "\\}");
}

function buildBottomGradientFilter() {
    return [
        "drawbox=x=0:y=ih*0.64:w=iw:h=ih*0.36:color=black@0.10:t=fill",
        "drawbox=x=0:y=ih*0.70:w=iw:h=ih*0.30:color=black@0.12:t=fill",
        "drawbox=x=0:y=ih*0.76:w=iw:h=ih*0.24:color=black@0.14:t=fill",
        "drawbox=x=0:y=ih*0.82:w=iw:h=ih*0.18:color=black@0.16:t=fill",
        "drawbox=x=0:y=ih*0.86:w=iw:h=ih*0.14:color=black@0.18:t=fill",
        "drawbox=x=0:y=ih*0.90:w=iw:h=ih*0.10:color=black@0.20:t=fill"
    ].join(",");
}

function buildAss(captions = [], rawStyle = {}, { width = 1080, height = 1920 } = {}) {
    const style = normalizeSubtitleAiSettings(rawStyle);
    const scaleFactor = height / 1920;
    const scaledFontSize = Math.max(12, Math.round(style.fontSize * scaleFactor));
    const scaledMarginV = Math.max(16, Math.round(style.positionBottom * scaleFactor));
    const scaledMarginX = Math.max(12, Math.round(style.marginX * scaleFactor));
    const outlineWidth = style.outlineWidth <= 0 ? 0 : Math.max(1, Math.round(style.outlineWidth * scaleFactor));
    const shadowDepth = style.shadowDepth <= 0 ? 0 : Math.max(1, Math.round(style.shadowDepth * scaleFactor));
    const boldFlag = style.bold ? -1 : 0;
    const italicFlag = style.italic ? -1 : 0;
    const assAlign = style.alignment === "left" ? 1 : style.alignment === "right" ? 3 : 2;

    const primaryAss = hexToAssColor(style.primaryColor, "&H00FFFFFF");
    const highlightAss = hexToAssColor(style.highlightColor, "&H0081B910");
    const outlineAss = hexToAssColor(style.outlineColor, "&H00000000");

    // In ASS karaoke (\k), SecondaryColour is the pre-fill color and PrimaryColour is the filled/active color.
    const stylePrimary = style.highlightMode === "karaoke" ? highlightAss : primaryAss;
    const styleSecondary = style.highlightMode === "karaoke" ? primaryAss : highlightAss;

    const footerFontSize = Math.max(11, Math.round(20 * scaleFactor));
    const footerMarginV = Math.max(16, Math.round(44 * scaleFactor));
    const footerShadow = shadowDepth > 0 ? 1 : 0;
    const footerStyleLine = style.footerText
        ? `\nStyle: Footer,${style.fontFamily},${footerFontSize},&H38CCCCCC,&H38CCCCCC,&H00000000,&H64000000,0,0,0,0,100,100,1.2,0,1,0,${footerShadow},1,${scaledMarginX},${scaledMarginX},${footerMarginV},1`
        : "";

    const header = `[Script Info]
ScriptType: v4.00+
PlayResX: ${width}
PlayResY: ${height}
WrapStyle: 2
ScaledBorderAndShadow: yes

[V4+ Styles]
Format: Name, Fontname, Fontsize, PrimaryColour, SecondaryColour, OutlineColour, BackColour, Bold, Italic, Underline, StrikeOut, ScaleX, ScaleY, Spacing, Angle, BorderStyle, Outline, Shadow, Alignment, MarginL, MarginR, MarginV, Encoding
Style: Default,${style.fontFamily},${scaledFontSize},${stylePrimary},${styleSecondary},${outlineAss},&H64000000,${boldFlag},${italicFlag},0,0,100,100,0,0,1,${outlineWidth},${shadowDepth},${assAlign},${scaledMarginX},${scaledMarginX},${scaledMarginV},1${footerStyleLine}

[Events]
Format: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text`;

    const events = [];
    const formatWord = (txt) => {
        const t = style.uppercase ? String(txt).toUpperCase() : String(txt);
        return escapeAssText(t);
    };

    let lastEnd = 0;
    for (const caption of captions) {
        if (!caption || !Array.isArray(caption.words) || caption.words.length === 0) continue;
        lastEnd = Math.max(lastEnd, Number(caption.end) || 0);

        if (style.highlightMode === "karaoke") {
            let wordIdx = 0;
            const flatWords = caption.words;
            const lineStrings = caption.lines.map((line) => {
                return line.map((w) => {
                    const nextW = flatWords[wordIdx + 1];
                    const spanEnd = nextW ? Math.max(w.end, nextW.start) : caption.end;
                    const durCs = Math.max(1, Math.round((spanEnd - w.start) * 100));
                    wordIdx += 1;
                    return `{\\k${durCs}}${formatWord(w.text)}`;
                }).join(" ");
            });

            events.push(
                `Dialogue: 0,${formatAssTime(caption.start)},${formatAssTime(caption.end)},Default,,0,0,0,,${lineStrings.join("\\N")}`
            );
        } else if (style.highlightMode === "active" || style.highlightMode === "active_underline") {
            const flatWords = caption.words;
            const withUnderline = style.highlightMode === "active_underline";
            const popOpen = style.activePop ? "\\fscx108\\fscy108" : "";
            const popClose = style.activePop ? "\\fscx100\\fscy100" : "";
            const uOpen = withUnderline ? "\\u1" : "";
            const uClose = withUnderline ? "\\u0" : "";

            for (let activeIdx = 0; activeIdx < flatWords.length; activeIdx++) {
                const activeWord = flatWords[activeIdx];
                const nextWord = flatWords[activeIdx + 1];
                const segStart = activeWord.start;
                const segEnd = nextWord ? Math.max(activeWord.end, nextWord.start) : caption.end;

                let cursor = 0;
                const lineStrings = caption.lines.map((line) => {
                    return line.map((w) => {
                        const isCurrent = cursor === activeIdx;
                        cursor += 1;
                        const text = formatWord(w.text);
                        if (isCurrent) {
                            return `{\\c${highlightAss}${uOpen}${popOpen}}${text}{\\c${primaryAss}${uClose}${popClose}}`;
                        }
                        return text;
                    }).join(" ");
                });

                events.push(
                    `Dialogue: 0,${formatAssTime(segStart)},${formatAssTime(Math.max(segStart + 0.04, segEnd))},Default,,0,0,0,,${lineStrings.join("\\N")}`
                );
            }
        } else {
            const lineStrings = caption.lines.map((line) => line.map((w) => formatWord(w.text)).join(" "));
            events.push(
                `Dialogue: 0,${formatAssTime(caption.start)},${formatAssTime(caption.end)},Default,,0,0,0,,${lineStrings.join("\\N")}`
            );
        }
    }

    if (style.footerText && lastEnd > 0) {
        const endAss = formatAssTime(lastEnd);
        const dividerY = Math.max(20, height - footerMarginV - footerFontSize - Math.round(14 * scaleFactor));
        const dividerW = Math.max(80, width - scaledMarginX * 2);
        events.push(
            `Dialogue: 0,0:00:00.00,${endAss},Default,,0,0,0,,{\\an7\\pos(${scaledMarginX},${dividerY})\\bord0\\shad0\\1c&HFFFFFF&\\1a&HD8&\\p1}m 0 0 l ${dividerW} 0 l ${dividerW} 1 l 0 1{\\p0}`
        );
        events.push(
            `Dialogue: 0,0:00:00.00,${endAss},Footer,,0,0,0,,${escapeAssText(style.footerText)}`
        );
    }

    return `${header}\n${events.join("\n")}\n`;
}

async function getTargetMediaDimensions(inputPath) {
    const ext = path.extname(inputPath).toLowerCase();
    if (AUDIO_EXTS.has(ext)) {
        return { width: 1080, height: 1920, isAudioOnly: true };
    }
    try {
        const dims = await getVideoDimensions(inputPath);
        if (dims.width > 0 && dims.height > 0) {
            return { width: dims.width, height: dims.height, isAudioOnly: false };
        }
    } catch { /* fallback below */ }
    return { width: 1080, height: 1920, isAudioOnly: false };
}

async function burnSubtitles(inputPath, assPath, outputPath, style = {}) {
    const absInput = path.resolve(inputPath);
    const absAss = path.resolve(assPath);
    const absOutput = path.resolve(outputPath);
    await fs.mkdir(path.dirname(absOutput), { recursive: true });

    const ext = path.extname(absInput).toLowerCase();
    const isAudioOnly = AUDIO_EXTS.has(ext);
    const escapedAss = escapeAssFilterPath(absAss);
    const useBottomGradient = Boolean(style && style.bottomGradient);
    const vfChain = useBottomGradient ? `${buildBottomGradientFilter()},ass='${escapedAss}'` : `ass='${escapedAss}'`;

    console.log(chalk.cyan(`🎬 Merender subtitle ke ${path.basename(absOutput)}...`));

    if (isAudioOnly) {
        await runEncode(
            (encArgs) => `ffmpeg -y -f lavfi -i color=c=0x0c1210:s=1080x1920:r=30 -i "${absInput}" -vf "${vfChain}" ${encArgs} -c:a aac -b:a 128k -shortest "${absOutput}"`,
            { quality: 23, preset: "fast" }
        );
    } else {
        await runEncode(
            (encArgs) => `ffmpeg -y -i "${absInput}" -vf "${vfChain}" ${encArgs} -c:a copy "${absOutput}"`,
            { quality: 23, preset: "fast" }
        );
    }

    console.log(chalk.green(`✅ Render selesai: ${absOutput}`));
    return absOutput;
}

module.exports = {
    AUDIO_EXTS,
    groupWords,
    buildBottomGradientFilter,
    buildAss,
    getTargetMediaDimensions,
    burnSubtitles
};
