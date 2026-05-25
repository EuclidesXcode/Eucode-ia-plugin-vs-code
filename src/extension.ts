import * as vscode from 'vscode';
import * as fs from 'fs';
import * as path from 'path';
import { callAIWithVision, checkConnection } from './services/api-client';
import { loadHistory, appendEntry, buildHistorySummary, HistoryEntry } from './services/history-service';
import { collectWorkspaceContext, getDefaultCwd } from './workspace/context';
import { runAgentLoop } from './agent/loop';
import { SYSTEM_PROMPT } from './agent/prompt';
import { loadSettings, saveSettings, buildApiEndpoint, buildAuthHeader, EucodeSettings } from './config/settings';

export function activate(context: vscode.ExtensionContext) {
    console.log('Eucode-IA Plugin ativo.');
    context.subscriptions.push(
        vscode.commands.registerCommand('eucode-ia.activateAgent', () => initializeEucodeAgent(context))
    );
}

async function initializeEucodeAgent(context: vscode.ExtensionContext) {
    const panel = vscode.window.createWebviewPanel(
        'eucodeChatPanel',
        'Eucode AI Agent',
        vscode.ViewColumn.One,
        { enableScripts: true, retainContextWhenHidden: true }
    );

    const htmlPath = path.join(context.extensionUri.fsPath, 'webviews', 'chatPanel.html');
    panel.webview.html = fs.readFileSync(htmlPath, 'utf8');

    let sessionHistory: HistoryEntry[] = loadHistory();
    let settings = loadSettings(context);

    const notify = (text: string) => panel.webview.postMessage({ command: 'status', text });

    async function pingAndNotify(s: EucodeSettings) {
        const endpoint = buildApiEndpoint(s);
        const auth = buildAuthHeader(s);
        const online = await checkConnection(endpoint, auth);
        panel.webview.postMessage({ command: 'connection_status', online });
    }

    panel.webview.onDidReceiveMessage(
        async (message: any) => {
            if (message?.command === 'webview_ready') {
                panel.webview.postMessage({
                    command: 'load_config',
                    provider: settings.provider,
                    apiHost: settings.apiHost,
                    apiKey: settings.apiKey,
                });
                // Envia historico para restaurar conversa anterior
                const history = sessionHistory.filter(e => !e.content.startsWith('ERRO DE CONEXAO'));
                if (history.length > 0) {
                    panel.webview.postMessage({ command: 'load_history', entries: history });
                }
                pingAndNotify(settings);
                return;
            }

            if (message?.command === 'save_config') {
                settings = {
                    provider: message.provider ?? settings.provider,
                    apiHost: message.apiHost ?? settings.apiHost,
                    apiKey: message.apiKey ?? '',
                };
                await saveSettings(context, settings);
                panel.webview.postMessage({ command: 'config_saved' });
                pingAndNotify(settings);
                return;
            }

            if (message?.command !== 'user_input' || !message.text) { return; }

            sessionHistory = appendEntry(sessionHistory, {
                role: 'user',
                content: message.text,
                timestamp: Date.now(),
                hasImage: !!message.image,
            });

            const endpoint = buildApiEndpoint(settings);
            const authHeaders = buildAuthHeader(settings);
            let response: string;

            if (message.image?.base64) {
                notify('Analisando imagem...');
                const historySummary = buildHistorySummary(sessionHistory.slice(0, -1));
                const systemWithHistory = [SYSTEM_PROMPT, historySummary].filter(Boolean).join('\n\n');
                response = await callAIWithVision(
                    endpoint,
                    authHeaders,
                    message.text,
                    message.image.base64,
                    message.image.mimeType,
                    systemWithHistory
                );
                sessionHistory = appendEntry(sessionHistory, {
                    role: 'assistant',
                    content: response,
                    timestamp: Date.now(),
                    hasImage: true,
                    imageSummary: response.slice(0, 300),
                });
            } else {
                notify('Mapeando workspace...');
                const ctx = collectWorkspaceContext();
                if (ctx.openFiles.length > 0) {
                    notify(`Abertos no editor: ${ctx.openFiles.map(f => f.name).join(', ')}`);
                }
                const defaultCwd = getDefaultCwd(ctx.roots);
                response = await runAgentLoop(
                    message.text,
                    ctx.contextBlock,
                    defaultCwd,
                    endpoint,
                    authHeaders,
                    sessionHistory,
                    notify
                );
                sessionHistory = appendEntry(sessionHistory, {
                    role: 'assistant',
                    content: response,
                    timestamp: Date.now(),
                });
            }

            panel.webview.postMessage({ command: 'agent_response', text: response });
        },
        undefined,
        context.subscriptions
    );
}

export function deactivate() {}
