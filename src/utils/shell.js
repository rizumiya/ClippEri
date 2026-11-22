const { exec } = require("child_process");
const { promisify } = require("util");
const chalk = require("chalk");
const path = require("path");
const fs = require("fs/promises");
const config = require("../config");

const execPromise = promisify(exec);
const execOptions = {
    env: {
        ...process.env,
        PATH: `${config.paths.binDir}${path.delimiter}${process.env.PATH || ""}`
    }
};

async function runCommand(command, showLog = false) {
    if (showLog) {
        console.log(chalk.yellow(`\n▶️  Executing: ${command}`));
    }
    try {
        const { stdout, stderr } = await execPromise(command, execOptions);
        // if (stderr) {
        //     console.log(chalk.yellow(`Warning output: ${stderr}`));
        // }
        return stdout;
    } catch (error) {
        console.error(chalk.red.bold(`Error executing command: ${command}`));
        console.error(chalk.red(error.message));
        throw error;
    }
}

async function getToolCommand(toolName) {
    const localExe = path.join(config.paths.binDir, `${toolName}.exe`);
    try {
        await fs.access(localExe);
        return `"${localExe}"`;
    } catch {
        return toolName;
    }
}

async function checkDependencies() {
    const dependencies = ['ffmpeg', 'ffprobe', 'yt-dlp', 'mp4box'];
    const missing = [];

    for (const dep of dependencies) {
        try {
            const toolCmd = await getToolCommand(dep);
            let versionCmd = `${toolCmd} -version`;

            if (dep === 'yt-dlp') versionCmd = `${toolCmd} --version`;

            if (toolCmd.includes('bin')) {
                console.log(chalk.cyan(`ℹ️  Using local ${dep} from bin folder`));
            }

            await execPromise(versionCmd, execOptions);
            console.log(chalk.green(`✅ ${dep} is available`));
        } catch (error) {
            console.log(chalk.red(`❌ ${dep} is not available`));
            missing.push(dep);
        }
    }

    if (missing.length > 0) {
        console.log(chalk.red.bold(`\n⚠️  WARNING: Missing: ${missing.join(', ')}`));
    }
}

async function ensureDirectoryExists(dirPath) {
    try {
        await fs.mkdir(dirPath, { recursive: true });
    } catch (error) {
        if (error.code !== "EEXIST") throw error;
    }
}

module.exports = {
    runCommand,
    getToolCommand,
    checkDependencies,
    ensureDirectoryExists
};
