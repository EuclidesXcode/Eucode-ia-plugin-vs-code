import * as vscode from 'vscode';
import { EucodeSettings } from '../config/settings';
import { getCompletion } from '../services/completion-service';

const MAX_TOKENS = 1024;

export class EucodeFixCodeActionProvider implements vscode.CodeActionProvider {
    public static readonly providedCodeActionKinds = [
        vscode.CodeActionKind.QuickFix,
        vscode.CodeActionKind.Refactor,
    ];

    constructor(private getSettings: () => EucodeSettings) {}

    provideCodeActions(
        document: vscode.TextDocument,
        range: vscode.Range | vscode.Selection,
        context: vscode.CodeActionContext
    ): vscode.CodeAction[] | undefined {
        const settings = this.getSettings();
        if (!settings.fixWithEucodeEnabled) { return; }

        const actions: vscode.CodeAction[] = [];

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

// Command implementation — registered separately so it can be invoked from
// the code action AND from the context menu (which doesn't pass range/diags).
export async function executeFixWithEucode(
    getSettings: () => EucodeSettings,
    uriArg?: vscode.Uri,
    rangeArg?: vscode.Range,
    diagsArg?: vscode.Diagnostic[]
): Promise<void> {
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
    const diagnostics = diagsArg ?? vscode.languages.getDiagnostics(document.uri).filter(d =>
        d.range.intersection(range) !== undefined
    );

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

        const result = await getCompletion(settings, {
            system,
            user,
            maxTokens: MAX_TOKENS,
            signal: abort.signal,
        });

        if (abort.signal.aborted) { return; }

        if (!result.text || result.error === 'aborted') {
            vscode.window.showWarningMessage(`Eucode IA: nao foi possivel gerar correcao${result.error ? ` (${result.error})` : ''}.`);
            return;
        }

        const cleaned = stripFences(result.text);

        // Preview as a diff editor before applying
        const apply = await vscode.window.showInformationMessage(
            `Eucode IA propos uma correcao (via ${result.source === 'support' ? 'IA paga (HYBRID)' : 'IA local'}). Aplicar?`,
            { modal: false },
            'Aplicar', 'Visualizar', 'Cancelar'
        );

        if (apply === 'Visualizar') {
            const tempDoc = await vscode.workspace.openTextDocument({
                content: cleaned,
                language: document.languageId,
            });
            await vscode.window.showTextDocument(tempDoc, { preview: true, viewColumn: vscode.ViewColumn.Beside });
            return;
        }
        if (apply !== 'Aplicar') { return; }

        const edit = new vscode.WorkspaceEdit();
        edit.replace(document.uri, range, cleaned);
        await vscode.workspace.applyEdit(edit);
    });
}

function stripFences(text: string): string {
    const fence = text.match(/```[a-z]*\n?([\s\S]+?)\n?```/i);
    return fence ? fence[1] : text.trim();
}
