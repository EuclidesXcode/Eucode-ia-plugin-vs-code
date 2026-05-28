import * as vscode from 'vscode';

export type AIProvider = 'lmstudio' | 'anthropic' | 'ollama';

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
] as const;

export type ToolName = typeof ALL_TOOL_NAMES[number];

export interface EucodeSettings {
    provider: AIProvider;
    apiHost: string;
    apiKey: string;
    model: string;
    enabledTools: ToolName[];
    ragEnabled: boolean;
    ragEndpoint: string;
    ragCollection: string;
}

const DEFAULTS: EucodeSettings = {
    provider: 'lmstudio',
    apiHost: 'http://localhost:1234',
    apiKey: '',
    model: '',
    enabledTools: [...ALL_TOOL_NAMES],
    ragEnabled: false,
    ragEndpoint: 'http://localhost:8000',
    ragCollection: 'eucode',
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
        ragEndpoint: context.globalState.get<string>(KEYS.ragEndpoint) ?? DEFAULTS.ragEndpoint,
        ragCollection: context.globalState.get<string>(KEYS.ragCollection) ?? DEFAULTS.ragCollection,
    };
}

export async function saveSettings(context: vscode.ExtensionContext, settings: EucodeSettings): Promise<void> {
    await context.globalState.update(KEYS.provider, settings.provider);
    await context.globalState.update(KEYS.apiHost, settings.apiHost.replace(/\/+$/, ''));
    await context.globalState.update(KEYS.apiKey, settings.apiKey);
    await context.globalState.update(KEYS.model, settings.model.trim());
    await context.globalState.update(KEYS.enabledTools, settings.enabledTools);
    await context.globalState.update(KEYS.ragEnabled, settings.ragEnabled);
    await context.globalState.update(KEYS.ragEndpoint, settings.ragEndpoint.replace(/\/+$/, ''));
    await context.globalState.update(KEYS.ragCollection, settings.ragCollection.trim());
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
