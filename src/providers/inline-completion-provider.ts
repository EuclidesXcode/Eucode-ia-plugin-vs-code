import * as vscode from 'vscode';
import { EucodeSettings } from '../config/settings';
import { getCompletion } from '../services/completion-service';

const DEBOUNCE_MS = 500;
const CONTEXT_LINES_BEFORE = 30;
const CONTEXT_LINES_AFTER = 5;
const MAX_TOKENS = 256;

// Skip these — completion is annoying in non-code or commented contexts
const SKIP_LANGUAGES = new Set(['plaintext', 'markdown', 'log', 'git-commit']);

export class EucodeInlineCompletionProvider implements vscode.InlineCompletionItemProvider {
    private debounceTimer: NodeJS.Timeout | null = null;
    private activeAbortController: AbortController | null = null;

    constructor(private getSettings: () => EucodeSettings) {}

    async provideInlineCompletionItems(
        document: vscode.TextDocument,
        position: vscode.Position,
        _context: vscode.InlineCompletionContext,
        token: vscode.CancellationToken
    ): Promise<vscode.InlineCompletionItem[] | undefined> {
        const settings = this.getSettings();
        if (!settings.inlineCompletionEnabled) { return; }
        if (SKIP_LANGUAGES.has(document.languageId)) { return; }

        // Cancel previous in-flight request
        if (this.debounceTimer) { clearTimeout(this.debounceTimer); }
        this.activeAbortController?.abort();
        this.activeAbortController = new AbortController();
        const localAbort = this.activeAbortController;

        // Wait for the user to stop typing
        await new Promise<void>(resolve => {
            this.debounceTimer = setTimeout(resolve, DEBOUNCE_MS);
        });
        if (token.isCancellationRequested || localAbort.signal.aborted) { return; }

        // Build context window around cursor
        const startLine = Math.max(0, position.line - CONTEXT_LINES_BEFORE);
        const endLine = Math.min(document.lineCount - 1, position.line + CONTEXT_LINES_AFTER);
        const before = document.getText(new vscode.Range(startLine, 0, position.line, position.character));
        const after = document.getText(new vscode.Range(position.line, position.character, endLine, document.lineAt(endLine).text.length));

        // Don't trigger on empty line with no leading prefix
        const currentLine = document.lineAt(position.line).text;
        const prefix = currentLine.slice(0, position.character).trim();
        if (prefix.length === 0 && before.trim().length === 0) { return; }

        const system = `You are an inline code completion engine. Complete the code AT THE CURSOR position marked with <CURSOR/>. Return ONLY the new text to insert at the cursor — no explanations, no markdown, no code fences. Match the existing indentation and style exactly. Keep the completion concise: a few tokens to a few lines max. If no good completion is possible, return an empty response.`;
        const user = `Language: ${document.languageId}\nFile: ${document.fileName.split(/[/\\]/).pop()}\n\nCode:\n\`\`\`${document.languageId}\n${before}<CURSOR/>${after}\n\`\`\`\n\nInsert at <CURSOR/>:`;

        try {
            const result = await getCompletion(settings, {
                system,
                user,
                maxTokens: MAX_TOKENS,
                signal: localAbort.signal,
            });
            if (token.isCancellationRequested || localAbort.signal.aborted) { return; }

            const text = sanitizeCompletion(result.text);
            if (!text) { return; }

            return [new vscode.InlineCompletionItem(text, new vscode.Range(position, position))];
        } catch {
            return;
        }
    }
}

// Strip markdown fences, leading comments like "Here is the completion:", etc.
function sanitizeCompletion(raw: string): string {
    if (!raw) { return ''; }
    let text = raw;

    // Drop fenced code block wrapper if the model returned one
    const fence = text.match(/```[a-z]*\n?([\s\S]+?)\n?```/i);
    if (fence) { text = fence[1]; }

    // Drop common preamble lines
    text = text.replace(/^(here\s+is.*?:|sure[,.]?|completion:|insert:|the\s+code\s+is:?)\s*/i, '');

    return text;
}
