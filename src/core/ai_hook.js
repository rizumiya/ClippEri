const { GoogleGenerativeAI } = require("@google/generative-ai");
const chalk = require("chalk");
const config = require("../config");
const { getSettings } = require("../utils/settings_manager");
const { getPersona, applyPersonaPlaceholders } = require("./personas");

// ─── MULTI-KEY HELPERS ───────────────────────────────────────────────────────

function getApiKeyList(apiKey) {
    if (apiKey) {
        if (Array.isArray(apiKey)) return apiKey.map(k => k.trim()).filter(Boolean);
        const split = String(apiKey).split("\n").map(k => k.trim()).filter(Boolean);
        if (split.length > 0) return split;
    }
    const settings = getSettings();
    if (settings.gemini_api_key) {
        const raw = settings.gemini_api_key;
        const freshKeys = Array.isArray(raw)
            ? raw.map(k => String(k).trim()).filter(Boolean)
            : String(raw).split("\n").map(k => k.trim()).filter(Boolean);
        if (freshKeys.length > 0) return freshKeys;
    }
    if (config.ai.apiKeys && config.ai.apiKeys.length > 0) return config.ai.apiKeys;
    if (config.ai.apiKey) return [config.ai.apiKey];
    return [];
}

async function callWithFallback(keys, promptFn) {
    if (!keys || keys.length === 0) throw new Error("Tidak ada Gemini API Key yang tersedia.");

    let lastError = null;
    for (let i = 0; i < keys.length; i++) {
        if (i > 0) {
            console.log(chalk.yellow(`   ⚠️ Key [${i}] limit/error → mencoba Key [${i + 1}/${keys.length}]...`));
        }
        try {
            return await promptFn(keys[i]);
        } catch (err) {
            const msg = (err.message || "").toLowerCase();
            const isQuota = msg.includes("resource_exhausted") || msg.includes("429") ||
                msg.includes("quota") || msg.includes("too many requests") || msg.includes("rate limit");
            lastError = err;
            if (isQuota && i < keys.length - 1) continue;
            throw err;
        }
    }
    throw lastError;
}

function buildModel(key) {
    return new GoogleGenerativeAI(key).getGenerativeModel({ model: config.ai.model });
}

function resolvePersonaArg(personaOrMode) {
    if (personaOrMode && typeof personaOrMode === "object") {
        return personaOrMode;
    }
    return getPersona(personaOrMode || "default");
}

function buildTopicSection(topics, count, label = "Hook") {
    if (!Array.isArray(topics) || topics.length === 0) return "";
    const selected = Array.from({ length: count }, () => topics[Math.floor(Math.random() * topics.length)]);
    const lines = selected.map((cat, i) => `${label} ${i + 1} HARUS menggunakan Kategori Konten: "${cat}"`).join("\n");
    return `\nKATEGORI KONTEN UNTUK MASING-MASING ${label.toUpperCase()} (BERURUTAN):\n${lines}\n`;
}

// ─── STORY 2-STEP GENERATION ─────────────────────────────────────────────────

async function extractStoryFacts(keys, storySourceContent, count = 1) {
    const sourceRef = storySourceContent ? storySourceContent.substring(0, 10000) : "";
    if (!sourceRef) return [];

    return callWithFallback(keys, async (key) => {
        const model = buildModel(key);
        const prompt = `Kamu adalah pencerita yang ahli mencari fakta menarik.

REFERENSI TEKS:
---
${sourceRef}
---

TUGAS:
Ekstrak ${count} buah potongan cerita/fakta yang BERBEDA dan UNIK dari teks di atas.
- Setiap potongan harus berupa satu cerita utuh atau satu konsep ilmu yang lengkap tapi sangat singkat (2-3 paragraf kecil).
- Bahasa santai, tidak formal.
- JANGAN sebut nama produk atau brand.
- Jika ada kisah "tim balap sepeda Inggris (1%)", JANGAN pilih itu lagi jika ada cerita lain yang tak kalah menarik. Cari variasi.

OUTPUT FORMAT:
Pisahkan setiap potongan cerita dengan penanda "[STORY_SEP]". Langsung ke isi cerita saja.`;

        const result = await model.generateContent(prompt);
        const text = result.response.text().trim();
        return text.split("[STORY_SEP]").map(s => s.trim()).filter(s => s !== "").slice(0, count);
    });
}

// ─── HOOK GENERATOR ──────────────────────────────────────────────────────────

