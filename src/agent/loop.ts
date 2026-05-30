import * as path from 'path';
import * as fs from 'fs';
import { callAI, callAnthropicAI, ToolCall } from '../services/api-client';
import { queryRag, formatRagContext } from '../services/rag-client';
import { callSupportProvider } from '../services/hybrid-client';
import { AIProvider, SupportProvider } from '../config/settings';
import { DEFAULT_MODEL } from '../utils/constants';
import { HistoryEntry, buildMessagesFromHistory } from '../services/history-service';
import { listDirectory, readLocalFile, writeLocalFile, editLocalFile } from '../tools/file-tools';
import { searchInWorkspace, runGit, isCommandBlocked, isGitReadOnly } from '../tools/shell-tools';
import { webSearch } from '../tools/web-tools';
import { runCommandTool } from './tools-definition';
import { SYSTEM_PROMPT } from './prompt';
import { TOOLS, TOOL_NAMES } from './tools-definition';
import { MAX_AGENT_STEPS } from '../utils/constants';
import { resolveFilePath } from '../utils/validation';

export type TodoItem = { content: string; status: 'pending' | 'in_progress' | 'completed' };

type Message = { role: string; content: string | null; tool_calls?: any[]; tool_call_id?: string };

export type ConfirmWriteRequest = {
    filePath: string;
    before: string | null;
    after: string;
};

export type ConfirmCommandRequest = {
    command: string;
    cwd: string;
};

export type ConfirmCommandDecision = 'once' | 'session' | 'block';

export type HybridReason = 'plan' | 'verify_write' | 'verify_build' | 'recover_command' | 'recover_syntax' | 'recover_stop';
export type HybridActivityEvent = {
    provider: SupportProvider;
    reason: HybridReason;
    statusText: string;
    responseText?: string;
    promptTokens?: number;
    completionTokens?: number;
    elapsedMs?: number;
    success: boolean;
    error?: string;
};

export interface HybridConfig {
    enabled: boolean;
    provider: SupportProvider;
    apiKey: string;
    model?: string;
}

// Extrai nomes de funções, classes, exports e variáveis exportadas de um bloco de código
function extractSymbols(code: string): string[] {
    const patterns = [
        /^export\s+(?:async\s+)?function\s+(\w+)/gm,
        /^export\s+(?:const|let|var)\s+(\w+)/gm,
        /^export\s+class\s+(\w+)/gm,
        /^export\s+(?:default\s+)?(?:async\s+)?function\s+(\w+)/gm,
        /^(?:export\s+)?(?:async\s+)?function\s+(\w+)/gm,
        /^(?:export\s+)?class\s+(\w+)/gm,
    ];
    const symbols = new Set<string>();
    for (const pattern of patterns) {
        let match;
        while ((match = pattern.exec(code)) !== null) {
            if (match[1] && match[1].length > 2) { symbols.add(match[1]); }
        }
    }
    return Array.from(symbols);
}

async function checkRemovedSymbols(before: string, after: string, cwd: string): Promise<string[]> {
    const beforeSymbols = extractSymbols(before);
    const afterSymbols = new Set(extractSymbols(after));
    const removed = beforeSymbols.filter(s => !afterSymbols.has(s));
    if (removed.length === 0) { return []; }

    const warnings: string[] = [];
    for (const symbol of removed) {
        const result = await searchInWorkspace(symbol, cwd);
        if (result && !result.startsWith('[ERRO]') && result.trim().length > 0) {
            warnings.push(`  - "${symbol}" — referencias encontradas:\n${result.split('\n').slice(0, 3).map(l => '    ' + l).join('\n')}`);
        }
    }
    return warnings;
}

