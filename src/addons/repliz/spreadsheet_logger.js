const fs = require("fs/promises");
const path = require("path");
const axios = require("axios");

function escCsv(v) {
    const s = String(v == null ? "" : v);
    if (/[",\n]/.test(s)) return `"${s.replace(/"/g, '""')}"`;
    return s;
}

async function appendRowsToCsv(csvPath, rows) {
    const abs = path.resolve(csvPath);
    const dir = path.dirname(abs);
    await fs.mkdir(dir, { recursive: true });
    let exists = true;
    try { await fs.access(abs); } catch { exists = false; }
    const header = "timestamp,video,caption\n";
    const body = rows.map((r) => `${escCsv(r.timestamp)},${escCsv(r.video)},${escCsv(r.caption)}`).join("\n") + "\n";
    if (!exists) {
        await fs.writeFile(abs, header + body, "utf8");
    } else {
        await fs.appendFile(abs, body, "utf8");
    }
    return abs;
}

async function appendRowsToSpreadsheet(rows, opts = {}) {
    const webhookUrl = String(opts.webhookUrl || "").trim();
    if (webhookUrl) {
        await axios.post(webhookUrl, { rows }, { timeout: 20000 });
        return { mode: "webhook", target: webhookUrl };
    }
    const csvPath = opts.csvPath || path.join(process.cwd(), "spreadsheet_log.csv");
    const abs = await appendRowsToCsv(csvPath, rows);
    return { mode: "csv", target: abs };
}

module.exports = { appendRowsToSpreadsheet };
