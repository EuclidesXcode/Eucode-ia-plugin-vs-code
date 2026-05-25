import * as vscode from 'vscode';

export type AIProvider = 'lmstudio' | 'anthropic' | 'ollama';

export interface EucodeSettings {
    provider: AIProvider;
    apiHost: string;
    apiKey: string;
}

const DEFAULTS: EucodeSettings = {
    provider: 'lmstudio',
    apiHost: 'http://localhost:1234',
    apiKey: '',
};

const KEYS = {
    provider: 'eucode.provider',
    apiHost: 'eucode.apiHost',
    apiKey: 'eucode.apiKey',
};

export function loadSettings(context: vscode.ExtensionContext): EucodeSettings {
    return {
        provider: context.globalState.get<AIProvider>(KEYS.provider) ?? DEFAULTS.provider,
        apiHost: context.globalState.get<string>(KEYS.apiHost) ?? DEFAULTS.apiHost,
        apiKey: context.globalState.get<string>(KEYS.apiKey) ?? DEFAULTS.apiKey,
    };
}

export async function saveSettings(context: vscode.ExtensionContext, settings: EucodeSettings): Promise<void> {
    await context.globalState.update(KEYS.provider, settings.provider);
    await context.globalState.update(KEYS.apiHost, settings.apiHost.replace(/\/+$/, ''));
    await context.globalState.update(KEYS.apiKey, settings.apiKey);
}

export function buildApiEndpoint(settings: EucodeSettings): string {
    return `${settings.apiHost}/v1/chat/completions`;
}

export function buildAuthHeader(settings: EucodeSettings): Record<string, string> {
    if (settings.apiKey) {
        return { Authorization: `Bearer ${settings.apiKey}` };
    }
    // Anthropic sem key explícita ainda precisa do header para não rejeitar
    if (settings.provider === 'anthropic') {
        return { Authorization: 'Bearer ollama' };
    }
    return {};
}
