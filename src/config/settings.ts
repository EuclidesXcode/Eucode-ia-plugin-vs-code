import * as vscode from 'vscode';
import { RagProvider } from '../services/rag-client';

export type AIProvider = 'lmstudio' | 'anthropic' | 'ollama' | 'mlx';
export type SupportProvider = 'anthropic' | 'openai' | 'gemini';
export type { RagProvider };

export const DEFAULT_SUPPORT_MODELS: Record<SupportProvider, string> = {
    anthropic: 'claude-sonnet-4-6',
    openai: 'gpt-4o',
    gemini: 'gemini-2.0-flash-exp',
};

export const ALL_TOOL_NAMES = [
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
    'browser_action',
] as const;

export type ToolName = typeof ALL_TOOL_NAMES[number];

export interface EucodeSettings {
    provider: AIProvider;
    apiHost: string;
    apiKey: string;
    model: string;
    enabledTools: ToolName[];
    ragEnabled: boolean;
    // Which vector DB backend. 'chroma' embeds text server-side; 'qdrant' is a
    // pure vector store, so the plugin embeds the query first (see ragEmbed*).
    ragProvider: RagProvider;
    ragEndpoint: string;
    ragCollection: string;
    // Qdrant only: OpenAI-compatible /v1/embeddings host + model used to turn
    // the query into a vector before searching. Defaults to the LM Studio host.
    ragEmbedHost: string;
    ragEmbedModel: string;
    hybridEnabled: boolean;
    supportProvider: SupportProvider;
    supportApiKey: string;
    supportModel: string;
    inlineCompletionEnabled: boolean;
    fixWithEucodeEnabled: boolean;
    customCommandsScope: 'workspace' | 'global';
    // HYBRID intensity controls how much the paid model is invoked.
    //   25  = minimal — only critical recovery (model totally stuck)
    //   50  = balanced — recovery + planning for macro tasks
    //   75  = aggressive — adds step validation between decomposed sub-tasks
    //   100 = maximum — every trigger fires (planning, verify, recover, validate)
    hybridIntensity: 25 | 50 | 75 | 100;
    // When true, the plugin scans the workspace at the start of each round
    // and injects a compact symbol index into the system prompt. Helps the
    // model find files by exported name without reading them, but adds
    // ~700-1500 tokens to every prompt. Disable to free context on small
    // models (≤ 4B params) or on huge monorepos where the scan is slow.
    projectIntelEnabled: boolean;
    // Orcamento de contexto (tokens) que o Eucode assume para o modelo local.
    // Calibra a poda e os limites de limpeza de output. 0/ausente = usa o
    // default do provedor (PROVIDER_CONTEXT_DEFAULTS). O usuario pode ajustar
    // manualmente na UI para casar com a janela real do modelo carregado.
    contextTokenBudget: number;
    // ── JARVIS (voice mode) ─────────────────────────────────────────────
    jarvisEnabled: boolean;          // master switch for voice features
    jarvisAutoSpeak: boolean;        // TTS reads agent responses out loud
    jarvisTtsVoice: string;          // empty = system default
    jarvisTtsRate: number;           // 0.5 to 2.0
    voiceServerEnabled: boolean;     // local HTTP server for STT and mobile clients
    voiceServerPort: number;         // default 9876
    voiceServerExposeNetwork: boolean; // bind 0.0.0.0 (mobile on LAN) vs 127.0.0.1
    voicePairingToken: string;       // generated once, persisted; required by all server endpoints
    whisperEndpoint: string;         // LM Studio base URL for /v1/audio/transcriptions
    whisperModel: string;            // e.g. "whisper-1" or your local model id
    whisperLanguage: string;         // ISO code like "pt", "en"; empty = auto-detect
    micDeviceIndex: string;          // avfoundation audio device index for capture; '' = default (:0)
    wakeWordEnabled: boolean;        // continuous listen for the wake word
    wakeWord: string;                // the wake word to trigger recording (default "eucode")
}

const DEFAULTS: EucodeSettings = {
    provider: 'lmstudio',
    apiHost: 'http://localhost:1234',
    apiKey: '',
    model: '',
    enabledTools: [...ALL_TOOL_NAMES],
    ragEnabled: false,
    ragProvider: 'chroma',
    ragEndpoint: 'http://localhost:8000',
    ragCollection: 'eucode',
    ragEmbedHost: 'http://localhost:1234',
    ragEmbedModel: '',
    hybridEnabled: false,
    supportProvider: 'anthropic',
    supportApiKey: '',
    supportModel: '',
    inlineCompletionEnabled: false,
    fixWithEucodeEnabled: false,
    customCommandsScope: 'workspace',
    hybridIntensity: 50,
    projectIntelEnabled: true,
    contextTokenBudget: 0,  // 0 = usa o default do provedor
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
    wakeWordEnabled: false,
    wakeWord: 'eucode',
};

