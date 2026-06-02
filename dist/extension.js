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
const inline_completion_provider_1 = require("./providers/inline-completion-provider");
const fix_code_action_provider_1 = require("./providers/fix-code-action-provider");
const custom_commands_1 = require("./services/custom-commands");
const memory_service_1 = require("./services/memory-service");
const workspace_init_1 = require("./services/workspace-init");
const constants_1 = require("./utils/constants");
class EucodeViewProvider {
    getCurrentSettings() { return this._settings; }
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
        // Loads commands from the configured scope and pushes them to the
        // webview so the chat input can autocomplete on `/`. Errors come
        // through as a separate field for non-blocking display.
        const pushCommandsToWebview = () => {
            const scope = this._settings.customCommandsScope;
            const { commands, errors } = (0, custom_commands_1.loadCommands)(scope);
            webviewView.webview.postMessage({
                command: 'command_list',
                commands,
                errors,
                scope,
                filePath: (0, custom_commands_1.getCommandsFilePath)(scope),
            });
        };
        // Hot-reload: rewatch whenever the scope changes
        let commandsWatcher = (0, custom_commands_1.watchCommandsFile)(this._settings.customCommandsScope, () => pushCommandsToWebview());
        this._context.subscriptions.push({
            dispose: () => commandsWatcher.dispose(),
        });
        const rewatchCommands = () => {
            commandsWatcher.dispose();
            commandsWatcher = (0, custom_commands_1.watchCommandsFile)(this._settings.customCommandsScope, () => pushCommandsToWebview());
        };
        this._context.subscriptions.push(vscode.window.onDidChangeActiveTextEditor(() => sendOpenFiles()), vscode.window.tabGroups.onDidChangeTabs(() => sendOpenFiles()));
        webviewView.webview.onDidReceiveMessage(async (message) => {
            if (message?.command === 'webview_ready') {
                // Initialize/migrate the .eucode/ workspace folder. Idempotent —
                // safe to call on every open. Surfaces a notification if legacy
                // files were moved into .eucode/ this run.
                const initResult = (0, workspace_init_1.ensureEucodeWorkspace)();
                if (initResult.migrated.length > 0) {
                    const moved = initResult.migrated.join(', ');
                    vscode.window.showInformationMessage(`Eucode IA: ${moved} foram movidos para .eucode/. Tudo continua funcionando.`, 'Abrir pasta').then(action => { if (action === 'Abrir pasta') {
                        (0, workspace_init_1.revealEucodeDir)();
                    } });
                }
                webviewView.webview.postMessage({
                    command: 'load_config',
                    provider: this._settings.provider,
                    apiHost: this._settings.apiHost,
                    apiKey: this._settings.apiKey,
                    model: this._settings.model,
                    enabledTools: this._settings.enabledTools,
                    ragEnabled: this._settings.ragEnabled,
                    ragEndpoint: this._settings.ragEndpoint,
                    ragCollection: this._settings.ragCollection,
                    hybridEnabled: this._settings.hybridEnabled,
                    supportProvider: this._settings.supportProvider,
                    supportApiKey: this._settings.supportApiKey,
                    supportModel: this._settings.supportModel,
                    inlineCompletionEnabled: this._settings.inlineCompletionEnabled,
                    fixWithEucodeEnabled: this._settings.fixWithEucodeEnabled,
                    customCommandsScope: this._settings.customCommandsScope,
                });
                const history = this._sessionHistory.filter(e => !e.content.startsWith('ERRO DE CONEXAO'));
                webviewView.webview.postMessage({ command: 'load_history', entries: history });
                webviewView.webview.postMessage({ command: 'load_sessions', sessions: this._historyManager.loadSessions() });
                pingAndNotify(this._settings);
                sendOpenFiles();
                pushCommandsToWebview();
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
                // Delete the per-session memory file alongside the session itself
                (0, memory_service_1.deleteSessionMemory)(message.id);
                await this._historyManager.deleteSession(message.id);
                this._sessionHistory = this._historyManager.load();
                webviewView.webview.postMessage({ command: 'load_sessions', sessions: this._historyManager.loadSessions() });
                return;
            }
            if (message?.command === 'save_config') {
                this._settings = {
                    provider: message.provider ?? this._settings.provider,
                    apiHost: message.apiHost ?? this._settings.apiHost,
                    apiKey: message.apiKey ?? '',
                    model: message.model ?? '',
                    enabledTools: message.enabledTools ?? this._settings.enabledTools,
                    ragEnabled: message.ragEnabled ?? this._settings.ragEnabled,
                    ragEndpoint: message.ragEndpoint ?? this._settings.ragEndpoint,
                    ragCollection: message.ragCollection ?? this._settings.ragCollection,
                    hybridEnabled: message.hybridEnabled ?? this._settings.hybridEnabled,
                    supportProvider: message.supportProvider ?? this._settings.supportProvider,
                    // Empty string from UI means "don't change" — preserve stored key
                    supportApiKey: (message.supportApiKey && message.supportApiKey.length > 0)
                        ? message.supportApiKey
                        : this._settings.supportApiKey,
                    supportModel: message.supportModel ?? this._settings.supportModel,
                    inlineCompletionEnabled: message.inlineCompletionEnabled ?? this._settings.inlineCompletionEnabled,
                    fixWithEucodeEnabled: message.fixWithEucodeEnabled ?? this._settings.fixWithEucodeEnabled,
                    customCommandsScope: message.customCommandsScope ?? this._settings.customCommandsScope,
                };
                await (0, settings_1.saveSettings)(this._context, this._settings);
                vscode.commands.executeCommand('setContext', 'eucodeFixEnabled', this._settings.fixWithEucodeEnabled);
                webviewView.webview.postMessage({ command: 'config_saved' });
                pingAndNotify(this._settings);
                return;
            }
            if (message?.command === 'set_hybrid') {
                this._settings = { ...this._settings, hybridEnabled: !!message.enabled };
                await (0, settings_1.saveSettings)(this._context, this._settings);
                return;
            }
            if (message?.command === 'save_command') {
                const cmd = {
                    command: String(message.commandName || '').trim(),
                    prompt: String(message.prompt || '').trim(),
                    description: message.description ? String(message.description).trim() : undefined,
                    autoMode: !!message.autoMode,
                    hybridMode: !!message.hybridMode,
                };
                const scope = (message.scope === 'global' || message.scope === 'workspace')
                    ? message.scope
                    : this._settings.customCommandsScope;
                const result = await (0, custom_commands_1.appendCommand)(scope, cmd);
                webviewView.webview.postMessage({
                    command: 'save_command_result',
                    ok: result.ok,
                    error: result.error,
                    filePath: result.filePath,
                });
                if (result.ok) {
                    pushCommandsToWebview();
                }
                return;
            }
            if (message?.command === 'open_commands_file') {
                const scope = (message.scope === 'global' || message.scope === 'workspace')
                    ? message.scope
                    : this._settings.customCommandsScope;
                const fp = (0, custom_commands_1.getCommandsFilePath)(scope);
                if (!fp) {
                    vscode.window.showWarningMessage('Eucode IA: abra um workspace para usar comandos em escopo workspace.');
                    return;
                }
                try {
                    require('fs').mkdirSync(require('path').dirname(fp), { recursive: true });
                    if (!require('fs').existsSync(fp)) {
                        require('fs').writeFileSync(fp, '[\n]\n', 'utf8');
                    }
                    const doc = await vscode.workspace.openTextDocument(fp);
                    await vscode.window.showTextDocument(doc, { preview: false });
                }
                catch (e) {
                    vscode.window.showErrorMessage(`Eucode IA: nao foi possivel abrir ${fp}: ${e instanceof Error ? e.message : String(e)}`);
                }
                return;
            }
            if (message?.command === 'change_commands_scope') {
                const next = message.scope === 'global' ? 'global' : 'workspace';
                this._settings = { ...this._settings, customCommandsScope: next };
                await (0, settings_1.saveSettings)(this._context, this._settings);
                rewatchCommands();
                pushCommandsToWebview();
                return;
            }
            if (message?.command === 'remember_decision') {
                const activeId = this._historyManager.getActiveId();
                if (!activeId) {
                    webviewView.webview.postMessage({ command: 'remember_decision_result', ok: false, error: 'Nenhuma sessao ativa.' });
                    return;
                }
                const result = (0, memory_service_1.rememberDecision)(activeId, String(message.note || ''), 'user');
                webviewView.webview.postMessage({
                    command: 'remember_decision_result',
                    ok: result.ok,
                    error: result.reason,
                });
                return;
            }
            if (message?.command === 'open_memory_file') {
                const activeId = this._historyManager.getActiveId();
                if (!activeId) {
                    vscode.window.showWarningMessage('Eucode IA: nenhuma sessao ativa. Inicie um chat antes de abrir a memoria.');
                    return;
                }
                const fp = (0, memory_service_1.getSessionMemoryPath)(activeId);
                if (!fp) {
                    vscode.window.showWarningMessage('Eucode IA: abra um workspace para usar memoria de sessao.');
                    return;
                }
                try {
                    require('fs').mkdirSync(require('path').dirname(fp), { recursive: true });
                    if (!require('fs').existsSync(fp)) {
                        require('fs').writeFileSync(fp, JSON.stringify({ sessionId: activeId, createdAt: Date.now(), updatedAt: Date.now(), approvedCommands: [], decisions: [] }, null, 2) + '\n', 'utf8');
                    }
                    const doc = await vscode.workspace.openTextDocument(fp);
                    await vscode.window.showTextDocument(doc, { preview: false });
                }
                catch (e) {
                    vscode.window.showErrorMessage(`Eucode IA: nao foi possivel abrir ${fp}: ${e instanceof Error ? e.message : String(e)}`);
                }
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
            const userMode = message.chatMode ? 'chat' : 'dev';
            this._sessionHistory = this._historyManager.append(this._sessionHistory, { role: 'user', content: message.text, timestamp: Date.now(), hasImage: !!message.image, mode: userMode });
            const endpoint = (0, settings_1.buildApiEndpoint)(this._settings);
            const authHeaders = (0, settings_1.buildAuthHeader)(this._settings);
            const activeModel = this._settings.model || constants_1.DEFAULT_MODEL;
            let response;
            if (message.image?.base64) {
                notify('Analisando imagem...');
                const historySummary = (0, history_service_1.buildHistorySummary)(this._sessionHistory.slice(0, -1));
                const systemWithHistory = [prompt_1.SYSTEM_PROMPT, historySummary].filter(Boolean).join('\n\n');
                response = await (0, api_client_1.callAIWithVision)(endpoint, authHeaders, message.text, message.image.base64, message.image.mimeType, systemWithHistory, activeModel);
                this._sessionHistory = this._historyManager.append(this._sessionHistory, { role: 'assistant', content: response, timestamp: Date.now(), hasImage: true, imageSummary: response.slice(0, 300), mode: userMode });
            }
            else {
                // CHAT mode skips workspace mapping entirely — no "Mapeando workspace",
                // no "Abertos no editor", no diagnostics. The conversation is meant
                // to be free-form and not tied to the project.
                const isChat = userMode === 'chat';
                if (!isChat) {
                    notify('Mapeando workspace...');
                }
                const ctx = isChat
                    ? { openFiles: [], contextBlock: '', roots: [] }
                    : (0, context_1.collectWorkspaceContext)();
                if (!isChat && ctx.openFiles.length > 0) {
                    notify(`Abertos no editor: ${ctx.openFiles.map(f => f.name).join(', ')}`);
                }
                // Inclui diagnósticos do editor no bloco de contexto quando houver
                const diagnosticsBlock = isChat ? '' : (0, context_1.collectDiagnostics)();
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
                const notifyTelemetry = (metrics) => webviewView.webview.postMessage({ command: 'telemetry', ...metrics });
                const notifyLiveTelemetry = (tokens, tokensPerSec, elapsedMs) => webviewView.webview.postMessage({ command: 'live_telemetry', tokens, tokensPerSec, elapsedMs });
                // Open the file the agent just wrote/edited in the editor so the
                // user sees the change live. Throttled per path — repeated touches
                // to the same file in quick succession only open once.
                const recentlyOpened = new Map();
                const openFileInEditor = (absolutePath) => {
                    const now = Date.now();
                    const last = recentlyOpened.get(absolutePath) || 0;
                    if (now - last < 1500) {
                        return;
                    }
                    recentlyOpened.set(absolutePath, now);
                    vscode.workspace.openTextDocument(absolutePath).then(doc => vscode.window.showTextDocument(doc, { preview: false, preserveFocus: true }), () => { });
                };
                // Hybrid: when toggled on AND a key is configured, ship support
                // config + activity callback to the loop.
                const hybridConfig = (message.hybridMode && this._settings.supportApiKey)
                    ? {
                        enabled: true,
                        provider: this._settings.supportProvider,
                        apiKey: this._settings.supportApiKey,
                        model: this._settings.supportModel,
                    }
                    : undefined;
                const notifyHybridActivity = (evt) => webviewView.webview.postMessage({ command: 'hybrid_activity', ...evt });
                response = await (0, loop_1.runAgentLoop)(message.text, fullContextBlock, defaultCwd, endpoint, authHeaders, this._sessionHistory, notifyStatus, notifyCommandStart, notifyCommandOutput, notifyCommandEnd, makeConfirmWrite(), makeConfirmCommand(), getDiagnostics, makeTodoUpdate(), activeModel, !!message.autoMode, this._abortController.signal, (handler) => { this._injectMessage = handler; }, this._settings.provider, this._settings.apiKey, this._settings.enabledTools, notifyStreamChunk, notifyTelemetry, this._settings.ragEnabled ? this._settings.ragEndpoint : undefined, this._settings.ragEnabled ? this._settings.ragCollection : undefined, notifyLiveTelemetry, openFileInEditor, hybridConfig, notifyHybridActivity, this._historyManager.getActiveId(), !!message.chatMode);
                this._abortController = null;
                this._injectMessage = null;
                webviewView.webview.postMessage({ command: 'agent_running', running: false });
                if (response && !response.startsWith('[INTERROMPIDO]')) {
                    notifyUser('Tarefa concluida', ['Abrir chat']);
                }
                // Truncate long responses before saving to history to avoid inflating future prompts.
                const historySummary = response.length > 400 ? response.slice(0, 400) + '...' : response;
                this._sessionHistory = this._historyManager.append(this._sessionHistory, { role: 'assistant', content: historySummary, timestamp: Date.now(), mode: userMode });
            }
            webviewView.webview.postMessage({ command: 'agent_response', text: response, mode: userMode });
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
    // ── Editor features: inline completion + fix with eucode ──
    const getSettings = () => provider.getCurrentSettings();
    // Set the initial context key for the menu visibility (Fix with Eucode)
    vscode.commands.executeCommand('setContext', 'eucodeFixEnabled', getSettings().fixWithEucodeEnabled);
    // Register inline completion provider for ALL languages — provider itself
    // checks the setting at runtime and bails when disabled, so registering
    // once is enough (no need to dispose/reregister on toggle).
    context.subscriptions.push(vscode.languages.registerInlineCompletionItemProvider({ scheme: 'file' }, new inline_completion_provider_1.EucodeInlineCompletionProvider(getSettings)));
    // Register code action provider (Quick Fix lightbulb + Refactor).
    context.subscriptions.push(vscode.languages.registerCodeActionsProvider({ scheme: 'file' }, new fix_code_action_provider_1.EucodeFixCodeActionProvider(getSettings), { providedCodeActionKinds: fix_code_action_provider_1.EucodeFixCodeActionProvider.providedCodeActionKinds }));
    // Register the fixWithEucode command (used by code action AND context menu).
    context.subscriptions.push(vscode.commands.registerCommand('eucode-ia.fixWithEucode', (uri, range, diags) => (0, fix_code_action_provider_1.executeFixWithEucode)(getSettings, uri, range, diags)));
}
function deactivate() { }
