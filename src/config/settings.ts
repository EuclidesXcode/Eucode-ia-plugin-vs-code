import * as vscode from 'vscode';

const KEY_HOST = 'eucode.apiHost';
const DEFAULT_HOST = 'http://localhost:1234';

export interface EucodeSettings {
    apiHost: string;
}

export function loadSettings(context: vscode.ExtensionContext): EucodeSettings {
    return {
        apiHost: context.globalState.get<string>(KEY_HOST) ?? DEFAULT_HOST,
    };
}

export async function saveSettings(context: vscode.ExtensionContext, settings: EucodeSettings): Promise<void> {
    await context.globalState.update(KEY_HOST, settings.apiHost.replace(/\/+$/, ''));
}

export function buildApiEndpoint(settings: EucodeSettings): string {
    return `${settings.apiHost}/v1/chat/completions`;
}