// Parses command output looking for error locations: "path/to/file.ext:LINE:COL"
// or "path/to/file.ext:LINE". Returns unique file paths in order of appearance
// plus a short summary line (first error message found).
function parseErrorLocations(output: string): { files: string[]; summary: string } {
    const seen = new Set<string>();
    const files: string[] = [];
    let summary = '';

    // file.ext:line:col or file.ext:line — common across tsc, eslint, jest, node
    const locationRe = /([A-Za-z0-9_\-./\\]+\.[A-Za-z0-9]{1,8})(?::(\d+))(?::(\d+))?/g;
    let m: RegExpExecArray | null;
    while ((m = locationRe.exec(output)) !== null) {
        const file = m[1];
        // skip node_modules, dist, common non-source paths
        if (/node_modules|\bdist\/|\.next\/|coverage\//.test(file)) { continue; }
        // skip common false positives (URLs, version strings)
        if (file.startsWith('http') || /\.(?:js|ts|tsx|jsx|css|scss|json|html|vue|svelte|py|rs|go|java|md)$/i.test(file) === false) { continue; }
        if (!seen.has(file)) {
            seen.add(file);
            files.push(file);
        }
        if (files.length >= 5) { break; }
    }

    // First line that looks like an error message
    const errorLineRe = /^.*(?:error|Error|ERROR|TypeError|ReferenceError|SyntaxError|Cannot|Failed|failed|undefined).*$/m;
    const errMatch = output.match(errorLineRe);
    if (errMatch) { summary = errMatch[0].trim().slice(0, 200); }

    return { files, summary };
}

function buildToolHandlers(
    onStatus: (s: string) => void,
    onCommandStart: (cmd: string) => void,
    onCommandOutput: (chunk: string) => void,
    onCommandEnd: (exitCode: number) => void,
    onConfirmWrite: (req: ConfirmWriteRequest) => Promise<boolean>,
    onConfirmCommand: (req: ConfirmCommandRequest) => Promise<ConfirmCommandDecision>,
    onGetDiagnostics: () => string,
    onTodoUpdate: (todos: TodoItem[]) => void,
    autoMode: boolean,
    filesReadThisRound: Set<string>,
    sessionApprovedCommands: Set<string>,
    fileCache: Map<string, string>,
    dirCache: Map<string, string>,
    counters: {
        filesWritten: number;
        lastCommandFailed: boolean;
        lastBuildPassed: boolean;
        lastErrorFiles: string[];
        lastErrorSummary: string;
        lastEditedFile: string;
    },
    onFileTouched?: (absolutePath: string) => void
): Record<string, (args: Record<string, any>, cwd: string, step: number, max: number) => Promise<string>> {
    return {
        list_directory: async (args, cwd) => {
            const dir = path.resolve(cwd, args.dirPath || args.path || cwd);
            if (dirCache.has(dir)) {
                onStatus(`Reading structure: ${path.basename(dir)} (cached)`);
                return dirCache.get(dir)!;
            }
            onStatus(`Reading structure: ${path.basename(dir)}`);
            const result = await listDirectory(dir, cwd);
            dirCache.set(dir, result);
            return result;
        },
        read_local_file: async (args, cwd) => {
            const fp: string = args.filePath || '';
            const fullPath = path.resolve(cwd, fp);
            if (fileCache.has(fullPath)) {
                onStatus(`Reading file: ${path.basename(fp)} (cached)`);
                filesReadThisRound.add(fullPath);
                return fileCache.get(fullPath)!;
            }
            onStatus(`Reading file: ${path.basename(fp)}`);
            const result = await readLocalFile(fp, cwd);
            fileCache.set(fullPath, result);
            filesReadThisRound.add(fullPath);
            return result;
        },
        edit_file: async (args, cwd) => {
            const filePath: string = args.filePath || '';
            const oldString: string = args.old_string ?? args.oldString ?? '';
            const newString: string = args.new_string ?? args.newString ?? '';

            if (!filePath) {
                return '[ERROR] filePath is required. Example: edit_file({"filePath": "/abs/path/to/file.ts", "old_string": "...", "new_string": "..."})';
            }

            let before: string | null = null;
            try {
                const fullPath = resolveFilePath(filePath, cwd);
                before = fs.readFileSync(fullPath, 'utf8');
            } catch { before = null; }

            // If old_string is empty, the model likely wants to create the file
            // or replace its entire content. Route to write_local_file logic
            // instead of failing with a terminal error.
            if (oldString === '') {
                if (before === null) {
                    // File doesn't exist yet — create it with new_string
                    onStatus(`Creating: ${path.basename(filePath)}`);
                    const writeResult = await writeLocalFile(filePath, newString, cwd);
                    fileCache.delete(resolveFilePath(filePath, cwd));
                    counters.filesWritten++;
                    onFileTouched?.(resolveFilePath(filePath, cwd));
                    return `[OK] File created via edit_file (empty old_string). ${writeResult}`;
                }
                // File exists — empty old_string is ambiguous. Guide the model.
                return `[ERROR] edit_file needs a non-empty old_string when the file already exists. To replace specific text: provide the exact existing text in old_string. To rewrite the entire file: use write_local_file instead. To append: use old_string with the last existing line and put that line + new content in new_string.`;
            }

            const after = before ? before.replace(oldString, newString) : newString;

            if (autoMode) {
                onStatus(`Editing: ${path.basename(filePath)}`);
                const editResult = editLocalFile(filePath, oldString, newString, cwd);
                fileCache.delete(resolveFilePath(filePath, cwd));
                counters.filesWritten++;
                counters.lastEditedFile = filePath;
                onFileTouched?.(resolveFilePath(filePath, cwd));
                return editResult;
            }

            onStatus(`Awaiting approval: ${path.basename(filePath)}`);
            const approved = await onConfirmWrite({ filePath, before, after });
            if (!approved) { return '[CANCELLED] User rejected the file change.'; }
            const editResult2 = editLocalFile(filePath, oldString, newString, cwd);
            fileCache.delete(resolveFilePath(filePath, cwd));
            counters.filesWritten++;
            counters.lastEditedFile = filePath;
            onFileTouched?.(resolveFilePath(filePath, cwd));
            return editResult2;
        },
        search_in_workspace: async (args, cwd) => {
            onStatus(`Searching project: "${args.query}"`);
            return searchInWorkspace(args.query || '', args.dirPath || cwd, cwd);
        },
        get_diagnostics: async () => {
            onStatus('Fetching editor diagnostics...');
            return onGetDiagnostics() || 'No errors or warnings found in the editor.';
        },
        write_local_file: async (args, cwd) => {
            const filePath: string = args.filePath || '';
            const content: string = args.content || '';

            let before: string | null = null;
            try {
                const fullPath = resolveFilePath(filePath, cwd);
                before = fs.readFileSync(fullPath, 'utf8');
            } catch { before = null; }

            if (before !== null) {
                const fullPath = resolveFilePath(filePath, cwd);
                if (!filesReadThisRound.has(fullPath)) {
                    return `[REQUIRED] You attempted to overwrite "${path.basename(filePath)}" without reading its current content. Use edit_file for partial changes, or call read_local_file("${filePath}") before using write_local_file with the full accumulated content.`;
                }
            }

            if (before) {
                const warnings = await checkRemovedSymbols(before, content, cwd);
                if (warnings.length > 0) {
                    return `[WARNING] The following symbols will be removed and were found in other files:\n${warnings.join('\n')}\n\nIf the removal is intentional as a direct replacement, call write_local_file again with explicit confirmation by starting the content with "// REMOVAL_CONFIRMED". Otherwise, revise the content to preserve these symbols.`;
                }
            }

            if (autoMode) {
                onStatus(`Writing: ${path.basename(filePath)}`);
                const writeResult = writeLocalFile(filePath, content, cwd);
                fileCache.delete(resolveFilePath(filePath, cwd));
                counters.filesWritten++;
                counters.lastEditedFile = filePath;
                onFileTouched?.(resolveFilePath(filePath, cwd));
                return writeResult;
            }

            onStatus(`Awaiting approval: ${path.basename(filePath)}`);
            const approved2 = await onConfirmWrite({ filePath, before, after: content });
            if (!approved2) { return '[CANCELLED] User rejected the file change.'; }
            const writeResult2 = writeLocalFile(filePath, content, cwd);
            fileCache.delete(resolveFilePath(filePath, cwd));
            counters.filesWritten++;
            counters.lastEditedFile = filePath;
            onFileTouched?.(resolveFilePath(filePath, cwd));
            return writeResult2;
        },
        run_command: async (args, cwd) => {
            const cmd: string = args.command || '';
            const workDir: string = args.cwd || cwd;

            if (isCommandBlocked(cmd)) {
                return `[BLOCKED] Command refused by security policy: "${cmd}"`;
            }

            if (!autoMode && !sessionApprovedCommands.has(cmd)) {
                onStatus(`Awaiting approval to run: ${cmd}`);
                const decision = await onConfirmCommand({ command: cmd, cwd: workDir });
                if (decision === 'block') {
                    return `[BLOCKED] User refused to run: "${cmd}"`;
                }
                if (decision === 'session') {
                    sessionApprovedCommands.add(cmd);
                }
            }

            onStatus(`Running: ${cmd}`);
            onCommandStart(cmd);
            return new Promise<string>((resolve) => {
                const emitter = runCommandTool(cmd, workDir);
                let output = '';
                let isLongRunning = false;
                let exitCode = 0;
                emitter.on('stdout', (chunk: string) => { output += chunk; onCommandOutput(chunk); });
                emitter.on('stderr', (chunk: string) => { output += chunk; onCommandOutput(chunk); });
                emitter.on('exit_code', (code: number) => { exitCode = code; });
                emitter.on('long_running', () => { isLongRunning = true; });
                emitter.on('done', () => {
                    onCommandEnd(exitCode);
                    const looksLikeBuild = /\b(build|test|tsc|compile|lint|jest|vitest|pytest|cargo build|go build|mvn|gradle)\b/i.test(cmd);
                    if (isLongRunning) {
                        // Long-running processes (dev servers, watchers) often emit runtime
                        // errors AFTER startup — capture them so the model gets oriented.
                        const parsedRuntime = parseErrorLocations(output);
                        counters.lastErrorFiles = parsedRuntime.files;
                        counters.lastErrorSummary = parsedRuntime.summary;
                        // Heuristic: if output contains "error" keywords AFTER ready markers,
                        // treat as a failure to fix even though the process is "running".
                        const hasRuntimeError = /\b(TypeError|ReferenceError|SyntaxError|Cannot read|Uncaught|500\b)/i.test(output);
                        onStatus(hasRuntimeError ? 'Runtime errors detected — fixing...' : 'Process running — awaiting your response...');
                        counters.lastCommandFailed = hasRuntimeError;
                        if (looksLikeBuild && !hasRuntimeError) { counters.lastBuildPassed = true; }
                        const prefix = hasRuntimeError ? '[RUNTIME ERROR]' : '[PROCESS STARTED]';
                        resolve(`${prefix} Command "${cmd}". Output:\n${output}${hasRuntimeError ? '\nThe server started but is throwing errors. Fix the root cause in the file listed above.' : '\nThe server is up.'}`);
                    } else if (exitCode !== 0) {
                        const parsed = parseErrorLocations(output);
                        counters.lastCommandFailed = true;
                        counters.lastErrorFiles = parsed.files;
                        counters.lastErrorSummary = parsed.summary;
                        if (looksLikeBuild) { counters.lastBuildPassed = false; }
                        const hint = parsed.files.length > 0
                            ? `\n\n[ERROR LOCATIONS] Fix these files (in order):\n${parsed.files.map(f => `  - ${f}`).join('\n')}`
                            : '';
                        resolve(`[FAILED exit=${exitCode}] Command "${cmd}" failed. You MUST diagnose and fix the underlying issue, then re-run. Do not give up. Output:\n${output || '(no output)'}${hint}`);
                    } else {
                        counters.lastCommandFailed = false;
                        counters.lastErrorFiles = [];
                        counters.lastErrorSummary = '';
                        if (looksLikeBuild) { counters.lastBuildPassed = true; }
                        resolve(output || '[OK] Command executed with no output.');
                    }
                });
            });
        },
        run_git: async (args, cwd) => {
            const subcommand: string = args.subcommand || '';
            const workDir: string = args.cwd || cwd;

            if (!subcommand) { return '[ERROR] subcommand not provided.'; }

            const isReadOnly = isGitReadOnly(subcommand);

            if (!isReadOnly && !autoMode) {
                onStatus(`Awaiting approval: git ${subcommand}`);
                const decision = await onConfirmCommand({ command: `git ${subcommand}`, cwd: workDir });
                if (decision === 'block') {
                    return `[BLOCKED] User refused: "git ${subcommand}"`;
                }
            }

            onStatus(`git ${subcommand.split(' ')[0]}...`);
            return runGit(subcommand, workDir);
        },
        web_search: async (args) => {
            const query: string = args.query || '';
            if (!query) { return '[ERROR] query not provided.'; }
            onStatus(`Searching the web: "${query}"`);
            return webSearch(query);
        },
        todo_update: async (args) => {
            const todos: TodoItem[] = (args.todos || []).map((t: any) => ({
                content: t.content || '',
                status: (['pending', 'in_progress', 'completed'].includes(t.status) ? t.status : 'pending') as TodoItem['status'],
            }));
            onTodoUpdate(todos);
            return '[OK] Todo list updated.';
        },
    };
}

const PENDING_ACTION_PATTERNS = [
    /vou criar/i, /vou escrever/i, /vou gerar/i, /vou adicionar/i,
    /vou implementar/i, /vou modificar/i, /vou editar/i, /vou atualizar/i,
    /vou executar/i, /vou rodar/i, /vou instalar/i, /vou fazer/i,
    /vou refatorar/i, /vou corrigir/i, /vou ajustar/i, /vou focar/i,
    /vou usar/i, /vou aplicar/i, /vou tentar/i, /vou verificar/i,
    /agora vou/i, /agora crio/i, /agora escrevo/i, /agora corrijo/i,
    /a seguir vou/i, /em seguida vou/i, /enquanto isso/i,
    /criando o arquivo/i, /escrevendo o arquivo/i, /refatorando/i,
    /criei o arquivo/i, /arquivo foi criado/i, /arquivo criado/i,
    /escrevi o arquivo/i, /gravei o arquivo/i,
    /criei o mock/i, /gerei o arquivo/i,
    /eu removi/i, /removi os/i, /apaguei os/i, /deletei os/i,
    /eu criei/i, /eu escrevi/i, /eu atualizei/i, /eu modifiquei/i,
    /eu executei/i, /executei os testes/i, /rodei os testes/i,
    /testes passaram/i, /testes foram executados/i,
    /atualizei o/i, /modifiquei o/i, /corrigi o/i,
    /i will create/i, /i will write/i, /i will now/i, /i'll create/i, /i'll write/i,
    /i have created/i, /i've created/i, /i have written/i, /file has been created/i,
    /i will refactor/i, /i will fix/i, /i will update/i,
    /i removed/i, /i deleted/i, /i updated/i, /i modified/i,
    /i ran the tests/i, /tests passed/i, /i executed/i,
];

function detectsPendingAction(text: string, autoMode = false): boolean {
    const toCheck = autoMode
        ? text
        : text.split('\n').filter(l => l.trim()).slice(-6).join(' ');
    return PENDING_ACTION_PATTERNS.some(p => p.test(toCheck));
}

function detectEscapedToolCall(text: string): ToolCall | null {
    // Fast reject: if there's nothing that looks like a tool call, skip parsing.
    if (!text.includes('"function"') && !text.includes('tool_call') && !text.includes('{')) {
        return null;
    }

    const simple = text.match(/(\w+)\s*\(\s*\{([^}]+)\}\s*\)/);
    if (simple && TOOL_NAMES.has(simple[1])) {
        try { return { function: { name: simple[1], arguments: JSON.parse(`{${simple[2]}}`) } }; } catch {}
    }

    const jsonBlock = text.match(/```(?:json)?\s*([\s\S]*?)```/);
    const jsonStr = jsonBlock ? jsonBlock[1] : text;
    // Skip JSON.parse on very long text — almost never valid JSON in full.
    if (!jsonBlock && jsonStr.length > 4000) { return null; }
    try {
        const parsed = JSON.parse(jsonStr.trim());
        const tc = parsed?.tool_calls?.[0];
        if (tc?.function?.name && TOOL_NAMES.has(tc.function.name)) {
            const args = typeof tc.function.arguments === 'string'
                ? JSON.parse(tc.function.arguments)
                : (tc.function.args || tc.function.arguments || {});
            return { id: tc.id, function: { name: tc.function.name, arguments: args } };
        }
        if (parsed?.function?.name && TOOL_NAMES.has(parsed.function.name)) {
            const args = typeof parsed.function.arguments === 'string'
                ? JSON.parse(parsed.function.arguments)
                : (parsed.function.args || parsed.function.arguments || {});
            return { function: { name: parsed.function.name, arguments: args } };
        }
    } catch {}

    const tagMatch = text.match(/<\|tool_call\|>call:(\w+)\{([^}]*)\}<\|\/tool_call\|>/);
    if (tagMatch && TOOL_NAMES.has(tagMatch[1])) {
        try {
            const rawArgs = tagMatch[2].replace(/<\|"([^"]*)"\|>/g, '"$1"');
            return { function: { name: tagMatch[1], arguments: JSON.parse(`{${rawArgs}}`) } };
        } catch {}
        const cmdMatch = tagMatch[2].match(/"command"\s*:\s*"([^"]+)"/);
        if (cmdMatch) {
            return { function: { name: tagMatch[1], arguments: { command: cmdMatch[1] } } };
        }
    }

    return null;
}

