const path = require("path");
const chalk = require("chalk");
const { runCommand, getToolCommand, ensureDirectoryExists } = require("../utils/shell");

async function downloadYoutubeCore(url, options = {}) {
    const { startTime, endTime, outputDir: customOutputDir, quality = "highest" } = options;

    console.log(chalk.cyan("\nMemulai proses download..."));

    const now = new Date();
    const date = now.toISOString().slice(0, 10).replace(/-/g, "_");
    const time = now.toTimeString().slice(0, 8).replace(/:/g, "");
    const outputDir = customOutputDir || path.join("videos", date);
    await ensureDirectoryExists(outputDir);

    const outputTemplate = path.join(outputDir, `${date}_${time}_%(title).180B.%(ext)s`);

    try {
        const ytDlpCmd = await getToolCommand("yt-dlp");

        let format = "bestvideo[ext=mp4]+bestaudio[ext=m4a]/best[ext=mp4]/best";
        if (quality === "1080p") {
            format = "bestvideo[height<=1080][ext=mp4]+bestaudio[ext=m4a]/best[height<=1080][ext=mp4]/best";
        } else if (quality === "720p") {
            format = "bestvideo[height<=720][ext=mp4]+bestaudio[ext=m4a]/best[height<=720][ext=mp4]/best";
        } else if (quality === "audio") {
            format = "bestaudio/best";
        }

        let downloadCommand = `${ytDlpCmd} --no-playlist --js-runtimes node -o "${outputTemplate}" --print after_move:filepath "${url}" -f "${format}"`;
        if (quality === "audio") {
            downloadCommand += " --extract-audio --audio-format mp3";
        } else {
            downloadCommand += " --merge-output-format mp4";
        }

        const downloadResult = await runCommand(downloadCommand);
        const originalFile = downloadResult
            .split(/\r?\n/)
            .map((line) => line.trim())
            .filter(Boolean)
            .pop();

        if (!originalFile) {
            throw new Error("yt-dlp tidak mengembalikan path file hasil download.");
        }

        const parsedOriginal = path.parse(originalFile);
        const outputFile = path.join(parsedOriginal.dir, `${parsedOriginal.name}_potongan${parsedOriginal.ext || ".mp4"}`);

        console.log(chalk.green("Video berhasil diunduh."));

        if (startTime || endTime) {
            const mp4BoxCmd = await getToolCommand("mp4box");
            const cutCommand = `${mp4BoxCmd} -splitx ${startTime || 0}:${endTime || 999999} "${originalFile}" -out "${outputFile}"`;

            try {
                await runCommand(cutCommand);
                console.log(chalk.green(`Video berhasil dipotong (via MP4Box): ${outputFile}`));
            } catch (error) {
                console.log(chalk.yellow("MP4Box gagal, mencoba FFmpeg sebagai fallback..."));
                let ffmpegCommand = `ffmpeg -y -i "${originalFile}"`;
                if (startTime) ffmpegCommand += ` -ss ${startTime}`;
                if (endTime) ffmpegCommand += ` -to ${endTime}`;
                ffmpegCommand += ` -c copy "${outputFile}" -loglevel quiet`;
                await runCommand(ffmpegCommand);
                console.log(chalk.green(`Video berhasil dipotong (via FFmpeg): ${outputFile}`));
            }
        }

        return {
            success: true,
            originalFile,
            outputFile: (startTime || endTime) ? outputFile : originalFile
        };
    } catch (error) {
        console.error(chalk.red.bold("\nTerjadi kesalahan pada proses download atau potong."));
        throw error;
    }
}

async function downloadAndCut() {
    const inquirer = require("inquirer");
    const answers = await inquirer.prompt([
        { type: "input", name: "url", message: "Masukkan URL YouTube: " },
        {
            type: "input",
            name: "startTime",
            message: "Waktu Mulai Potong (HH:MM:SS atau detik desimal, kosongkan jika dari awal):"
        },
        {
            type: "input",
            name: "endTime",
            message: "Waktu Selesai Potong (HH:MM:SS atau detik desimal, kosongkan jika sampai akhir):"
        }
    ]);

    const { url, startTime, endTime } = answers;
    if (!url) {
        console.log(chalk.red("URL YouTube tidak boleh kosong."));
        return;
    }

    try {
        await downloadYoutubeCore(url, { startTime, endTime });
    } catch (error) {
    }
}

module.exports = { downloadAndCut, downloadYoutubeCore };
