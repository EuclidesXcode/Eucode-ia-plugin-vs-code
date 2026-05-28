import * as vscode from 'vscode';
import * as fs from 'fs';
import * as path from 'path';
import { callAIWithVision, checkConnection, checkAnthropicConnection } from './services/api-client';
import { buildHistorySummary, HistoryEntry } from './services/history-service';
import { HistoryManagerService } from './services/HistoryManagerService';
import { collectWorkspaceContext, collectDiagnostics, getDefaultCwd } from './workspace/context';
import { runAgentLoop, ConfirmWriteRequest, ConfirmCommandRequest, ConfirmCommandDecision, TodoItem } from './agent/loop';
import { SYSTEM_PROMPT } from './agent/prompt';
import { loadSettings, saveSettings, buildApiEndpoint, buildAuthHeader, EucodeSettings } from './config/settings';
import { DEFAULT_MODEL } from './utils/constants';

class EucodeViewProvider implements vscode.WebviewViewProvider {
    public static readonly viewType = 'eucode-ia.chatView';
    private _historyManager: HistoryManagerService;
    private _sessionHistory: HistoryEntry[] = [];
    private _settings: EucodeSettings;
    private _pendingConfirms = new Map<string, (approved: boolean) => void>();
    private _pendingCommandConfirms = new Map<string, (decision: ConfirmCommandDecision) => void>();
    private _abortController: AbortController | null = null;
    private _injectMessage: ((msg: string) => void) | null = null;
    private _windowFocused: boolean = true;

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

        this._windowFocused = vscode.window.state.focused;
        this._context.subscriptions.push(
            vscode.window.onDidChangeWindowState(state => { this._windowFocused = state.focused; })
        );