const KEYS = {
    provider: 'eucode.provider',
    apiHost: 'eucode.apiHost',
    apiKey: 'eucode.apiKey',
    model: 'eucode.model',
    enabledTools: 'eucode.enabledTools',
    ragEnabled: 'eucode.ragEnabled',
    ragProvider: 'eucode.ragProvider',
    ragEndpoint: 'eucode.ragEndpoint',
    ragCollection: 'eucode.ragCollection',
    ragEmbedHost: 'eucode.ragEmbedHost',
    ragEmbedModel: 'eucode.ragEmbedModel',
    hybridEnabled: 'eucode.hybridEnabled',
    supportProvider: 'eucode.supportProvider',
    supportApiKey: 'eucode.supportApiKey',
    supportModel: 'eucode.supportModel',
    inlineCompletionEnabled: 'eucode.inlineCompletionEnabled',
    fixWithEucodeEnabled: 'eucode.fixWithEucodeEnabled',
    customCommandsScope: 'eucode.customCommandsScope',
    hybridIntensity: 'eucode.hybridIntensity',
    projectIntelEnabled: 'eucode.projectIntelEnabled',
    contextTokenBudget: 'eucode.contextTokenBudget',
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
    wakeWordEnabled: 'eucode.wakeWordEnabled',
    wakeWord: 'eucode.wakeWord',
};

export const DEFAULT_ANTHROPIC_MODEL = 'claude-sonnet-4-6';

export function loadSettings(context: vscode.ExtensionContext): EucodeSettings {
    const saved = context.globalState.get<string[]>(KEYS.enabledTools);
    const enabledTools = saved
        ? (saved.filter(t => (ALL_TOOL_NAMES as readonly string[]).includes(t)) as ToolName[])
        : [...ALL_TOOL_NAMES];
    return {
        provider: context.globalState.get<AIProvider>(KEYS.provider) ?? DEFAULTS.provider,
        apiHost: context.globalState.get<string>(KEYS.apiHost) ?? DEFAULTS.apiHost,
        apiKey: context.globalState.get<string>(KEYS.apiKey) ?? DEFAULTS.apiKey,
        model: context.globalState.get<string>(KEYS.model) ?? DEFAULTS.model,
        enabledTools,
        ragEnabled: context.globalState.get<boolean>(KEYS.ragEnabled) ?? DEFAULTS.ragEnabled,
        ragProvider: context.globalState.get<RagProvider>(KEYS.ragProvider) ?? DEFAULTS.ragProvider,
        ragEndpoint: context.globalState.get<string>(KEYS.ragEndpoint) ?? DEFAULTS.ragEndpoint,
        ragCollection: context.globalState.get<string>(KEYS.ragCollection) ?? DEFAULTS.ragCollection,
        ragEmbedHost: context.globalState.get<string>(KEYS.ragEmbedHost) ?? DEFAULTS.ragEmbedHost,
        ragEmbedModel: context.globalState.get<string>(KEYS.ragEmbedModel) ?? DEFAULTS.ragEmbedModel,
        hybridEnabled: context.globalState.get<boolean>(KEYS.hybridEnabled) ?? DEFAULTS.hybridEnabled,
        supportProvider: context.globalState.get<SupportProvider>(KEYS.supportProvider) ?? DEFAULTS.supportProvider,
        supportApiKey: context.globalState.get<string>(KEYS.supportApiKey) ?? DEFAULTS.supportApiKey,
        supportModel: context.globalState.get<string>(KEYS.supportModel) ?? DEFAULTS.supportModel,
        inlineCompletionEnabled: context.globalState.get<boolean>(KEYS.inlineCompletionEnabled) ?? DEFAULTS.inlineCompletionEnabled,
        fixWithEucodeEnabled: context.globalState.get<boolean>(KEYS.fixWithEucodeEnabled) ?? DEFAULTS.fixWithEucodeEnabled,
        customCommandsScope: context.globalState.get<'workspace' | 'global'>(KEYS.customCommandsScope) ?? DEFAULTS.customCommandsScope,
        hybridIntensity: (context.globalState.get<25 | 50 | 75 | 100>(KEYS.hybridIntensity) ?? DEFAULTS.hybridIntensity),
        projectIntelEnabled: context.globalState.get<boolean>(KEYS.projectIntelEnabled) ?? DEFAULTS.projectIntelEnabled,
        contextTokenBudget: context.globalState.get<number>(KEYS.contextTokenBudget) ?? DEFAULTS.contextTokenBudget,
        jarvisEnabled: context.globalState.get<boolean>(KEYS.jarvisEnabled) ?? DEFAULTS.jarvisEnabled,
        jarvisAutoSpeak: context.globalState.get<boolean>(KEYS.jarvisAutoSpeak) ?? DEFAULTS.jarvisAutoSpeak,
        jarvisTtsVoice: context.globalState.get<string>(KEYS.jarvisTtsVoice) ?? DEFAULTS.jarvisTtsVoice,
        jarvisTtsRate: context.globalState.get<number>(KEYS.jarvisTtsRate) ?? DEFAULTS.jarvisTtsRate,
        voiceServerEnabled: context.globalState.get<boolean>(KEYS.voiceServerEnabled) ?? DEFAULTS.voiceServerEnabled,
        voiceServerPort: context.globalState.get<number>(KEYS.voiceServerPort) ?? DEFAULTS.voiceServerPort,
        voiceServerExposeNetwork: context.globalState.get<boolean>(KEYS.voiceServerExposeNetwork) ?? DEFAULTS.voiceServerExposeNetwork,
        voicePairingToken: context.globalState.get<string>(KEYS.voicePairingToken) ?? DEFAULTS.voicePairingToken,
        whisperEndpoint: context.globalState.get<string>(KEYS.whisperEndpoint) ?? DEFAULTS.whisperEndpoint,
        whisperModel: context.globalState.get<string>(KEYS.whisperModel) ?? DEFAULTS.whisperModel,
        whisperLanguage: context.globalState.get<string>(KEYS.whisperLanguage) ?? DEFAULTS.whisperLanguage,
        micDeviceIndex: context.globalState.get<string>(KEYS.micDeviceIndex) ?? DEFAULTS.micDeviceIndex,
        wakeWordEnabled: context.globalState.get<boolean>(KEYS.wakeWordEnabled) ?? DEFAULTS.wakeWordEnabled,
        wakeWord: context.globalState.get<string>(KEYS.wakeWord) ?? DEFAULTS.wakeWord,
    };
}

