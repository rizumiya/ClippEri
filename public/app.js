let socket;
if (typeof io !== 'undefined') {
    socket = io();

    // LOGGING
    const logConsole = document.getElementById('log-console');

    socket.on('log', (data) => {
        const div = document.createElement('div');
        const time = new Date().toLocaleTimeString();
        div.innerHTML = `<span style="opacity:0.5">[${time}]</span> ${data.message}`;

        if (data.type === 'error') {
            div.style.color = '#ef4444';
        }

        logConsole.appendChild(div);
        logConsole.scrollTop = logConsole.scrollHeight;
    });

    socket.on('process-complete', (data) => {
        if (data.success) {
            alert('Process Completed Successfully!');
        } else {
            alert('Process Failed: ' + data.error);
        }
    });
} else {
    console.warn("Socket.io not found. Backend features won't work in static mode.");
}

// ─── TOAST Notification ──────────────────────────────────────────────────────
function showToast(msg) {
    let container = document.getElementById('toast-container');
    if (!container) {
        container = document.createElement('div');
        container.id = 'toast-container';
        document.body.appendChild(container);
    }
    const toast = document.createElement('div');
    toast.className = 'toast';
    toast.textContent = msg;
    container.appendChild(toast);
    setTimeout(() => toast.remove(), 3500);
}

const defaultSubtitleAiSettings = {
    fontFamily: "Poppins",
    fontSize: 80,
    lineSpacing: 0,
    outlineColor: "#ff0000",
    maxLines: 2,
    maxWordsPerLine: 3,
    positionBottom: 300
};

let lastSavedSubtitleAiSettings = { ...defaultSubtitleAiSettings };

function normalizeSubtitleAiSettings(raw = {}) {
    const fontSize = Number(raw.fontSize);
    const lineSpacing = Number(raw.lineSpacing);
    const maxLines = Number(raw.maxLines);
    const maxWordsPerLine = Number(raw.maxWordsPerLine);
    const positionBottom = Number(raw.positionBottom);

    return {
        fontFamily: String(raw.fontFamily || defaultSubtitleAiSettings.fontFamily).trim() || defaultSubtitleAiSettings.fontFamily,
        fontSize: Number.isFinite(fontSize) && fontSize > 0 ? fontSize : defaultSubtitleAiSettings.fontSize,
        lineSpacing: Number.isFinite(lineSpacing) ? lineSpacing : defaultSubtitleAiSettings.lineSpacing,
        outlineColor: /^#[0-9a-fA-F]{6}$/.test(String(raw.outlineColor || "")) ? String(raw.outlineColor) : defaultSubtitleAiSettings.outlineColor,
        maxLines: Math.min(2, Math.max(1, Number.isFinite(maxLines) ? maxLines : defaultSubtitleAiSettings.maxLines)),
        maxWordsPerLine: Math.max(1, Number.isFinite(maxWordsPerLine) ? maxWordsPerLine : defaultSubtitleAiSettings.maxWordsPerLine),
        positionBottom: Math.max(20, Number.isFinite(positionBottom) ? positionBottom : defaultSubtitleAiSettings.positionBottom)
    };
}

function syncSavedSubtitleAiSettings(rawSettings = {}, statusMode = 'saved', statusText = 'Tersimpan') {
    lastSavedSubtitleAiSettings = normalizeSubtitleAiSettings(rawSettings);
    setSubtitleAiStatus(statusMode, statusText);
}

function populateSubtitleAiSettings(rawSettings = {}) {
    const settings = normalizeSubtitleAiSettings(rawSettings);

    const fontFamilyInput = document.getElementById('settings-subtitle-font-family');
    const fontSizeInput = document.getElementById('settings-subtitle-font-size');
    const lineSpacingInput = document.getElementById('settings-subtitle-line-spacing');
    const outlineColorInput = document.getElementById('settings-subtitle-outline-color');
    const maxLinesInput = document.getElementById('settings-subtitle-max-lines');
    const maxWordsInput = document.getElementById('settings-subtitle-max-words');
    const positionBottomInput = document.getElementById('settings-subtitle-position-bottom');

    if (fontFamilyInput) fontFamilyInput.value = settings.fontFamily;
    if (fontSizeInput) fontSizeInput.value = settings.fontSize;
    if (lineSpacingInput) lineSpacingInput.value = settings.lineSpacing;
    if (outlineColorInput) outlineColorInput.value = settings.outlineColor;
    if (maxLinesInput) maxLinesInput.value = settings.maxLines;
    if (maxWordsInput) maxWordsInput.value = settings.maxWordsPerLine;
    if (positionBottomInput) positionBottomInput.value = settings.positionBottom;
}

function areSubtitleAiSettingsEqual(a, b) {
    const left = normalizeSubtitleAiSettings(a);
    const right = normalizeSubtitleAiSettings(b);
    return left.fontFamily === right.fontFamily
        && left.fontSize === right.fontSize
        && left.lineSpacing === right.lineSpacing
        && left.outlineColor === right.outlineColor
        && left.maxLines === right.maxLines
        && left.maxWordsPerLine === right.maxWordsPerLine
        && left.positionBottom === right.positionBottom;
}

function setSubtitleAiStatus(mode, text) {
    const el = document.getElementById('subtitle-ai-status');
    if (!el) return;

    el.classList.remove('settings-status-unsaved', 'settings-status-saved', 'settings-status-default');
    if (mode) {
        el.classList.add(`settings-status-${mode}`);
    }
    el.textContent = text;
}

function getSubtitleAiSettingsFromForm() {
    return normalizeSubtitleAiSettings({
        fontFamily: document.getElementById('settings-subtitle-font-family')?.value,
        fontSize: document.getElementById('settings-subtitle-font-size')?.value,
        lineSpacing: document.getElementById('settings-subtitle-line-spacing')?.value,
        outlineColor: document.getElementById('settings-subtitle-outline-color')?.value,
        maxLines: document.getElementById('settings-subtitle-max-lines')?.value,
        maxWordsPerLine: document.getElementById('settings-subtitle-max-words')?.value,
        positionBottom: document.getElementById('settings-subtitle-position-bottom')?.value
    });
}

function bindSubtitleAiInputs() {
    const fieldIds = [
        'settings-subtitle-font-family',
        'settings-subtitle-font-size',
        'settings-subtitle-line-spacing',
        'settings-subtitle-outline-color',
        'settings-subtitle-max-lines',
        'settings-subtitle-max-words',
        'settings-subtitle-position-bottom'
    ];

    fieldIds.forEach((id) => {
        const el = document.getElementById(id);
        if (!el || el.dataset.previewBound === 'true') return;

        const updateStatus = () => {
            const formSettings = getSubtitleAiSettingsFromForm();
            if (areSubtitleAiSettingsEqual(formSettings, lastSavedSubtitleAiSettings)) {
                setSubtitleAiStatus('saved', 'Tersimpan');
            } else {
                setSubtitleAiStatus('unsaved', 'Belum disimpan');
            }
        };
        el.addEventListener('input', updateStatus);
        el.addEventListener('change', updateStatus);
        el.dataset.previewBound = 'true';
    });
}

// ====================== NEW TAB SYSTEM ======================
function openMainTab(tabName) {
    document.querySelectorAll('.main-tab-content').forEach(t => t.classList.remove('active'));
    document.getElementById(tabName).classList.add('active');

    // Update active state pada tombol tab utama
    document.querySelectorAll('.main-tab-btn').forEach(btn => {
        btn.classList.remove('active');
        if (btn.getAttribute('onclick') && btn.getAttribute('onclick').includes(tabName)) {
            btn.classList.add('active');
        }
    });

    // Auto buka sidebar pertama
    const firstLi = document.querySelector(`#${tabName} .sidebar-menu li`);
    if (firstLi) openSubTab(firstLi);
}

function openSubTab(el) {
    const contentArea = el.closest('.app-layout').querySelector('.content-area');
    const subId = el.getAttribute('data-sub');

    contentArea.querySelectorAll('.sub-tab-content').forEach(c => c.classList.remove('active'));
    const target = document.getElementById(subId);
    if (target) target.classList.add('active');

    // Highlight sidebar
    el.parentElement.querySelectorAll('li').forEach(li => li.classList.remove('active'));
    el.classList.add('active');
}

