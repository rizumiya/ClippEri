function formatAssTime(seconds) {
    const safeSeconds = Math.max(0, Number(seconds) || 0);
    const h = Math.floor(safeSeconds / 3600);
    const m = Math.floor((safeSeconds % 3600) / 60);
    const s = Math.floor(safeSeconds % 60);
    const cs = Math.min(99, Math.round((safeSeconds % 1) * 100));
    return `${h}:${m.toString().padStart(2, "0")}:${s.toString().padStart(2, "0")}.${cs.toString().padStart(2, "0")}`;
}

function assTimeToSeconds(time) {
    const match = String(time).trim().match(/^(\d+):(\d{2}):(\d{2})\.(\d{2})$/);
    if (!match) return 0;
    const [, h, m, s, cs] = match;
    return Number(h) * 3600 + Number(m) * 60 + Number(s) + Number(cs) / 100;
}

function hexToAssColor(hex, fallback = "&H00FFFFFF") {
    const normalized = String(hex || "").replace("#", "").trim();
    if (!/^[0-9a-fA-F]{6}$/.test(normalized)) {
        return fallback;
    }
    const r = normalized.slice(0, 2).toUpperCase();
    const g = normalized.slice(2, 4).toUpperCase();
    const b = normalized.slice(4, 6).toUpperCase();
    return `&H00${b}${g}${r}`;
}

function escapeAssFilterPath(filePath) {
    return String(filePath || "").replace(/\\/g, "/").replace(/:/g, "\\:");
}

const SUBTITLE_PRESETS = {
    editorial_left: {
        fontFamily: "Georgia",
        fontSize: 38,
        bold: false,
        italic: true,
        uppercase: false,
        alignment: "left",
        marginX: 64,
        positionBottom: 200,
        outlineWidth: 0,
        outlineColor: "#000000",
        shadowDepth: 2,
        primaryColor: "#8e94a0",
        highlightColor: "#ffffff",
        highlightMode: "karaoke",
        activePop: false,
        bottomGradient: true,
        maxWordsPerLine: 6,
        maxLines: 2,
        footerText: ""
    },
    editorial_gold: {
        fontFamily: "Segoe UI",
        fontSize: 40,
        bold: false,
        italic: false,
        uppercase: false,
        alignment: "left",
        marginX: 64,
        positionBottom: 200,
        outlineWidth: 0,
        outlineColor: "#000000",
        shadowDepth: 2,
        primaryColor: "#9ca3af",
        highlightColor: "#f3cf7a",
        highlightMode: "active_underline",
        activePop: false,
        bottomGradient: true,
        maxWordsPerLine: 6,
        maxLines: 2,
        footerText: ""
    },
    bold_center: {
        fontFamily: "Poppins",
        fontSize: 76,
        bold: true,
        italic: false,
        uppercase: false,
        alignment: "center",
        marginX: 32,
        positionBottom: 300,
        outlineWidth: 3,
        outlineColor: "#000000",
        shadowDepth: 1,
        primaryColor: "#ffffff",
        highlightColor: "#a59fd8",
        highlightMode: "karaoke",
        activePop: true,
        bottomGradient: false,
        maxWordsPerLine: 3,
        maxLines: 2,
        footerText: ""
    }
};

function normalizeSubtitleAiSettings(raw = {}) {
    const fontSize = Number(raw.fontSize);
    const lineSpacing = Number(raw.lineSpacing);
    const outlineWidth = Number(raw.outlineWidth);
    const shadowDepth = Number(raw.shadowDepth);
    const marginX = Number(raw.marginX);
    const maxLines = Number(raw.maxLines);
    const maxWordsPerLine = Number(raw.maxWordsPerLine);
    const positionBottom = Number(raw.positionBottom);
    const rawHighlightMode = String(raw.highlightMode || "karaoke").toLowerCase();
    const highlightMode = ["karaoke", "active", "active_underline", "none"].includes(rawHighlightMode)
        ? rawHighlightMode
        : "karaoke";
    const rawAlignment = String(raw.alignment || "center").toLowerCase();
    const alignment = ["left", "center", "right"].includes(rawAlignment) ? rawAlignment : "center";

    return {
        fontFamily: String(raw.fontFamily || "Poppins").trim() || "Poppins",
        fontSize: Math.max(18, Math.min(160, Number.isFinite(fontSize) ? fontSize : 80)),
        lineSpacing: Number.isFinite(lineSpacing) ? lineSpacing : 0,
        outlineWidth: Math.max(0, Math.min(10, Number.isFinite(outlineWidth) ? outlineWidth : 3)),
        outlineColor: /^#[0-9a-fA-F]{6}$/.test(String(raw.outlineColor || "")) ? String(raw.outlineColor) : "#000000",
        shadowDepth: Math.max(0, Math.min(10, Number.isFinite(shadowDepth) ? shadowDepth : 1)),
        primaryColor: /^#[0-9a-fA-F]{6}$/.test(String(raw.primaryColor || "")) ? String(raw.primaryColor) : "#ffffff",
        highlightColor: /^#[0-9a-fA-F]{6}$/.test(String(raw.highlightColor || "")) ? String(raw.highlightColor) : "#10b981",
        highlightMode,
        alignment,
        marginX: Math.max(16, Math.min(240, Number.isFinite(marginX) ? marginX : 24)),
        maxLines: Math.min(3, Math.max(1, Number.isFinite(maxLines) ? maxLines : 2)),
        maxWordsPerLine: Math.max(1, Math.min(10, Number.isFinite(maxWordsPerLine) ? maxWordsPerLine : 3)),
        positionBottom: Math.max(20, Math.min(600, Number.isFinite(positionBottom) ? positionBottom : 300)),
        uppercase: Boolean(raw.uppercase),
        bold: raw.bold !== undefined ? Boolean(raw.bold) : true,
        italic: Boolean(raw.italic),
        activePop: raw.activePop !== undefined ? Boolean(raw.activePop) : true,
        bottomGradient: Boolean(raw.bottomGradient),
        footerText: String(raw.footerText || "").replace(/[\r\n]+/g, " ").trim().slice(0, 120)
    };
}

module.exports = {
    SUBTITLE_PRESETS,
    formatAssTime,
    assTimeToSeconds,
    hexToAssColor,
    escapeAssFilterPath,
    normalizeSubtitleAiSettings
};
