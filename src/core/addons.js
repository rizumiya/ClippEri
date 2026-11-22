const fs = require("fs");
const path = require("path");
const express = require("express");
const chalk = require("chalk");
const { registerHook } = require("./hooks");
const { getSettings, saveSettings } = require("../utils/settings_manager");

const ADDONS_DIR = path.join(__dirname, "..", "addons");

function discoverAddons() {
    if (!fs.existsSync(ADDONS_DIR)) return [];
    const entries = fs.readdirSync(ADDONS_DIR, { withFileTypes: true });
    const addons = [];

    for (const entry of entries) {
        if (!entry.isDirectory()) continue;
        const dirPath = path.join(ADDONS_DIR, entry.name);
        const indexPath = path.join(dirPath, "index.js");
        if (!fs.existsSync(indexPath)) continue;

        try {
            const addon = require(indexPath);
            if (!addon || !addon.id || typeof addon.register !== "function") {
                console.warn(chalk.yellow(`⚠️ Addon tidak valid di ${entry.name}/index.js`));
                continue;
            }
            const publicDir = path.join(dirPath, "public");
            const hasPanel = fs.existsSync(path.join(publicDir, "panel.html"));
            addons.push({
                ...addon,
                dirPath,
                publicDir,
                hasPanel
            });
        } catch (err) {
            console.error(chalk.red(`❌ Gagal memuat modul addon ${entry.name}: ${err.message}`));
        }
    }

    return addons;
}

function getAddonConfig(addon) {
    const settings = getSettings();
    const saved = (settings.addons && settings.addons[addon.id]) || {};
    return {
        enabled: false,
        ...(addon.defaultSettings || {}),
        ...saved
    };
}

function loadAddons({ app, io }) {
    const discovered = discoverAddons();
    const loadedIds = new Set();

    for (const addon of discovered) {
        const cfg = getAddonConfig(addon);
        if (!cfg.enabled) continue;

        try {
            addon.register({
                app,
                io,
                registerHook,
                getSettings,
                saveSettings
            });

            if (fs.existsSync(addon.publicDir)) {
                app.use(`/addons/${addon.id}`, express.static(addon.publicDir));
            }

            loadedIds.add(addon.id);
            console.log(chalk.cyan(`🧩 Addon aktif: ${addon.name} (${addon.id})`));
        } catch (err) {
            console.error(chalk.red(`❌ Gagal inisialisasi addon ${addon.id}: ${err.message}`));
        }
    }

    app.get("/api/addons", (req, res) => {
        const list = discoverAddons().map((addon) => {
            const cfg = getAddonConfig(addon);
            return {
                id: addon.id,
                name: addon.name,
                description: addon.description || "",
                icon: addon.icon || "fa-puzzle-piece",
                enabled: Boolean(cfg.enabled),
                loaded: loadedIds.has(addon.id),
                hasPanel: addon.hasPanel
            };
        });
        res.json(list);
    });

    app.post("/api/addons/:id/toggle", (req, res) => {
        const { id } = req.params;
        const addon = discoverAddons().find((a) => a.id === id);
        if (!addon) {
            return res.status(404).json({ error: `Addon '${id}' tidak ditemukan.` });
        }

        const settings = getSettings();
        if (!settings.addons || typeof settings.addons !== "object") {
            settings.addons = {};
        }

        const current = getAddonConfig(addon);
        const nextEnabled = typeof req.body?.enabled === "boolean"
            ? req.body.enabled
            : !current.enabled;

        settings.addons[id] = {
            ...current,
            enabled: nextEnabled
        };

        if (!saveSettings(settings)) {
            return res.status(500).json({ error: "Gagal menyimpan status addon." });
        }

        console.log(chalk.green(`🧩 Addon '${id}' diubah ke ${nextEnabled ? "AKTIF" : "NONAKTIF"} (restart server untuk menerapkan).`));
        res.json({
            success: true,
            id,
            enabled: nextEnabled,
            restartRequired: true
        });
    });

    return {
        discovered,
        loadedIds
    };
}

module.exports = {
    discoverAddons,
    getAddonConfig,
    loadAddons
};
