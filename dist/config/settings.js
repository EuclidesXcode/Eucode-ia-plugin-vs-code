"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.loadSettings = loadSettings;
exports.saveSettings = saveSettings;
exports.buildApiEndpoint = buildApiEndpoint;
exports.buildAuthHeader = buildAuthHeader;
const DEFAULTS = {
    provider: 'lmstudio',
    apiHost: 'http://localhost:1234',
    apiKey: '',
    model: '',
};
const KEYS = {
    provider: 'eucode.provider',
    apiHost: 'eucode.apiHost',
    apiKey: 'eucode.apiKey',
    model: 'eucode.model',
};
function loadSettings(context) {
    return {
        provider: context.globalState.get(KEYS.provider) ?? DEFAULTS.provider,
        apiHost: context.globalState.get(KEYS.apiHost) ?? DEFAULTS.apiHost,
        apiKey: context.globalState.get(KEYS.apiKey) ?? DEFAULTS.apiKey,
        model: context.globalState.get(KEYS.model) ?? DEFAULTS.model,
    };
}
async function saveSettings(context, settings) {
    await context.globalState.update(KEYS.provider, settings.provider);
    await context.globalState.update(KEYS.apiHost, settings.apiHost.replace(/\/+$/, ''));
    await context.globalState.update(KEYS.apiKey, settings.apiKey);
    await context.globalState.update(KEYS.model, settings.model.trim());
}
function buildApiEndpoint(settings) {
    return `${settings.apiHost}/v1/chat/completions`;
}
function buildAuthHeader(settings) {
    if (settings.apiKey) {
        return { Authorization: `Bearer ${settings.apiKey}` };
    }
    if (settings.provider === 'anthropic') {
        return { Authorization: 'Bearer ollama' };
    }
    return {};
}
