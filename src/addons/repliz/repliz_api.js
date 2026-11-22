const axios = require("axios");
const chalk = require("chalk");

const BASE_URL = "https://api.repliz.com/public";

/**
 * Upload video to Repliz via schedule API.
 * @param {string} accessKey
 * @param {string} secretKey
 * @param {object} data { title, description, videoUrl, accountId, scheduleAt }
 */
async function scheduleReplizVideo(accessKey, secretKey, data) {
    const safeAccessKey = String(accessKey || "").trim();
    const safeSecretKey = String(secretKey || "").trim();
    const { title, description, videoUrl, accountId, scheduleAt } = data;

    if (!safeAccessKey || !safeSecretKey) {
        throw new Error("Repliz access key / secret key belum diisi.");
    }

    const body = {
        title,
        description,
        type: "video",
        medias: [
            {
                type: "video",
                url: videoUrl,
                thumbnail: ""
            }
        ],
        scheduleAt: scheduleAt.toISOString(),
        accountId
    };

    try {
        const response = await axios.post(`${BASE_URL}/schedule`, body, {
            headers: {
                "Authorization": `Basic ${Buffer.from(`${safeAccessKey}:${safeSecretKey}`).toString("base64")}`,
                "Content-Type": "application/json"
            }
        });

        if (response.status === 200 || response.status === 201) {
            console.log(chalk.green(`✅ Berhasil menjadwalkan ke Repliz: ${title} pada ${body.scheduleAt}`));
            return response.data;
        }
    } catch (err) {
        const msg = err.response?.data?.message || err.message;
        console.error(chalk.red(`❌ Gagal upload ke Repliz: ${msg}`));
        throw new Error(msg);
    }
}

module.exports = { scheduleReplizVideo };
