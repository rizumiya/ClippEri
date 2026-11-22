const { runCommand } = require("./shell");
const { runEncode } = require("./encoder");
const chalk = require("chalk");

async function getVideoDimensions(filePath) {
    try {
        const command = `ffprobe -v error -select_streams v:0 -show_entries stream=width,height -of csv=p=0 "${filePath}"`;
        const result = await runCommand(command, false);
        const [width, height] = result.trim().split(",").map(Number);
        return { width, height };
    } catch (e) {
        console.error(chalk.red(`❌ Gagal mendapatkan dimensi video: ${e.message}`));
        throw e;
    }
}

async function checkVideoOrientation(filePath) {
    const { width, height } = await getVideoDimensions(filePath);
    const isPortrait = height > width;
    return {
        isPortrait,
        width,
        height,
        aspectRatio: `${width}:${height}`
    };
}

async function convertToPortrait(inputPath, outputPath, method = "rotate", direction = "clockwise") {
    const { width, height, isPortrait } = await checkVideoOrientation(inputPath);

    if (isPortrait) {
        console.log(chalk.cyan(`   ℹ️  Video sudah portrait, skip konversi.`));
        return inputPath;
    }

    console.log(chalk.yellow(`   🔄 Mengkonversi landscape (${width}x${height}) ke portrait...`));

    let filterFlag = "";
    if (method === "rotate") {
        const transposeValue = direction === "clockwise" ? "1" : "2";
        filterFlag = `-vf "transpose=${transposeValue}"`;
    } else if (method === "crop") {
        const targetWidth = Math.floor(height * 9 / 16);
        const cropX = Math.floor((width - targetWidth) / 2);
        filterFlag = `-filter_complex "crop=${targetWidth}:${height}:${cropX}:0,scale=1080:1920"`;
    } else {
        const filterComplex = `[0:v]scale=1080:1920:force_original_aspect_ratio=decrease,boxblur=20:5[fg];` +
            `[0:v]scale=1080:1920,boxblur=50:10[bg];` +
            `[bg][fg]overlay=(W-w)/2:(H-h)/2`;
        filterFlag = `-filter_complex "${filterComplex}"`;
    }

    try {
        await runEncode(
            (encArgs) => `ffmpeg -y -i "${inputPath}" ${filterFlag} ${encArgs} -c:a copy "${outputPath}" -loglevel quiet`,
            { quality: 23, preset: "fast" }
        );
        const directionText = method === "rotate" ? ` - ${direction}` : "";
        console.log(chalk.green(`   ✅ Konversi portrait selesai (${method}${directionText})`));
        return outputPath;
    } catch (e) {
        console.error(chalk.red(`   ❌ Gagal konversi ke portrait: ${e.message}`));
        throw e;
    }
}

module.exports = {
    getVideoDimensions,
    checkVideoOrientation,
    convertToPortrait
};
