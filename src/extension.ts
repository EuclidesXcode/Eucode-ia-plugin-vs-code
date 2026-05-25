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

class EucodeViewProvider implements vscode.WebviewViewProvider {
    public static readonly viewType = 'eucode-ia.chatView';
    private _historyManager: HistoryManagerService;
    private _sessionHistory: HistoryEntry[] = [];
    private _settings: EucodeSettings;
    private _pendingConfirms = new Map<string, (approved: boolean) => void>();

    constructor(private readonly _context: vscode.ExtensionContext) {
        this._historyManager = new HistoryManagerService(_context);
        this._sessionHistory = this._historyManager.load();
        this._settings = loadSettings(_context);
    }

    resolveWebviewView(
        webviewView: vscode.WebviewView,
        _ctx: vscode.WebviewViewResolveContext,
        _token: vscode.CancellationToken
    ) {
        webviewView.webview.options = {
            enableScripts: true,
            localResourceRoots: [this._context.extensionUri],
        };

        const htmlPath = path.join(this._context.extensionUri.fsPath, 'webviews', 'chatPanel.html');
        webviewView.webview.html = fs.readFileSync(htmlPath, 'utf8');

        const notify = (text: string) => webviewView.webview.postMessage({ command: 'status', text });

        const makeConfirmWrite = (): (req: ConfirmWriteRequest) => Promise<boolean> =>
            (req) => new Promise<boolean>((resolve) => {
                const id = `confirm_${Date.now()}`;
                this._pendingConfirms.set(id, resolve);
                webviewView.webview.postMessage({ command: 'confirm_write', id, filePath: req.filePath, before: req.before, after: req.after });
            });

        const pingAndNotify = async (s: EucodeSettings) => {
            const online = await checkConnection(buildApiEndpoint(s), buildAuthHeader(s));
            webviewView.webview.postMessage({ command: 'connection_status', online });
        };

        this._context.subscriptions.push(
            vscode.workspace.onDidChangeWorkspaceFolders(() => {
                this._sessionHistory = this._historyManager.load();
                const filtered = this._sessionHistory.filter(e => !e.content.startsWith('ERRO DE CONEXAO'));
                webviewView.webview.postMessage({ command: 'load_history', entries: filtered });
            })
        );

        webviewView.webview.onDidReceiveMessage(async (message: any) => {
            if (message?.command === 'webview_ready') {
                webviewView.webview.postMessage({ command: 'load_config', provider: this._settings.provider, apiHost: this._settings.apiHost, apiKey: this._settings.apiKey, model: this._settings.model });
                const history = this._sessionHistory.filter(e => !e.content.startsWith('ERRO DE CONEXAO'));
                webviewView.webview.postMessage({ command: 'load_history', entries: history });
                webviewView.webview.postMessage({ command: 'load_sessions', sessions: this._historyManager.loadSessions() });
                pingAndNotify(this._settings);
                return;
            }

            if (message?.command === 'new_session') {
                this._sessionHistory = await this._historyManager.newSession();
                webviewView.webview.postMessage({ command: 'session_started', entries: [] });
                webviewView.webview.postMessage({ command: 'load_sessions', sessions: this._historyManager.loadSessions() });
                return;
            }

            if (message?.command === 'load_session') {
                this._sessionHistory = await this._historyManager.loadSession(message.id);
                webviewView.webview.postMessage({ command: 'load_history', entries: this._sessionHistory });
                webviewView.webview.postMessage({ command: 'load_sessions', sessions: this._historyManager.loadSessions() });
                return;
            }

            if (message?.command === 'delete_session') {
                await this._historyManager.deleteSession(message.id);
                this._sessionHistory = this._historyManager.load();
                webviewView.webview.postMessage({ command: 'load_sessions', sessions: this._historyManager.loadSessions() });
                return;
            }

            if (message?.command === 'save_config') {
                this._settings = { provider: message.provider ?? this._settings.provider, apiHost: message.apiHost ?? this._settings.apiHost, apiKey: message.apiKey ?? '', model: message.model ?? '' };
                await saveSettings(this._context, this._settings);
                webviewView.webview.postMessage({ command: 'config_saved' });
                pingAndNotify(this._settings);
                return;
            }

            if (message?.command === 'confirm_write_response') {
                const resolve = this._pendingConfirms.get(message.id);
                if (resolve) { this._pendingConfirms.delete(message.id); resolve(message.approved === true); }
                return;
            }

            if (message?.command !== 'user_input' || !message.text) { return; }

            this._sessionHistory = this._historyManager.append(this._sessionHistory, { role: 'user', content: message.text, timestamp: Date.now(), hasImage: !!message.image });

            const endpoint = buildApiEndpoint(this._settings);
            const authHeaders = buildAuthHeader(this._settings);
            const activeModel = this._settings.model || DEFAULT_MODEL;
            let response: string;

            if (message.image?.base64) {
                notify('Analisando imagem...');
                const historySummary = buildHistorySummary(this._sessionHistory.slice(0, -1));
                const systemWithHistory = [SYSTEM_PROMPT, historySummary].filter(Boolean).join('\n\n');
                response = await callAIWithVision(endpoint, authHeaders, message.text, message.image.base64, message.image.mimeType, systemWithHistory, activeModel);
                this._sessionHistory = this._historyManager.append(this._sessionHistory, { role: 'assistant', content: response, timestamp: Date.now(), hasImage: true, imageSummary: response.slice(0, 300) });
            } else {
                notify('Mapeando workspace...');
                const ctx = collectWorkspaceContext();
                if (ctx.openFiles.length > 0) { notify(`Abertos no editor: ${ctx.openFiles.map(f => f.name).join(', ')}`); }
                const defaultCwd = getDefaultCwd(ctx.roots);
                const notifyCommandStart = (cmd: string) => webviewView.webview.postMessage({ command: 'command_start', cmd });
                const notifyCommandOutput = (chunk: string) => webviewView.webview.postMessage({ command: 'command_output', chunk });

                response = await runAgentLoop(message.text, ctx.contextBlock, defaultCwd, endpoint, authHeaders, this._sessionHistory, notify, notifyCommandStart, notifyCommandOutput, makeConfirmWrite(), activeModel, !!message.autoMode);
                this._sessionHistory = this._historyManager.append(this._sessionHistory, { role: 'assistant', content: response, timestamp: Date.now() });
            }

            webviewView.webview.postMessage({ command: 'agent_response', text: response });
        }, undefined, this._context.subscriptions);
    }
}

export function activate(context: vscode.ExtensionContext) {
    console.log('Eucode-IA Plugin ativo.');

    const provider = new EucodeViewProvider(context);
    context.subscriptions.push(
        vscode.window.registerWebviewViewProvider(EucodeViewProvider.viewType, provider, {
            webviewOptions: { retainContextWhenHidden: true },
        })
    );

    context.subscriptions.push(
        vscode.commands.registerCommand('eucode-ia.activateAgent', () => {
            vscode.commands.executeCommand('eucode-ia.chatView.focus');
        })
    );

    context.subscriptions.push(
        vscode.commands.registerCommand('eucode-ia.openChat', () => {
            vscode.commands.executeCommand('eucode-ia.chatView.focus');
        })
    );
}

export function deactivate() {}
