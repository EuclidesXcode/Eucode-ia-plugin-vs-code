import * as vscode from 'vscode';
import * as fs from 'fs';
import * as path from 'path';
import { callAIWithVision, checkConnection } from './services/api-client';
import { buildHistorySummary, HistoryEntry } from './services/history-service';
import { HistoryManagerService } from './services/HistoryManagerService';
import { collectWorkspaceContext, getDefaultCwd } from './workspace/context';
import { runAgentLoop, ConfirmWriteRequest } from './agent/loop';
import { SYSTEM_PROMPT } from './agent/prompt';
import { loadSettings, saveSettings, buildApiEndpoint, buildAuthHeader, EucodeSettings } from './config/settings';
import { DEFAULT_MODEL } from './utils/constants';

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

    const historyManager = new HistoryManagerService(context);
    let sessionHistory: HistoryEntry[] = historyManager.load();
    let settings = loadSettings(context);

    const notify = (text: string) => panel.webview.postMessage({ command: 'status', text });

    // Mapa de Promises pendentes para aprovação de escrita de arquivo
    const pendingConfirms = new Map<string, (approved: boolean) => void>();

    async function pingAndNotify(s: EucodeSettings) {
        const endpoint = buildApiEndpoint(s);
        const auth = buildAuthHeader(s);
        const online = await checkConnection(endpoint, auth);
        panel.webview.postMessage({ command: 'connection_status', online });
    }

    function makeConfirmWrite(): (req: ConfirmWriteRequest) => Promise<boolean> {
        return (req) => new Promise<boolean>((resolve) => {
            const id = `confirm_${Date.now()}`;
            pendingConfirms.set(id, resolve);
            panel.webview.postMessage({
                command: 'confirm_write',
                id,
                filePath: req.filePath,
                before: req.before,
                after: req.after,
            });
        });
    }

    const workspaceListener = vscode.workspace.onDidChangeWorkspaceFolders(() => {
        sessionHistory = historyManager.load();
        const filtered = sessionHistory.filter(e => !e.content.startsWith('ERRO DE CONEXAO'));
        panel.webview.postMessage({ command: 'load_history', entries: filtered });
    });
    context.subscriptions.push(workspaceListener);

    panel.webview.onDidReceiveMessage(
        async (message: any) => {
            if (message?.command === 'webview_ready') {
                panel.webview.postMessage({
                    command: 'load_config',
                    provider: settings.provider,
                    apiHost: settings.apiHost,
                    apiKey: settings.apiKey,
                    model: settings.model,
                });
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
                    model: message.model ?? '',
                };
                await saveSettings(context, settings);
                panel.webview.postMessage({ command: 'config_saved' });
                pingAndNotify(settings);
                return;
            }

            // Resposta do usuário para aprovação de escrita de arquivo
            if (message?.command === 'confirm_write_response') {
                const resolve = pendingConfirms.get(message.id);
                if (resolve) {
                    pendingConfirms.delete(message.id);
                    resolve(message.approved === true);
                }
                return;
            }

            if (message?.command !== 'user_input' || !message.text) { return; }

            sessionHistory = historyManager.append(sessionHistory, {
                role: 'user',
                content: message.text,
                timestamp: Date.now(),
                hasImage: !!message.image,
            });

            const endpoint = buildApiEndpoint(settings);
            const authHeaders = buildAuthHeader(settings);
            const activeModel = settings.model || DEFAULT_MODEL;
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
                    systemWithHistory,
                    activeModel
                );
                sessionHistory = historyManager.append(sessionHistory, {
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
                const notifyCommandOutput = (chunk: string) =>
                    panel.webview.postMessage({ command: 'command_output', chunk });

                response = await runAgentLoop(
                    message.text,
                    ctx.contextBlock,
                    defaultCwd,
                    endpoint,
                    authHeaders,
                    sessionHistory,
                    notify,
                    notifyCommandOutput,
                    makeConfirmWrite(),
                    activeModel
                );
                sessionHistory = historyManager.append(sessionHistory, {
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