// ====================== YOUTUBE DOWNLOADER (placeholder) ======================
const ytForm = document.getElementById('youtube-form');
if (ytForm) {
    ytForm.addEventListener('submit', async (e) => {
        e.preventDefault();
        const f = new FormData(e.target);
        const d = Object.fromEntries(f.entries());

        const payload = {
            url: d.url,
            outputDir: d.outputDir || "downloads",
            quality: d.quality || "highest"
        };

        if (payload.url) {
            await sendCommand('/api/run/youtube', payload);
        } else {
            alert("URL YouTube wajib diisi!");
        }
    });

    // ─── AUTO PORTRAIT ROTATION ──────────────────────────────────────────────────
    const rotateForm = document.getElementById('rotate-form');
    if (rotateForm) {
        rotateForm.addEventListener('submit', async (e) => {
            e.preventDefault();
            const f = new FormData(e.target);
            const d = Object.fromEntries(f.entries());

            if (!d.sourceDir) {
                return alert("Folder sumber wajib diisi!");
            }

            await sendCommand('/api/run/rotate-portrait', {
                sourceDir: d.sourceDir
            });
        });
    }

    // ─── COMPRESS VIDEO ─────────────────────────────────────────────────────────
    const compressForm = document.getElementById('compress-form');
    if (compressForm) {
        compressForm.addEventListener('submit', async (e) => {
            e.preventDefault();
            const f = new FormData(e.target);
            const d = Object.fromEntries(f.entries());

            if (!d.sourceDir) {
                return alert("Folder sumber wajib diisi!");
            }

            const confirmProceed = confirm("⚠️ PERINGATAN!\n\nProses ini akan MENIMPA video aslinya secara permanen. Apakah kamu SUDAH MENGETES dengan 1 video contoh dan yakin ingin memproses seluruh folder ini?");
            if (!confirmProceed) return;

            await sendCommand('/api/run/compress-video', {
                sourceDir: d.sourceDir
            });
        });
    }
}

// ─── AI VIDEO ANALYSIS ──────────────────────────────────────────────────────
const analysisForm = document.getElementById('analysis-form');
if (analysisForm) {
    analysisForm.addEventListener('submit', async (e) => {
        e.preventDefault();
        const urlValue = e.target.url.value.trim();
        if (!urlValue) return;

        const resultsArea = document.getElementById('analysis-results-area');
        const outputText = document.getElementById('analysis-output');

        resultsArea.classList.remove('hidden');
        outputText.value = "⚡ Analyzing video... Please wait.\n(Checking Logs for progress recommended)";

        try {
            const response = await fetch('/api/run/analyze-video', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ url: urlValue })
            });

            const data = await response.json();
            if (data.analysis) {
                outputText.value = JSON.stringify(data.analysis, null, 2);
                showToast("✅ Analysis complete!");
            } else {
                outputText.value = `❌ Error: ${data.error || 'Failed to analyze'}`;
            }
        } catch (err) {
            outputText.value = `❌ Error: ${err.message}`;
        }
    });
}

window.copyAnalysisResult = function () {
    const outputText = document.getElementById('analysis-output');
    outputText.select();
    document.execCommand('copy');
    showToast("📋 Copied to clipboard!");
};

// Init pertama kali
document.addEventListener('DOMContentLoaded', () => {
    openMainTab('processing');
    bindSubtitleAiInputs();
    ensureBrandModeOptions();
    setReplizEditorState(false);
    setReplizSaveState('saved', 'Tersimpan');
    setBrandEditorState(false);
});

// --- HELPER TOGGLES ---
// --- HELPER TOGGLES ---

// 1. Toggles untuk Tab All In One
const aioMusicCheckbox = document.getElementById('aio-useMusic');
if (aioMusicCheckbox) {
    aioMusicCheckbox.addEventListener('change', (e) => {
        document.getElementById('music-options').classList.toggle('hidden', !e.target.checked);
    });
}

const aioHookCheckbox = document.getElementById('aio-useHooks');
if (aioHookCheckbox) {
    aioHookCheckbox.addEventListener('change', (e) => {
        document.getElementById('hook-options').classList.toggle('hidden', !e.target.checked);
    });
}

const aioCaptionCheckbox = document.getElementById('aio-useCaptions');
if (aioCaptionCheckbox) {
    aioCaptionCheckbox.addEventListener('change', (e) => {
        document.getElementById('caption-options').classList.toggle('hidden', !e.target.checked);
    });
}

function buildRandomScheduleAcrossDateRange(count, startDateStr, endDateStr, startTimeStr, endTimeStr) {
    const today = new Date();
    const todayStr = today.toISOString().split('T')[0];
    const startDate = new Date(`${startDateStr || todayStr}T00:00:00`);
    const endDate = new Date(`${endDateStr || startDateStr || todayStr}T00:00:00`);

    if (Number.isNaN(startDate.getTime()) || Number.isNaN(endDate.getTime())) {
        return [];
    }

    if (endDate < startDate) {
        endDate.setTime(startDate.getTime());
    }

    const parseMinutes = (value, fallback) => {
        const source = value || fallback;
        const [h, m] = String(source).split(':').map(Number);
        return ((Number.isFinite(h) ? h : 0) * 60) + (Number.isFinite(m) ? m : 0);
    };

    const startMinutes = parseMinutes(startTimeStr, '13:00');
    const endMinutes = parseMinutes(endTimeStr, '17:00');
    const safeStartMinutes = Math.min(startMinutes, endMinutes);
    const safeEndMinutes = Math.max(startMinutes, endMinutes);

    const dates = [];
    for (let cursor = new Date(startDate); cursor <= endDate; cursor.setDate(cursor.getDate() + 1)) {
        dates.push(new Date(cursor));
    }

    const totalDays = dates.length;
    const basePerDay = Math.floor(count / totalDays);
    const extra = count % totalDays;
    const scheduleTimes = [];

    dates.forEach((day, dayIndex) => {
        const itemsForDay = basePerDay + (dayIndex < extra ? 1 : 0);
        if (itemsForDay <= 0) return;

        const totalWindow = Math.max(1, safeEndMinutes - safeStartMinutes);
        const step = totalWindow / itemsForDay;

        for (let itemIndex = 0; itemIndex < itemsForDay; itemIndex += 1) {
            const minuteOffset = safeStartMinutes + Math.floor((itemIndex + 0.5) * step);
            const scheduled = new Date(day);
            scheduled.setHours(0, 0, 0, 0);
            scheduled.setMinutes(Math.min(safeEndMinutes, minuteOffset));
            scheduleTimes.push(scheduled.toISOString());
        }
    });

    while (scheduleTimes.length > count) {
        scheduleTimes.pop();
    }

    return scheduleTimes.sort();
}

const aioOutputMode = document.getElementById('aio-output-mode');
if (aioOutputMode) {
    aioOutputMode.addEventListener('change', () => {
        const isSheetMode = aioOutputMode.value === 'video_caption_sheet';
        if (isSheetMode && aioCaptionCheckbox) {
            aioCaptionCheckbox.checked = true;
            document.getElementById('caption-options').classList.remove('hidden');
        }
    });
}

const aioSubtitleCheckbox = document.getElementById('aio-useSubtitles');
if (aioSubtitleCheckbox) {
    aioSubtitleCheckbox.addEventListener('change', (e) => {
        document.getElementById('subtitle-options-aio').classList.toggle('hidden', !e.target.checked);
    });
}

const aioUploadCheckbox = document.getElementById('aio-autoUpload');
if (aioUploadCheckbox) {
    aioUploadCheckbox.addEventListener('change', (e) => {
        document.getElementById('repliz-options').classList.toggle('hidden', !e.target.checked);
    });
}

// 2. Toggle untuk Tab Standalone Merge
const simpleMusicCheckbox = document.getElementById('merge-simple-useMusic');
if (simpleMusicCheckbox) {
    simpleMusicCheckbox.addEventListener('change', (e) => {
        document.getElementById('music-options-simple').classList.toggle('hidden', !e.target.checked);
    });
}


