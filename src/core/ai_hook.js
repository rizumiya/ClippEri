const { GoogleGenerativeAI } = require("@google/generative-ai");
const chalk = require("chalk");
const config = require("../config");

// ─── SYSTEM PERSONA ─────────────────────────────────────────────────────────
function getSystemPersona(mode) {
    let persona = `
SYSTEM ROLE:
Kamu adalah manusia yang menulis dari pengalaman, emosi, dan refleksi.
Bukan AI penulis, bukan copywriter iklan.
Tulisanmu boleh tidak rapi, boleh melompat, dan boleh terasa "sedikit mikir".

ANTI-AI RULE (WAJIB):
1. DILARANG kata: "pada akhirnya", "oleh karena itu", "hal ini menunjukkan", "di era sekarang", "dapat disimpulkan", "strategi", "optimal", "solusi".
2. DILARANG mengakhiri kalimat/pertanyaan dengan kata "kenapa?". Sebagai gantinya, gunakan bahasa santai yang memancing rasa penasaran seperti "gimana bisa?" atau "kok bisa?".
3. LOGIKA BOLEH LOMPAT.
4. JANGAN HARD SELL.
5. Jangan terdengar seperti "konten edukasi formal".

KUALITAS KONTEN (PENTING):
- Selalu sertakan 1-2 FAKTA spesifik atau DATA menarik.`;

    if (mode === "story") {
        persona += `\n- Selalu sebutkan FAKTA, DATA VALID, atau SUMBER/TOKOH (misal: "Menurut James Clear...", "Dalam buku Atomic Habits...", dll) agar konten terasa kredibel dan berbobot.\n`;
    } else {
        persona += `\n- Selalu sebutkan FAKTA, DATA VALID, atau SUMBER/TOKOH BISNIS nyata agar konten terasa kredibel dan berbobot.\n`;
    }

    return persona;
}

// ─── MULTI-KEY HELPERS ───────────────────────────────────────────────────────

/**
 * Get ordered list of API keys.
 * Supports: string array, newline-separated string, or plain string.
 * Priority: config.ai.apiKeys (array) → apiKey (string) → env var
 * @param {string|string[]|undefined} apiKey - optional override
 * @returns {string[]}
 */
function getApiKeyList(apiKey) {
    // If caller passed explicit key(s), parse those
    if (apiKey) {
        if (Array.isArray(apiKey)) return apiKey.map(k => k.trim()).filter(Boolean);
        const split = String(apiKey).split('\n').map(k => k.trim()).filter(Boolean);
        if (split.length > 0) return split;
    }
    // Otherwise fall back to config.ai.apiKeys (populated from settings.json)
    if (config.ai.apiKeys && config.ai.apiKeys.length > 0) return config.ai.apiKeys;
    if (config.ai.apiKey) return [config.ai.apiKey];
    return [];
}

/**
 * Try calling promptFn(key) for each key in order.
 * On RESOURCE_EXHAUSTED / 429 / quota error → try next key.
 * @param {string[]} keys
 * @param {function(string): Promise<any>} promptFn
 */
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
            if (isQuota && i < keys.length - 1) continue; // try next key
            throw err; // non-quota or last key
        }
    }
    throw lastError;
}

// Helper: build a Gemini model instance
function buildModel(key) {
    return new GoogleGenerativeAI(key).getGenerativeModel({ model: config.ai.model });
}

// ─── STORY 2-STEP GENERATION ─────────────────────────────────────────────────

/**
 * STEP 1: Extract unique story/informative facts from story source.
 * Returns an array of story facts.
 */
async function extractStoryFacts(keys, storySourceContent, count = 1) {
    const sourceRef = storySourceContent
        ? storySourceContent.substring(0, 10000) // increase context
        : "";

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
        return text.split('[STORY_SEP]').map(s => s.trim()).filter(s => s !== '').slice(0, count);
    });
}

/**
 * STEP 2 (Optional): Generate hook fact for pre-alignment.
 * (Not strictly needed if we pass excerpts directly)
 */

// ─── HOOK GENERATOR ──────────────────────────────────────────────────────────

