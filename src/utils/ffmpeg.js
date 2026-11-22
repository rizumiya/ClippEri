const path = require("path");
const fs = require("fs/promises");
const chalk = require("chalk");
const config = require("../config");
const { runCommand } = require("./shell");

async function getVideoRotation(filePath) {
    try {
        const command = `ffprobe -v error -select_streams v:0 -show_entries stream_tags=rotate -of default=noprint_wrappers=1:nokey=1 "${filePath}"`;
        const result = await runCommand(command);
        return parseInt(result.trim()) || 0;
    } catch (e) {
        return 0;
    }
}

function wrapText(text, maxChars = 30) {
    if (!text) return "";
    // Normalize whitespace (replace newlines/tabs with spaces) to avoid FFmpeg drawtext clipping
    const words = text.trim().split(/\s+/);
    let lines = [];
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
    return lines.join('\n');
}

async function applyHookToFinalVideo(inputPath, text, outputPath, backgroundAudioPath = null, hookStartTime = null, hookDuration = null) {
    const wrappedText = wrapText(text, config.styles.wrapLimit);
    const lines = text ? wrappedText.split('\n') : [];
    const rotation = await getVideoRotation(inputPath);

    const { tealColor, fontPath, fixedBoxBorder, fixedLineSpacing, quoteSizeExpr, textSizeExpr, yOffsetQuoteExpr } = config.styles;

    const tempDir = path.resolve(path.dirname(outputPath));
    const quoteTextPath = path.join(tempDir, `quote_icon_${Date.now()}.txt`);
    const linePaths = [];

    let filter = "";

    // Build enable filter for timing
    let enableFilter = "";
    if (hookStartTime !== null && hookDuration !== null) {
        enableFilter = `:enable='between(t,${hookStartTime},${hookStartTime + hookDuration})'`;
    }

    if (text) {
        await fs.writeFile(quoteTextPath, "", 'utf8');

        for (let i = 0; i < lines.length; i++) {
            const lp = path.join(tempDir, `hook_line_${i}_${Date.now()}.txt`);
            // Escape % in FFmpeg drawtext textfile by using \%
            const fileContent = lines[i].replace(/%/g, '\\%');
            await fs.writeFile(lp, fileContent, 'utf8');
            linePaths.push(lp);
        }

        let xCoord = "w/10";
        let yBase = "h/3.2";

        const escapedQuotePath = quoteTextPath.replace(/\\/g, '/').replace(/:/g, '\\:');

        // 1. Ikon Kutipan
        filter += `,drawtext=textfile='${escapedQuotePath}':fontcolor=white:fontsize=${quoteSizeExpr}:fontfile='${fontPath}':box=1:boxcolor=${tealColor}:boxborderw=${fixedBoxBorder - 4}:x=${xCoord}:y=${yBase}-${yOffsetQuoteExpr}${enableFilter}`;

        // 2. Teks Utama
        for (let i = 0; i < linePaths.length; i++) {
            const escapedLinePath = linePaths[i].replace(/\\/g, '/').replace(/:/g, '\\:');

            // lineHeightSafe should be slightly larger than the text height + padding
            // textSizeExpr is the font size. Padding top and bottom is fixedBoxBorder.
            // We add a tiny bit of fixedLineSpacing to separate the boxes.
            const lineHeightSafe = `(${textSizeExpr}) + (${fixedBoxBorder} * 2) + ${fixedLineSpacing}`;
            const yExpr = i === 0 ? yBase : `${yBase}+${i}*(${lineHeightSafe})`;

            filter += `,drawtext=textfile='${escapedLinePath}':fontcolor=black:fontsize=${textSizeExpr}:fontfile='${fontPath}':box=1:boxcolor=white:boxborderw=${fixedBoxBorder}:x=${xCoord}:y=${yExpr}${enableFilter}`;
        }
    }

    const rotateFlag = (rotation !== 0) ? "-noautorotate" : "";
    const targetRes = config.video.targetResolution;
    const scaleFilter = (rotation === 90 || rotation === 270) ? `scale=-2:${targetRes}` : `scale=${targetRes}:-2`;

    const { vBitrate, preset, crf, frameRate, pixFmt } = config.video;
    const { aBitrate, channels, sampleRate } = config.audio;

    // LOGIKA AUDIO REPLACEMENT (Hapus suara asli, gunakan backsound)
    let audioInput = "";
    let audioMap = "";
    let audioFilterComplex = "";

    if (backgroundAudioPath) {
        audioInput = `-i "${path.resolve(backgroundAudioPath)}"`;
        // Kita HANYA ambil audio dari input 1 ([1:a])
        // Gunakan apad/atrim atau amix dengan 1 input? amix paling aman untuk handle durasi
        // tapi amix butuh 2 input. 
        // Cara terbaik ganti suara: ambil suara ke-2, potong sesuai video.
        // Kita gunakan -map 1:a dan tambahkan -shortest serta filter durasi.
        // [vproc] = label untuk hasil filter video (scale + drawtext)
        // [bg] = label untuk hasil filter audio
        audioFilterComplex = `[1:a]atrim=0,asetpts=PTS-STARTPTS[bg]`;
        audioMap = `-map "[vproc]" -map "[bg]" -shortest`;
    } else {
        audioMap = `-c:a aac -b:a ${aBitrate} -ac ${channels} -ar ${sampleRate}`;
    }

    let command = `ffmpeg -y ${rotateFlag} -i "${path.resolve(inputPath)}" ${audioInput} `;

    if (backgroundAudioPath) {
        // Gabungkan filter video (label vproc) dan filter audio (label bg)
        command += `-filter_complex "${scaleFilter}${filter}[vproc];${audioFilterComplex}" ${audioMap} `;
        command += `-c:v libx264 -b:v ${vBitrate} -r ${frameRate} -pix_fmt ${pixFmt} -preset ${preset} -crf ${crf} `;
        command += `-c:a aac -b:a ${aBitrate} -ac ${channels} -ar ${sampleRate} `;
    } else {
        command += `-vf "${scaleFilter}${filter}" `;
        command += `-c:v libx264 -b:v ${vBitrate} -r ${frameRate} -pix_fmt ${pixFmt} -preset ${preset} -crf ${crf} `;
        command += `${audioMap} `;
    }


    if (rotation !== 0) command += ` -metadata:s:v:0 rotate=${rotation}`;
    command += ` "${path.resolve(outputPath)}" -loglevel quiet`;

    try {
        await runCommand(command);
    } finally {
        if (text) {
            try { await fs.unlink(quoteTextPath); } catch (e) { }
            for (const p of linePaths) {
                try { await fs.unlink(p); } catch (e) { }
            }
        }
    }
}

module.exports = {
    getVideoRotation,
    wrapText,
    applyHookToFinalVideo
};