// Schedule Mode Cards Logic
const scheduleCards = document.querySelectorAll('.schedule-card');
if (scheduleCards.length > 0) {
    scheduleCards.forEach(card => {
        card.addEventListener('click', () => {
            const target = card.getAttribute('data-target') || 'merge'; // Default to merge for old ones
            const mode = card.getAttribute('data-mode');

            // Remove active class from same target cards
            document.querySelectorAll(`.schedule-card[data-target="${target}"]`).forEach(c => c.classList.remove('active'));
            card.classList.add('active');

            // Update hidden input value
            const hiddenInputId = target === 'upload' ? 'hidden-upload-scheduleMode' : 'hidden-scheduleMode';
            const hiddenScheduleMode = document.getElementById(hiddenInputId);
            if (hiddenScheduleMode) hiddenScheduleMode.value = mode;

            // Hide all input groups for this target
            document.querySelectorAll(`.${target === 'upload' ? 'upload-schedule-input-group' : 'schedule-input-group'}`).forEach(el => el.classList.add('hidden'));

            // Show the selected input group
            const activeGroup = document.getElementById(`${target === 'upload' ? 'upload-' : ''}schedule-input-${mode}`);
            if (activeGroup) activeGroup.classList.remove('hidden');
        });
    });
}

// --- POPULATE CONFIG & BRANDS ---
async function loadConfig() {
    try {
        const timestamp = new Date().getTime();
        const res = await fetch(`/api/config?t=${timestamp}`);
        const config = await res.json();
        populateSubtitleAiSettings(config.subtitle_ai);
        syncSavedSubtitleAiSettings(config.subtitle_ai, 'saved', 'Tersimpan');
        const brandsRes = await fetch(`/api/brands?t=${timestamp}`);
        const brands = await brandsRes.json();

        // Merge brands from specific endpoint if needed, but config.brands should have it
        const finalBrands = (config.brands && config.brands.length > 0) ? config.brands : brands;

        // Populate Brand Dropdowns (Updated: Name Only)
        const selects = document.querySelectorAll('.brand-select');
        selects.forEach(select => {
            // Keep the selected value if possible
            const currentVal = select.value;
            select.innerHTML = '<option value="">-- No Brand Specific --</option>';

            if (finalBrands && finalBrands.length > 0) {
                finalBrands.forEach((b, index) => {
                    const opt = document.createElement('option');
                    opt.value = index;
                    opt.textContent = `${b.name}`;
                    select.appendChild(opt);
                });
            }

            // Restore selection if valid
            if (currentVal && finalBrands[currentVal]) {
                select.value = currentVal;
            }

            // ADD LISTENER: Disable Context if Brand Selected
            select.addEventListener('change', function () {
                let contextId = null;
                let placeholderText = "";

                if (this.name === 'brandIndex') {
                    contextId = this.closest('#merge-form') ? 'merge-hook-context' : 'hooks-context';
                    placeholderText = "e.g. 'Fitness Tips' or 'Gaming Highlights'";
                } else if (this.name === 'captionBrandIndex') {
                    contextId = 'repliz-caption-context';
                    placeholderText = "Konteks caption jika beda dari hook";
                }

                if (contextId) {
                    const ctxInput = document.getElementById(contextId);
                    if (this.value !== "") {
                        ctxInput.value = "";
                        ctxInput.placeholder = "(Using Brand Rules... Input Disabled)";
                        ctxInput.disabled = true;
                        if (this.name === 'brandIndex') ctxInput.required = false;
                        ctxInput.style.backgroundColor = "rgba(0,0,0,0.5)";
                        ctxInput.style.opacity = "0.5";
                    } else {
                        ctxInput.placeholder = placeholderText;
                        ctxInput.disabled = false;
                        if (this.name === 'brandIndex') ctxInput.required = true;
                        ctxInput.style.backgroundColor = "";
                        ctxInput.style.opacity = "1";
                    }
                }
            });
            // Trigger once on load to set initial state
            select.dispatchEvent(new Event('change'));
        });

        // Populate Clips Folder dropdown (Merge tab Source Clips Folder)
        loadClipsFolders();

        console.log("Config & Brands loaded:", finalBrands.length);
    } catch (e) {
        console.error("Failed to load config", e);
    }
}
loadConfig();

// --- FORM SUBMISSIONS ---
async function sendCommand(endpoint, payload) {
    if (!socket) {
        alert("Backend not connected (Socket.io missing).");
        return;
    }
    try {
        // Pindah ke tab Pemrosesan Video + buka Logs
        openMainTab('processing');
        const logsLi = document.querySelector('#processing li[data-sub="logs"]');
        if (logsLi) openSubTab(logsLi);

        document.getElementById('log-console').innerHTML += `<div>> Sending command to ${endpoint}...</div>`;

        await fetch(endpoint, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(payload)
        });
    } catch (err) {
        alert('Failed to start: ' + err.message);
        openMainTab('processing');
        const logsLi = document.querySelector('#processing li[data-sub="logs"]');
        if (logsLi) openSubTab(logsLi);
        document.getElementById('log-console').innerHTML += `<div style="color:red">> Error: ${err.message}</div>`;
    }
}

// 1. Multi-Cut
document.getElementById('multicut-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    const formData = new FormData(e.target);
    const data = Object.fromEntries(formData.entries());

    // ── Save output folder ke registry ──────────────────────────
    if (data.clipsDir && data.clipsDir.trim() !== '') {
        await saveClipsFolderToRegistry(data.clipsDir.trim());
    }

    const payload = {
        sourceDir: data.sourceDir,
        clipsDir: data.clipsDir,
        fastMode: false,
        settings: {
            trimStart: data.trimStart,
            trimEnd: data.trimEnd,
            maxClips: parseInt(data.maxClips),
            clipDuration: parseFloat(data.clipDuration)
        }
    };

    await sendCommand('/api/run/multicut', payload);
});

/**
 * Ekstrak nama folder terakhir dari path, simpan ke settings.json clips_folders.
 * Format: [{"contents": "D:\\path\\to\\contents"}, ...]
 */
async function saveClipsFolderToRegistry(fullPath) {
    // Ekstra nama folder terakhir (handle \ dan /)
    const folderName = fullPath.replace(/[\\/]+$/, '').split(/[\\/]/).pop();
    if (!folderName) return;

    try {
        const res = await fetch('/api/config');
        const cfg = await res.json();
        const existing = Array.isArray(cfg.clips_folders) ? cfg.clips_folders : [];

        // Cek apakah path sudah ada (dedup by full path)
        const alreadyExists = existing.some(obj => Object.values(obj)[0] === fullPath);
        if (!alreadyExists) {
            const newEntry = { [folderName]: fullPath };
            const updated = [...existing, newEntry];
            await fetch('/api/settings', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ clips_folders: updated })
            });
            // Refresh dropdown merge
            populateClipsFolderDropdown(updated);
            console.log(`Clips folder saved: ${folderName} → ${fullPath}`);
        }
    } catch (e) {
        console.error('Failed to save clips folder registry:', e);
    }
}

// Populate Clips Folder Dropdown from settings.json
async function loadClipsFolders() {
    const dropdown = document.getElementById('merge-clips-dropdown');
    if (!dropdown) return;

    try {
        const res = await fetch('/api/config');
        const config = await res.json();
        const folders = config.clips_folders || [];

        // Clear loading option but keep Manual option
        dropdown.innerHTML = '<option value="">-- Pilih Folder Klip --</option>';

        folders.forEach(obj => {
            for (const [name, path] of Object.entries(obj)) {
                const opt = document.createElement('option');
                opt.value = path;
                opt.textContent = name + " (" + path + ")";
                dropdown.appendChild(opt);
            }
        });

        // Add Manual Entry at the end
        const manualOpt = document.createElement('option');
        manualOpt.value = 'manual';
        manualOpt.textContent = 'Manual Entry...';
        dropdown.appendChild(manualOpt);

    } catch (e) {
        console.error("Failed to load clips folders", e);
        dropdown.innerHTML = '<option value="">-- Gagal memuat folder, gunakan manual --</option>';
        const manualOpt = document.createElement('option');
        manualOpt.value = 'manual';
        manualOpt.textContent = 'Manual Entry...';
        dropdown.appendChild(manualOpt);
    }
}