async function generateHooks(apiKey, context, count, brandName = "", brandContentHooks = "", captionMode = "standard", storySummary = "") {
    const keys = getApiKeyList(apiKey);

    return callWithFallback(keys, async (key) => {
        const model = buildModel(key);

        let brandInfo = "";
        let contextInstruction = "";

        if (captionMode === "edukasi_bisnis" || captionMode === "edukasibisnis") {
            // For Edukasi Bisnis, completely IGNORE the brand name so it doesn't pollute the prompt
            contextInstruction = `Konteks Video: "${context || brandContentHooks || 'Bisnis & Edukasi'}"`;
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

        let hookRule = "";
        if (captionMode === "story") {
            // Handle array of summaries
            let summaryText = "";
            if (Array.isArray(storySummary)) {
                summaryText = `DATA CERITA (Gunakan ini untuk membuat hook yang BERBEDA tiap videonya):\n${storySummary.map((s, i) => `Cerita ${i + 1}: "${s.substring(0, 100)}..."`).join('\n')}`;
            } else {
                summaryText = storySummary ? `Fakta/cerita yang akan dipakai caption: "${storySummary}"` : "Cari fakta paling menarik dari konteks.";
            }

            hookRule = `
HOOK MODE: STORY (Kalimat Gantung)
${summaryText}

HOOK RULE:
- Panjang: 10–20 kata. Boleh pakai tanda tanya atau titik tiga.
- Teaser fakta/cerita tanpa spoiler — buat orang HARUS baca caption.
- Boleh format: fakta mengejutkan, paradoks, pernyataan kontradiktif, atau pertanyaan gantung.
- JANGAN sebut produk atau brand di hook.
- PENTING: Jika diberikan beberapa Cerita, buatlah hook yang BERURUTAN sesuai cerita tersebut.
- Contoh: "Rahasia jadi ahli ternyata bukan di KUALITAS, tapi di KUANTITAS. Kok bisa?"`;
        } else if (captionMode === "edukasi_bisnis" || captionMode === "edukasibisnis") {
            const EDUKASI_BISNIS_CATEGORIES = [
                'Mindset & Refleksi Diri Bisnis Owner: Membahas realita pahit, pentingnya menjaga kesehatan fisik di tengah hustle culture, atau hubungan antara identitas diri dan pertumbuhan bisnis.',
                'Studi Kasus Kesuksesan F&B / Lokal: Mengangkat anomali atau rahasia di balik bisnis lokal (seperti jualan ayam goreng, teh, atau es krim) yang terlihat sederhana tapi bisa menghasilkan omzet miliaran.',
                'Strategi Harga & Loyalitas (Global Case Study): Membedah keputusan ekstrem perusahaan luar negeri dalam mempertahankan harga murah selama puluhan tahun demi mengunci loyalitas pelanggan.',
                'Hacking Psikologi Marketing: Trik jenius namun nyeleneh untuk menyelesaikan keluhan pelanggan atau meningkatkan konversi penjualan secara drastis dengan biaya sangat minim (bahkan Rp 0).',
                'Strategi "Rahasia" Tokoh & Perusahaan Dunia: Membedah alasan logis di balik keputusan aneh para miliarder (seperti mengambil gaji hanya $1) atau kutipan mereka tentang produktivitas dan stres.',
                'Komedi Satir / POV Realita Pengusaha: Format jokes logika relatable atau realita menyedihkan tentang margin tipis, biaya tersembunyi, dan ekspektasi vs realita saat menjalankan bisnis atau investasi.',
                'Penerapan Teori Manajemen dari Pop Culture: Mengaitkan dasar-dasar ilmu bisnis yang membosankan (seperti SOP atau POAC) dengan film, serial Netflix, atau kompetisi viral yang sedang hangat dibicarakan.',
                'Checklist & Alat Tempur Bisnis (FOMO): Memancing rasa takut tertinggal dengan menyebutkan angka pasti tentang dokumen, metrik, atau laporan yang wajib dimiliki agar bisnis tidak hancur.',
                'Manajemen SDM & Leadership (HR Issue): Membahas realita mengurus tim, masalah budaya kerja, atau bahaya tipe karyawan tertentu (seperti silent saboteur), seringkali dibungkus dengan kutipan tajam dari tokoh besar seperti Elon Musk atau Steve Jobs.',
                'Personal Development & Habit Pengusaha: Fokus pada pengembangan diri, checklist kebiasaan harian (habits), manajemen waktu, atau investasi leher ke atas (seperti olahraga atau spiritual) yang berdampak langsung pada performa bisnis owner.',
                'Engagement Bait / Riddle Logika Ringan: Konten selingan yang sifatnya ice-breaking. Berupa pertanyaan nyeleneh, tebak-tebakan logika, atau jokes bapak-bapak yang memancing rasa gemas audiens untuk membanjiri kolom komentar.'
            ];
            const selectedCategories = Array.from({ length: count }, () => EDUKASI_BISNIS_CATEGORIES[Math.floor(Math.random() * EDUKASI_BISNIS_CATEGORIES.length)]);
            const categoryInstructions = selectedCategories.map((cat, i) => `Hook ${i + 1} HARUS menggunakan Kategori Konten: "${cat}"`).join('\n');

            hookRule = `
System Role Tambahan: Kamu adalah Copywriter spesialis Social Media Hook untuk akun edukasi dan hiburan bagi para Business Owner, khususnya di industri ritel dan F&B.

KATEGORI KONTEN UNTUK MASING-MASING HOOK (BERURUTAN):
${categoryInstructions}

HOOK MODE: EDUKASI BISNIS
Aturan Penulisan:
- Hook harus sangat spesifik, punchy, dan memicu rasa penasaran (maksimal 20-30 kata).
- PASTIKAN kalimat UTUH, JELAS, dan TIDAK ADA KATA BENDA/SIFAT YANG HILANG (jangan membuat kalimat rumpang/berlubang hanya demi menekan jumlah kata).
- Gunakan bahasa Indonesia kasual bisnis (gunakan 'bisnis owner', 'kita', 'kalian', atau langsung 'kamu').
- Jika kategorinya tentang studi kasus atau tokoh, karanglah sebuah premis fakta yang terdengar valid dan menarik.
- Jika kategorinya POV/Komedi, buatlah sangat relatable dengan rasa sakit/kerugian kecil dalam bisnis.
- JANGAN sebut nama brand secara langsung di hook ini, buat terlihat general fact atau story.
- PENTING: Kamu harus membuat ${count} hook. Pastikan masing-masing hook menggunakan Kategori Konten yang sudah ditentukan di atas secara berurutan (Hook 1 pakai Topik 1, Hook 2 pakai Topik 2, dst).`;
        } else if (captionMode === "bisnis") {
            hookRule = `
HOOK MODE: BISNIS (Teaser Peluang)
HOOK RULE:
- Panjang: 8–14 kata.
- Memancing rasa penasaran tentang penghasilan, kebebasan, atau peluang.
- JANGAN kata "daftar sekarang" atau "join". Cukup teaser.`;
        } else {
            hookRule = `
HOOK MODE: STANDARD
HOOK RULE:
- Panjang: MID (8–14 kata) atau LONG (15–25 kata).
- Menggantung, tidak menjual, boleh pertanyaan atau refleksi personal.`;
        }

        const prompt = `${getSystemPersona(captionMode)}

INPUT:
${brandInfo}
Target Audiens: Audiens Media Sosial Umum (TikTok/Reels)
${contextInstruction}

TUGAS UTAMA:
Buatlah ${count} buah kalimat hook (judul pembuka video).

${hookRule}

LARANGAN MUTLAK:
- DILARANG KERAS menggunakan emoji atau karakter khusus apapun (tidak ada 😱🔥💡❤️ dll).
- Hanya teks biasa (huruf, angka, tanda baca umum: . , ! ? ... - %, dll).
- WAJIB gunakan penalaran dan logika bahasa Indonesia yang natural (misal: 19.900 dipahami/dibaca sebagai "sembilan belas ribu", BUKAN "satu belas ribu").

OUTPUT FORMAT:
HANYA berikan daftar hook saja, pisahkan dengan baris baru. Jangan ada angka atau kata pembuka/penutup.`;

        const result = await model.generateContent(prompt);
        const text = result.response.text();
        return text.split('\n').filter(line => line.trim() !== '').slice(0, count);

    }).catch((error) => {
        console.error(chalk.red("❌ Gagal generate hook: " + error.message));
        if (error.message.includes("WAJIB")) return Array(count).fill("⚠️ Error: Konteks Video Wajib Diisi!");
        return Array(count).fill(config.ai.defaultHook);
    });
}

// ─── STORY 2-STEP GENERATION ─────────────────────────────────────────────────

/**
 * STEP 1: Generate raw story/informative content from story source.
 * Short, focused prompt — no brand info.
 */
async function generateStoryContent(keys, storySourceContent) {
    const sourceRef = storySourceContent
        ? storySourceContent.substring(0, 5000)
        : "";

    if (!sourceRef) return "";

    return callWithFallback(keys, async (key) => {
        const model = buildModel(key);
        const prompt = `Kamu adalah pencerita yang singkat dan mengena.

REFERENSI (pilih 1 cerita/fakta paling menarik):
---
${sourceRef}
---

TUGAS:
Tulis konten cerita/ilmu dari referensi di atas dalam 2–3 paragraf singkat.
- Setiap paragraf maksimal 3 baris.
- Bahasa santai, tidak formal, langsung ke inti.
- WAJIB: Sertakan minimal 1-2 fakta/angka spesifik dan sebutkan sumbernya (judul buku/tokoh) secara natural di dalam cerita.
- JANGAN sebut nama produk atau brand apapun.
- Jangan beri label atau nomor paragraf.

OUTPUT: Langsung paragraf cerita saja.`;

        const result = await model.generateContent(prompt);
        return result.response.text().trim();
    });
}

/**
 * STEP 2: Blend story content with brand (hook + soft selling + closing question + hashtag).
 * storyContent can be a single string or an array of strings.
 */
async function blendStoryWithBrand(keys, storyContent, brandName, brandCaptionRule, count) {
    const stories = Array.isArray(storyContent) ? storyContent : [storyContent];
    const brandTag = brandName ? `#${brandName.replace(/\s+/g, '')}` : "#brand";

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

    return callWithFallback(keys, async (key) => {
        const model = buildModel(key);

        let storyInput = "";
        if (stories.length > 1) {
            storyInput = `KONTEN CERITA (Ada ${stories.length} buah, buatlah 1 caption UNTUK SETIAP CERITA secara berurutan):\n` +
                stories.map((s, i) => `--- CERITA ${i + 1} ---\n${s}\n---`).join('\n\n');
        } else {
            storyInput = `KONTEN CERITA/ILMU:\n---\n${stories[0]}\n---`;
        }

        const prompt = `${getSystemPersona("story")}

Brand: ${brandName || "Brand"}

${storyInput}

TUGAS: Buat ${count} buah caption lengkap. 
PENTING: Jika ada beberapa CERITA di atas, buatlah caption yang BERURUTAN sesuai cerita tersebut. 1 Caption = 1 Cerita.

FORMAT WAJIB tiap caption (jangan tampilkan label/subtitle):
1. HOOK — 1 baris kalimat gantung yang bikin orang lanjut baca.
2. CERITA — Gunakan konten cerita di atas. Pastikan ada fakta spesifik dan penyebutan SUMBER/TOKOH yang relevan (misal: James Clear).
3. SOFT SELLING — 1 paragraf, selipkan brand "${brandName}" secara natural, bukan iklan. Max 3 baris.
4. PERTANYAAN PEMANTIK — 1 kalimat pertanyaan yang relate dengan CERITA (bukan produk). Buat orang mau komentar.

GAYA: Santai, mengalir, orang malas baca pun bisa ikuti. Max 3 baris per paragraf.
${hashtagSection}

OUTPUT FORMAT:
Pisahkan setiap caption dengan "[SEP]". Jangan pakai penomoran.`;

        const result = await model.generateContent(prompt);
        const text = result.response.text();
        return text.split('[SEP]').map(s => s.trim()).filter(s => s !== '').slice(0, count);
    });
}

// ─── CAPTION GENERATOR ───────────────────────────────────────────────────────

async function generateCaptions(apiKey, context, count, brandName = "", brandLocation = "solo", targetAudience = "General", brandContentHooks = "", brandCaptionRule = "", captionMode = "standard", storySourceContent = "", hooksArray = []) {
    const keys = getApiKeyList(apiKey);

    // ── STORY MODE: 2-step generation ────────────────────────────────────────
    if (captionMode === "story") {
        try {
            // Check if storySourceContent is already an array of snippets (passed from processor)
            let stories = [];
            if (Array.isArray(storySourceContent)) {
                stories = storySourceContent;
            } else {
                console.log(chalk.cyan("   📖 Story Step 1: Mengekstrak konten cerita dari file..."));
                stories = await extractStoryFacts(keys, storySourceContent, count);
            }

            if (stories.length === 0) {
                console.log(chalk.yellow("   ⚠️ Story content kosong, fallback ke standard mode."));
                // fallthrough to standard
            } else {
                console.log(chalk.cyan("   ✍️  Story Step 2: Memadukan cerita dengan brand..."));
                const captions = await blendStoryWithBrand(keys, stories, brandName, brandCaptionRule, count);
                return captions;
            }
        } catch (err) {
            console.error(chalk.red("❌ Story 2-step gagal: " + err.message));
            return Array(count).fill("Story caption gagal digenerate. Coba lagi.");
        }
    }

    // ── STANDARD & BISNIS MODE ───────────────────────────────────────────────
    return callWithFallback(keys, async (key) => {
        const model = buildModel(key);

        let brandInfo = "";
        let contextInstruction = "";

        if (captionMode === "edukasi_bisnis" || captionMode === "edukasibisnis") {
            // IGNORE Brand info for Edukasi Bisnis
            contextInstruction = `Konteks Video: "${context || 'Bisnis & Edukasi'}"`;
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

        const brandTag = brandName ? `#${brandName.replace(/\s+/g, '')}` : "#brand";
        const locationTag = brandLocation ? `#${brandLocation.replace(/\s+/g, '').toLowerCase()}` : "";

        let modeSection = "";
        let hashtagSection = "";

        if (captionMode === "bisnis") {
            modeSection = `
CAPTION MODE: BISNIS (Kemitraan)
- JANGAN menyebut "beli", "order" — fokus ajakan bergabung/kemitraan.
- Pola: Hook peluang → Cerita/fakta → Soft CTA kemitraan → Pertanyaan pemantik.
- Panjang: MID (90–100 kata).
- FORMAT: Bagi tulisan ke dalam 3-4 paragraf. Setiap paragraf MAKSIMAL 2-3 kalimat saja.`;

            hashtagSection = brandCaptionRule && brandCaptionRule.trim() !== ""
                ? `\nHASHTAG RULE:\n${brandCaptionRule}`
                : `\nHASHTAG RULE:\n- 6–10 hashtag.\n- Wajib ada: ${brandTag} ${locationTag}\n- Topik: #kemitraan #peluangusaha #bisnisrumahan #usahasampingan #entrepreneur`;

        } else if (captionMode === "edukasi_bisnis" || captionMode === "edukasibisnis") {
            let hookSyncInstruction = "";
            if (hooksArray && hooksArray.length > 0) {
                hookSyncInstruction = `\n[MANDATORI] DATA PENGKAITAN CERITA:\nKamu diberikan daftar Hook berikut. SETIAP CAPTION harus dikembangkan SECARA BERURUTAN berdasarkan Hook ini:\n${hooksArray.map((h, i) => `Caption ${i + 1} HARUS membahas/melanjutkan cerita dari Hook: "${h}"`).join('\n')}\n\nPENTING: Isi caption harus merupakan ekstensi langsung, detail fakta, atau punchline yang sangat relevan dengan Hook pasangannya tersebut.\nLARANGAN CAPTION: JANGAN MENGULANG kalimat Hook secara sama persis di dalam isi tulisan caption. Langsung saja masuk ke kelanjutan atau penjelasan cerita dari hook tersebut tanpa mengulangnya.`;
            }

            modeSection = `
CAPTION MODE: EDUKASI BISNIS
- Gunakan bahasa Indonesia kasual bisnis untuk audiens Business Owner (terutama F&B / Ritel).
- Berikan insight edukasi, studi kasus, fakta menarik, atau komedi seputar realita pengusaha.${hookSyncInstruction}
- Pola: Opening (Langsung cerita/opini tanpa mengulang hook) → Isi (Ilmu/Komedi Pendek/Kisah Nyata secara detail) → Penutup (Fokus pada konklusi/insight, SESEKALI saja berikan pertanyaan pemantik jika memang dirasa perlu, tetapi jangan dipaksakan di setiap caption).
- Panjang: MID (90–100 kata).
- JANGAN hard sell.
- FORMAT: Bagi tulisan ke dalam 3-4 paragraf. Setiap paragraf MAKSIMAL 2-3 kalimat saja.`;

            hashtagSection = brandCaptionRule && brandCaptionRule.trim() !== ""
                ? `\nHASHTAG RULE:\n${brandCaptionRule}`
                : `\nHASHTAG RULE:\n- 6–10 hashtag.\n- Wajib ada: ${brandTag} ${locationTag}\n- Topik umum: #bisnisowner #edukasibisnis #ceritapengusaha #tipsbisnis #bisniskuliner`;

        } else {
            // Standard
            modeSection = `
CAPTION MODE: STANDARD
MODE KONTEN (acak per caption): Mirror Story / Relatable POV / Confessional / Story Logic / Post-Irony
POLA: Opening → Cerita → Insight. Panjang: MID (90–130) atau LONG (100–200 kata).
FORMAT: Bagi tulisan ke dalam 3-4 paragraf. Setiap paragraf MAKSIMAL 2-3 kalimat saja.`;

            hashtagSection = brandCaptionRule && brandCaptionRule.trim() !== ""
                ? `\nHASHTAG & CAPTION RULE:\n${brandCaptionRule}`
                : `\nHASHTAG RULE:\n- 5–8 hashtag. Wajib ada: ${brandTag} ${locationTag}`;
        }

        const prompt = `${getSystemPersona(captionMode)}

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
        return text.split('[SEP]').map(s => s.trim()).filter(s => s !== '').slice(0, count);

    }).catch((error) => {
        console.error(chalk.red("❌ Gagal generate caption: " + error.message));
        return Array(count).fill("Nemu video seru nih... #random #video");
    });
}

module.exports = { generateHooks, generateCaptions, getApiKeyList, extractStoryFacts };