        const notifyUser = (message: string, actions: string[] = []) => {
            if (!this._windowFocused) {
                vscode.window.showInformationMessage(`Eucode IA: ${message}`, ...actions).then(action => {
                    if (action) { webviewView.show(true); }
                });
                // Notificacao nativa do sistema operacional (macOS)
                if (process.platform === 'darwin') {
                    const safe = message.replace(/"/g, '\\"');
                    require('child_process').exec(
                        `osascript -e 'display notification "${safe}" with title "Eucode IA"'`
                    );
                }
            }
        };

        const makeConfirmWrite = (): (req: ConfirmWriteRequest) => Promise<boolean> =>
            (req) => new Promise<boolean>((resolve) => {
                const id = `confirm_${Date.now()}`;
                this._pendingConfirms.set(id, resolve);
                webviewView.webview.postMessage({ command: 'confirm_write', id, filePath: req.filePath, before: req.before, after: req.after });
                notifyUser(`Aguardando aprovacao para editar "${path.basename(req.filePath)}"`, ['Abrir chat']);
            });

        const makeConfirmCommand = (): (req: ConfirmCommandRequest) => Promise<ConfirmCommandDecision> =>
            (req) => new Promise<ConfirmCommandDecision>((resolve) => {
                const id = `cmd_${Date.now()}`;
                this._pendingCommandConfirms.set(id, resolve);
                webviewView.webview.postMessage({ command: 'confirm_command', id, cmd: req.command, cwd: req.cwd });
                notifyUser(`Aguardando aprovacao para executar comando`, ['Abrir chat']);
            });

        const getDiagnostics = (): string => collectDiagnostics();

        const makeTodoUpdate = () => (todos: TodoItem[]) => {
            webviewView.webview.postMessage({ command: 'todo_update', todos });
        };

        const pingAndNotify = async (s: EucodeSettings) => {
            const online = s.provider === 'anthropic'
                ? await checkAnthropicConnection(s.apiKey)
                : await checkConnection(buildApiEndpoint(s), buildAuthHeader(s));
            webviewView.webview.postMessage({ command: 'connection_status', online });
        };

        this._context.subscriptions.push(
            vscode.workspace.onDidChangeWorkspaceFolders(() => {
                this._sessionHistory = this._historyManager.load();
                const filtered = this._sessionHistory.filter(e => !e.content.startsWith('ERRO DE CONEXAO'));
                webviewView.webview.postMessage({ command: 'load_history', entries: filtered });
            })
        );

        const sendOpenFiles = () => {
            const ctx = collectWorkspaceContext();
            webviewView.webview.postMessage({ command: 'open_files', files: ctx.openFiles });
        };

        this._context.subscriptions.push(
            vscode.window.onDidChangeActiveTextEditor(() => sendOpenFiles()),
            vscode.window.tabGroups.onDidChangeTabs(() => sendOpenFiles())
        );

        webviewView.webview.onDidReceiveMessage(async (message: any) => {
            if (message?.command === 'webview_ready') {
                webviewView.webview.postMessage({ command: 'load_config', provider: this._settings.provider, apiHost: this._settings.apiHost, apiKey: this._settings.apiKey, model: this._settings.model, enabledTools: this._settings.enabledTools, ragEnabled: this._settings.ragEnabled, ragEndpoint: this._settings.ragEndpoint, ragCollection: this._settings.ragCollection });
                const history = this._sessionHistory.filter(e => !e.content.startsWith('ERRO DE CONEXAO'));
                webviewView.webview.postMessage({ command: 'load_history', entries: history });
                webviewView.webview.postMessage({ command: 'load_sessions', sessions: this._historyManager.loadSessions() });
                pingAndNotify(this._settings);
                sendOpenFiles();
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
                this._settings = { provider: message.provider ?? this._settings.provider, apiHost: message.apiHost ?? this._settings.apiHost, apiKey: message.apiKey ?? '', model: message.model ?? '', enabledTools: message.enabledTools ?? this._settings.enabledTools, ragEnabled: message.ragEnabled ?? this._settings.ragEnabled, ragEndpoint: message.ragEndpoint ?? this._settings.ragEndpoint, ragCollection: message.ragCollection ?? this._settings.ragCollection };
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

            if (message?.command === 'confirm_command_response') {
                const resolve = this._pendingCommandConfirms.get(message.id);
                if (resolve) {
                    this._pendingCommandConfirms.delete(message.id);
                    resolve(message.decision as ConfirmCommandDecision ?? 'block');
                }
                return;
            }

            if (message?.command === 'stop') {
                this._abortController?.abort();
                return;
            }

            if (message?.command === 'inject_message' && message.text) {
                this._injectMessage?.(message.text);
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

                // Inclui diagnósticos do editor no bloco de contexto quando houver
                const diagnosticsBlock = collectDiagnostics();
                const fullContextBlock = [ctx.contextBlock, diagnosticsBlock].filter(Boolean).join('\n\n');

                const defaultCwd = getDefaultCwd(ctx.roots);
                const notifyCommandStart = (cmd: string) => webviewView.webview.postMessage({ command: 'command_start', cmd });
                const notifyCommandOutput = (chunk: string) => webviewView.webview.postMessage({ command: 'command_output', chunk });
                const notifyCommandEnd = (exitCode: number) => webviewView.webview.postMessage({ command: 'command_end', exitCode });
                const notifyStatus = (s: string) => {
                    notify(s);
                    if (s.toLowerCase().includes('aguardando sua resposta')) {
                        notifyUser('Processo rodando — aguardando sua resposta no chat', ['Abrir chat']);
                    }
                };

                this._abortController = new AbortController();
                this._injectMessage = null;
                webviewView.webview.postMessage({ command: 'agent_running', running: true });

                const notifyStreamChunk = (text: string) =>
                    webviewView.webview.postMessage({ command: 'stream_chunk', text });

                const notifyTelemetry = (metrics: { promptTokens: number; completionTokens: number; tokensPerSec: number; elapsedMs: number }) =>
                    webviewView.webview.postMessage({ command: 'telemetry', ...metrics });

                const notifyLiveTelemetry = (tokens: number, tokensPerSec: number, elapsedMs: number) =>
                    webviewView.webview.postMessage({ command: 'live_telemetry', tokens, tokensPerSec, elapsedMs });

                response = await runAgentLoop(
                    message.text, fullContextBlock, defaultCwd, endpoint, authHeaders,
                    this._sessionHistory, notifyStatus, notifyCommandStart, notifyCommandOutput, notifyCommandEnd,
                    makeConfirmWrite(), makeConfirmCommand(), getDiagnostics,
                    makeTodoUpdate(),
                    activeModel, !!message.autoMode,
                    this._abortController.signal,
                    (handler) => { this._injectMessage = handler; },
                    this._settings.provider,
                    this._settings.apiKey,
                    this._settings.enabledTools,
                    notifyStreamChunk,
                    notifyTelemetry,
                    this._settings.ragEnabled ? this._settings.ragEndpoint : undefined,
                    this._settings.ragEnabled ? this._settings.ragCollection : undefined,
                    notifyLiveTelemetry
                );
                this._abortController = null;
                this._injectMessage = null;
                webviewView.webview.postMessage({ command: 'agent_running', running: false });
                if (response && !response.startsWith('[INTERROMPIDO]')) {
                    notifyUser('Tarefa concluida', ['Abrir chat']);
                }
                // Truncate long responses before saving to history to avoid inflating future prompts.
                const historySummary = response.length > 400 ? response.slice(0, 400) + '...' : response;
                this._sessionHistory = this._historyManager.append(this._sessionHistory, { role: 'assistant', content: historySummary, timestamp: Date.now() });
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