export async function saveSettings(context: vscode.ExtensionContext, settings: EucodeSettings): Promise<void> {
    await context.globalState.update(KEYS.provider, settings.provider);
    await context.globalState.update(KEYS.apiHost, settings.apiHost.replace(/\/+$/, ''));
    await context.globalState.update(KEYS.apiKey, settings.apiKey);
    await context.globalState.update(KEYS.model, settings.model.trim());
    await context.globalState.update(KEYS.enabledTools, settings.enabledTools);
    await context.globalState.update(KEYS.ragEnabled, settings.ragEnabled);
    await context.globalState.update(KEYS.ragProvider, settings.ragProvider);
    await context.globalState.update(KEYS.ragEndpoint, settings.ragEndpoint.replace(/\/+$/, ''));
    await context.globalState.update(KEYS.ragCollection, settings.ragCollection.trim());
    await context.globalState.update(KEYS.ragEmbedHost, settings.ragEmbedHost.replace(/\/+$/, ''));
    await context.globalState.update(KEYS.ragEmbedModel, settings.ragEmbedModel.trim());
    await context.globalState.update(KEYS.hybridEnabled, settings.hybridEnabled);
    await context.globalState.update(KEYS.supportProvider, settings.supportProvider);
    await context.globalState.update(KEYS.supportApiKey, settings.supportApiKey);
    await context.globalState.update(KEYS.supportModel, settings.supportModel.trim());
    await context.globalState.update(KEYS.inlineCompletionEnabled, settings.inlineCompletionEnabled);
    await context.globalState.update(KEYS.fixWithEucodeEnabled, settings.fixWithEucodeEnabled);
    await context.globalState.update(KEYS.customCommandsScope, settings.customCommandsScope);
    await context.globalState.update(KEYS.hybridIntensity, settings.hybridIntensity);
    await context.globalState.update(KEYS.projectIntelEnabled, settings.projectIntelEnabled);
    await context.globalState.update(KEYS.contextTokenBudget, settings.contextTokenBudget);
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
    await context.globalState.update(KEYS.wakeWordEnabled, settings.wakeWordEnabled);
    await context.globalState.update(KEYS.wakeWord, settings.wakeWord);
}

// Not used for Anthropic provider — Anthropic uses its own endpoint in api-client.ts
export function buildApiEndpoint(settings: EucodeSettings): string {
    return `${settings.apiHost}/v1/chat/completions`;
}

export function buildAuthHeader(settings: EucodeSettings): Record<string, string> {
    if (settings.provider === 'anthropic') {
        return {};
    }
    if (settings.apiKey) {
        return { Authorization: `Bearer ${settings.apiKey}` };
    }
    return {};
}
