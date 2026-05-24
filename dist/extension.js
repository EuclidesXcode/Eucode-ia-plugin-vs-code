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
const context_1 = require("./workspace/context");
const loop_1 = require("./agent/loop");
const prompt_1 = require("./agent/prompt");
const settings_1 = require("./config/settings");
function activate(context) {
    console.log('Eucode-IA Plugin ativo.');
    context.subscriptions.push(vscode.commands.registerCommand('eucode-ia.activateAgent', () => initializeEucodeAgent(context)));
}
async function initializeEucodeAgent(context) {
    const panel = vscode.window.createWebviewPanel('eucodeChatPanel', 'Eucode AI Agent', vscode.ViewColumn.One, { enableScripts: true });
    const htmlPath = path.join(context.extensionUri.fsPath, 'webviews', 'chatPanel.html');
    panel.webview.html = fs.readFileSync(htmlPath, 'utf8');
    let sessionHistory = (0, history_service_1.loadHistory)();
    let settings = (0, settings_1.loadSettings)(context);
    const notify = (text) => panel.webview.postMessage({ command: 'status', text });
    // Envia as configuracoes atuais para o webview assim que abre
    panel.webview.onDidReceiveMessage(async (message) => {
        if (message?.command === 'webview_ready') {
            panel.webview.postMessage({ command: 'load_config', apiHost: settings.apiHost });
            return;
        }
        if (message?.command === 'save_config') {
            settings = { apiHost: message.apiHost ?? settings.apiHost };
            await (0, settings_1.saveSettings)(context, settings);
            panel.webview.postMessage({ command: 'config_saved' });
            return;
        }
        if (message?.command !== 'user_input' || !message.text) {
            return;
        }
        sessionHistory = (0, history_service_1.appendEntry)(sessionHistory, {
            role: 'user',
            content: message.text,
            timestamp: Date.now(),
            hasImage: !!message.image,
        });
        const endpoint = (0, settings_1.buildApiEndpoint)(settings);
        let response;
        if (message.image?.base64) {
            notify('Analisando imagem...');
            const historySummary = (0, history_service_1.buildHistorySummary)(sessionHistory.slice(0, -1));
            const systemWithHistory = [prompt_1.SYSTEM_PROMPT, historySummary].filter(Boolean).join('\n\n');
            response = await (0, api_client_1.callAIWithVision)(endpoint, message.text, message.image.base64, message.image.mimeType, systemWithHistory);
            sessionHistory = (0, history_service_1.appendEntry)(sessionHistory, {
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
            response = await (0, loop_1.runAgentLoop)(message.text, ctx.contextBlock, defaultCwd, endpoint, sessionHistory, notify);
            sessionHistory = (0, history_service_1.appendEntry)(sessionHistory, {
                role: 'assistant',
                content: response,
                timestamp: Date.now(),
            });
        }
        panel.webview.postMessage({ command: 'agent_response', text: response });
    }, undefined, context.subscriptions);
}
function deactivate() { }
