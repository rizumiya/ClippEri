function splitIntoLines(captionWords, maxWordsPerLine, maxLines) {
    if (maxLines <= 1 || captionWords.length <= maxWordsPerLine) {
        return [captionWords];
    }
    if (maxLines === 2) {
        const firstCount = Math.min(maxWordsPerLine, Math.ceil(captionWords.length / 2));
        return [
            captionWords.slice(0, firstCount),
            captionWords.slice(firstCount)
        ].filter((line) => line.length > 0);
    }
    const lines = [];
    for (let i = 0; i < captionWords.length; i += maxWordsPerLine) {
        lines.push(captionWords.slice(i, i + maxWordsPerLine));
    }
    return lines;
}

export function groupWords(words = [], { maxWordsPerLine = 3, maxLines = 2, maxGapSec = 0.6 } = {}) {
    if (!Array.isArray(words) || words.length === 0) return [];

    const safeMaxWords = Math.max(1, Number(maxWordsPerLine) || 3);
    const safeMaxLines = Math.min(3, Math.max(1, Number(maxLines) || 2));
    const capacity = safeMaxWords * safeMaxLines;

    const captions = [];
    let current = [];

    const flush = () => {
        if (current.length === 0) return;
        const indexed = current.map((w, localIdx) => ({ ...w, localIdx }));
        const lines = splitIntoLines(indexed, safeMaxWords, safeMaxLines);
        captions.push({
            start: current[0].start,
            end: current[current.length - 1].end,
            words: indexed,
            lines
        });
        current = [];
    };

    for (let i = 0; i < words.length; i++) {
        const w = words[i];
        if (!w || !String(w.text || "").trim()) continue;

        if (current.length > 0) {
            const prev = current[current.length - 1];
            const gap = (Number(w.start) || 0) - (Number(prev.end) || 0);
            const endsSentence = /[.!?]$/.test(String(prev.text || "").trim());

            if (
                current.length >= capacity ||
                gap > maxGapSec ||
                (endsSentence && current.length >= safeMaxWords)
            ) {
                flush();
            }
        }
        current.push({ ...w, globalIdx: i });
    }
    flush();

    return captions;
}

/**
 * Find active caption and word state at playback currentTime (seconds).
 */
export function findActiveCaption(captions = [], currentTime = 0) {
    for (const cap of captions) {
        if (currentTime >= cap.start && currentTime <= cap.end + 0.08) {
            let activeLocalIdx = -1;
            for (let i = 0; i < cap.words.length; i++) {
                const w = cap.words[i];
                const nextW = cap.words[i + 1];
                const spanEnd = nextW ? nextW.start : cap.end + 0.08;
                if (currentTime >= w.start && currentTime < spanEnd) {
                    activeLocalIdx = i;
                    break;
                }
            }
            if (activeLocalIdx === -1 && currentTime >= cap.end) {
                activeLocalIdx = cap.words.length - 1;
            }
            return { caption: cap, activeLocalIdx };
        }
    }
    return { caption: null, activeLocalIdx: -1 };
}