/**
 * Handler when dropdown changes — fills the actual name="sourceDir" input.
 */
window.onClipsFolderSelect = function (selectEl) {
    const manualInput = document.getElementById('merge-manual-clipsDir');
    if (!selectEl || !manualInput) return;

    if (selectEl.value === 'manual' || selectEl.value === '') {
        // Tampilkan manual input
        manualInput.style.display = '';
        manualInput.required = true;
        manualInput.value = '';
    } else {
        // Sembunyikan manual input, gunakan value dari dropdown
        manualInput.style.display = 'none';
        manualInput.required = false;
        manualInput.value = selectEl.value; // isi full path agar ikut tersubmit
    }
};


// 2. All In One (formerly Merge)
const allInOneForm = document.getElementById('all-in-one-form');
if (allInOneForm) {
    allInOneForm.addEventListener('submit', async (e) => {
        e.preventDefault();
        const f = new FormData(e.target);
        const d = Object.fromEntries(f.entries());

        // --- MULTI-CUT SETTINGS ---
        const multicutPayload = {
            sourceDir: d.allInOneSourceDir,
            clipsDir: "temp_allinone_clips", // Hardcoded temporary folder
            fastMode: false,
            settings: {
                trimStart: document.getElementById('def-mc-trimStart').value.trim() || "",
                trimEnd: document.getElementById('def-mc-trimEnd').value.trim() || "",
                maxClips: parseInt(document.getElementById('def-mc-maxClips').value) || 5,
                clipDuration: parseFloat(document.getElementById('def-mc-clipDuration').value) || 2
            }
        };

        // --- MERGE SETTINGS ---
        const mergeSettings = {
            finalCount: parseInt(document.getElementById('def-merge-finalCount').value) || 3,
            maxPerSource: parseInt(document.getElementById('def-merge-maxPerSource').value) || 2,
            maxSources: parseInt(document.getElementById('def-merge-maxSources').value) || 0,
            finalDurationSec: parseInt(document.getElementById('def-merge-finalDuration').value) || 17,
            mode: document.getElementById('def-merge-mode').value || "random",
            useHook: document.getElementById('aio-useHooks') ? document.getElementById('aio-useHooks').checked : false,
            useMusic: document.getElementById('aio-useMusic') ? document.getElementById('aio-useMusic').checked : false
        };

        let musicAns = null;
        if (mergeSettings.useMusic) {
            musicAns = {
                folder: d.musicDir || "backsound",
                mode: d.musicMode || "random"
            };
        }

        let uploadConfig = {
            mergeSettings,
            musicAns,
            hookContext: d.hookContext,
            brandIndex: d.brandIndex,
            replizConfig: false,
            systemPersona: d.systemPersona || 'default',
            outputMode: d.outputMode || 'normal',
            // Hook timing configuration
            hookTimingMode: d.aioHookTimingMode || 'full',
            hookStartTime: null,
            hookDuration: null
        };

        // Parse AIO hook timing
        if (uploadConfig.hookTimingMode === 'custom' && d.aioHookTiming) {
            const [start, duration] = d.aioHookTiming.split(',').map(s => parseFloat(s.trim()));
            if (!isNaN(start) && !isNaN(duration) && start >= 0 && duration > 0) {
                uploadConfig.hookStartTime = start;
                uploadConfig.hookDuration = duration;
            }
        }

        // --- REPLIZ SCHEDULE LOGIC ---
        const autoUpload = document.getElementById('aio-autoUpload') && document.getElementById('aio-autoUpload').checked;

        if (autoUpload) {
            const selectedReplizAccountIds = getSelectedReplizAccountIds('aio-repliz-account-list');
            if (selectedReplizAccountIds.length === 0) {
                alert("Pilih minimal 1 akun Repliz untuk All In One.");
                return;
            }

            const scheduleMode = d.scheduleMode; // Dari input hidden "#hidden-scheduleMode"
            const count = mergeSettings.finalCount;
            let scheduleTimes = [];

            // Helper: Gabungkan date string (YYYY-MM-DD) + time string (HH:MM) menjadi Date object
            const parseDateTime = (dateStr, timeStr) => {
                const today = new Date();
                const todayStr = today.toISOString().split('T')[0]; // YYYY-MM-DD
                const d = dateStr || todayStr;   // fallback ke hari ini jika tidak dipilih
                const t = String(timeStr || '13:00').trim().replace('.', ':');
                return new Date(`${d}T${t}:00`);
            };

            if (scheduleMode === 'fixed') {
                const dt = parseDateTime(d.fixedDate, d.fixedTime || '13:00');
                for (let i = 0; i < count; i++) {
                    scheduleTimes.push(dt.toISOString());
                }
            }
            else if (scheduleMode === 'range') {
                scheduleTimes = buildRandomScheduleAcrossDateRange(
                    count,
                    d.rangeStartDate,
                    d.rangeEndDate,
                    d.rangeStart || '13:00',
                    d.rangeEnd || '17:00'
                );
            }
            else if (scheduleMode === 'list') {
                const list = (d.listTimes || '').split(',').map(s => s.trim()).filter(s => s);
                list.forEach(t => {
                    try {
                        scheduleTimes.push(parseDateTime(d.listDate, t).toISOString());
                    } catch (e) { console.error('Invalid time format', t); }
                });
                // Jika list jam lebih sedikit dari jumlah video, ulangi jam terakhir
                while (scheduleTimes.length > 0 && scheduleTimes.length < count) {
                    scheduleTimes.push(scheduleTimes[scheduleTimes.length - 1]);
                }
                // Batasi sesuai count jika list kepanjangan
                scheduleTimes = scheduleTimes.slice(0, count);
            }


            uploadConfig = {
                ...uploadConfig,
                replizConfig: true,
                selectedReplizAccountIds,
                scheduleTimes,
                captionContext: d.captionContext || d.hookContext || d.subtitleContext || "",
                captionBrandIndex: d.captionBrandIndex || d.brandIndex || d.subtitleBrandIndex || ""
            };
        }

        // Add useCaptions to config regardless of replizConfig, so it runs independently
        uploadConfig.useCaptions = document.getElementById('aio-useCaptions') ? document.getElementById('aio-useCaptions').checked : false;
        if (uploadConfig.outputMode === 'video_caption_sheet') {
            uploadConfig.useCaptions = true;
        }
        uploadConfig.captionContext = d.captionContext || d.hookContext || d.subtitleContext || "";
        uploadConfig.captionBrandIndex = d.captionBrandIndex || d.brandIndex || d.subtitleBrandIndex || "";

        // Add useSubtitles to config
        uploadConfig.useSubtitles = document.getElementById('aio-useSubtitles') ? document.getElementById('aio-useSubtitles').checked : false;
        uploadConfig.srtWavDir = d.srtWavDir || "";

        const payload = {
            multicut: multicutPayload,
            merge: {
                sourceDir: "temp_allinone_clips",
                finalDir: d.finalDir,
                uploadConfig
            }
        };

        await sendCommand('/api/run/all-in-one', payload);
    });
}

// 2b. Standalone Merge (Simplified)
const simpleMergeForm = document.getElementById('merge-form');
if (simpleMergeForm) {
    simpleMergeForm.addEventListener('submit', async (e) => {
        e.preventDefault();
        const f = new FormData(e.target);
        const d = Object.fromEntries(f.entries());

        const mergeSettings = {
            finalCount: parseInt(d.finalCount),
            maxPerSource: parseInt(d.maxPerSource),
            maxSources: parseInt(d.maxSources || 0),
            finalDurationSec: parseInt(d.finalDurationSec || 17),
            mode: d.mode,
            useHook: false,
            useMusic: document.getElementById('merge-simple-useMusic') ? document.getElementById('merge-simple-useMusic').checked : false
        };

        let musicAns = null;
        if (mergeSettings.useMusic) {
            musicAns = {
                folder: d.musicDir || "backsound",
                mode: d.musicMode || "random"
            };
        }

        const uploadConfig = {
            mergeSettings,
            musicAns,
            hookContext: "",
            brandIndex: "",
            replizConfig: false
        };

        const manualPath = document.getElementById('merge-manual-clipsDir').value.trim();
        const dropdownPath = document.getElementById('merge-clips-dropdown').value;
        const sourceDir = (dropdownPath === 'manual') ? manualPath : dropdownPath;
        const payload = {
            sourceDir: sourceDir,
            finalDir: d.finalDir,
            uploadConfig
        };

        await sendCommand('/api/run/merge', payload);
    });
}

