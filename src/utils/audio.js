const fs = require("fs/promises");
const path = require("path");

/**
 * Mendapatkan daftar file audio dari folder tertentu.
 */
async function getAudioFiles(dir) {
    try {
        const files = await fs.readdir(dir);
        return files.filter(f => {
            const ext = path.extname(f).toLowerCase();
            return [".mp3", ".m4a", ".wav", ".aac"].includes(ext);
        }).map(f => path.join(dir, f));
    } catch (error) {
        return [];
    }
}

/**
 * Mengacak satu audio dari daftar.
 */
function getRandomAudio(audioFiles) {
    if (!audioFiles || audioFiles.length === 0) return null;
    const idx = Math.floor(Math.random() * audioFiles.length);
    return audioFiles[idx];
}

module.exports = {
    getAudioFiles,
    getRandomAudio
};