async function generateHooks(apiKey, context, count, brandName = "", brandContentHooks = "", personaOrMode = null, storySummary = "") {
    const keys = getApiKeyList(apiKey);
    const persona = resolvePersonaArg(personaOrMode);
    const mode = persona.mode || "standard";

    return callWithFallback(keys, async (key) => {
        const model = buildModel(key);

        let brandInfo = "";
        let contextInstruction = "";

        if (mode === "edukasi_bisnis" || mode === "edukasibisnis") {
            contextInstruction = `Konteks Video: "${context || brandContentHooks || "Bisnis & Edukasi"}"`;
        } else {
            brandInfo = brandName ? `\nBrand/Objek: ${brandName}` : "";

            if (brandContentHooks && brandContentHooks.trim() !== "") {
                brandInfo += `\nFOKUS KONTEN BRAND: ${brandContentHooks}`;
                contextInstruction = `Konteks: Fokus sepenuhnya pada "FOKUS KONTEN BRAND" di atas.`;
            } else if (brandName) {
                contextInstruction = `Konteks: Buat hook untuk brand "${brandName}". AI bebas menentukan angle terbaik.`;
            } else {
                if (!context || context.trim() === "") {
                    throw new Error("Konteks Video WAJIB diisi jika tidak memilih Brand!");
                }
                contextInstruction = `Konteks Video: "${context}"`;
            }
        }

        const topicSection = buildTopicSection(persona.topics, count, "Hook");

        let storySection = "";
        if (mode === "story" || (Array.isArray(storySummary) && storySummary.length > 0) || (typeof storySummary === "string" && storySummary.trim() !== "")) {
            if (Array.isArray(storySummary) && storySummary.length > 0) {
                storySection = `\nDATA CERITA (Gunakan ini untuk membuat hook yang BERBEDA tiap videonya):\n${storySummary.map((s, i) => `Cerita ${i + 1}: "${s.substring(0, 100)}..."`).join("\n")}\n`;
            } else if (typeof storySummary === "string" && storySummary.trim() !== "") {
                storySection = `\nFakta/cerita yang akan dipakai caption: "${storySummary}"\n`;
            }
        }

        let hookRule = applyPersonaPlaceholders(persona.hookRule || "", { count, brand: brandName, context });
        if (!hookRule) {
            if (mode === "bisnis") {
                hookRule = `HOOK MODE: BISNIS (Teaser Peluang)
HOOK RULE:
- Panjang: 8–14 kata.
- Memancing rasa penasaran tentang penghasilan, kebebasan, atau peluang.
- JANGAN kata "daftar sekarang" atau "join". Cukup teaser.`;
            } else {
                hookRule = `HOOK MODE: STANDARD
HOOK RULE:
- Panjang: MID (8–14 kata) atau LONG (15–25 kata).
- Menggantung, tidak menjual, boleh pertanyaan atau refleksi personal.`;
            }
        }

        const systemPromptText = applyPersonaPlaceholders(persona.systemPrompt || "", { count, brand: brandName, context });

        const prompt = `${systemPromptText}

INPUT:
${brandInfo}
Target Audiens: Audiens Media Sosial Umum (TikTok/Reels)
${contextInstruction}

TUGAS UTAMA:
Buatlah ${count} buah kalimat hook (judul pembuka video).
${topicSection}${storySection}
${hookRule}

LARANGAN MUTLAK:
- DILARANG KERAS menggunakan emoji atau karakter khusus apapun (tidak ada 😱🔥💡❤️ dll).
- Hanya teks biasa (huruf, angka, tanda baca umum: . , ! ? ... - %, dll).
- WAJIB gunakan penalaran dan logika bahasa Indonesia yang natural (misal: 19.900 dipahami/dibaca sebagai "sembilan belas ribu", BUKAN "satu belas ribu").

OUTPUT FORMAT:
HANYA berikan daftar hook saja, pisahkan dengan baris baru. Jangan ada angka atau kata pembuka/penutup.`;

        const result = await model.generateContent(prompt);
        const text = result.response.text();
        return text.split("\n").filter(line => line.trim() !== "").slice(0, count);
    }).catch((error) => {
        console.error(chalk.red("❌ Gagal generate hook: " + error.message));
        if (error.message.includes("WAJIB")) return Array(count).fill("⚠️ Error: Konteks Video Wajib Diisi!");
        return Array(count).fill(config.ai.defaultHook);
    });
}

// ─── STORY STEP 2 ────────────────────────────────────────────────────────────

