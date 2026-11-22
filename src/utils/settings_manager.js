const fs = require("fs");
const path = require("path");

const SETTINGS_PATH = path.join(process.cwd(), "settings.json");

const defaultSettings = {
    browser_ui: {
        fontFamily: "Inter, -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif",
        fontSize: 16,
        monoFontSize: 13,
        lineHeight: 1.6,
        containerMaxWidth: 1200
    },
    subtitle_ai: {
        fontFamily: "Poppins",
        fontSize: 80,
        lineSpacing: 0,
        outlineColor: "#ff0000",
        maxLines: 2,
        maxWordsPerLine: 3,
        positionBottom: 300
    },
    gemini_api_key: "",
    source_folder: "sumber_video",
    backsound_folder: "backsound",
    trim_start: "",
    trim_end: "",
    max_clips: 5,
    clip_duration: "2.5",
    repliz_access_key: "",
    repliz_secret_key: "",
    repliz_account_id: [
        { name: "Ai Chick Instagram", id: "6958940f3251303b1d87e33a" },
        { name: "Ai Chick TikTok", id: "699e6594fd04380368c0444d" },
        { name: "Instagram Aniprimadani", id: "69a25c607e118ff8ca94617c" },
        { name: "fourside.tiramisu", id: "69992108fd043803689aecc3" },
        { name: "Fourside Pusat", id: "69620a26a35a8aab2ab21506" },
        { name: "Instagram Fourside.Tiramisu", id: "699fb545fd04380368c7e9f8" },
        { name: "Ani Primadani", id: "6992934cfd04380368718a95" }
    ],
    upload_webhook_url: "https://automasi.xiexieicecream.com/webhook/photobooth/save-file",
    upload_public_base_url: "https://files.xiexieicecream.com/auto-upload",
    spreadsheet_webhook_url: "https://script.google.com/macros/s/AKfycbwDRuoRv8YJeQj4ZHhEFn3mkAYP0RxwAE2PfII5BX8wZzoVRjl3Jy37oAUswVnOFv8tsQ/exec",
    brands: [],
    aio_defaults: {
        multicut: {
            maxClips: 5,
            clipDuration: 2,
            trimStart: "",
            trimEnd: ""
        },
        merge: {
            finalCount: 3,
            maxPerSource: 2,
            maxSources: 0,
            finalDurationSec: 17,
            mode: "random"
        }
    }
};

function isPlainObject(value) {
    return value !== null && typeof value === "object" && !Array.isArray(value);
}

function mergeDeep(base, override) {
    if (!isPlainObject(base) || !isPlainObject(override)) {
        return override;
    }

    const merged = { ...base };
    for (const [key, value] of Object.entries(override)) {
        merged[key] = isPlainObject(value) && isPlainObject(base[key])
            ? mergeDeep(base[key], value)
            : value;
    }
    return merged;
}

function getSettings() {
    if (!fs.existsSync(SETTINGS_PATH)) {
        return defaultSettings;
    }
    try {
        const data = fs.readFileSync(SETTINGS_PATH, "utf8");
        return mergeDeep(defaultSettings, JSON.parse(data));
    } catch (err) {
        console.error("Gagal membaca settings.json:", err.message);
        return defaultSettings;
    }
}

function saveSettings(settings) {
    try {
        fs.writeFileSync(SETTINGS_PATH, JSON.stringify(settings, null, 2), "utf8");
        return true;
    } catch (err) {
        console.error("Gagal menyimpan settings.json:", err.message);
        return false;
    }
}

module.exports = { getSettings, saveSettings };