// 2c. Standalone Upload Repliz
const uploadForm = document.getElementById('upload-form');
if (uploadForm) {
    uploadForm.addEventListener('submit', async (e) => {
        e.preventDefault();
        const f = new FormData(e.target);
        const d = Object.fromEntries(f.entries());

        const scheduleMode = d.scheduleMode || 'fixed';
        let scheduleTimes = [];

        // Helper: Convert date string (YYYY-MM-DD) + time string (HH:MM) to Date object
        const parseDateTime = (dateStr, timeStr) => {
            const today = new Date();
            const todayStr = today.toISOString().split('T')[0];
            const dtStr = dateStr || todayStr;
            const tStr = String(timeStr || '13:00').trim().replace('.', ':');
            return new Date(`${dtStr}T${tStr}:00`);
        };

        // For range mode, let the backend generate schedule slots from the real file count
        // in the upload folder so per-day distribution stays accurate.
        const countEstimate = 50;

        if (scheduleMode === 'fixed') {
            const dt = parseDateTime(d.fixedDate, d.fixedTime || '13:00');
            for (let i = 0; i < countEstimate; i++) scheduleTimes.push(dt.toISOString());
        }
        else if (scheduleMode === 'range') {
            scheduleTimes = [];
        }
        else if (scheduleMode === 'list') {
            const list = (d.listTimes || '').split(',').map(s => s.trim()).filter(s => s);
            list.forEach(t => {
                try {
                    scheduleTimes.push(parseDateTime(d.listDate, t).toISOString());
                } catch (err) { console.error('Invalid time format', t); }
            });
            while (scheduleTimes.length > 0 && scheduleTimes.length < countEstimate) {
                scheduleTimes.push(scheduleTimes[scheduleTimes.length - 1]);
            }
            scheduleTimes = scheduleTimes.slice(0, countEstimate);
        }

        const selectedReplizAccountIds = getSelectedReplizAccountIds('upload-repliz-account-list');
        if (selectedReplizAccountIds.length === 0) {
            alert("Pilih minimal 1 akun Repliz untuk upload.");
            return;
        }

        const payload = {
            uploadDir: d.uploadDir,
            scheduleSettings: {
                scheduleMode,
                scheduleTimes,
                selectedReplizAccountIds,
                rangeStartDate: d.rangeStartDate || "",
                rangeEndDate: d.rangeEndDate || "",
                rangeStart: d.rangeStart || "",
                rangeEnd: d.rangeEnd || ""
            }
        };
        await sendCommand('/api/run/upload-repliz', payload);
    });
}

// Helper: Toggle manual path input in simplified Merge
window.toggleManualClipsDir = function () {
    const dropdown = document.getElementById('merge-clips-dropdown');
    const manualInput = document.getElementById('merge-manual-clipsDir');
    if (dropdown.value === 'manual') {
        manualInput.style.display = 'block';
        manualInput.required = true;
    } else {
        manualInput.style.display = 'none';
        manualInput.required = false;
    }
}

// Populate Clips Folder Dropdown from settings.json
async function loadClipsFolders() {
    const dropdown = document.getElementById('merge-clips-dropdown');
    if (!dropdown) return;

    try {
        const res = await fetch('/api/config');
        const config = await res.json();
        const folders = config.clips_folders || [];

        // Clear loading option but keep Manual option
        dropdown.innerHTML = '<option value="">-- Pilih Folder Klip --</option>';

        folders.forEach(obj => {
            for (const [name, path] of Object.entries(obj)) {
                const opt = document.createElement('option');
                opt.value = path;
                opt.textContent = name + " (" + path + ")";
                dropdown.appendChild(opt);
            }
        });

        // Add Manual Entry at the end
        const manualOpt = document.createElement('option');
        manualOpt.value = 'manual';
        manualOpt.textContent = 'Manual Entry...';
        dropdown.appendChild(manualOpt);

    } catch (e) {
        console.error("Failed to load clips folders", e);
        dropdown.innerHTML = '<option value="">-- Gagal memuat folder, gunakan manual --</option>';
        const manualOpt = document.createElement('option');
        manualOpt.value = 'manual';
        manualOpt.textContent = 'Manual Entry...';
        dropdown.appendChild(manualOpt);
    }
}

// 3. Hooks - Timing Toggle Function
function toggleHooksTimingInput() {
    const modeSelect = document.getElementById('hooks-timing-mode');
    const timingInput = document.getElementById('hooks-timing-input');

    if (modeSelect && timingInput) {
        if (modeSelect.value === 'custom') {
            timingInput.classList.remove('hidden');
        } else {
            timingInput.classList.add('hidden');
        }
    }
}

// All-In-One Hook Timing Toggle Function
function toggleAioHooksTimingInput() {
    const modeSelect = document.getElementById('aio-hook-timing-mode');
    const timingInput = document.getElementById('aio-hook-timing-input');

    if (modeSelect && timingInput) {
        if (modeSelect.value === 'custom') {
            timingInput.style.display = 'block';
        } else {
            timingInput.style.display = 'none';
        }
    }
}

// 3. Hooks Form Handler
document.getElementById('hooks-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    const f = new FormData(e.target);
    const data = Object.fromEntries(f.entries());

    // Checkbox boolean coercion
    data.useCaptions = document.getElementById('hooks-useCaptions') ? document.getElementById('hooks-useCaptions').checked : false;

    // Parse hook timing
    data.hookTimingMode = data.hookTimingMode || 'full';
    if (data.hookTimingMode === 'custom' && data.hookTiming) {
        const [start, duration] = data.hookTiming.split(',').map(s => parseFloat(s.trim()));
        data.hookStartTime = start;
        data.hookDuration = duration;
    } else {
        data.hookStartTime = null;
        data.hookDuration = null;
    }
    delete data.hookTiming; // Remove raw input

    // apiKey di-handle oleh server dari settings.json (multi-key)
    delete data.apiKey;

    await sendCommand('/api/run/hooks', data);
});

// 4. Subtitle AI
const subtitleForm = document.getElementById('subtitle-form');
if (subtitleForm) {
    subtitleForm.addEventListener('submit', async (e) => {
        e.preventDefault();
        const f = new FormData(e.target);
        const data = Object.fromEntries(f.entries());

        await sendCommand('/api/run/subtitle', data);
    });
}

// --- BRAND MANAGER LOGIC ---
let brandsData = [];

async function loadBrandsForManager() {
    try {
        const res = await fetch('/api/brands');
        brandsData = await res.json();
        renderBrandTable();
    } catch (e) {
        // Mock data fallback if API fails
        if (brandsData.length === 0) {
            brandsData = [
                { name: 'Rizumiya', hooks: 'relatable moments', captionRule: '#jajandisolo' }
            ];
        }
        renderBrandTable();
    }
}

// --- REPLIZ ACCOUNT MANAGER LOGIC ---
let replizIds = [];
let editingReplizIndex = null;
let editingBrandIndex = null;
let replizDirty = false;

function setReplizSaveState(mode, text) {
    const el = document.getElementById('repliz-save-status');
    if (!el) return;

    el.classList.remove('settings-status-unsaved', 'settings-status-saved', 'settings-status-default');
    if (mode) {
        el.classList.add(`settings-status-${mode}`);
    }
    el.textContent = text;
}

