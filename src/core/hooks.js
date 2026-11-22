const chalk = require("chalk");

const registry = new Map();

/**
 * Register a lifecycle hook callback.
 * @param {string} name Hook name (e.g. 'afterMerge', 'afterMergeMedia')
 * @param {Function} fn Async or sync callback
 */
function registerHook(name, fn) {
    if (typeof fn !== "function") return;
    if (!registry.has(name)) {
        registry.set(name, []);
    }
    registry.get(name).push(fn);
}

/**
 * Run all callbacks registered for a hook sequentially.
 * Errors are logged and swallowed so core workflows don't crash.
 * @param {string} name
 * @param {object} payload
 */
async function runHooks(name, payload = {}) {
    const callbacks = registry.get(name);
    if (!callbacks || callbacks.length === 0) return;

    for (const fn of callbacks) {
        try {
            await fn(payload);
        } catch (err) {
            console.error(chalk.red(`❌ Hook "${name}" error: ${err.message}`));
        }
    }
}

function clearHooks() {
    registry.clear();
}

module.exports = {
    registerHook,
    runHooks,
    clearHooks
};
