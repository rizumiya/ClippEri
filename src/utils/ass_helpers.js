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

function normalizeSubtitleAiSettings(raw = {}) {
    const fontSize = Number(raw.fontSize);
    const lineSpacing = Number(raw.lineSpacing);
    const maxLines = Number(raw.maxLines);
    const maxWordsPerLine = Number(raw.maxWordsPerLine);
    const positionBottom = Number(raw.positionBottom);
    const rawHighlightMode = String(raw.highlightMode || "karaoke").toLowerCase();
    const highlightMode = ["karaoke", "active", "none"].includes(rawHighlightMode) ? rawHighlightMode : "karaoke";

    return {
        fontFamily: String(raw.fontFamily || "Poppins").trim() || "Poppins",
        fontSize: Math.max(24, Math.min(160, Number.isFinite(fontSize) ? fontSize : 80)),
        lineSpacing: Number.isFinite(lineSpacing) ? lineSpacing : 0,
        outlineColor: /^#[0-9a-fA-F]{6}$/.test(String(raw.outlineColor || "")) ? String(raw.outlineColor) : "#000000",
        primaryColor: /^#[0-9a-fA-F]{6}$/.test(String(raw.primaryColor || "")) ? String(raw.primaryColor) : "#ffffff",
        highlightColor: /^#[0-9a-fA-F]{6}$/.test(String(raw.highlightColor || "")) ? String(raw.highlightColor) : "#10b981",
        highlightMode,
        maxLines: Math.min(2, Math.max(1, Number.isFinite(maxLines) ? maxLines : 2)),
        maxWordsPerLine: Math.max(1, Math.min(8, Number.isFinite(maxWordsPerLine) ? maxWordsPerLine : 3)),
        positionBottom: Math.max(20, Math.min(600, Number.isFinite(positionBottom) ? positionBottom : 300)),
        uppercase: Boolean(raw.uppercase),
        bold: raw.bold !== undefined ? Boolean(raw.bold) : true
    };
}

module.exports = {
    formatAssTime,
    assTimeToSeconds,
    hexToAssColor,
    escapeAssFilterPath,
    normalizeSubtitleAiSettings
};
