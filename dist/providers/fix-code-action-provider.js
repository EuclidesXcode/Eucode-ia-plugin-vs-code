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
exports.EucodeFixCodeActionProvider = void 0;
exports.executeFixWithEucode = executeFixWithEucode;
const vscode = __importStar(require("vscode"));
const completion_service_1 = require("../services/completion-service");
const MAX_TOKENS = 1024;
class EucodeFixCodeActionProvider {
    constructor(getSettings) {
        this.getSettings = getSettings;
    }
    provideCodeActions(document, range, context) {
        const settings = this.getSettings();
        if (!settings.fixWithEucodeEnabled) {
            return;
        }
        const actions = [];
        // QuickFix bound to diagnostics
        if (context.diagnostics.length > 0) {
            const action = new vscode.CodeAction('◆ Fix with Eucode', vscode.CodeActionKind.QuickFix);
            action.command = {
                command: 'eucode-ia.fixWithEucode',
                title: 'Fix with Eucode',
                arguments: [document.uri, range, context.diagnostics],
            };
            action.diagnostics = [...context.diagnostics];
            action.isPreferred = false;
            actions.push(action);
        }
        // Refactor on plain selection (no diagnostic)
        if (!range.isEmpty && context.diagnostics.length === 0) {
            const action = new vscode.CodeAction('◆ Refactor with Eucode', vscode.CodeActionKind.Refactor);
            action.command = {
                command: 'eucode-ia.fixWithEucode',
                title: 'Refactor with Eucode',
                arguments: [document.uri, range, []],
            };
            actions.push(action);
        }
        return actions;
    }
}
exports.EucodeFixCodeActionProvider = EucodeFixCodeActionProvider;
EucodeFixCodeActionProvider.providedCodeActionKinds = [
    vscode.CodeActionKind.QuickFix,
    vscode.CodeActionKind.Refactor,
];
// Command implementation — registered separately so it can be invoked from
// the code action AND from the context menu (which doesn't pass range/diags).
async function executeFixWithEucode(getSettings, uriArg, rangeArg, diagsArg) {
    const settings = getSettings();
    if (!settings.fixWithEucodeEnabled) {
        vscode.window.showInformationMessage('Eucode IA: ative "Fix with Eucode" nas configuracoes do plugin.');
        return;
    }
    const editor = vscode.window.activeTextEditor;
    if (!editor) {
        vscode.window.showInformationMessage('Eucode IA: nenhum editor ativo.');
        return;
    }
    const document = uriArg
        ? await vscode.workspace.openTextDocument(uriArg)
        : editor.document;
    const range = rangeArg ?? editor.selection;
    const diagnostics = diagsArg ?? vscode.languages.getDiagnostics(document.uri).filter(d => d.range.intersection(range) !== undefined);
    const selectedText = document.getText(range);
    if (!selectedText.trim()) {
        vscode.window.showInformationMessage('Eucode IA: selecione um trecho de codigo para corrigir.');
        return;
    }
    const diagText = diagnostics.length > 0
        ? diagnostics.map(d => `- ${d.message}`).join('\n')
        : '';
    const system = `You are a code fixer. Rewrite the given snippet to fix the issues. Return ONLY the corrected code — no explanations, no markdown fences, no preamble. Preserve the original indentation. Keep the public API and behavior intact unless a fix requires changing it.`;
    const user = diagText
        ? `Language: ${document.languageId}\n\nDiagnostics to fix:\n${diagText}\n\nOriginal code:\n${selectedText}\n\nFixed code:`
        : `Language: ${document.languageId}\n\nRefactor or improve this code (clarity, performance, idiomatic style). Original:\n${selectedText}\n\nImproved code:`;
    await vscode.window.withProgress({
        location: vscode.ProgressLocation.Notification,
        title: '◆ Eucode IA — gerando correcao...',
        cancellable: true,
    }, async (_progress, token) => {
        const abort = new AbortController();
        token.onCancellationRequested(() => abort.abort());
        const result = await (0, completion_service_1.getCompletion)(settings, {
            system,
            user,
            maxTokens: MAX_TOKENS,
            signal: abort.signal,
        });
        if (abort.signal.aborted) {
            return;
        }
        if (!result.text || result.error === 'aborted') {
            vscode.window.showWarningMessage(`Eucode IA: nao foi possivel gerar correcao${result.error ? ` (${result.error})` : ''}.`);
            return;
        }
        const cleaned = stripFences(result.text);
        // Preview as a diff editor before applying
        const apply = await vscode.window.showInformationMessage(`Eucode IA propos uma correcao (via ${result.source === 'support' ? 'IA paga (HYBRID)' : 'IA local'}). Aplicar?`, { modal: false }, 'Aplicar', 'Visualizar', 'Cancelar');
        if (apply === 'Visualizar') {
            const tempDoc = await vscode.workspace.openTextDocument({
                content: cleaned,
                language: document.languageId,
            });
            await vscode.window.showTextDocument(tempDoc, { preview: true, viewColumn: vscode.ViewColumn.Beside });
            return;
        }
        if (apply !== 'Aplicar') {
            return;
        }
        const edit = new vscode.WorkspaceEdit();
        edit.replace(document.uri, range, cleaned);
        await vscode.workspace.applyEdit(edit);
    });
}
function stripFences(text) {
    const fence = text.match(/```[a-z]*\n?([\s\S]+?)\n?```/i);
    return fence ? fence[1] : text.trim();
}
