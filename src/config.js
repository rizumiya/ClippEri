const path = require("path");
const { getSettings } = require("./utils/settings_manager");

const settings = getSettings();

const config = {
    // --- AI Hook Style ---
    styles: {
        tealColor: "0x72D2C3",
        fontPath: "C\\:/Windows/Fonts/arialbd.ttf", // Use FFmpeg path escaping
        fixedBoxBorder: 16, // Increased to prevent descenders (g, p, y) from being clipped
        fixedLineSpacing: 5,
        quoteSizeExpr: "h/15",
        textSizeExpr: "h/40", // makin besar angkanya makin kecil font nya
        yOffsetQuoteExpr: "h/22", // Closer to the text box

        wrapLimit: 26, // Disesuaikan karena font lebih kecil
    },

    // --- Video Encoding Settings ---
    video: {
        targetResolution: 1024, // High side (width or height depending on rotation)
        vBitrate: "1200k",
        preset: "fast",
        crf: 26,
        frameRate: 30,
        pixFmt: "yuv420p",
        // Standarisasi untuk mencegah glitch saat merge
        standardization: {
            width: 1080,
            height: 1920,
            fps: 30
        }
    },

    // --- Audio Encoding Settings ---
    audio: {
        codec: "aac",
        aBitrate: "32k",
        channels: 1,
        sampleRate: 22050,
    },

    // --- Paths ---
    paths: {
        binDir: path.join(__dirname, "..", "tools"),
        tempDir: "temp", // Generic temp folder if needed
        audioDir: settings.backsound_folder || "backsound", // Default folder for background music
        sourceDir: settings.source_folder || "sumber_video",
    },

    // --- AI Settings ---
    ai: (() => {
        const raw = settings.gemini_api_key || process.env.GEMINI_API_KEY || "";
        // Support: JSON array, newline-separated string, or plain string
        let keys = [];
        if (Array.isArray(raw)) {
            keys = raw.map(k => k.trim()).filter(Boolean);
        } else {
            keys = String(raw).split('\n').map(k => k.trim()).filter(Boolean);
        }
        return {
            model: "gemini-2.5-flash",
            apiKey: keys[0] || "",   // backward compat — first key
            apiKeys: keys,            // full list for multi-key fallback
            defaultHook: "Wait for it...",
        };
    })(),
    brands: settings.brands || [],

    // --- Repliz Settings ---
    repliz: {
        accessKey: settings.repliz_access_key || "",
        secretKey: settings.repliz_secret_key || "",
        accountId: (() => {
            const raw = settings.repliz_account_id;
            const arr = Array.isArray(raw) ? raw : (raw ? [raw] : []);
            return arr.map(e => (e && typeof e === 'object' ? e.id : e)).filter(Boolean);
        })(),
    },

    // --- Storage Settings ---
    storage: {
        webhookUrl: settings.upload_webhook_url || "",
        publicBaseUrl: settings.upload_public_base_url || "",
        spreadsheetWebhookUrl: settings.spreadsheet_webhook_url || "",
    },

    // --- Batch Processing Defaults ---
    batch: {
        trimStart: settings.trim_start || "",
        trimEnd: settings.trim_end || "",
        maxClips: settings.max_clips || 5,
        clipDuration: settings.clip_duration || "2.5",
    }
};

module.exports = config;