function setReplizEditorState(isEditing) {
    const submitBtn = document.getElementById('repliz-submit-btn');
    const cancelBtn = document.getElementById('repliz-cancel-btn');
    if (submitBtn) {
        submitBtn.innerHTML = isEditing
            ? '<i class="fas fa-save"></i> Simpan Perubahan'
            : '<i class="fas fa-plus"></i> Tambah Akun';
    }
    if (cancelBtn) {
        cancelBtn.classList.toggle('hidden', !isEditing);
    }
}

function setBrandEditorState(isEditing) {
    const submitBtn = document.getElementById('brand-submit-btn');
    const cancelBtn = document.getElementById('brand-cancel-btn');
    if (submitBtn) {
        submitBtn.innerHTML = isEditing
            ? '<i class="fas fa-save"></i> Simpan Perubahan Brand'
            : '<i class="fas fa-plus"></i> Tambah ke List';
    }
    if (cancelBtn) {
        cancelBtn.classList.toggle('hidden', !isEditing);
    }
}

function ensureBrandModeOptions() {
    const modeSelect = document.getElementById('new-brand-mode');
    if (!modeSelect) return;

    const requiredOptions = [
        { value: 'standard', label: 'Standard' },
        { value: 'bisnis', label: 'Bisnis' },
        { value: 'story', label: 'Story' },
        { value: 'edukasi_bisnis', label: 'Edukasi Bisnis' }
    ];

    requiredOptions.forEach((optionConfig) => {
        const exists = Array.from(modeSelect.options).some((option) => option.value === optionConfig.value);
        if (!exists) {
            const option = document.createElement('option');
            option.value = optionConfig.value;
            option.textContent = optionConfig.label;
            modeSelect.appendChild(option);
        }
    });
}

function getSelectedReplizAccountIds(containerId) {
    const container = document.getElementById(containerId);
    if (!container) return [];
    return Array.from(container.querySelectorAll('input[type="checkbox"]:checked'))
        .map((el) => el.value)
        .filter(Boolean);
}

function renderReplizAccountPicker(containerId) {
    const container = document.getElementById(containerId);
    if (!container) return;

    container.innerHTML = '';
    if (replizIds.length === 0) {
        container.innerHTML = `<div style="color:var(--text-muted); font-style:italic;">Belum ada akun Repliz di Settings.</div>`;
        return;
    }

    replizIds.forEach((entry, index) => {
        const id = entry && typeof entry === 'object' ? entry.id : String(entry);
        const name = entry && typeof entry === 'object' ? entry.name : '';
        const item = document.createElement('label');
        item.style.display = 'flex';
        item.style.alignItems = 'center';
        item.style.gap = '10px';
        item.style.padding = '10px 8px';
        item.style.borderBottom = index < replizIds.length - 1 ? '1px solid rgba(148, 163, 184, 0.12)' : 'none';
        item.innerHTML = `
            <input type="checkbox" value="${id}" style="width: 16px; height: 16px;">
            <div>
                <div style="font-weight: 600; color: white;">${name || 'Tanpa Nama'}</div>
                <div style="font-size: 0.85rem; color: var(--text-muted);">${id}</div>
            </div>
        `;
        container.appendChild(item);
    });

    container.querySelectorAll('input[type="checkbox"]').forEach((checkbox) => {
        checkbox.addEventListener('change', () => {
            const selected = container.querySelectorAll('input[type="checkbox"]:checked');
            if (selected.length > 3) {
                checkbox.checked = false;
                showToast('Maksimal pilih 3 akun Repliz.');
            }
        });
    });
}

async function loadReplizAccounts() {
    try {
        const res = await fetch('/api/config');
        const config = await res.json();
        populateSubtitleAiSettings(config.subtitle_ai);
        syncSavedSubtitleAiSettings(config.subtitle_ai, 'saved', 'Tersimpan');
        const raw = Array.isArray(config.repliz_account_id)
            ? config.repliz_account_id
            : (config.repliz_account_id ? [config.repliz_account_id] : []);
        // Normalize: legacy plain strings become {name: '', id: string}
        replizIds = raw.map(entry =>
            (typeof entry === 'object' && entry !== null) ? entry : { name: '', id: String(entry) }
        );
        renderReplizList();
        renderReplizAccountPicker('aio-repliz-account-list');
        renderReplizAccountPicker('upload-repliz-account-list');
        replizDirty = false;
        setReplizSaveState('saved', 'Tersimpan');

        // Load Gemini API Key ke textarea (handle array or string)
        const geminiTextarea = document.getElementById('settings-gemini-key');
        if (geminiTextarea && config.gemini_api_key) {
            const raw = config.gemini_api_key;
            geminiTextarea.value = Array.isArray(raw) ? raw.join('\n') : String(raw);
        }

        // Load TikTok TTS settings
        const tiktokSessionInput = document.getElementById('settings-tiktok-session');
        const tiktokVoiceSelect = document.getElementById('settings-tiktok-voice');
        if (tiktokSessionInput && config.tiktok_session_id) {
            tiktokSessionInput.value = config.tiktok_session_id;
        }
        if (tiktokVoiceSelect && config.tiktok_voice) {
            tiktokVoiceSelect.value = config.tiktok_voice;
        }
    } catch (e) {
        console.error("Failed to load repliz accounts", e);
    }
}

window.saveGeminiKey = async function () {
    const textarea = document.getElementById('settings-gemini-key');
    if (!textarea) return;
    // Store as array: split by newline, trim, filter empty
    const keys = textarea.value.split('\n').map(k => k.trim()).filter(Boolean);
    try {
        const res = await fetch('/api/settings', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ gemini_api_key: keys })
        });
        if (res.ok) {
            showToast('✅ ' + keys.length + ' API Key berhasil disimpan!');
        } else {
            showToast('❌ Gagal menyimpan API Key.');
        }
    } catch (e) {
        showToast('❌ Error: ' + e.message);
    }
};

window.saveTikTokSettings = async function () {
    const sessionInput = document.getElementById('settings-tiktok-session');
    const voiceSelect = document.getElementById('settings-tiktok-voice');
    if (!sessionInput) return;
    const sessionId = sessionInput.value.trim();
    const voice = voiceSelect ? voiceSelect.value : 'id_001';
    try {
        const res = await fetch('/api/settings', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ tiktok_session_id: sessionId, tiktok_voice: voice })
        });
        if (res.ok) {
            showToast('✅ TikTok TTS settings berhasil disimpan!');
        } else {
            showToast('❌ Gagal menyimpan TikTok settings.');
        }
    } catch (e) {
        showToast('❌ Error: ' + e.message);
    }
};

window.saveSpreadsheetSettings = async function () {
    const input = document.getElementById('settings-spreadsheet-webhook');
    if (!input) return;
    try {
        const res = await fetch('/api/settings', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ spreadsheet_webhook_url: input.value.trim() })
        });
        if (res.ok) {
            showToast('Spreadsheet webhook berhasil disimpan.');
        } else {
            showToast('Gagal menyimpan spreadsheet webhook.');
        }
    } catch (e) {
        showToast('Error: ' + e.message);
    }
};

window.saveSubtitleAiSettings = async function () {
    const payload = {
        subtitle_ai: getSubtitleAiSettingsFromForm()
    };

    try {
        const res = await fetch('/api/settings', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(payload)
        });
        if (res.ok) {
            syncSavedSubtitleAiSettings(payload.subtitle_ai, 'saved', 'Tersimpan');
            showToast('Pengaturan subtitle AI berhasil disimpan.');
        } else {
            showToast('Gagal menyimpan pengaturan subtitle AI.');
        }
    } catch (e) {
        showToast('Error: ' + e.message);
    }
};

window.resetSubtitleAiSettings = async function () {
    populateSubtitleAiSettings(defaultSubtitleAiSettings);
    setSubtitleAiStatus('default', 'Default aktif');

    try {
        const res = await fetch('/api/settings', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ subtitle_ai: defaultSubtitleAiSettings })
        });
        if (res.ok) {
            syncSavedSubtitleAiSettings(defaultSubtitleAiSettings, 'default', 'Default aktif');
            showToast('Pengaturan subtitle AI direset ke default.');
        } else {
            showToast('Gagal reset pengaturan subtitle AI.');
        }
    } catch (e) {
        showToast('Error: ' + e.message);
    }
};

