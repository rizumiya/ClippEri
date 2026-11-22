const chalk = require("chalk");
const { exec } = require("child_process");
const { promisify } = require("util");
const { runCommand } = require("./shell");
const { getSettings } = require("./settings_manager");

const execPromise = promisify(exec);

const ENCODER_DEFINITIONS = [
    { id: "h264_qsv", label: "Intel Quick Sync (h264_qsv)" },
    { id: "h264_nvenc", label: "NVIDIA NVENC (h264_nvenc)" },
    { id: "h264_amf", label: "AMD AMF (h264_amf)" },
    { id: "libx264", label: "CPU Software (libx264)" }
];

const HW_PRIORITY = ["h264_qsv", "h264_nvenc", "h264_amf"];

let cachedDetection = null;

async function testEncoder(encoderName) {
    const cmd = `ffmpeg -hide_banner -loglevel error -f lavfi -i color=c=black:s=640x360:d=0.5 -c:v ${encoderName} -f null -`;
    try {
        await execPromise(cmd);
        return true;
    } catch {
        return false;
    }
}

/**
 * Detect which H.264 encoders work on this system and cache the result.
 */
async function detectEncoders(forceRefresh = false) {
    if (cachedDetection && !forceRefresh) {
        return cachedDetection;
    }

    const availability = { libx264: true };
    for (const enc of HW_PRIORITY) {
        availability[enc] = await testEncoder(enc);
    }

    const available = ENCODER_DEFINITIONS
        .filter(e => availability[e.id])
        .map(e => e.id);

    cachedDetection = {
        availability,
        available,
        encoders: ENCODER_DEFINITIONS.map(e => ({
            id: e.id,
            label: e.label,
            available: Boolean(availability[e.id])
        }))
    };

    return cachedDetection;
}

function buildArgsForEncoder(encoder, { quality = 23, preset = "fast" } = {}) {
    switch (encoder) {
        case "h264_qsv":
            return `-c:v h264_qsv -preset medium -global_quality ${quality} -look_ahead 0 -pix_fmt yuv420p`;
        case "h264_nvenc":
            return `-c:v h264_nvenc -preset p4 -cq ${quality} -pix_fmt yuv420p`;
        case "h264_amf":
            return `-c:v h264_amf -quality balanced -rc cqp -qp_i ${quality} -qp_p ${quality} -pix_fmt yuv420p`;
        case "libx264":
        default:
            return `-c:v libx264 -preset ${preset} -crf ${quality} -pix_fmt yuv420p`;
    }
}

async function resolveSelectedEncoder() {
    const settings = getSettings();
    const configured = String(settings.encoding?.videoEncoder || "auto").trim();
    const detection = await detectEncoders();

    if (configured !== "auto" && detection.availability[configured]) {
        return configured;
    }

    for (const hw of HW_PRIORITY) {
        if (detection.availability[hw]) {
            return hw;
        }
    }

    return "libx264";
}

/**
 * Return FFmpeg video encoding args string for the active encoder.
 */
async function getVideoEncodeArgs({ quality = 23, preset = "fast" } = {}) {
    const encoder = await resolveSelectedEncoder();
    return buildArgsForEncoder(encoder, { quality, preset });
}

/**
 * Run an FFmpeg encode command built by buildCmd(encodeArgs, encoderName),
 * falling back to libx264 if a hardware encoder fails at runtime.
 */
async function runEncode(buildCmd, { quality = 23, preset = "fast", showLog = false } = {}) {
    const encoder = await resolveSelectedEncoder();
    const args = buildArgsForEncoder(encoder, { quality, preset });

    try {
        return await runCommand(buildCmd(args, encoder), showLog);
    } catch (err) {
        if (encoder !== "libx264") {
            console.log(chalk.yellow(`⚠️ Encoder GPU (${encoder}) gagal (${err.message}), fallback ke CPU (libx264)...`));
            const cpuArgs = buildArgsForEncoder("libx264", { quality, preset });
            return await runCommand(buildCmd(cpuArgs, "libx264"), showLog);
        }
        throw err;
    }
}

async function getEncoderSummary() {
    const settings = getSettings();
    const detection = await detectEncoders();
    const selected = String(settings.encoding?.videoEncoder || "auto").trim();
    const active = await resolveSelectedEncoder();
    return {
        selected,
        active,
        available: detection.available,
        encoders: detection.encoders
    };
}

module.exports = {
    detectEncoders,
    getVideoEncodeArgs,
    buildArgsForEncoder,
    resolveSelectedEncoder,
    runEncode,
    getEncoderSummary
};
