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
        outlineColor: "#000000",
        primaryColor: "#ffffff",
        highlightColor: "#10b981",
        highlightMode: "karaoke",
        maxLines: 2,
        maxWordsPerLine: 3,
        positionBottom: 300,
        uppercase: false,
        bold: true
    },
    subtitle_engine: {
        binPath: "",
        defaultModel: "small-q5_1"
    },
    encoding: {
        videoEncoder: "auto"
    },
    gemini_api_key: "",
    source_folder: "sumber_video",
    backsound_folder: "backsound",
    trim_start: "",
    trim_end: "",
    max_clips: 5,
    clip_duration: "2.5",
    brands: [],
    ai_personas: [],
    addons: {},
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

function migrateSettings(rawData) {
    if (!isPlainObject(rawData)) return { migrated: rawData, changed: false };

    let changed = false;
    const next = { ...rawData };
    if (!isPlainObject(next.addons)) {
        next.addons = {};
    }

    // Migrate legacy Repliz / Storage / Spreadsheet keys into addons.repliz
    const hasLegacyRepliz =
        next.repliz_access_key !== undefined ||
        next.repliz_secret_key !== undefined ||
        next.repliz_account_id !== undefined ||
        next.upload_webhook_url !== undefined ||
        next.upload_public_base_url !== undefined ||
        next.spreadsheet_webhook_url !== undefined;

    if (!isPlainObject(next.addons.repliz) && hasLegacyRepliz) {
        let normalizedAccounts = [];
        if (Array.isArray(next.repliz_account_id)) {
            normalizedAccounts = next.repliz_account_id;
        } else if (next.repliz_account_id) {
            normalizedAccounts = [next.repliz_account_id];
        }

        next.addons.repliz = {
            enabled: false,
            access_key: next.repliz_access_key || "",
            secret_key: next.repliz_secret_key || "",
            account_id: normalizedAccounts,
            upload_webhook_url: next.upload_webhook_url || "",
            upload_public_base_url: next.upload_public_base_url || "",
            spreadsheet_webhook_url: next.spreadsheet_webhook_url || ""
        };
        changed = true;
    }

    // Migrate legacy TikTok TTS keys into addons['tts-narration']
    const hasLegacyTts =
        next.tiktok_session_id !== undefined ||
        next.tiktok_voice !== undefined;

    if (!isPlainObject(next.addons["tts-narration"]) && hasLegacyTts) {
        next.addons["tts-narration"] = {
            enabled: false,
            tiktok_session_id: next.tiktok_session_id || "",
            tiktok_voice: next.tiktok_voice || "id_001"
        };
        changed = true;
    }

    return { migrated: next, changed };
}

let migrationChecked = false;

function getSettings() {
    if (!fs.existsSync(SETTINGS_PATH)) {
        return JSON.parse(JSON.stringify(defaultSettings));
    }
    try {
        const data = fs.readFileSync(SETTINGS_PATH, "utf8");
        const parsed = JSON.parse(data);

        if (!migrationChecked) {
            migrationChecked = true;
            const { migrated, changed } = migrateSettings(parsed);
            if (changed) {
                saveSettings(migrated);
                return mergeDeep(defaultSettings, migrated);
            }
        }

        return mergeDeep(defaultSettings, parsed);
    } catch (err) {
        console.error("Gagal membaca settings.json:", err.message);
        return JSON.parse(JSON.stringify(defaultSettings));
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

module.exports = { getSettings, saveSettings, migrateSettings, defaultSettings };
