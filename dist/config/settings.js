"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.DEFAULT_ANTHROPIC_MODEL = exports.ALL_TOOL_NAMES = void 0;
exports.loadSettings = loadSettings;
exports.saveSettings = saveSettings;
exports.buildApiEndpoint = buildApiEndpoint;
exports.buildAuthHeader = buildAuthHeader;
exports.ALL_TOOL_NAMES = [
    'list_directory',
    'read_local_file',
    'edit_file',
    'write_local_file',
    'search_in_workspace',
    'get_diagnostics',
    'todo_update',
    'run_command',
    'run_git',
    'web_search',
];
const DEFAULTS = {
    provider: 'lmstudio',
    apiHost: 'http://localhost:1234',
    apiKey: '',
    model: '',
    enabledTools: [...exports.ALL_TOOL_NAMES],
};
const KEYS = {
    provider: 'eucode.provider',
    apiHost: 'eucode.apiHost',
    apiKey: 'eucode.apiKey',
    model: 'eucode.model',
    enabledTools: 'eucode.enabledTools',
};
exports.DEFAULT_ANTHROPIC_MODEL = 'claude-sonnet-4-6';
function loadSettings(context) {
    const saved = context.globalState.get(KEYS.enabledTools);
    const enabledTools = saved
        ? saved.filter(t => exports.ALL_TOOL_NAMES.includes(t))
        : [...exports.ALL_TOOL_NAMES];
    return {
        provider: context.globalState.get(KEYS.provider) ?? DEFAULTS.provider,
        apiHost: context.globalState.get(KEYS.apiHost) ?? DEFAULTS.apiHost,
        apiKey: context.globalState.get(KEYS.apiKey) ?? DEFAULTS.apiKey,
        model: context.globalState.get(KEYS.model) ?? DEFAULTS.model,
        enabledTools,
    };
}
async function saveSettings(context, settings) {
    await context.globalState.update(KEYS.provider, settings.provider);
    await context.globalState.update(KEYS.apiHost, settings.apiHost.replace(/\/+$/, ''));
    await context.globalState.update(KEYS.apiKey, settings.apiKey);
    await context.globalState.update(KEYS.model, settings.model.trim());
    await context.globalState.update(KEYS.enabledTools, settings.enabledTools);
}
// Not used for Anthropic provider — Anthropic uses its own endpoint in api-client.ts
function buildApiEndpoint(settings) {
    return `${settings.apiHost}/v1/chat/completions`;
}
function buildAuthHeader(settings) {
    if (settings.provider === 'anthropic') {
        return {};
    }
    if (settings.apiKey) {
        return { Authorization: `Bearer ${settings.apiKey}` };
    }
    return {};
}
