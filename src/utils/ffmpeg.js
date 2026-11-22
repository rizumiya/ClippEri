const path = require("path");
const fs = require("fs/promises");
const config = require("../config");
const { runCommand } = require("./shell");
const { runEncode } = require("./encoder");

async function getVideoRotation(filePath) {
    try {
        const command = `ffprobe -v error -select_streams v:0 -show_entries stream_tags=rotate -of default=noprint_wrappers=1:nokey=1 "${filePath}"`;
        const result = await runCommand(command);
        return parseInt(result.trim()) || 0;
    } catch {
        return 0;
    }
}

function wrapText(text, maxChars = 30) {
    if (!text) return "";
    const words = text.trim().split(/\s+/);
    const lines = [];
    let currentLine = "";

    words.forEach(word => {
        if ((currentLine + word).length > maxChars) {
            if (currentLine) lines.push(currentLine.trim());
            currentLine = word + " ";
        } else {
            currentLine += word + " ";
        }
    });
    if (currentLine) lines.push(currentLine.trim());
    return lines.join("\n");
}

async function applyHookToFinalVideo(inputPath, text, outputPath, backgroundAudioPath = null, hookStartTime = null, hookDuration = null) {
    const wrappedText = wrapText(text, config.styles.wrapLimit);
    const lines = text ? wrappedText.split("\n") : [];
    const rotation = await getVideoRotation(inputPath);

    const { tealColor, fontPath, fixedBoxBorder, fixedLineSpacing, quoteSizeExpr, textSizeExpr, yOffsetQuoteExpr } = config.styles;

    const tempDir = path.resolve(path.dirname(outputPath));
    const quoteTextPath = path.join(tempDir, `quote_icon_${Date.now()}.txt`);
    const linePaths = [];

    let filter = "";
    let enableFilter = "";
    if (hookStartTime !== null && hookDuration !== null) {
        enableFilter = `:enable='between(t,${hookStartTime},${hookStartTime + hookDuration})'`;
    }

    if (text) {
        await fs.writeFile(quoteTextPath, "", "utf8");

        for (let i = 0; i < lines.length; i++) {
            const lp = path.join(tempDir, `hook_line_${i}_${Date.now()}.txt`);
            const fileContent = lines[i].replace(/%/g, "\\%");
            await fs.writeFile(lp, fileContent, "utf8");
            linePaths.push(lp);
        }

        const xCoord = "w/10";
        const yBase = "h/3.2";
        const escapedQuotePath = quoteTextPath.replace(/\\/g, "/").replace(/:/g, "\\:");

        filter += `,drawtext=textfile='${escapedQuotePath}':fontcolor=white:fontsize=${quoteSizeExpr}:fontfile='${fontPath}':box=1:boxcolor=${tealColor}:boxborderw=${fixedBoxBorder - 4}:x=${xCoord}:y=${yBase}-${yOffsetQuoteExpr}${enableFilter}`;

        for (let i = 0; i < linePaths.length; i++) {
            const escapedLinePath = linePaths[i].replace(/\\/g, "/").replace(/:/g, "\\:");
            const lineHeightSafe = `(${textSizeExpr}) + (${fixedBoxBorder} * 2) + ${fixedLineSpacing}`;
            const yExpr = i === 0 ? yBase : `${yBase}+${i}*(${lineHeightSafe})`;
            filter += `,drawtext=textfile='${escapedLinePath}':fontcolor=black:fontsize=${textSizeExpr}:fontfile='${fontPath}':box=1:boxcolor=white:boxborderw=${fixedBoxBorder}:x=${xCoord}:y=${yExpr}${enableFilter}`;
        }
    }

    const rotateFlag = (rotation !== 0) ? "-noautorotate" : "";
    const targetRes = config.video.targetResolution;
    const scaleFilter = (rotation === 90 || rotation === 270) ? `scale=-2:${targetRes}` : `scale=${targetRes}:-2`;

    const { vBitrate, preset, crf, frameRate } = config.video;
    const { aBitrate, channels, sampleRate } = config.audio;

    const audioInput = backgroundAudioPath ? `-i "${path.resolve(backgroundAudioPath)}"` : "";

    try {
        await runEncode((encArgs, encoder) => {
            const bitrateArg = encoder === "libx264" ? `-b:v ${vBitrate}` : "";
            let command = `ffmpeg -y ${rotateFlag} -i "${path.resolve(inputPath)}" ${audioInput} `;

            if (backgroundAudioPath) {
                const audioFilterComplex = `[1:a]atrim=0,asetpts=PTS-STARTPTS[bg]`;
                command += `-filter_complex "${scaleFilter}${filter}[vproc];${audioFilterComplex}" -map "[vproc]" -map "[bg]" -shortest `;
                command += `${encArgs} ${bitrateArg} -r ${frameRate} `;
                command += `-c:a aac -b:a ${aBitrate} -ac ${channels} -ar ${sampleRate} `;
            } else {
                command += `-vf "${scaleFilter}${filter}" `;
                command += `${encArgs} ${bitrateArg} -r ${frameRate} `;
                command += `-c:a aac -b:a ${aBitrate} -ac ${channels} -ar ${sampleRate} `;
            }

            if (rotation !== 0) command += ` -metadata:s:v:0 rotate=${rotation}`;
            command += ` "${path.resolve(outputPath)}" -loglevel quiet`;
            return command;
        }, { quality: crf, preset });
    } finally {
        if (text) {
            await fs.unlink(quoteTextPath).catch(() => {});
            for (const p of linePaths) {
                await fs.unlink(p).catch(() => {});
            }
        }
    }
}

module.exports = {
    getVideoRotation,
    wrapText,
    applyHookToFinalVideo
};