function renderReplizList() {
    const list = document.getElementById('repliz-id-list');
    if (!list) return;
    list.innerHTML = '';

    if (replizIds.length === 0) {
        list.innerHTML = `<li style="padding: 20px; text-align: center; color: var(--text-muted); font-style: italic;">Belum ada akun Repliz yang ditambahkan.</li>`;
        return;
    }

    replizIds.forEach((entry, index) => {
        const name = entry.name || '';
        const id = entry.id || String(entry);
        const li = document.createElement('li');
        li.className = 'account-item';
        li.innerHTML = `
            <div class="account-info">
                <i class="fas fa-user-circle"></i>
                ${name ? `<span class="account-name-badge">${name}</span>` : ''}
                <span class="account-id-text">ID: ${id}</span>
            </div>
            <div style="display:flex; gap:8px;">
                <button class="btn-secondary btn-danger-sm" onclick="editReplizAccount(${index})" title="Edit Akun">
                    <i class="fas fa-pen"></i>
                </button>
                <button class="btn-danger-sm" onclick="deleteReplizAccount(${index})" title="Hapus Akun">
                    <i class="fas fa-trash"></i>
                </button>
            </div>
        `;
        list.appendChild(li);
    });
}

window.addReplizAccount = async function () {
    const nameInput = document.getElementById('new-repliz-name');
    const input = document.getElementById('new-repliz-id');
    const name = nameInput ? nameInput.value.trim() : '';
    const val = input.value.trim();
    if (!val) return alert("ID tidak boleh kosong!");
    if (replizIds.some((e, idx) => idx !== editingReplizIndex && (e.id || String(e)) === val)) return alert("ID sudah ada!");

    if (editingReplizIndex !== null) {
        replizIds[editingReplizIndex] = { name, id: val };
    } else {
        replizIds.push({ name, id: val });
    }
    input.value = '';
    if (nameInput) nameInput.value = '';
    editingReplizIndex = null;
    setReplizEditorState(false);
    renderReplizList();
    renderReplizAccountPicker('aio-repliz-account-list');
    renderReplizAccountPicker('upload-repliz-account-list');
    replizDirty = true;
    setReplizSaveState('unsaved', 'Belum disimpan');
};

window.editReplizAccount = function (index) {
    const entry = replizIds[index];
    const nameInput = document.getElementById('new-repliz-name');
    const input = document.getElementById('new-repliz-id');
    if (!entry || !input) return;

    if (nameInput) nameInput.value = entry.name || '';
    input.value = entry.id || String(entry);
    editingReplizIndex = index;
    setReplizEditorState(true);
};

window.cancelEditRepliz = function () {
    const nameInput = document.getElementById('new-repliz-name');
    const input = document.getElementById('new-repliz-id');
    if (nameInput) nameInput.value = '';
    if (input) input.value = '';
    editingReplizIndex = null;
    setReplizEditorState(false);
};

window.deleteReplizAccount = async function (index) {
    if (confirm("Hapus ID ini dari daftar rotasi?")) {
        replizIds.splice(index, 1);
        renderReplizList();
        renderReplizAccountPicker('aio-repliz-account-list');
        renderReplizAccountPicker('upload-repliz-account-list');
        replizDirty = true;
        setReplizSaveState('unsaved', 'Belum disimpan');
    }
};

window.saveReplizAccounts = async function () {
    await saveReplizSettings();
};

async function saveReplizSettings() {
    try {
        const res = await fetch('/api/settings', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ repliz_account_id: replizIds })
        });
        if (!res.ok) {
            throw new Error('HTTP ' + res.status);
        }
        replizDirty = false;
        setReplizSaveState('saved', 'Tersimpan');
        showToast('Daftar akun Repliz berhasil disimpan.');
    } catch (e) {
        console.error("Failed to save settings", e);
        setReplizSaveState('unsaved', 'Gagal disimpan');
        alert("Gagal menyimpan settings!");
    }
}

function renderBrandTable() {
    const tbody = document.getElementById('brand-list');
    tbody.innerHTML = '';

    const modeBadge = {
        standard: '<span class="mode-badge mode-standard">Standard</span>',
        bisnis: '<span class="mode-badge mode-bisnis">Bisnis</span>',
        story: '<span class="mode-badge mode-story">Story</span>',
        edukasi_bisnis: '<span class="mode-badge mode-story" style="background: rgba(168, 85, 247, 0.2); color: #d8b4fe; border-color: rgba(168, 85, 247, 0.3);">Edukasi Bisnis</span>'
    };

    brandsData.forEach((b, index) => {
        const hooksPreview = b.hooks ? (b.hooks.substring(0, 40) + (b.hooks.length > 40 ? '...' : '')) : '<span style="color:var(--text-muted); font-style:italic;">(General Topic)</span>';
        const captionPreview = b.captionRule ? (b.captionRule.substring(0, 40) + (b.captionRule.length > 40 ? '...' : '')) : '<span style="color:var(--text-muted); font-style:italic;">(Caption rules)</span>';
        const mode = b.captionMode || 'standard';
        const badge = modeBadge[mode] || modeBadge.standard;

        const tr = document.createElement('tr');
        tr.innerHTML = `
            <td>#${index + 1}</td>
            <td style="font-weight:600; color:white;">${b.name}</td>
            <td class="text-center">${badge}</td>
            <td style="color:var(--text-muted); font-size:0.9rem;">${hooksPreview}</td>
            <td style="color:var(--text-muted); font-size:0.9rem;">${captionPreview}</td>
            <td class="text-center">
                <div style="display:flex; gap:8px; justify-content:center;">
                    <button class="btn-secondary btn-danger-sm" onclick="editBrand(${index})" title="Edit Brand">
                        <i class="fas fa-pen"></i>
                    </button>
                    <button class="btn-secondary btn-danger-sm" onclick="deleteBrand(${index})" title="Hapus Brand">
                        <i class="fas fa-trash"></i>
                    </button>
                </div>
            </td>
        `;
        tbody.appendChild(tr);
    });
}

window.addBrand = function () {
    const nameInput = document.getElementById('new-brand-name');
    const hooksInput = document.getElementById('NewBrandHooks');
    const captionRuleInput = document.getElementById('NewBrandCaptionRule');
    const modeSelect = document.getElementById('new-brand-mode');
    const storyFileInput = document.getElementById('new-brand-story-file');

    const name = nameInput.value.trim();
    const hooks = hooksInput ? hooksInput.value.trim() : '';
    const captionRule = captionRuleInput ? captionRuleInput.value.trim() : '';
    const captionMode = modeSelect ? modeSelect.value : 'standard';
    const storySourceFile = (captionMode === 'story' && storyFileInput) ? storyFileInput.value.trim() : '';

    if (!name) {
        alert('Nama Brand tidak boleh kosong!');
        return;
    }

    if (editingBrandIndex !== null) {
        brandsData[editingBrandIndex] = { name, hooks, captionRule, captionMode, storySourceFile };
    } else {
        brandsData.push({ name, hooks, captionRule, captionMode, storySourceFile });
    }

    nameInput.value = '';
    if (hooksInput) hooksInput.value = '';
    if (captionRuleInput) captionRuleInput.value = '';
    if (modeSelect) modeSelect.value = 'standard';
    if (storyFileInput) storyFileInput.value = 'Resume atomic habit.txt';
    editingBrandIndex = null;
    setBrandEditorState(false);
    toggleStorySourceField(); // reset show/hide

    renderBrandTable();
};

window.editBrand = function (index) {
    const brand = brandsData[index];
    if (!brand) return;

    const nameInput = document.getElementById('new-brand-name');
    const hooksInput = document.getElementById('NewBrandHooks');
    const captionRuleInput = document.getElementById('NewBrandCaptionRule');
    const modeSelect = document.getElementById('new-brand-mode');
    const storyFileInput = document.getElementById('new-brand-story-file');

    if (nameInput) nameInput.value = brand.name || '';
    if (hooksInput) hooksInput.value = brand.hooks || '';
    if (captionRuleInput) captionRuleInput.value = brand.captionRule || '';
    if (modeSelect) modeSelect.value = brand.captionMode || 'standard';
    if (storyFileInput) storyFileInput.value = brand.storySourceFile || '';

    editingBrandIndex = index;
    setBrandEditorState(true);
    toggleStorySourceField();
};

