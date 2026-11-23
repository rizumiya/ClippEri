const fs = require("fs");
const fsp = require("fs/promises");
const path = require("path");
const axios = require("axios");
const { ensureDirectoryExists } = require("./shell");

const VALID_IMAGE_MIMES = new Set(["image/jpeg", "image/jpg", "image/png"]);
const MIN_IMAGE_BYTES = 4096;
const MAX_IMAGE_BYTES = 15 * 1024 * 1024;

async function downloadValidImage(url, destBasePath) {
    if (!url || /\.(svg|gif|webp)(\?|$)/i.test(url)) return null;
    try {
        const res = await axios.get(url, {
            responseType: "arraybuffer",
            timeout: 12000,
            maxContentLength: MAX_IMAGE_BYTES,
            headers: { "User-Agent": "ClippEri/1.0 (https://github.com/rizumiya/ClippEri)" }
        });

        const contentType = String(res.headers["content-type"] || "").split(";")[0].trim().toLowerCase();
        if (contentType && !VALID_IMAGE_MIMES.has(contentType)) {
            return null;
        }

        const buf = Buffer.from(res.data);
        if (buf.length < MIN_IMAGE_BYTES) return null;

        const ext = contentType === "image/png" ? ".png" : ".jpg";
        const finalPath = `${destBasePath}${ext}`;
        await ensureDirectoryExists(path.dirname(finalPath));
        await fsp.writeFile(finalPath, buf);

        if (fs.statSync(finalPath).size < MIN_IMAGE_BYTES) {
            await fsp.unlink(finalPath).catch(() => {});
            return null;
        }
        return finalPath;
    } catch {
        return null;
    }
}

async function searchOpenverse(query, destBasePath) {
    try {
        const url = `https://api.openverse.org/v1/images/?q=${encodeURIComponent(query)}&page_size=6&license_type=commercial`;
        const res = await axios.get(url, {
            timeout: 10000,
            headers: { "User-Agent": "ClippEri/1.0" }
        });
        const items = Array.isArray(res.data?.results) ? res.data.results : [];
        for (const item of items) {
            const candidateUrl = item.url;
            if (!candidateUrl) continue;
            const downloaded = await downloadValidImage(candidateUrl, destBasePath);
            if (downloaded) return downloaded;
        }
    } catch { /* fallback below */ }
    return null;
}

async function searchWikimedia(query, destBasePath) {
    try {
        const url = `https://commons.wikimedia.org/w/api.php?action=query&generator=search&gsrnamespace=6&gsrsearch=${encodeURIComponent(query)}&prop=imageinfo&iiprop=url|mime|size&format=json&gsrlimit=6`;
        const res = await axios.get(url, {
            timeout: 10000,
            headers: { "User-Agent": "ClippEri/1.0" }
        });
        const pages = res.data?.query?.pages ? Object.values(res.data.query.pages) : [];
        for (const page of pages) {
            const info = Array.isArray(page.imageinfo) ? page.imageinfo[0] : null;
            if (!info || !VALID_IMAGE_MIMES.has(String(info.mime || "").toLowerCase())) continue;
            if (Number(info.size) < MIN_IMAGE_BYTES || Number(info.size) > MAX_IMAGE_BYTES) continue;
            const downloaded = await downloadValidImage(info.url, destBasePath);
            if (downloaded) return downloaded;
        }
    } catch { /* ignore */ }
    return null;
}

/**
 * Search and download a commercial-friendly stock image (Openverse -> Wikimedia Commons).
 * Returns local file path on success, or null if none succeeded (never throws).
 */
async function searchStockImage(query, destPathWithoutExt) {
    const q = String(query || "").trim() || "minimalist aesthetic lifestyle";
    const base = destPathWithoutExt.replace(/\.(jpg|jpeg|png|webp)$/i, "");

    const openverseHit = await searchOpenverse(q, base);
    if (openverseHit) return openverseHit;

    const wikiHit = await searchWikimedia(q, base);
    if (wikiHit) return wikiHit;

    return null;
}

module.exports = {
    searchStockImage
};
