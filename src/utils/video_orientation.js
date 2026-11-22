const { runCommand } = require("./shell");
const chalk = require("chalk");

/**
 * Get video dimensions using ffprobe
 * @param {string} filePath - Path to video file
 * @returns {Promise<{width: number, height: number}>}
 */
async function getVideoDimensions(filePath) {
    try {
        const command = `ffprobe -v error -select_streams v:0 -show_entries stream=width,height -of csv=p=0 "${filePath}"`;
        const result = await runCommand(command, false);
        const [width, height] = result.trim().split(',').map(Number);
        return { width, height };
    } catch (e) {
        console.error(chalk.red(`❌ Gagal mendapatkan dimensi video: ${e.message}`));
        throw e;
    }
}

/**
 * Check if video is portrait (9:16 or similar) or landscape
 * @param {string} filePath - Path to video file
 * @returns {Promise<{isPortrait: boolean, width: number, height: number, aspectRatio: string}>}
 */
async function checkVideoOrientation(filePath) {
    const { width, height } = await getVideoDimensions(filePath);
    const isPortrait = height > width;
    const aspectRatio = `${width}:${height}`;

    return {
        isPortrait,
        width,
        height,
        aspectRatio
    };
}

/**
 * Convert landscape video to portrait
 * @param {string} inputPath - Input video path
 * @param {string} outputPath - Output video path
 * @param {string} method - Conversion method: 'rotate', 'crop', or 'blur' (default: 'rotate')
 * @param {string} direction - Rotation direction: 'clockwise' or 'counter-clockwise' (only for rotate method)
 */
async function convertToPortrait(inputPath, outputPath, method = 'rotate', direction = 'clockwise') {
    const { width, height, isPortrait } = await checkVideoOrientation(inputPath);

    if (isPortrait) {
        console.log(chalk.cyan(`   ℹ️  Video sudah portrait, skip konversi.`));
        return inputPath; // No conversion needed
    }

    console.log(chalk.yellow(`   🔄 Mengkonversi landscape (${width}x${height}) ke portrait...`));

    let command;

    if (method === 'rotate') {
        // Method 1: Simple rotation (FASTEST & RECOMMENDED)
        // transpose=1 = 90° clockwise (rotate right)
        // transpose=2 = 90° counter-clockwise (rotate left)
        const transposeValue = direction === 'clockwise' ? '1' : '2';
        command = `ffmpeg -y -i "${inputPath}" -vf "transpose=${transposeValue}" ` +
            `-c:v libx264 -preset fast -crf 23 -c:a copy "${outputPath}" -loglevel quiet`;
    } else if (method === 'crop') {
        // Method 2: Crop center to 9:16
        const targetWidth = Math.floor(height * 9 / 16);
        const cropX = Math.floor((width - targetWidth) / 2);
        const filterComplex = `crop=${targetWidth}:${height}:${cropX}:0,scale=1080:1920`;
        command = `ffmpeg -y -i "${inputPath}" -filter_complex "${filterComplex}" ` +
            `-c:v libx264 -preset fast -crf 23 -c:a copy "${outputPath}" -loglevel quiet`;
    } else {
        // Method 3: Blur background with original centered
        const filterComplex = `[0:v]scale=1080:1920:force_original_aspect_ratio=decrease,boxblur=20:5[fg];` +
            `[0:v]scale=1080:1920,boxblur=50:10[bg];` +
            `[bg][fg]overlay=(W-w)/2:(H-h)/2`;
        command = `ffmpeg -y -i "${inputPath}" -filter_complex "${filterComplex}" ` +
            `-c:v libx264 -preset fast -crf 23 -c:a copy "${outputPath}" -loglevel quiet`;
    }

    try {
        await runCommand(command, false);
        const directionText = method === 'rotate' ? ` - ${direction}` : '';
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
