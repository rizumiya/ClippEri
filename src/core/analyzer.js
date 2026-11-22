const { GoogleGenerativeAI } = require("@google/generative-ai");
const path = require("path");
const fs = require("fs/promises");
const chalk = require("chalk");
const config = require("../config");
const { getToolCommand, runCommand, ensureDirectoryExists } = require("../utils/shell");
const { getApiKeyList } = require("./ai_hook");

/**
 * Orchestrates video analysis: sends YouTube URL directly to Gemini.
 */
async function analyzeVideo(url, customApiKey) {
    const keys = getApiKeyList(customApiKey);
    if (keys.length === 0) throw new Error("API Key Gemini tidak ditemukan.");

    try {
        console.log(chalk.cyan(`\n🧠 Sending YouTube URL directly to Gemini for theme analysis...`));

        const genAI = new GoogleGenerativeAI(keys[0]);
        // Menggunakan gemini-2.5-flash atau model terbaru yang mendukung YouTube URL
        const model = genAI.getGenerativeModel({ model: "gemini-2.5-flash" });

        const prompt = `
            Analisis video ini dan identifikasi segmen-segmen kunci atau tema-temanya. 
            Keluar hasilnya sebagai objek JSON yang bersih yang bisa dipahami oleh pengguna non-teknis.
            Contoh format:
            {
              "title": "Judul Video",
              "duration": "Durasi Total",
              "segments": [
                { "start": "00:00", "end": "03:00", "theme": "Pengantar/Persiapan" },
                { "start": "03:01", "end": "05:00", "theme": "Langkah 1: Pembersihan" }
              ],
              "summary": "Ringkasan singkat isi video"
            }
            Pastikan JSON valid dan mudah dibaca.
        `;

        const result = await model.generateContent([
            {
                text: prompt
            },
            {
                fileData: {
                    fileUri: url,
                    mimeType: "video/mp4" // Gemini mengharapkan mimeType video untuk YouTube URL
                }
            }
        ]);

        const responseText = result.response.text();
        // Extract JSON from potential markdown markers
        const jsonMatch = responseText.match(/\{[\s\S]*\}/);
        if (!jsonMatch) throw new Error("Gagal mendapatkan format JSON dari AI. Response: " + responseText);

        const analysis = JSON.parse(jsonMatch[0]);
        console.log(chalk.green("✅ Analysis successful."));

        return analysis;
    } catch (err) {
        console.error(chalk.red("❌ Analysis failed: " + err.message));
        throw err;
    }
}

module.exports = { analyzeVideo };
