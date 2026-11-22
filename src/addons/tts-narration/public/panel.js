export async function mount(container, { api, toast }) {
    const cfg = await api.get("/api/addons/tts-narration/settings");
    container.querySelector("#tts-session-id").value = cfg.tiktok_session_id || "";
    if (cfg.tiktok_voice) {
        container.querySelector("#tts-voice").value = cfg.tiktok_voice;
    }

    container.querySelector("#tts-run-form").addEventListener("submit", async (e) => {
        e.preventDefault();
        const fd = new FormData(e.target);
        const d = Object.fromEntries(fd.entries());
        await api.run("/api/addons/tts-narration/run", {
            sourceDir: d.sourceDir,
            finalDir: d.finalDir,
            context: d.context || "",
            srtWavDir: d.srtWavDir || "",
            voice: container.querySelector("#tts-voice").value
        });
    });

    container.querySelector("#tts-settings-form").addEventListener("submit", async (e) => {
        e.preventDefault();
        await api.post("/api/addons/tts-narration/settings", {
            tiktok_session_id: container.querySelector("#tts-session-id").value,
            tiktok_voice: container.querySelector("#tts-voice").value
        });
        toast("Konfigurasi TikTok TTS disimpan.");
    });
}
