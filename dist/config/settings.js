"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.DEFAULT_ANTHROPIC_MODEL = exports.ALL_TOOL_NAMES = exports.DEFAULT_SUPPORT_MODELS = void 0;
exports.loadSettings = loadSettings;
exports.saveSettings = saveSettings;
exports.buildApiEndpoint = buildApiEndpoint;
exports.buildAuthHeader = buildAuthHeader;
exports.DEFAULT_SUPPORT_MODELS = {
    anthropic: 'claude-sonnet-4-6',
    openai: 'gpt-4o',
    gemini: 'gemini-2.0-flash-exp',
};
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
    'memory_remember',
    'memory_read',
];
const DEFAULTS = {
    provider: 'lmstudio',
    apiHost: 'http://localhost:1234',
    apiKey: '',
    model: '',
    enabledTools: [...exports.ALL_TOOL_NAMES],
    ragEnabled: false,
    ragEndpoint: 'http://localhost:8000',
    ragCollection: 'eucode',
    hybridEnabled: false,
    supportProvider: 'anthropic',
    supportApiKey: '',
    supportModel: '',
    inlineCompletionEnabled: false,
    fixWithEucodeEnabled: false,
    customCommandsScope: 'workspace',
    hybridIntensity: 50,
    projectIntelEnabled: true,
    jarvisEnabled: false,
    jarvisAutoSpeak: true,
    jarvisTtsVoice: '',
    jarvisTtsRate: 1.0,
    voiceServerEnabled: false,
    voiceServerPort: 9876,
    voiceServerExposeNetwork: false,
    voicePairingToken: '',
    whisperEndpoint: 'http://localhost:1234',
    whisperModel: 'whisper-1',
    whisperLanguage: 'pt',
    micDeviceIndex: '',
};
const KEYS = {
    provider: 'eucode.provider',
    apiHost: 'eucode.apiHost',
    apiKey: 'eucode.apiKey',
    model: 'eucode.model',
    enabledTools: 'eucode.enabledTools',
    ragEnabled: 'eucode.ragEnabled',
    ragEndpoint: 'eucode.ragEndpoint',
    ragCollection: 'eucode.ragCollection',
    hybridEnabled: 'eucode.hybridEnabled',
    supportProvider: 'eucode.supportProvider',
    supportApiKey: 'eucode.supportApiKey',
    supportModel: 'eucode.supportModel',
    inlineCompletionEnabled: 'eucode.inlineCompletionEnabled',
    fixWithEucodeEnabled: 'eucode.fixWithEucodeEnabled',
    customCommandsScope: 'eucode.customCommandsScope',
    hybridIntensity: 'eucode.hybridIntensity',
    projectIntelEnabled: 'eucode.projectIntelEnabled',
    jarvisEnabled: 'eucode.jarvisEnabled',
    jarvisAutoSpeak: 'eucode.jarvisAutoSpeak',
    jarvisTtsVoice: 'eucode.jarvisTtsVoice',
    jarvisTtsRate: 'eucode.jarvisTtsRate',
    voiceServerEnabled: 'eucode.voiceServerEnabled',
    voiceServerPort: 'eucode.voiceServerPort',
    voiceServerExposeNetwork: 'eucode.voiceServerExposeNetwork',
    voicePairingToken: 'eucode.voicePairingToken',
    whisperEndpoint: 'eucode.whisperEndpoint',
    whisperModel: 'eucode.whisperModel',
    whisperLanguage: 'eucode.whisperLanguage',
    micDeviceIndex: 'eucode.micDeviceIndex',
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
        ragEnabled: context.globalState.get(KEYS.ragEnabled) ?? DEFAULTS.ragEnabled,
        ragEndpoint: context.globalState.get(KEYS.ragEndpoint) ?? DEFAULTS.ragEndpoint,
        ragCollection: context.globalState.get(KEYS.ragCollection) ?? DEFAULTS.ragCollection,
        hybridEnabled: context.globalState.get(KEYS.hybridEnabled) ?? DEFAULTS.hybridEnabled,
        supportProvider: context.globalState.get(KEYS.supportProvider) ?? DEFAULTS.supportProvider,
        supportApiKey: context.globalState.get(KEYS.supportApiKey) ?? DEFAULTS.supportApiKey,
        supportModel: context.globalState.get(KEYS.supportModel) ?? DEFAULTS.supportModel,
        inlineCompletionEnabled: context.globalState.get(KEYS.inlineCompletionEnabled) ?? DEFAULTS.inlineCompletionEnabled,
        fixWithEucodeEnabled: context.globalState.get(KEYS.fixWithEucodeEnabled) ?? DEFAULTS.fixWithEucodeEnabled,
        customCommandsScope: context.globalState.get(KEYS.customCommandsScope) ?? DEFAULTS.customCommandsScope,
        hybridIntensity: (context.globalState.get(KEYS.hybridIntensity) ?? DEFAULTS.hybridIntensity),
        projectIntelEnabled: context.globalState.get(KEYS.projectIntelEnabled) ?? DEFAULTS.projectIntelEnabled,
        jarvisEnabled: context.globalState.get(KEYS.jarvisEnabled) ?? DEFAULTS.jarvisEnabled,
        jarvisAutoSpeak: context.globalState.get(KEYS.jarvisAutoSpeak) ?? DEFAULTS.jarvisAutoSpeak,
        jarvisTtsVoice: context.globalState.get(KEYS.jarvisTtsVoice) ?? DEFAULTS.jarvisTtsVoice,
        jarvisTtsRate: context.globalState.get(KEYS.jarvisTtsRate) ?? DEFAULTS.jarvisTtsRate,
        voiceServerEnabled: context.globalState.get(KEYS.voiceServerEnabled) ?? DEFAULTS.voiceServerEnabled,
        voiceServerPort: context.globalState.get(KEYS.voiceServerPort) ?? DEFAULTS.voiceServerPort,
        voiceServerExposeNetwork: context.globalState.get(KEYS.voiceServerExposeNetwork) ?? DEFAULTS.voiceServerExposeNetwork,
        voicePairingToken: context.globalState.get(KEYS.voicePairingToken) ?? DEFAULTS.voicePairingToken,
        whisperEndpoint: context.globalState.get(KEYS.whisperEndpoint) ?? DEFAULTS.whisperEndpoint,
        whisperModel: context.globalState.get(KEYS.whisperModel) ?? DEFAULTS.whisperModel,
        whisperLanguage: context.globalState.get(KEYS.whisperLanguage) ?? DEFAULTS.whisperLanguage,
        micDeviceIndex: context.globalState.get(KEYS.micDeviceIndex) ?? DEFAULTS.micDeviceIndex,
    };
}
async function saveSettings(context, settings) {
    await context.globalState.update(KEYS.provider, settings.provider);
    await context.globalState.update(KEYS.apiHost, settings.apiHost.replace(/\/+$/, ''));
    await context.globalState.update(KEYS.apiKey, settings.apiKey);
    await context.globalState.update(KEYS.model, settings.model.trim());
    await context.globalState.update(KEYS.enabledTools, settings.enabledTools);
    await context.globalState.update(KEYS.ragEnabled, settings.ragEnabled);
    await context.globalState.update(KEYS.ragEndpoint, settings.ragEndpoint.replace(/\/+$/, ''));
    await context.globalState.update(KEYS.ragCollection, settings.ragCollection.trim());
    await context.globalState.update(KEYS.hybridEnabled, settings.hybridEnabled);
    await context.globalState.update(KEYS.supportProvider, settings.supportProvider);
    await context.globalState.update(KEYS.supportApiKey, settings.supportApiKey);
    await context.globalState.update(KEYS.supportModel, settings.supportModel.trim());
    await context.globalState.update(KEYS.inlineCompletionEnabled, settings.inlineCompletionEnabled);
    await context.globalState.update(KEYS.fixWithEucodeEnabled, settings.fixWithEucodeEnabled);
    await context.globalState.update(KEYS.customCommandsScope, settings.customCommandsScope);
    await context.globalState.update(KEYS.hybridIntensity, settings.hybridIntensity);
    await context.globalState.update(KEYS.projectIntelEnabled, settings.projectIntelEnabled);
    await context.globalState.update(KEYS.jarvisEnabled, settings.jarvisEnabled);
    await context.globalState.update(KEYS.jarvisAutoSpeak, settings.jarvisAutoSpeak);
    await context.globalState.update(KEYS.jarvisTtsVoice, settings.jarvisTtsVoice);
    await context.globalState.update(KEYS.jarvisTtsRate, settings.jarvisTtsRate);
    await context.globalState.update(KEYS.voiceServerEnabled, settings.voiceServerEnabled);
    await context.globalState.update(KEYS.voiceServerPort, settings.voiceServerPort);
    await context.globalState.update(KEYS.voiceServerExposeNetwork, settings.voiceServerExposeNetwork);
    await context.globalState.update(KEYS.voicePairingToken, settings.voicePairingToken);
    await context.globalState.update(KEYS.whisperEndpoint, settings.whisperEndpoint);
    await context.globalState.update(KEYS.whisperModel, settings.whisperModel);
    await context.globalState.update(KEYS.whisperLanguage, settings.whisperLanguage);
    await context.globalState.update(KEYS.micDeviceIndex, settings.micDeviceIndex);
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
