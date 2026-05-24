"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.loadSettings = loadSettings;
exports.saveSettings = saveSettings;
exports.buildApiEndpoint = buildApiEndpoint;
const KEY_HOST = 'eucode.apiHost';
const DEFAULT_HOST = 'http://localhost:1234';
function loadSettings(context) {
    return {
        apiHost: context.globalState.get(KEY_HOST) ?? DEFAULT_HOST,
    };
}
async function saveSettings(context, settings) {
    await context.globalState.update(KEY_HOST, settings.apiHost.replace(/\/+$/, ''));
}
function buildApiEndpoint(settings) {
    return `${settings.apiHost}/v1/chat/completions`;
}
