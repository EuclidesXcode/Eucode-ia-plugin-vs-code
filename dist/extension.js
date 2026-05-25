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
function activate(context) {
    console.log('Eucode-IA Plugin ativo.');
    context.subscriptions.push(vscode.commands.registerCommand('eucode-ia.activateAgent', () => initializeEucodeAgent(context)));
}
async function initializeEucodeAgent(context) {
    const panel = vscode.window.createWebviewPanel('eucodeChatPanel', 'Eucode AI Agent', vscode.ViewColumn.One, { enableScripts: true, retainContextWhenHidden: true });
    const htmlPath = path.join(context.extensionUri.fsPath, 'webviews', 'chatPanel.html');
    panel.webview.html = fs.readFileSync(htmlPath, 'utf8');
    const historyManager = new HistoryManagerService_1.HistoryManagerService(context);
    let sessionHistory = historyManager.load();
    let settings = (0, settings_1.loadSettings)(context);
    const notify = (text) => panel.webview.postMessage({ command: 'status', text });
    // Mapa de Promises pendentes para aprovação de escrita de arquivo
    const pendingConfirms = new Map();
    async function pingAndNotify(s) {
        const endpoint = (0, settings_1.buildApiEndpoint)(s);
        const auth = (0, settings_1.buildAuthHeader)(s);
        const online = await (0, api_client_1.checkConnection)(endpoint, auth);
        panel.webview.postMessage({ command: 'connection_status', online });
    }
    function makeConfirmWrite() {
        return (req) => new Promise((resolve) => {
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
    panel.webview.onDidReceiveMessage(async (message) => {
        if (message?.command === 'webview_ready') {
            panel.webview.postMessage({
                command: 'load_config',
                provider: settings.provider,
                apiHost: settings.apiHost,
                apiKey: settings.apiKey,
                model: settings.model,
            });
            const history = sessionHistory.filter(e => !e.content.startsWith('ERRO DE CONEXAO'));
            panel.webview.postMessage({ command: 'load_history', entries: history });
            panel.webview.postMessage({ command: 'load_sessions', sessions: historyManager.loadSessions() });
            pingAndNotify(settings);
            return;
        }
        if (message?.command === 'new_session') {
            sessionHistory = await historyManager.newSession();
            panel.webview.postMessage({ command: 'session_started', entries: [] });
            panel.webview.postMessage({ command: 'load_sessions', sessions: historyManager.loadSessions() });
            return;
        }
        if (message?.command === 'load_session') {
            sessionHistory = await historyManager.loadSession(message.id);
            panel.webview.postMessage({ command: 'load_history', entries: sessionHistory });
            panel.webview.postMessage({ command: 'load_sessions', sessions: historyManager.loadSessions() });
            return;
        }
        if (message?.command === 'delete_session') {
            await historyManager.deleteSession(message.id);
            sessionHistory = historyManager.load();
            panel.webview.postMessage({ command: 'load_sessions', sessions: historyManager.loadSessions() });
            return;
        }
        if (message?.command === 'save_config') {
            settings = {
                provider: message.provider ?? settings.provider,
                apiHost: message.apiHost ?? settings.apiHost,
                apiKey: message.apiKey ?? '',
                model: message.model ?? '',
            };
            await (0, settings_1.saveSettings)(context, settings);
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
        if (message?.command !== 'user_input' || !message.text) {
            return;
        }
        sessionHistory = historyManager.append(sessionHistory, {
            role: 'user',
            content: message.text,
            timestamp: Date.now(),
            hasImage: !!message.image,
        });
        const endpoint = (0, settings_1.buildApiEndpoint)(settings);
        const authHeaders = (0, settings_1.buildAuthHeader)(settings);
        const activeModel = settings.model || constants_1.DEFAULT_MODEL;
        let response;
        if (message.image?.base64) {
            notify('Analisando imagem...');
            const historySummary = (0, history_service_1.buildHistorySummary)(sessionHistory.slice(0, -1));
            const systemWithHistory = [prompt_1.SYSTEM_PROMPT, historySummary].filter(Boolean).join('\n\n');
            response = await (0, api_client_1.callAIWithVision)(endpoint, authHeaders, message.text, message.image.base64, message.image.mimeType, systemWithHistory, activeModel);
            sessionHistory = historyManager.append(sessionHistory, {
                role: 'assistant',
                content: response,
                timestamp: Date.now(),
                hasImage: true,
                imageSummary: response.slice(0, 300),
            });
        }
        else {
            notify('Mapeando workspace...');
            const ctx = (0, context_1.collectWorkspaceContext)();
            if (ctx.openFiles.length > 0) {
                notify(`Abertos no editor: ${ctx.openFiles.map(f => f.name).join(', ')}`);
            }
            const defaultCwd = (0, context_1.getDefaultCwd)(ctx.roots);
            const notifyCommandStart = (cmd) => panel.webview.postMessage({ command: 'command_start', cmd });
            const notifyCommandOutput = (chunk) => panel.webview.postMessage({ command: 'command_output', chunk });
            response = await (0, loop_1.runAgentLoop)(message.text, ctx.contextBlock, defaultCwd, endpoint, authHeaders, sessionHistory, notify, notifyCommandStart, notifyCommandOutput, makeConfirmWrite(), activeModel);
            sessionHistory = historyManager.append(sessionHistory, {
                role: 'assistant',
                content: response,
                timestamp: Date.now(),
            });
        }
        panel.webview.postMessage({ command: 'agent_response', text: response });
    }, undefined, context.subscriptions);
}
function deactivate() { }
