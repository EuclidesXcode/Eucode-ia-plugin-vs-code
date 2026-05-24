import * as vscode from 'vscode';
import * as fs from 'fs';
import * as path from 'path';
import { callAIWithVision } from './services/api-client';
import { loadHistory, appendEntry, buildHistorySummary, HistoryEntry } from './services/history-service';
import { collectWorkspaceContext, getDefaultCwd } from './workspace/context';
import { runAgentLoop } from './agent/loop';
import { SYSTEM_PROMPT } from './agent/prompt';
import { loadSettings, saveSettings, buildApiEndpoint } from './config/settings';

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
        { enableScripts: true }
    );

    const htmlPath = path.join(context.extensionUri.fsPath, 'webviews', 'chatPanel.html');
    panel.webview.html = fs.readFileSync(htmlPath, 'utf8');

    let sessionHistory: HistoryEntry[] = loadHistory();
    let settings = loadSettings(context);

    const notify = (text: string) => panel.webview.postMessage({ command: 'status', text });

    // Envia as configuracoes atuais para o webview assim que abre
    panel.webview.onDidReceiveMessage(
        async (message: any) => {
            if (message?.command === 'webview_ready') {
                panel.webview.postMessage({ command: 'load_config', apiHost: settings.apiHost });
                return;
            }

            if (message?.command === 'save_config') {
                settings = { apiHost: message.apiHost ?? settings.apiHost };
                await saveSettings(context, settings);
                panel.webview.postMessage({ command: 'config_saved' });
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
            let response: string;

            if (message.image?.base64) {
                notify('Analisando imagem...');
                const historySummary = buildHistorySummary(sessionHistory.slice(0, -1));
                const systemWithHistory = [SYSTEM_PROMPT, historySummary].filter(Boolean).join('\n\n');
                response = await callAIWithVision(
                    endpoint,
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
