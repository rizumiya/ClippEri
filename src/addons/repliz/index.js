const chalk = require("chalk");
const { processStandaloneUpload, runReplizAfterMerge } = require("./repliz_runner");

module.exports = {
    id: "repliz",
    name: "Repliz Auto Upload & Sheet",
    description: "Jadwalkan upload video otomatis ke Repliz, unggah ke storage webhook, dan log ke spreadsheet.",
    icon: "fa-cloud-upload-alt",
    defaultSettings: {
        enabled: false,
        access_key: "",
        secret_key: "",
        account_id: [],
        upload_webhook_url: "",
        upload_public_base_url: "",
        spreadsheet_webhook_url: ""
    },

    register({ app, io, registerHook, getSettings, saveSettings }) {
        registerHook("afterMerge", runReplizAfterMerge);

        const readAddon = () => {
            const settings = getSettings();
            return {
                ...this.defaultSettings,
                ...(settings.addons?.repliz || {})
            };
        };

        const writeAddon = (patch) => {
            const settings = getSettings();
            if (!settings.addons || typeof settings.addons !== "object") {
                settings.addons = {};
            }
            const next = {
                ...readAddon(),
                ...patch
            };
            settings.addons.repliz = next;
            if (!saveSettings(settings)) {
                throw new Error("Gagal menyimpan pengaturan addon Repliz.");
            }
            return next;
        };

        app.get("/api/addons/repliz/settings", (req, res) => {
            res.json(readAddon());
        });

        app.post("/api/addons/repliz/settings", (req, res) => {
            try {
                const body = req.body || {};
                const patch = {};
                if (body.access_key !== undefined) patch.access_key = String(body.access_key).trim();
                if (body.secret_key !== undefined) patch.secret_key = String(body.secret_key).trim();
                if (body.upload_webhook_url !== undefined) patch.upload_webhook_url = String(body.upload_webhook_url).trim();
                if (body.upload_public_base_url !== undefined) patch.upload_public_base_url = String(body.upload_public_base_url).trim();
                if (body.spreadsheet_webhook_url !== undefined) patch.spreadsheet_webhook_url = String(body.spreadsheet_webhook_url).trim();
                if (Array.isArray(body.account_id)) patch.account_id = body.account_id;

                const updated = writeAddon(patch);
                console.log(chalk.green("✅ Pengaturan Addon Repliz tersimpan."));
                res.json({ success: true, settings: updated });
            } catch (err) {
                res.status(500).json({ error: err.message });
            }
        });

        app.get("/api/addons/repliz/accounts", (req, res) => {
            const cfg = readAddon();
            const raw = Array.isArray(cfg.account_id) ? cfg.account_id : (cfg.account_id ? [cfg.account_id] : []);
            const normalized = raw.map((item) => {
                if (item && typeof item === "object") {
                    return { name: String(item.name || item.id || ""), id: String(item.id || "") };
                }
                return { name: String(item), id: String(item) };
            }).filter((a) => a.id);
            res.json(normalized);
        });

        app.post("/api/addons/repliz/accounts", (req, res) => {
            try {
                const accounts = req.body;
                if (!Array.isArray(accounts)) {
                    return res.status(400).json({ error: "Format akun harus berupa array." });
                }
                const cleaned = accounts
                    .map((a) => ({
                        name: String(a?.name || a?.id || "").trim(),
                        id: String(a?.id || "").trim()
                    }))
                    .filter((a) => a.id);

                writeAddon({ account_id: cleaned });
                res.json({ success: true, count: cleaned.length });
            } catch (err) {
                res.status(500).json({ error: err.message });
            }
        });

        const handleUpload = (req, res) => {
            try {
                const { uploadDir, scheduleSettings } = req.body || {};
                if (!uploadDir) {
                    return res.status(400).json({ error: "uploadDir wajib diisi." });
                }
                console.log(chalk.magenta("\n--- [Addon Repliz] Starting Standalone Upload ---"));

                (async () => {
                    try {
                        await processStandaloneUpload(uploadDir, scheduleSettings || {});
                        console.log(chalk.green.bold("\n✨ Standalone Upload Finished!"));
                        io.emit("process-complete", { success: true });
                    } catch (err) {
                        console.error(`❌ [Addon Repliz] Error: ${err.message}`);
                        io.emit("process-complete", { success: false, error: err.message });
                    }
                })();

                res.json({ message: "Upload process started" });
            } catch (err) {
                res.status(500).json({ error: err.message });
            }
        };

        app.post("/api/addons/repliz/upload", handleUpload);
        app.post("/api/run/upload-repliz", handleUpload);
    }
};
