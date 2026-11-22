const axios = require("axios");
const FormData = require("form-data");
const fs = require("fs");
const path = require("path");
const chalk = require("chalk");
const { getSettings } = require("../../utils/settings_manager");

/**
 * Upload a file to the configured storage webhook.
 * @param {string} filePath Path to the local file
 * @param {object} opts Optional { webhookUrl, publicBaseUrl }
 * @returns {Promise<string>} Public URL of uploaded file
 */
async function uploadToStorage(filePath, opts = {}) {
    const fileName = path.basename(filePath);
    const settings = getSettings();
    const addonCfg = settings.addons?.repliz || {};

    const webhookUrl = String(opts.webhookUrl || addonCfg.upload_webhook_url || "").trim();
    const publicBaseUrl = String(opts.publicBaseUrl || addonCfg.upload_public_base_url || "").trim().replace(/\/+$/, "");

    if (!webhookUrl || !publicBaseUrl) {
        throw new Error("Upload Webhook URL / Public Base URL belum dikonfigurasi di addon Repliz.");
    }

    let attempts = 0;
    const maxAttempts = 3;

    while (attempts < maxAttempts) {
        try {
            attempts++;
            if (attempts > 1) {
                console.log(chalk.yellow(`   > Mencoba unggah ulang (Percobaan ${attempts}/${maxAttempts})...`));
            } else {
                console.log(chalk.yellow(`   > Mengunggah ${fileName} ke storage...`));
            }

            const form = new FormData();
            form.append("file", fs.createReadStream(filePath));

            const response = await axios.post(webhookUrl, form, {
                headers: { ...form.getHeaders() },
                maxContentLength: Infinity,
                maxBodyLength: Infinity
            });

            if (response.status === 200 || response.status === 201) {
                const publicUrl = `${publicBaseUrl}/${fileName}`;
                console.log(chalk.green(`   > Berhasil diunggah: ${publicUrl}`));
                return publicUrl;
            }
            throw new Error(`Upload failed with status ${response.status}`);
        } catch (err) {
            console.error(chalk.red(`   > Gagal unggah file ke storage (Percobaan ${attempts}): ${err.message}`));
            if (attempts >= maxAttempts) throw err;
            await new Promise((resolve) => setTimeout(resolve, 3000));
        }
    }
}

module.exports = { uploadToStorage };