async function blendStoryWithBrand(keys, storyContent, brandName, brandCaptionRule, count, persona) {
    const stories = Array.isArray(storyContent) ? storyContent : [storyContent];
    const brandTag = brandName ? `#${brandName.replace(/\s+/g, "")}` : "#brand";

    let hashtagSection = "";
    if (brandCaptionRule && brandCaptionRule.trim() !== "") {
        hashtagSection = `\nHASHTAG & ATURAN TAMBAHAN:\n${brandCaptionRule}`;
    } else {
        hashtagSection = `\nHASHTAG RULE:
- 6–10 hashtag relate dengan TOPIK CERITA.
- Wajib ada: ${brandTag}
- Tambah hashtag spesifik topik (mis. #kebiasaan #mindset #selfimprovement).
- Mix antara hashtag populer dan spesifik.`;
    }

    const defaultStoryRule = `FORMAT WAJIB tiap caption (jangan tampilkan label/subtitle):
1. HOOK — 1 baris kalimat gantung yang bikin orang lanjut baca.
2. CERITA — Gunakan konten cerita di atas. Pastikan ada fakta spesifik dan penyebutan SUMBER/TOKOH yang relevan (misal: James Clear).
3. SOFT SELLING — 1 paragraf, selipkan brand "{brand}" secara natural, bukan iklan. Max 3 baris.
4. PERTANYAAN PEMANTIK — 1 kalimat pertanyaan yang relate dengan CERITA (bukan produk). Buat orang mau komentar.

GAYA: Santai, mengalir, orang malas baca pun bisa ikuti. Max 3 baris per paragraf.`;

    const captionRule = applyPersonaPlaceholders(persona?.captionRule || defaultStoryRule, {
        count,
        brand: brandName || "Brand",
        context: ""
    });
    const systemPromptText = applyPersonaPlaceholders(persona?.systemPrompt || "", {
        count,
        brand: brandName || "Brand",
        context: ""
    });

    return callWithFallback(keys, async (key) => {
        const model = buildModel(key);

        let storyInput = "";
        if (stories.length > 1) {
            storyInput = `KONTEN CERITA (Ada ${stories.length} buah, buatlah 1 caption UNTUK SETIAP CERITA secara berurutan):\n` +
                stories.map((s, i) => `--- CERITA ${i + 1} ---\n${s}\n---`).join("\n\n");
        } else {
            storyInput = `KONTEN CERITA/ILMU:\n---\n${stories[0]}\n---`;
        }

        const prompt = `${systemPromptText}

Brand: ${brandName || "Brand"}

${storyInput}

TUGAS: Buat ${count} buah caption lengkap.
PENTING: Jika ada beberapa CERITA di atas, buatlah caption yang BERURUTAN sesuai cerita tersebut. 1 Caption = 1 Cerita.

${captionRule}
${hashtagSection}

OUTPUT FORMAT:
Pisahkan setiap caption dengan "[SEP]". Jangan pakai penomoran.`;

        const result = await model.generateContent(prompt);
        const text = result.response.text();
        return text.split("[SEP]").map(s => s.trim()).filter(s => s !== "").slice(0, count);
    });
}

// ─── CAPTION GENERATOR ───────────────────────────────────────────────────────

