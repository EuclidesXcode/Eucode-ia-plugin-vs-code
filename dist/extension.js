"use strict";
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
Object.defineProperty(exports, "__esModule", { value: true });
exports.activate = activate;
exports.deactivate = deactivate;
const vscode = __importStar(require("vscode"));
const fs = __importStar(require("fs"));
const path = __importStar(require("path"));
const api_client_1 = require("./services/api-client");
const history_service_1 = require("./services/history-service");
const HistoryManagerService_1 = require("./services/HistoryManagerService");
const context_1 = require("./workspace/context");
const loop_1 = require("./agent/loop");
const prompt_1 = require("./agent/prompt");
const settings_1 = require("./config/settings");
const constants_1 = require("./utils/constants");
class EucodeViewProvider {
    constructor(_context) {
        this._context = _context;
        this._sessionHistory = [];
        this._pendingConfirms = new Map();
        this._pendingCommandConfirms = new Map();
        this._abortController = null;
        this._injectMessage = null;
        this._windowFocused = true;
        this._historyManager = new HistoryManagerService_1.HistoryManagerService(_context);
        this._sessionHistory = this._historyManager.load();
        this._settings = (0, settings_1.loadSettings)(_context);
    }
    resolveWebviewView(webviewView, _ctx, _token) {
        webviewView.webview.options = {
            enableScripts: true,
            localResourceRoots: [this._context.extensionUri],
        };
        const htmlPath = path.join(this._context.extensionUri.fsPath, 'webviews', 'chatPanel.html');
        webviewView.webview.html = fs.readFileSync(htmlPath, 'utf8');
        const notify = (text) => webviewView.webview.postMessage({ command: 'status', text });
        this._windowFocused = vscode.window.state.focused;
        this._context.subscriptions.push(vscode.window.onDidChangeWindowState(state => { this._windowFocused = state.focused; }));
        const notifyUser = (message, actions = []) => {
            if (!this._windowFocused) {
                vscode.window.showInformationMessage(`Eucode IA: ${message}`, ...actions).then(action => {
                    if (action) {
                        webviewView.show(true);
                    }
                });
                // Notificacao nativa do sistema operacional (macOS)
                if (process.platform === 'darwin') {
                    const safe = message.replace(/"/g, '\\"');
                    require('child_process').exec(`osascript -e 'display notification "${safe}" with title "Eucode IA"'`);
                }
            }
        };
        const makeConfirmWrite = () => (req) => new Promise((resolve) => {
            const id = `confirm_${Date.now()}`;
            this._pendingConfirms.set(id, resolve);
            webviewView.webview.postMessage({ command: 'confirm_write', id, filePath: req.filePath, before: req.before, after: req.after });
            notifyUser(`Aguardando aprovacao para editar "${path.basename(req.filePath)}"`, ['Abrir chat']);
        });
        const makeConfirmCommand = () => (req) => new Promise((resolve) => {
            const id = `cmd_${Date.now()}`;
            this._pendingCommandConfirms.set(id, resolve);
            webviewView.webview.postMessage({ command: 'confirm_command', id, cmd: req.command, cwd: req.cwd });
            notifyUser(`Aguardando aprovacao para executar comando`, ['Abrir chat']);
        });
        const getDiagnostics = () => (0, context_1.collectDiagnostics)();
        const makeTodoUpdate = () => (todos) => {
            webviewView.webview.postMessage({ command: 'todo_update', todos });
        };
        const pingAndNotify = async (s) => {
            const online = s.provider === 'anthropic'
                ? await (0, api_client_1.checkAnthropicConnection)(s.apiKey)
                : await (0, api_client_1.checkConnection)((0, settings_1.buildApiEndpoint)(s), (0, settings_1.buildAuthHeader)(s));
            webviewView.webview.postMessage({ command: 'connection_status', online });
        };
        this._context.subscriptions.push(vscode.workspace.onDidChangeWorkspaceFolders(() => {
            this._sessionHistory = this._historyManager.load();
            const filtered = this._sessionHistory.filter(e => !e.content.startsWith('ERRO DE CONEXAO'));
            webviewView.webview.postMessage({ command: 'load_history', entries: filtered });
        }));
        const sendOpenFiles = () => {
            const ctx = (0, context_1.collectWorkspaceContext)();
            webviewView.webview.postMessage({ command: 'open_files', files: ctx.openFiles });
        };
        this._context.subscriptions.push(vscode.window.onDidChangeActiveTextEditor(() => sendOpenFiles()), vscode.window.tabGroups.onDidChangeTabs(() => sendOpenFiles()));
        webviewView.webview.onDidReceiveMessage(async (message) => {
            if (message?.command === 'webview_ready') {
                webviewView.webview.postMessage({ command: 'load_config', provider: this._settings.provider, apiHost: this._settings.apiHost, apiKey: this._settings.apiKey, model: this._settings.model, enabledTools: this._settings.enabledTools });
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
                this._settings = { provider: message.provider ?? this._settings.provider, apiHost: message.apiHost ?? this._settings.apiHost, apiKey: message.apiKey ?? '', model: message.model ?? '', enabledTools: message.enabledTools ?? this._settings.enabledTools };
                await (0, settings_1.saveSettings)(this._context, this._settings);
                webviewView.webview.postMessage({ command: 'config_saved' });
                pingAndNotify(this._settings);
                return;
            }
            if (message?.command === 'confirm_write_response') {
                const resolve = this._pendingConfirms.get(message.id);
                if (resolve) {
                    this._pendingConfirms.delete(message.id);
                    resolve(message.approved === true);
                }
                return;
            }
            if (message?.command === 'confirm_command_response') {
                const resolve = this._pendingCommandConfirms.get(message.id);
                if (resolve) {
                    this._pendingCommandConfirms.delete(message.id);
                    resolve(message.decision ?? 'block');
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
            if (message?.command !== 'user_input' || !message.text) {
                return;
            }
            this._sessionHistory = this._historyManager.append(this._sessionHistory, { role: 'user', content: message.text, timestamp: Date.now(), hasImage: !!message.image });
            const endpoint = (0, settings_1.buildApiEndpoint)(this._settings);
            const authHeaders = (0, settings_1.buildAuthHeader)(this._settings);
            const activeModel = this._settings.model || constants_1.DEFAULT_MODEL;
            let response;
            if (message.image?.base64) {
                notify('Analisando imagem...');
                const historySummary = (0, history_service_1.buildHistorySummary)(this._sessionHistory.slice(0, -1));
                const systemWithHistory = [prompt_1.SYSTEM_PROMPT, historySummary].filter(Boolean).join('\n\n');
                response = await (0, api_client_1.callAIWithVision)(endpoint, authHeaders, message.text, message.image.base64, message.image.mimeType, systemWithHistory, activeModel);
                this._sessionHistory = this._historyManager.append(this._sessionHistory, { role: 'assistant', content: response, timestamp: Date.now(), hasImage: true, imageSummary: response.slice(0, 300) });
            }
            else {
                notify('Mapeando workspace...');
                const ctx = (0, context_1.collectWorkspaceContext)();
                if (ctx.openFiles.length > 0) {
                    notify(`Abertos no editor: ${ctx.openFiles.map(f => f.name).join(', ')}`);
                }
                // Inclui diagnósticos do editor no bloco de contexto quando houver
                const diagnosticsBlock = (0, context_1.collectDiagnostics)();
                const fullContextBlock = [ctx.contextBlock, diagnosticsBlock].filter(Boolean).join('\n\n');
                const defaultCwd = (0, context_1.getDefaultCwd)(ctx.roots);
                const notifyCommandStart = (cmd) => webviewView.webview.postMessage({ command: 'command_start', cmd });
                const notifyCommandOutput = (chunk) => webviewView.webview.postMessage({ command: 'command_output', chunk });
                const notifyCommandEnd = (exitCode) => webviewView.webview.postMessage({ command: 'command_end', exitCode });
                const notifyStatus = (s) => {
                    notify(s);
                    if (s.toLowerCase().includes('aguardando sua resposta')) {
                        notifyUser('Processo rodando — aguardando sua resposta no chat', ['Abrir chat']);
                    }
                };
                this._abortController = new AbortController();
                this._injectMessage = null;
                webviewView.webview.postMessage({ command: 'agent_running', running: true });
                const notifyStreamChunk = (text) => webviewView.webview.postMessage({ command: 'stream_chunk', text });
                response = await (0, loop_1.runAgentLoop)(message.text, fullContextBlock, defaultCwd, endpoint, authHeaders, this._sessionHistory, notifyStatus, notifyCommandStart, notifyCommandOutput, notifyCommandEnd, makeConfirmWrite(), makeConfirmCommand(), getDiagnostics, makeTodoUpdate(), activeModel, !!message.autoMode, this._abortController.signal, (handler) => { this._injectMessage = handler; }, this._settings.provider, this._settings.apiKey, this._settings.enabledTools, notifyStreamChunk);
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
EucodeViewProvider.viewType = 'eucode-ia.chatView';
function activate(context) {
    console.log('Eucode-IA Plugin ativo.');
    const provider = new EucodeViewProvider(context);
    context.subscriptions.push(vscode.window.registerWebviewViewProvider(EucodeViewProvider.viewType, provider, {
        webviewOptions: { retainContextWhenHidden: true },
    }));
    context.subscriptions.push(vscode.commands.registerCommand('eucode-ia.activateAgent', () => {
        vscode.commands.executeCommand('eucode-ia.chatView.focus');
    }));
    context.subscriptions.push(vscode.commands.registerCommand('eucode-ia.openChat', () => {
        vscode.commands.executeCommand('eucode-ia.chatView.focus');
    }));
}
function deactivate() { }
