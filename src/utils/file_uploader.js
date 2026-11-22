const axios = require("axios");
const FormData = require("form-data");
const fs = require("fs");
const path = require("path");
const chalk = require("chalk");
const config = require("../config");

/**
 * Upload a file to the storage server using settings from config
 * @param {string} filePath Path to the local file
 * @returns {Promise<string>} The public URL of the uploaded file
 */
async function uploadToStorage(filePath) {
    const fileName = path.basename(filePath);

    // Ambil dari config (yang sudah di-refresh jika perlu)
    const { webhookUrl, publicBaseUrl } = config.storage;

    let attempts = 0;
    const maxAttempts = 3;

    while (attempts < maxAttempts) {
        try {
            attempts++;
            if (attempts > 1) console.log(chalk.yellow(`   > Mencoba unggah ulang (Percobaan ${attempts}/${maxAttempts})...`));
            else console.log(chalk.yellow(`   > Mengunggah ${fileName} ke storage...`));

            // Perlu buat stream baru setiap retry karena stream bisa jadi sudah consumed
            const form = new FormData();
            form.append("file", fs.createReadStream(filePath));

            const response = await axios.post(webhookUrl, form, {
                headers: {
                    ...form.getHeaders()
                },
                maxContentLength: Infinity,
                maxBodyLength: Infinity
            });

            if (response.status === 200 || response.status === 201) {
                const publicUrl = `${publicBaseUrl}/${fileName}`;
                console.log(chalk.green(`   > Berhasil diunggah: ${publicUrl}`));
                return publicUrl;
            } else {
                throw new Error(`Upload failed with status ${response.status}`);
            }
        } catch (err) {
            console.error(chalk.red(`   > Gagal unggah file ke storage (Percobaan ${attempts}): ${err.message}`));
            if (attempts >= maxAttempts) throw err;
            await new Promise(resolve => setTimeout(resolve, 3000)); // Tunggu 3 detik sebelum retry
        }
    }
}

module.exports = { uploadToStorage };