// Keeps only the last `maxPairs` assistant/tool pairs from the current round,
// dropping older ones so the context window doesn't overflow on long tasks.
// System message, history messages, and the initial user message are preserved.
function pruneRoundToolMessages(messages: Message[], maxPairs: number): void {
    // Find pairs (assistant with tool_calls + tool result) added during this round.
    // They always appear after the last 'user' message that started the round.
    let lastUserIdx = -1;
    for (let i = messages.length - 1; i >= 0; i--) {
        if (messages[i].role === 'user' && !(messages[i] as any).tool_call_id) {
            lastUserIdx = i;
            break;
        }
    }
    if (lastUserIdx === -1) { return; }

    // Collect indices of assistant+tool pairs after the last user message
    const pairStarts: number[] = [];
    for (let i = lastUserIdx + 1; i < messages.length - 1; i++) {
        if ((messages[i] as any).tool_calls?.length > 0 && messages[i + 1]?.role === 'tool') {
            pairStarts.push(i);
            i++; // skip the tool message
        }
    }

    // If within limit, nothing to do
    if (pairStarts.length <= maxPairs) { return; }

    // Drop oldest pairs that exceed the limit
    const toDrop = pairStarts.length - maxPairs;
    const dropUntilIdx = pairStarts[toDrop - 1] + 2; // +2 to include the tool message
    messages.splice(lastUserIdx + 1, dropUntilIdx - (lastUserIdx + 1));
}