window.cancelEditBrand = function () {
    const nameInput = document.getElementById('new-brand-name');
    const hooksInput = document.getElementById('NewBrandHooks');
    const captionRuleInput = document.getElementById('NewBrandCaptionRule');
    const modeSelect = document.getElementById('new-brand-mode');
    const storyFileInput = document.getElementById('new-brand-story-file');

    if (nameInput) nameInput.value = '';
    if (hooksInput) hooksInput.value = '';
    if (captionRuleInput) captionRuleInput.value = '';
    if (modeSelect) modeSelect.value = 'standard';
    if (storyFileInput) storyFileInput.value = 'Resume atomic habit.txt';

    editingBrandIndex = null;
    setBrandEditorState(false);
    toggleStorySourceField();
};

window.toggleStorySourceField = function () {
    const modeSelect = document.getElementById('new-brand-mode');
    const storyGroup = document.getElementById('story-source-group');
    if (modeSelect && storyGroup) {
        storyGroup.style.display = modeSelect.value === 'story' ? '' : 'none';
    }
};

window.deleteBrand = function (index) {
    if (confirm("Yakin ingin menghapus brand ini?")) {
        brandsData.splice(index, 1);
        renderBrandTable();
    }
};

window.saveBrands = async function () {
    try {
        const res = await fetch('/api/brands', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(brandsData)
        });

        const result = await res.json();
        if (result.success) {
            alert("Brands saved successfully!");
            loadConfig(); // Reload dropdowns
        } else {
            alert("Failed: " + result.error);
        }
    } catch (e) {
        // Fallback alert for demo
        alert("Simulasi: Data berhasil disimpan (lokal).");
        loadConfig();
    }
};

window.saveAioDefaults = async function () {
    const payload = {
        aio_defaults: {
            multicut: {
                maxClips: parseInt(document.getElementById('def-mc-maxClips').value) || 5,
                clipDuration: parseFloat(document.getElementById('def-mc-clipDuration').value) || 2,
                trimStart: document.getElementById('def-mc-trimStart').value.trim(),
                trimEnd: document.getElementById('def-mc-trimEnd').value.trim()
            },
            merge: {
                finalCount: parseInt(document.getElementById('def-merge-finalCount').value) || 3,
                maxPerSource: parseInt(document.getElementById('def-merge-maxPerSource').value) || 2,
                maxSources: parseInt(document.getElementById('def-merge-maxSources').value) || 0,
                finalDurationSec: parseInt(document.getElementById('def-merge-finalDuration').value) || 17,
                mode: document.getElementById('def-merge-mode').value || 'random'
            }
        }
    };

    try {
        const res = await fetch('/api/settings/aio', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(payload)
        });
        const result = await res.json();
        if (result.success) {
            alert("Default All-In-One settings saved!");
        } else {
            alert("Gagal menyimpan: " + result.error);
        }
    } catch (e) {
        alert("Server error.");
    }
};

// Initial Load (One loader for everything)
loadConfig();

// Helper to reload all config-dependent UI
async function loadConfig() {
    // 1. Load basic components
    await loadBrandsForManager();
    await loadReplizAccounts();
    await loadClipsFolders();

    // 2. Load Brand Dropdowns (Original logic from line 224)
    try {
        const timestamp = new Date().getTime();
        const res = await fetch(`/api/config?t=${timestamp}`);
        const config = await res.json();
        const brandsRes = await fetch(`/api/brands?t=${timestamp}`);
        const brands = await brandsRes.json();
        const finalBrands = (config.brands && config.brands.length > 0) ? config.brands : brands;

        const geminiTextarea = document.getElementById('settings-gemini-key');
        if (geminiTextarea && config.gemini_api_key) {
            const raw = config.gemini_api_key;
            geminiTextarea.value = Array.isArray(raw) ? raw.join('\n') : String(raw);
        }
        const tiktokSession = document.getElementById('settings-tiktok-session');
        if (tiktokSession) tiktokSession.value = config.tiktok_session_id || '';
        const tiktokVoice = document.getElementById('settings-tiktok-voice');
        if (tiktokVoice && config.tiktok_voice) tiktokVoice.value = config.tiktok_voice;
        const spreadsheetWebhook = document.getElementById('settings-spreadsheet-webhook');
        if (spreadsheetWebhook) spreadsheetWebhook.value = config.spreadsheet_webhook_url || '';

        const selects = document.querySelectorAll('.brand-select');
        selects.forEach(select => {
            const currentVal = select.value;
            select.innerHTML = '<option value="">-- No Brand Specific --</option>';
            if (finalBrands && finalBrands.length > 0) {
                finalBrands.forEach((b, index) => {
                    const opt = document.createElement('option');
                    opt.value = index;
                    opt.textContent = `${b.name}`;
                    select.appendChild(opt);
                });
            }
            if (currentVal && finalBrands[currentVal]) select.value = currentVal;

            if (!select.dataset.ctxBound) {
                select.addEventListener('change', function () {
                    let contextId = null;
                    let placeholderText = "";

                    if (this.name === 'brandIndex') {
                        contextId = this.closest('#all-in-one-form') ? 'merge-hook-context' : 'hooks-context';
                        placeholderText = "e.g. 'Fitness Tips' or 'Gaming Highlights'";
                    } else if (this.name === 'captionBrandIndex') {
                        contextId = this.closest('#all-in-one-form') ? 'merge-caption-context' : 'repliz-caption-context';
                        placeholderText = "Konteks caption jika beda dari hook";
                    }

                    if (!contextId) return;
                    const ctxInput = document.getElementById(contextId);
                    if (!ctxInput) return;

                    if (this.value !== "") {
                        ctxInput.value = "";
                        ctxInput.placeholder = "(Using Brand Rules... Input Disabled)";
                        ctxInput.disabled = true;
                        ctxInput.style.backgroundColor = "rgba(0,0,0,0.5)";
                        ctxInput.style.opacity = "0.5";
                    } else {
                        ctxInput.placeholder = placeholderText;
                        ctxInput.disabled = false;
                        ctxInput.style.backgroundColor = "";
                        ctxInput.style.opacity = "1";
                    }
                });
                select.dataset.ctxBound = "1";
            }
            select.dispatchEvent(new Event('change'));
        });

        // Load AIO defaults
        if (config.aio_defaults) {
            const mc = config.aio_defaults.multicut || {};
            const mg = config.aio_defaults.merge || {};

            if (mc.maxClips) document.getElementById('def-mc-maxClips').value = mc.maxClips;
            if (mc.clipDuration) document.getElementById('def-mc-clipDuration').value = mc.clipDuration;
            if (mc.trimStart !== undefined) document.getElementById('def-mc-trimStart').value = mc.trimStart;
            if (mc.trimEnd !== undefined) document.getElementById('def-mc-trimEnd').value = mc.trimEnd;

            if (mg.finalCount) document.getElementById('def-merge-finalCount').value = mg.finalCount;
            if (mg.maxPerSource) document.getElementById('def-merge-maxPerSource').value = mg.maxPerSource;
            if (mg.maxSources !== undefined) document.getElementById('def-merge-maxSources').value = mg.maxSources;
            if (mg.finalDurationSec) {
                document.getElementById('def-merge-finalDuration').value = mg.finalDurationSec;
                document.getElementById('def-merge-finalDuration-display').textContent = `${mg.finalDurationSec} detik`;
            }
            if (mg.mode) document.getElementById('def-merge-mode').value = mg.mode;
        }

    } catch (e) { console.error("Master loadConfig fail:", e); }
}

// --- AUTO-FILL TANGGAL HARI INI pada semua date input ---
(function setDefaultDates() {
    const today = new Date().toISOString().split('T')[0]; // "YYYY-MM-DD"
    document.querySelectorAll('input[type="date"]').forEach(input => {
        if (!input.value) input.value = today;
    });
})();