async function generateCaptions(apiKey, context, count, brandName = "", brandLocation = "solo", targetAudience = "General", brandContentHooks = "", brandCaptionRule = "", personaOrMode = null, storySourceContent = "", hooksArray = []) {
    const keys = getApiKeyList(apiKey);
    const persona = resolvePersonaArg(personaOrMode);
    const mode = persona.mode || "standard";

    // Story mode 2-step generation
    if (mode === "story") {
        try {
            let stories = [];
            if (Array.isArray(storySourceContent)) {
                stories = storySourceContent;
            } else {
                console.log(chalk.cyan("   📖 Story Step 1: Mengekstrak konten cerita dari file..."));
                stories = await extractStoryFacts(keys, storySourceContent, count);
            }

            if (stories.length === 0) {
                console.log(chalk.yellow("   ⚠️ Story content kosong, fallback ke standard mode."));
            } else {
                console.log(chalk.cyan("   ✍️  Story Step 2: Memadukan cerita dengan brand..."));
                return await blendStoryWithBrand(keys, stories, brandName, brandCaptionRule, count, persona);
            }
        } catch (err) {
            console.error(chalk.red("❌ Story 2-step gagal: " + err.message));
            return Array(count).fill("Story caption gagal digenerate. Coba lagi.");
        }
    }

    return callWithFallback(keys, async (key) => {
        const model = buildModel(key);

        let brandInfo = "";
        let contextInstruction = "";

        if (mode === "edukasi_bisnis" || mode === "edukasibisnis") {
            contextInstruction = `Konteks Video: "${context || "Bisnis & Edukasi"}"`;
            if (brandContentHooks && brandContentHooks.trim() !== "") {
                contextInstruction += `\nFokus Topik Tambahan: "${brandContentHooks}"`;
            }
        } else {
            brandInfo = brandName ? `\nBrand/Objek: ${brandName}${brandLocation ? `\nLokasi: ${brandLocation}` : ""}` : "";

            if (brandContentHooks && brandContentHooks.trim() !== "") {
                brandInfo += `\nFOKUS KONTEN BRAND: ${brandContentHooks}`;
                contextInstruction = `Konteks: Fokus sepenuhnya pada "FOKUS KONTEN BRAND" di atas.\nKonteks Tambahan: "${context}"`;
            } else if (brandName) {
                contextInstruction = `Konteks: Buat caption untuk brand "${brandName}". AI bebas menentukan angle terbaik sesuai mode.`;
            } else {
                if (!context || context.trim() === "") {
                    return Array(count).fill("⚠️ Caption Error: Konteks Wajib Diisi!");
                }
                contextInstruction = `Konteks Video: "${context}"`;
            }
        }

        const brandTag = brandName ? `#${brandName.replace(/\s+/g, "")}` : "#brand";
        const locationTag = brandLocation ? `#${brandLocation.replace(/\s+/g, "").toLowerCase()}` : "";

        let hookSyncInstruction = "";
        if (hooksArray && hooksArray.length > 0 && (mode === "edukasi_bisnis" || mode === "edukasibisnis")) {
            hookSyncInstruction = `\n[MANDATORI] DATA PENGKAITAN CERITA:\nKamu diberikan daftar Hook berikut. SETIAP CAPTION harus dikembangkan SECARA BERURUTAN berdasarkan Hook ini:\n${hooksArray.map((h, i) => `Caption ${i + 1} HARUS membahas/melanjutkan cerita dari Hook: "${h}"`).join("\n")}\n\nPENTING: Isi caption harus merupakan ekstensi langsung, detail fakta, atau punchline yang sangat relevan dengan Hook pasangannya tersebut.\nLARANGAN CAPTION: JANGAN MENGULANG kalimat Hook secara sama persis di dalam isi tulisan caption. Langsung saja masuk ke kelanjutan atau penjelasan cerita dari hook tersebut tanpa mengulangnya.`;
        }

        let modeSection = applyPersonaPlaceholders(persona.captionRule || "", {
            count,
            brand: brandName,
            context
        });

        if (!modeSection) {
            if (mode === "bisnis") {
                modeSection = `CAPTION MODE: BISNIS (Kemitraan)
- JANGAN menyebut "beli", "order" — fokus ajakan bergabung/kemitraan.
- Pola: Hook peluang → Cerita/fakta → Soft CTA kemitraan → Pertanyaan pemantik.
- Panjang: MID (90–100 kata).
- FORMAT: Bagi tulisan ke dalam 3-4 paragraf. Setiap paragraf MAKSIMAL 2-3 kalimat saja.`;
            } else {
                modeSection = `CAPTION MODE: STANDARD
MODE KONTEN (acak per caption): Mirror Story / Relatable POV / Confessional / Story Logic / Post-Irony
POLA: Opening → Cerita → Insight. Panjang: MID (90–130) atau LONG (100–200 kata).
FORMAT: Bagi tulisan ke dalam 3-4 paragraf. Setiap paragraf MAKSIMAL 2-3 kalimat saja.`;
            }
        }

        if (hookSyncInstruction) {
            modeSection += `\n${hookSyncInstruction}`;
        }

        let hashtagSection = "";
        if (brandCaptionRule && brandCaptionRule.trim() !== "") {
            hashtagSection = `\nHASHTAG & CAPTION RULE:\n${brandCaptionRule}`;
        } else if (mode === "bisnis") {
            hashtagSection = `\nHASHTAG RULE:\n- 6–10 hashtag.\n- Wajib ada: ${brandTag} ${locationTag}\n- Topik: #kemitraan #peluangusaha #bisnisrumahan #usahasampingan #entrepreneur`;
        } else if (mode === "edukasi_bisnis" || mode === "edukasibisnis") {
            hashtagSection = `\nHASHTAG RULE:\n- 6–10 hashtag.\n- Wajib ada: ${brandTag} ${locationTag}\n- Topik umum: #bisnisowner #edukasibisnis #ceritapengusaha #tipsbisnis #bisniskuliner`;
        } else {
            hashtagSection = `\nHASHTAG RULE:\n- 5–8 hashtag. Wajib ada: ${brandTag} ${locationTag}`;
        }

        const systemPromptText = applyPersonaPlaceholders(persona.systemPrompt || "", {
            count,
            brand: brandName,
            context
        });

        const prompt = `${systemPromptText}

INPUT:
${brandInfo}
Target Audiens: ${targetAudience}
${contextInstruction}

TUGAS: Buatlah ${count} buah caption.

${modeSection}
${hashtagSection}

OUTPUT FORMAT:
Pisahkan setiap caption dengan "[SEP]". Jangan pakai penomoran.`;

        const result = await model.generateContent(prompt);
        const text = result.response.text();
        return text.split("[SEP]").map(s => s.trim()).filter(s => s !== "").slice(0, count);
    }).catch((error) => {
        console.error(chalk.red("❌ Gagal generate caption: " + error.message));
        return Array(count).fill("Nemu video seru nih... #random #video");
    });
}

module.exports = { generateHooks, generateCaptions, getApiKeyList, extractStoryFacts, callWithFallback, buildModel };