export async function runAgentLoop(
    userPrompt: string,
    contextBlock: string,
    defaultCwd: string,
    endpoint: string,
    authHeaders: Record<string, string>,
    sessionHistory: HistoryEntry[],
    onStatus: (s: string) => void,
    onCommandStart: (cmd: string) => void,
    onCommandOutput: (chunk: string) => void,
    onCommandEnd: (exitCode: number) => void,
    onConfirmWrite: (req: ConfirmWriteRequest) => Promise<boolean>,
    onConfirmCommand: (req: ConfirmCommandRequest) => Promise<ConfirmCommandDecision>,
    onGetDiagnostics: () => string,
    onTodoUpdate: (todos: TodoItem[]) => void,
    model: string = DEFAULT_MODEL,
    autoMode: boolean = false,
    signal?: AbortSignal,
    onInjectMessage?: (handler: (msg: string) => void) => void,
    provider?: AIProvider,
    anthropicApiKey?: string,
    enabledTools?: string[],
    onStreamChunk?: (text: string) => void,
    onTelemetry?: (metrics: { promptTokens: number; completionTokens: number; tokensPerSec: number; elapsedMs: number }) => void,
    ragEndpoint?: string,
    ragCollection?: string,
    onLiveTelemetry?: (tokens: number, tokensPerSec: number, elapsedMs: number) => void,
    onFileTouched?: (absolutePath: string) => void,
    hybridConfig?: HybridConfig,
    onHybridActivity?: (evt: HybridActivityEvent) => void
): Promise<string> {
    const autoBlock = autoMode
        ? `\nAUTO MODE ACTIVE — strict rules:
- Execute the task end-to-end without asking the user anything.
- After writing files, ALWAYS run a build/test command to verify (npm run build, npm test, tsc, etc.).
- If a command fails (exit code != 0), READ the error output, diagnose the root cause, fix it with edit_file/write_local_file, and RE-RUN the command. Do NOT stop or describe — fix and retry.
- Never end with phrases like "I'll try", "let me try", "vou tentar", "vou ajustar" — execute the action immediately instead.
- Only finish when: (a) a build/test command exited with code 0, OR (b) the task explicitly does not require a build.
- When truly done, respond with a one-line summary.`
        : '';

    // Optional RAG: query vector DB and prepend relevant context
    let ragContext = '';
    if (ragEndpoint && ragCollection) {
        const ragResults = await queryRag(ragEndpoint, ragCollection, userPrompt);
        ragContext = formatRagContext(ragResults);
    }

    const systemContent = [SYSTEM_PROMPT + autoBlock, ragContext, contextBlock].filter(Boolean).join('\n\n');
    // In auto mode include only the last 1 history pair so the model knows what
    // the user was working on — skipping history entirely left it context-blind.
    // The round's own tool chain still grows large, so keep it to 1 pair max.
    const historySlice = sessionHistory.slice(0, -1);
    const priorMessages = autoMode
        ? buildMessagesFromHistory(historySlice.slice(-2))  // last user+assistant pair
        : buildMessagesFromHistory(historySlice);
    const roundMessages: Message[] = [
        { role: 'system', content: systemContent },
        ...priorMessages,
        { role: 'user', content: userPrompt },
    ];

    // Queue (not single slot) so multiple user messages sent during a slow
    // API call are all preserved instead of last-write-wins.
    const injectedMessages: string[] = [];
    if (onInjectMessage) {
        onInjectMessage((msg) => { injectedMessages.push(msg); });
    }

    const filesReadThisRound = new Set<string>();
    const sessionApprovedCommands = new Set<string>();
    const fileCache = new Map<string, string>();
    const dirCache = new Map<string, string>();
    const counters = {
        filesWritten: 0,
        lastCommandFailed: false,
        lastBuildPassed: false,
        lastErrorFiles: [] as string[],
        lastErrorSummary: '',
        lastEditedFile: '',
    };
    const toolHandlers = buildToolHandlers(
        onStatus, onCommandStart, onCommandOutput, onCommandEnd,
        onConfirmWrite, onConfirmCommand, onGetDiagnostics,
        onTodoUpdate, autoMode, filesReadThisRound, sessionApprovedCommands,
        fileCache, dirCache, counters, onFileTouched
    );

    const thinkingStatus = [
        'Analyzing your request...',
        'Processing project context...',
        'Working out the solution...',
        'Reviewing the code...',
        'Checking dependencies...',
        'Planning next steps...',
        'Generating response...',
    ];

    let lastToolName = '';
    const maxSteps = autoMode ? 40 : MAX_AGENT_STEPS;
    let step = 0;
    let emptyResponseStreak = 0;
    let pendingActionStreak = 0;
    // Tracks repeated identical tool calls (tool name + args). If the model
    // keeps calling the same thing, we nudge it to do something else.
    const toolCallSignatures = new Map<string, number>();
    let totalPromptTokens = 0;
    let totalCompletionTokens = 0;
    let totalElapsedMs = 0;
    const sessionStart = Date.now();

    const emitTelemetry = () => {
        if (!onTelemetry) { return; }
        if (totalCompletionTokens === 0 && totalElapsedMs === 0) { return; }
        const elapsedSec = totalElapsedMs / 1000;
        const tokensPerSec = elapsedSec > 0 ? Math.round(totalCompletionTokens / elapsedSec) : 0;
        onTelemetry({
            promptTokens: totalPromptTokens,
            completionTokens: totalCompletionTokens,
            tokensPerSec,
            elapsedMs: Date.now() - sessionStart,
        });
    };

    // ── HYBRID helpers ─────────────────────────────────────────────────
    const hybridActive = !!(hybridConfig?.enabled && hybridConfig.apiKey);
    const HYBRID_STATUS_BY_REASON: Record<HybridReason, string> = {
        plan: 'Planejando estrategia da tarefa',
        verify_write: 'Verificando se a escrita foi feita corretamente',
        verify_build: 'Confirmando que o build esta saudavel',
        recover_command: 'Analisando falha de comando e sugerindo correcao',
        recover_syntax: 'Analisando erro de sintaxe persistente',
        recover_stop: 'Local travou — pedindo plano de recuperacao',
    };

    async function askSupport(reason: HybridReason, system: string, user: string, maxTokens = 800): Promise<string | null> {
        if (!hybridActive || !hybridConfig) { return null; }
        const statusText = HYBRID_STATUS_BY_REASON[reason];
        onHybridActivity?.({
            provider: hybridConfig.provider,
            reason,
            statusText,
            success: false, // pending; UI will update on second event
        });
        const res = await callSupportProvider({
            provider: hybridConfig.provider,
            apiKey: hybridConfig.apiKey,
            model: hybridConfig.model,
            system,
            user,
            maxTokens,
        });
        const ok = !res.error && res.text.length > 0;
        onHybridActivity?.({
            provider: hybridConfig.provider,
            reason,
            statusText,
            responseText: res.text,
            promptTokens: res.promptTokens,
            completionTokens: res.completionTokens,
            elapsedMs: res.elapsedMs,
            success: ok,
            error: res.error,
        });
        return ok ? res.text : null;
    }

    // V1: deterministic verification — checks the filesystem.
    function v1VerifyWrite(absPath: string, claim: string): string {
        try {
            const stat = fs.statSync(absPath);
            return `[V1 OK] "${path.basename(absPath)}" exists (${stat.size} bytes). Local model claim: "${claim.slice(0, 200)}"`;
        } catch {
            return `[V1 FAIL] "${absPath}" was NOT created on disk, but the model claimed it was. Try again with write_local_file.`;
        }
    }

    // ── GATILHO 1: planejamento inicial ────────────────────────────────
    // Antes da primeira iteracao do loop, consulta o pago para gerar um
    // plano de execucao. O plano vira contexto adicional injetado como
    // mensagem do usuario que o local executa passo a passo.
    if (hybridActive) {
        const planSystem = 'You are a senior software architect helping a smaller local LLM execute a coding task. Produce a CONCISE, ACTIONABLE plan in 5-10 bullet steps. Each step must name specific files to create/edit and the exact action. No prose, no explanations — just the numbered plan. Keep under 300 words.';
        const planUser = `User request:\n${userPrompt}\n\nWorkspace context:\n${contextBlock.slice(0, 1500)}\n\nProduce the plan now.`;
        const plan = await askSupport('plan', planSystem, planUser, 600);
        if (plan) {
            roundMessages.push({
                role: 'user',
                content: `[HYBRID PLAN from support model] Follow this plan step by step. Use tools to execute each item:\n\n${plan}`,
            });
        }
    }

    while (++step <= maxSteps) {
        if (signal?.aborted) { emitTelemetry(); return '[INTERRUPTED] Execution cancelled by user.'; }

        if (injectedMessages.length > 0) {
            const combined = injectedMessages.splice(0).join('\n');
            roundMessages.push({ role: 'user', content: `[USER INTERRUPTED]: ${combined}` });
            lastToolName = '';
        }

        const statusAfterTool: Record<string, string> = {
            list_directory:      'Analyzing project structure...',
            read_local_file:     'Processing file contents...',
            edit_file:           'Working out next action...',
            search_in_workspace: 'Analyzing search results...',
            get_diagnostics:     'Analyzing editor diagnostics...',
            write_local_file:    'Working out next action...',
            run_command:         'Analyzing command output...',
            run_git:             'Analyzing git result...',
            web_search:          'Analyzing web results...',
            todo_update:         'Updating task list...',
        };
        const thinking = lastToolName && statusAfterTool[lastToolName]
            ? statusAfterTool[lastToolName]
            : thinkingStatus[step % thinkingStatus.length];
        onStatus(thinking);

        const activeTools = enabledTools?.length
            ? TOOLS.filter(t => enabledTools.includes(t.name))
            : TOOLS;

        // Preventive pruning calibrated for a 2048-token context window.
        // Only prune when significantly over budget, keeping the most recent pairs
        // so the model retains context of what it just read/did.
        {
            const totalChars = roundMessages.reduce((acc, m) => {
                const content = typeof m.content === 'string' ? m.content : '';
                const toolArgs = m.tool_calls ? JSON.stringify(m.tool_calls) : '';
                return acc + content.length + toolArgs.length;
            }, 0);
            const estimatedTokens = Math.floor(totalChars / 4);
            if (estimatedTokens > 1200) {
                // Keep more pairs in auto mode so model doesn't lose what it just read
                pruneRoundToolMessages(roundMessages, autoMode ? 3 : 2);
            }
        }

        // Only stream text to UI when there's a chance this is the final reply.
        // If the model ends up calling a tool instead, onStreamChunk output is
        // discarded — the UI bubble gets cleared before the tool result is shown.
        let streamedSoFar = '';
        const onChunk = onStreamChunk
            ? (text: string) => { streamedSoFar += text; onStreamChunk(text); }
            : undefined;

        const result = provider === 'anthropic' && anthropicApiKey
            ? await callAnthropicAI(anthropicApiKey, roundMessages, activeTools, model, signal, onChunk, onLiveTelemetry)
            : await callAI(endpoint, authHeaders, roundMessages, activeTools, model, signal, onChunk, onLiveTelemetry);

        // If the model called a tool, the streamed text was reasoning/preamble —
        // tell the UI to discard it so the bubble doesn't show stale content.
        if (result.toolCall && streamedSoFar) {
            onStreamChunk?.('\x00CLEAR');
        }

        if (result.responseText === '__ABORTED__') {
            emitTelemetry();
            return '[INTERRUPTED] Execution cancelled by user.';
        }

        if (result.responseText === '__INFRA_ERROR__') {
            emitTelemetry();
            return 'Erro de conexao com o modelo. Verifique se o LM Studio esta rodando e se o modelo tem memoria suficiente para ser carregado.';
        }

        // Accumulate telemetry
        if (result.usage) {
            totalPromptTokens += result.usage.promptTokens;
            totalCompletionTokens += result.usage.completionTokens;
            totalElapsedMs += result.usage.elapsedMs;
        }

        if (!result.toolCall && result.responseText) {
            const escaped = detectEscapedToolCall(result.responseText);
            if (escaped) {
                result.toolCall = escaped;
                result.responseText = '';
            }
        }

        if (result.toolCall) {
            const { name, arguments: args } = result.toolCall.function;
            lastToolName = name;
            const toolCallId = result.toolCall.id || `call_${step}`;
            const handler = toolHandlers[name];

            // Loop guard: if the model calls the same tool with the same args
            // 3+ times in a row, inject a corrective message instead of running
            // it again. Skips for run_command (legitimately retried) and
            // todo_update (whole list is the arg, changes per call).
            const sig = `${name}:${JSON.stringify(args)}`;
            const sigCount = (toolCallSignatures.get(sig) || 0) + 1;
            toolCallSignatures.set(sig, sigCount);
            if (sigCount >= 3 && name !== 'run_command' && name !== 'todo_update') {
                roundMessages.push({
                    role: 'assistant',
                    content: null,
                    tool_calls: [{ id: toolCallId, type: 'function', function: { name, arguments: JSON.stringify(args) } }],
                });
                roundMessages.push({
                    role: 'tool',
                    content: `[LOOP DETECTED] You have called ${name} with the same arguments ${sigCount} times. The result has not changed. Stop repeating this call. Either: (a) use a different tool, (b) use different arguments, or (c) act on the information you already have.`,
                    tool_call_id: toolCallId,
                });
                lastToolName = name;
                continue;
            }

            const toolOutput = handler
                ? await handler(args as Record<string, any>, defaultCwd, step, MAX_AGENT_STEPS)
                : `ERRO: Ferramenta "${name}" nao reconhecida.`;

            // Truncate large tool outputs to avoid filling the context window.
            // In auto mode limits are tighter — no history budget and test/build
            // output (jest, coverage tables) can be thousands of chars.
            // Calibrated for 2048-token context: system (~250t) + prompt + response (1024t).
            // Leaves ~750 tokens (~3000 chars) for tool output + conversation.
            const TOOL_OUTPUT_LIMITS: Record<string, number> = {
                list_directory:      600,
                search_in_workspace: 800,
                read_local_file:     1200,
                run_command:         800,
                run_git:             600,
                web_search:          1000,
            };
            const limit = TOOL_OUTPUT_LIMITS[name] ?? 800;
            const truncatedOutput = toolOutput.length > limit
                ? toolOutput.slice(0, limit) + `\n...[truncated — ${toolOutput.length - limit} chars omitted]`
                : toolOutput;

            roundMessages.push({
                role: 'assistant',
                content: null,
                tool_calls: [{
                    id: toolCallId,
                    type: 'function',
                    function: { name, arguments: JSON.stringify(args) },
                }],
            });
            roundMessages.push({
                role: 'tool',
                content: truncatedOutput,
                tool_call_id: toolCallId,
            });

            // ── GATILHO 2: verificacao apos escrita / build ────────────
            // V1 (deterministica) roda sempre que houve escrita/edicao.
            // V2 (semantica via pago) so roda em milestones: build verde
            // ou escrita que tenha "implementado" algo nao-trivial.
            if (hybridActive) {
                if ((name === 'write_local_file' || name === 'edit_file') && !toolOutput.startsWith('[ERROR') && !toolOutput.startsWith('[ERRO')) {
                    const fp = (args as any).filePath || '';
                    if (fp) {
                        const absPath = resolveFilePath(fp, defaultCwd);
                        const v1 = v1VerifyWrite(absPath, toolOutput);
                        roundMessages.push({
                            role: 'user',
                            content: `[VERIFICATION] ${v1}`,
                        });
                    }
                } else if (name === 'run_command' && counters.lastBuildPassed && !counters.lastCommandFailed) {
                    // V2: build acabou de passar — pago confirma se de fato esta tudo certo
                    const verifySystem = 'You are a code reviewer. The local agent just ran a build/test command successfully. Look at the command output and decide: is the build truly OK, or are there warnings/skipped tests/incomplete work the local agent might be ignoring? Reply in ONE LINE: either "BUILD OK" or "BUILD CONCERN: <one sentence>".';
                    const verifyUser = `Command: ${(args as any).command || ''}\nOutput:\n${toolOutput.slice(0, 1500)}`;
                    const verdict = await askSupport('verify_build', verifySystem, verifyUser, 150);
                    if (verdict && verdict.toUpperCase().includes('CONCERN')) {
                        roundMessages.push({
                            role: 'user',
                            content: `[BUILD REVIEW from support model] ${verdict}\n\nAddress this concern before declaring done.`,
                        });
                    }
                }
            }

            // In auto mode keep fewer pairs since there's no history budget to spare.
            pruneRoundToolMessages(roundMessages, autoMode ? 3 : 6);
        } else if (result.responseText !== undefined) {
            const text = result.responseText || '';

            // Only treat completely empty response as recoverable overflow.
            // Short responses are legitimate (model may say "Ok." then call a tool).
            if (!text) {
                emptyResponseStreak++;
                onStatus(`Modelo retornou vazio — recarregando contexto (tentativa ${emptyResponseStreak}/3)`);
                if (emptyResponseStreak >= 3) {
                    emitTelemetry();
                    return 'Nao foi possivel concluir a tarefa. Tente novamente ou simplifique o pedido.';
                }
                // Progressive pruning: each retry removes more pairs
                const keepPairs = Math.max(1, 3 - emptyResponseStreak);
                pruneRoundToolMessages(roundMessages, keepPairs);
                roundMessages.push({
                    role: 'user',
                    content: step <= 1
                        ? userPrompt
                        : 'Continue a tarefa de onde parou.',
                });
                lastToolName = '';
                continue;
            }
            emptyResponseStreak = 0;

            // Detect "code dumped in chat instead of using a tool":
            // model included a fenced code block of substantial size but
            // didn't call write_local_file/edit_file. Common failure mode
            // when the model gives up on a tool error.
            const codeBlockMatch = text.match(/```[a-z]*\n([\s\S]+?)\n```/i);
            const dumpedCodeInChat = !!codeBlockMatch && codeBlockMatch[1].length > 200;

            // ── Auto mode: force continuation rules ────────────────────────
            // The user activated AUTO expecting the agent NOT to stop until
            // the build passes. Any of these conditions mean "not done yet":
            //   - model described an action but didn't call a tool
            //   - planning text without ever writing a file
            //   - last command failed (build/test/install error)
            //   - never ran a successful build
            //   - dumped code in chat instead of using write_local_file
            // In all cases: push the model to act, don't return to the user.
            const modelIsPlanning = autoMode && counters.filesWritten === 0 && !lastToolName;
            const lastCommandFailed = autoMode && counters.lastCommandFailed;
            const buildNotYetPassed = autoMode && counters.filesWritten > 0 && !counters.lastBuildPassed;
            const dumpedInsteadOfWriting = autoMode && dumpedCodeInChat;

            if (detectsPendingAction(text, autoMode) || modelIsPlanning || lastCommandFailed || buildNotYetPassed || dumpedInsteadOfWriting) {
                pendingActionStreak++;

                // ── GATILHOS 3/4/5: recuperacao via pago ───────────────
                // Em vez de bater no cap de 5 e desistir, no penultimo
                // strike (4) consulta o pago para um plano de saida.
                if (hybridActive && pendingActionStreak === 4) {
                    const reason: HybridReason = lastCommandFailed
                        ? 'recover_command'
                        : buildNotYetPassed
                            ? 'recover_syntax'
                            : 'recover_stop';
                    const sys = 'You are a senior engineer helping a stuck local agent. The local agent failed multiple attempts. Diagnose and produce a SHORT, SPECIFIC corrective plan in 3-5 bullets. Name exact files and exact actions. Be concrete.';
                    const errCtx = counters.lastErrorFiles.length > 0
                        ? `\nError files: ${counters.lastErrorFiles.join(', ')}\nError summary: ${counters.lastErrorSummary}`
                        : '';
                    const usr = `Original task: ${userPrompt}\n\nLast agent response: ${text.slice(0, 800)}\n\nLast edited file: ${counters.lastEditedFile || 'none'}${errCtx}\n\nWhat should the local agent do next?`;
                    const recovery = await askSupport(reason, sys, usr, 500);
                    if (recovery) {
                        roundMessages.push({ role: 'assistant', content: text });
                        roundMessages.push({
                            role: 'user',
                            content: `[HYBRID RECOVERY from support model] The support model analyzed your situation. Follow this exactly:\n\n${recovery}`,
                        });
                        lastToolName = '';
                        continue;
                    }
                }

                if (pendingActionStreak >= 5) {
                    // Hard cap to avoid eternal loop. Surface what happened
                    // so the user knows the agent gave up and why.
                    pendingActionStreak = 0;
                    emitTelemetry();
                    const reason = dumpedInsteadOfWriting
                        ? 'O modelo escreveu codigo no chat em vez de salvar via tool — possivelmente o modelo local nao esta seguindo o protocolo de tool calling.'
                        : lastCommandFailed
                            ? 'O ultimo comando falhou e o agente nao conseguiu corrigir apos varias tentativas.'
                            : !counters.lastBuildPassed && counters.filesWritten > 0
                                ? 'O build ainda nao passou apos varias tentativas.'
                                : 'O modelo descreveu acoes mas nao executou.';
                    return `[AUTO PAUSADO] ${reason}\n\nUltima resposta do modelo:\n${text}\n\n[CONTINUE_BUTTON]`;
                }

                // Detector: model is editing the wrong file.
                // If the error points to a file but the model just edited a
                // different file, alert it explicitly with both paths.
                const wrongFileEdit = lastCommandFailed
                    && counters.lastErrorFiles.length > 0
                    && counters.lastEditedFile
                    && !counters.lastErrorFiles.some(f =>
                        counters.lastEditedFile.endsWith(f) || f.endsWith(path.basename(counters.lastEditedFile))
                    );

                const errorContext = (lastCommandFailed && counters.lastErrorFiles.length > 0)
                    ? `\n\nERROR LOCATION (focus here):\n  Files: ${counters.lastErrorFiles.join(', ')}\n  Message: ${counters.lastErrorSummary || '(see command output)'}`
                    : '';

                const nudge = dumpedInsteadOfWriting
                    ? 'You wrote code in the chat instead of saving it to a file. The user cannot use code in the chat. Use write_local_file (for new/full-rewrite) or edit_file (for partial edits) NOW to save that code to disk. Do not paste code in your reply — call the tool.'
                    : wrongFileEdit
                        ? `WRONG FILE. You edited "${counters.lastEditedFile}" but the error is in "${counters.lastErrorFiles[0]}". Read "${counters.lastErrorFiles[0]}" now and fix THAT file. The bug is not where you were looking.${errorContext}`
                        : lastCommandFailed
                            ? `The last command failed. Read the error output, identify the root cause, fix the SPECIFIC file mentioned in the error, then re-run.${errorContext}`
                            : buildNotYetPassed
                                ? 'You have written files but have not yet run a successful build. Run the build command now (e.g. npm run build) to verify. If it fails, fix the errors and retry.'
                                : autoMode
                                    ? 'Stop planning. Use write_local_file, edit_file, or run_command now to execute the task. Do not describe — act immediately.'
                                    : 'continue';

                roundMessages.push({ role: 'assistant', content: text });
                roundMessages.push({ role: 'user', content: nudge });
                lastToolName = '';
                continue;
            }
            pendingActionStreak = 0;

            // In auto mode: before returning, check editor diagnostics.
            // Only relevant if the model actually wrote/edited files this round.
            // Wait 2s for the TypeScript language server to process the new files.
            if (autoMode && counters.filesWritten > 0) {
                await new Promise(r => setTimeout(r, 2000));
                const diag = onGetDiagnostics();
                // Only block on actual errors — warnings are ignored in auto mode
                const hasErrors = diag && /\[ERROR\]/.test(diag);
                if (hasErrors) {
                    onStatus('Erros detectados — corrigindo...');
                    roundMessages.push({ role: 'assistant', content: text });
                    roundMessages.push({
                        role: 'user',
                        content: `The editor found TypeScript/build errors in the files you wrote. Fix all [ERROR] items now using edit_file. Ignore any [WARNING] lines.\n\n${diag}`,
                    });
                    lastToolName = '';
                    continue;
                }
            }

            emitTelemetry();
            return text;
        } else {
            // result.responseText is undefined and no toolCall — API returned
            // an unexpected shape. Treat as infra issue, don't loop silently.
            emitTelemetry();
            return 'Resposta inesperada do modelo. Tente novamente.';
        }
    }

    emitTelemetry();
    return 'Limite de passos atingido. A tarefa pode estar muito grande — tente dividir em pedidos menores.';
}
