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
};
const KEYS = {
    provider: 'eucode.provider',
    apiHost: 'eucode.apiHost',
    apiKey: 'eucode.apiKey',
};
function loadSettings(context) {
    return {
        provider: context.globalState.get(KEYS.provider) ?? DEFAULTS.provider,
        apiHost: context.globalState.get(KEYS.apiHost) ?? DEFAULTS.apiHost,
        apiKey: context.globalState.get(KEYS.apiKey) ?? DEFAULTS.apiKey,
    };
}
async function saveSettings(context, settings) {
    await context.globalState.update(KEYS.provider, settings.provider);
    await context.globalState.update(KEYS.apiHost, settings.apiHost.replace(/\/+$/, ''));
    await context.globalState.update(KEYS.apiKey, settings.apiKey);
}
function buildApiEndpoint(settings) {
    return `${settings.apiHost}/v1/chat/completions`;
}
function buildAuthHeader(settings) {
    if (settings.apiKey) {
        return { Authorization: `Bearer ${settings.apiKey}` };
    }
    // Anthropic sem key explícita ainda precisa do header para não rejeitar
    if (settings.provider === 'anthropic') {
        return { Authorization: 'Bearer ollama' };
    }
    return {};
}
