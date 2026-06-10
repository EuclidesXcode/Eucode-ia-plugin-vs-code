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
exports.runAgentLoop = runAgentLoop;
const path = __importStar(require("path"));
const fs = __importStar(require("fs"));
const api_client_1 = require("../services/api-client");
const rag_client_1 = require("../services/rag-client");
const hybrid_client_1 = require("../services/hybrid-client");
const memory_service_1 = require("../services/memory-service");
const project_intel_1 = require("../services/project-intel");
const constants_1 = require("../utils/constants");
const history_service_1 = require("../services/history-service");
const file_tools_1 = require("../tools/file-tools");
const shell_tools_1 = require("../tools/shell-tools");
const web_tools_1 = require("../tools/web-tools");
const tools_definition_1 = require("./tools-definition");
const prompt_1 = require("./prompt");
const tools_definition_2 = require("./tools-definition");
const constants_2 = require("../utils/constants");
const validation_1 = require("../utils/validation");
const context_sanitizer_1 = require("../services/context-sanitizer");
const execution_guard_1 = require("../services/execution-guard");
// Extrai nomes de funções, classes, exports e variáveis exportadas de um bloco de código
function extractSymbols(code) {
    const patterns = [
        /^export\s+(?:async\s+)?function\s+(\w+)/gm,
        /^export\s+(?:const|let|var)\s+(\w+)/gm,
        /^export\s+class\s+(\w+)/gm,
        /^export\s+(?:default\s+)?(?:async\s+)?function\s+(\w+)/gm,
        /^(?:export\s+)?(?:async\s+)?function\s+(\w+)/gm,
        /^(?:export\s+)?class\s+(\w+)/gm,
    ];
    const symbols = new Set();
    for (const pattern of patterns) {
        let match;
        while ((match = pattern.exec(code)) !== null) {
            if (match[1] && match[1].length > 2) {
                symbols.add(match[1]);
            }
        }
    }
    return Array.from(symbols);
}
async function checkRemovedSymbols(before, after, cwd) {
    const beforeSymbols = extractSymbols(before);
    const afterSymbols = new Set(extractSymbols(after));
    const removed = beforeSymbols.filter(s => !afterSymbols.has(s));
    if (removed.length === 0) {
        return [];
    }
    const warnings = [];
    for (const symbol of removed) {
        const result = await (0, shell_tools_1.searchInWorkspace)(symbol, cwd);
        if (result && !result.startsWith('[ERRO]') && result.trim().length > 0) {
            warnings.push(`  - "${symbol}" — referencias encontradas:\n${result.split('\n').slice(0, 3).map(l => '    ' + l).join('\n')}`);
        }
    }
    return warnings;
}
// Parses command output looking for error locations: "path/to/file.ext:LINE:COL"
// or "path/to/file.ext:LINE". Returns unique file paths in order of appearance
// plus a short summary line (first error message found).
function parseErrorLocations(output) {
    const seen = new Set();
    const files = [];
    let summary = '';
    // file.ext:line:col or file.ext:line — common across tsc, eslint, jest, node
    const locationRe = /([A-Za-z0-9_\-./\\]+\.[A-Za-z0-9]{1,8})(?::(\d+))(?::(\d+))?/g;
    let m;
    while ((m = locationRe.exec(output)) !== null) {
        const file = m[1];
        // skip node_modules, dist, common non-source paths
        if (/node_modules|\bdist\/|\.next\/|coverage\//.test(file)) {
            continue;
        }
        // skip common false positives (URLs, version strings)
        if (file.startsWith('http') || /\.(?:js|ts|tsx|jsx|css|scss|json|html|vue|svelte|py|rs|go|java|md)$/i.test(file) === false) {
            continue;
        }
        if (!seen.has(file)) {
            seen.add(file);
            files.push(file);
        }
        if (files.length >= 5) {
            break;
        }
    }
    // First line that looks like an error message
    const errorLineRe = /^.*(?:error|Error|ERROR|TypeError|ReferenceError|SyntaxError|Cannot|Failed|failed|undefined).*$/m;
    const errMatch = output.match(errorLineRe);
    if (errMatch) {
        summary = errMatch[0].trim().slice(0, 200);
    }
    return { files, summary };
}
function buildToolHandlers(onStatus, onCommandStart, onCommandOutput, onCommandEnd, onConfirmWrite, onConfirmCommand, onGetDiagnostics, onTodoUpdate, autoMode, filesReadThisRound, sessionApprovedCommands, fileCache, dirCache, counters, onFileTouched, sessionId) {
    return {
        list_directory: async (args, cwd) => {
            const dir = path.resolve(cwd, args.dirPath || args.path || cwd);
            if (dirCache.has(dir)) {
                onStatus(`Reading structure: ${path.basename(dir)} (cached)`);
                return dirCache.get(dir);
            }
            onStatus(`Reading structure: ${path.basename(dir)}`);
            const result = await (0, file_tools_1.listDirectory)(dir, cwd);
            dirCache.set(dir, result);
            return result;
        },
        read_local_file: async (args, cwd) => {
            const fp = args.filePath || '';
            const fullPath = path.resolve(cwd, fp);
            if (fileCache.has(fullPath)) {
                onStatus(`Reading file: ${path.basename(fp)} (cached)`);
                filesReadThisRound.add(fullPath);
                return fileCache.get(fullPath);
            }
            onStatus(`Reading file: ${path.basename(fp)}`);
            const result = await (0, file_tools_1.readLocalFile)(fp, cwd);
            fileCache.set(fullPath, result);
            filesReadThisRound.add(fullPath);
            return result;
        },
        edit_file: async (args, cwd) => {
            const filePath = args.filePath || '';
            const oldString = args.old_string ?? args.oldString ?? '';
            const newString = args.new_string ?? args.newString ?? '';
            if (!filePath) {
                return '[ERROR] filePath is required. Example: edit_file({"filePath": "/abs/path/to/file.ts", "old_string": "...", "new_string": "..."})';
            }
            let before = null;
            try {
                const fullPath = (0, validation_1.resolveFilePath)(filePath, cwd);
                before = fs.readFileSync(fullPath, 'utf8');
            }
            catch {
                before = null;
            }
            // If old_string is empty, the model likely wants to create the file
            // or replace its entire content. Route to write_local_file logic
            // instead of failing with a terminal error.
            if (oldString === '') {
                if (before === null) {
                    // File doesn't exist yet — create it with new_string
                    onStatus(`Creating: ${path.basename(filePath)}`);
                    const writeResult = await (0, file_tools_1.writeLocalFile)(filePath, newString, cwd);
                    fileCache.delete((0, validation_1.resolveFilePath)(filePath, cwd));
                    counters.filesWritten++;
                    onFileTouched?.((0, validation_1.resolveFilePath)(filePath, cwd));
                    return `[OK] File created via edit_file (empty old_string). ${writeResult}`;
                }
                // File exists — empty old_string is ambiguous. Guide the model.
                return `[ERROR] edit_file needs a non-empty old_string when the file already exists. To replace specific text: provide the exact existing text in old_string. To rewrite the entire file: use write_local_file instead. To append: use old_string with the last existing line and put that line + new content in new_string.`;
            }
            const after = before ? before.replace(oldString, newString) : newString;
            if (autoMode) {
                onStatus(`Editing: ${path.basename(filePath)}`);
                const editResult = (0, file_tools_1.editLocalFile)(filePath, oldString, newString, cwd);
                fileCache.delete((0, validation_1.resolveFilePath)(filePath, cwd));
                counters.filesWritten++;
                counters.lastEditedFile = filePath;
                onFileTouched?.((0, validation_1.resolveFilePath)(filePath, cwd));
                return editResult;
            }
            onStatus(`Awaiting approval: ${path.basename(filePath)}`);
            const approved = await onConfirmWrite({ filePath, before, after });
            if (!approved) {
                return '[CANCELLED] User rejected the file change.';
            }
            const editResult2 = (0, file_tools_1.editLocalFile)(filePath, oldString, newString, cwd);
            fileCache.delete((0, validation_1.resolveFilePath)(filePath, cwd));
            counters.filesWritten++;
            counters.lastEditedFile = filePath;
            onFileTouched?.((0, validation_1.resolveFilePath)(filePath, cwd));
            return editResult2;
        },
        search_in_workspace: async (args, cwd) => {
            onStatus(`Searching project: "${args.query}"`);
            return (0, shell_tools_1.searchInWorkspace)(args.query || '', args.dirPath || cwd, cwd);
        },
        get_diagnostics: async () => {
            onStatus('Fetching editor diagnostics...');
            return onGetDiagnostics() || 'No errors or warnings found in the editor.';
        },
        write_local_file: async (args, cwd) => {
            const filePath = args.filePath || '';
            const content = args.content || '';
            let before = null;
            try {
                const fullPath = (0, validation_1.resolveFilePath)(filePath, cwd);
                before = fs.readFileSync(fullPath, 'utf8');
            }
            catch {
                before = null;
            }
            if (before !== null) {
                const fullPath = (0, validation_1.resolveFilePath)(filePath, cwd);
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
                const writeResult = (0, file_tools_1.writeLocalFile)(filePath, content, cwd);
                fileCache.delete((0, validation_1.resolveFilePath)(filePath, cwd));
                counters.filesWritten++;
                counters.lastEditedFile = filePath;
                onFileTouched?.((0, validation_1.resolveFilePath)(filePath, cwd));
                return writeResult;
            }
            onStatus(`Awaiting approval: ${path.basename(filePath)}`);
            const approved2 = await onConfirmWrite({ filePath, before, after: content });
            if (!approved2) {
                return '[CANCELLED] User rejected the file change.';
            }
            const writeResult2 = (0, file_tools_1.writeLocalFile)(filePath, content, cwd);
            fileCache.delete((0, validation_1.resolveFilePath)(filePath, cwd));
            counters.filesWritten++;
            counters.lastEditedFile = filePath;
            onFileTouched?.((0, validation_1.resolveFilePath)(filePath, cwd));
            return writeResult2;
        },
        run_command: async (args, cwd) => {
            const cmd = args.command || '';
            const workDir = args.cwd || cwd;
            if ((0, shell_tools_1.isCommandBlocked)(cmd)) {
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
                    if (sessionId) {
                        (0, memory_service_1.rememberApprovedCommand)(sessionId, cmd);
                    }
                }
            }
            onStatus(`Running: ${cmd}`);
            onCommandStart(cmd);
            return new Promise((resolve) => {
                const emitter = (0, tools_definition_1.runCommandTool)(cmd, workDir);
                let output = '';
                let isLongRunning = false;
                let exitCode = 0;
                emitter.on('stdout', (chunk) => { output += chunk; onCommandOutput(chunk); });
                emitter.on('stderr', (chunk) => { output += chunk; onCommandOutput(chunk); });
                emitter.on('exit_code', (code) => { exitCode = code; });
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
                        if (looksLikeBuild && !hasRuntimeError) {
                            counters.lastBuildPassed = true;
                        }
                        const prefix = hasRuntimeError ? '[RUNTIME ERROR]' : '[PROCESS STARTED]';
                        resolve(`${prefix} Command "${cmd}". Output:\n${output}${hasRuntimeError ? '\nThe server started but is throwing errors. Fix the root cause in the file listed above.' : '\nThe server is up.'}`);
                    }
                    else if (exitCode !== 0) {
                        const parsed = parseErrorLocations(output);
                        counters.lastCommandFailed = true;
                        counters.lastErrorFiles = parsed.files;
                        counters.lastErrorSummary = parsed.summary;
                        if (looksLikeBuild) {
                            counters.lastBuildPassed = false;
                        }
                        const hint = parsed.files.length > 0
                            ? `\n\n[ERROR LOCATIONS] Fix these files (in order):\n${parsed.files.map(f => `  - ${f}`).join('\n')}`
                            : '';
                        resolve(`[FAILED exit=${exitCode}] Command "${cmd}" failed. You MUST diagnose and fix the underlying issue, then re-run. Do not give up. Output:\n${output || '(no output)'}${hint}`);
                    }
                    else {
                        counters.lastCommandFailed = false;
                        counters.lastErrorFiles = [];
                        counters.lastErrorSummary = '';
                        if (looksLikeBuild) {
                            counters.lastBuildPassed = true;
                        }
                        resolve(output || '[OK] Command executed with no output.');
                    }
                });
            });
        },
        run_git: async (args, cwd) => {
            const subcommand = args.subcommand || '';
            const workDir = args.cwd || cwd;
            if (!subcommand) {
                return '[ERROR] subcommand not provided.';
            }
            const isReadOnly = (0, shell_tools_1.isGitReadOnly)(subcommand);
            if (!isReadOnly && !autoMode) {
                onStatus(`Awaiting approval: git ${subcommand}`);
                const decision = await onConfirmCommand({ command: `git ${subcommand}`, cwd: workDir });
                if (decision === 'block') {
                    return `[BLOCKED] User refused: "git ${subcommand}"`;
                }
            }
            onStatus(`git ${subcommand.split(' ')[0]}...`);
            return (0, shell_tools_1.runGit)(subcommand, workDir);
        },
        web_search: async (args) => {
            const query = args.query || '';
            if (!query) {
                return '[ERROR] query not provided.';
            }
            onStatus(`Searching the web: "${query}"`);
            return (0, web_tools_1.webSearch)(query);
        },
        todo_update: async (args) => {
            const todos = (args.todos || []).map((t) => ({
                content: t.content || '',
                status: (['pending', 'in_progress', 'completed'].includes(t.status) ? t.status : 'pending'),
            }));
            onTodoUpdate(todos);
            return '[OK] Todo list updated.';
        },
        memory_remember: async (args) => {
            const note = args.note || '';
            if (!sessionId) {
                return '[ERROR] No active session — cannot persist memory.';
            }
            onStatus(`Salvando na memoria: ${note.slice(0, 60)}${note.length > 60 ? '...' : ''}`);
            const res = (0, memory_service_1.rememberDecision)(sessionId, note, 'agent');
            if (!res.ok) {
                if (res.reason === 'duplicate') {
                    return '[OK] Note already in memory, nothing to do.';
                }
                if (res.reason === 'too_long') {
                    return '[ERROR] Note exceeds 500 chars. Be concise.';
                }
                return '[ERROR] Could not save note (empty).';
            }
            return '[OK] Note saved to session memory.';
        },
        memory_read: async () => {
            if (!sessionId) {
                return '[ERROR] No active session.';
            }
            onStatus('Lendo memoria da sessao...');
            return (0, memory_service_1.dumpMemoryAsJson)(sessionId);
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
function detectsPendingAction(text, autoMode = false) {
    const toCheck = autoMode
        ? text
        : text.split('\n').filter(l => l.trim()).slice(-6).join(' ');
    return PENDING_ACTION_PATTERNS.some(p => p.test(toCheck));
}
function detectEscapedToolCall(text) {
    // Fast reject: if there's nothing that looks like a tool call, skip parsing.
    if (!text.includes('"function"') && !text.includes('tool_call') && !text.includes('{')) {
        return null;
    }
    const simple = text.match(/(\w+)\s*\(\s*\{([^}]+)\}\s*\)/);
    if (simple && tools_definition_2.TOOL_NAMES.has(simple[1])) {
        try {
            return { function: { name: simple[1], arguments: JSON.parse(`{${simple[2]}}`) } };
        }
        catch { }
    }
    const jsonBlock = text.match(/```(?:json)?\s*([\s\S]*?)```/);
    const jsonStr = jsonBlock ? jsonBlock[1] : text;
    // Skip JSON.parse on very long text — almost never valid JSON in full.
    if (!jsonBlock && jsonStr.length > 4000) {
        return null;
    }
    try {
        const parsed = JSON.parse(jsonStr.trim());
        const tc = parsed?.tool_calls?.[0];
        if (tc?.function?.name && tools_definition_2.TOOL_NAMES.has(tc.function.name)) {
            const args = typeof tc.function.arguments === 'string'
                ? JSON.parse(tc.function.arguments)
                : (tc.function.args || tc.function.arguments || {});
            return { id: tc.id, function: { name: tc.function.name, arguments: args } };
        }
        if (parsed?.function?.name && tools_definition_2.TOOL_NAMES.has(parsed.function.name)) {
            const args = typeof parsed.function.arguments === 'string'
                ? JSON.parse(parsed.function.arguments)
                : (parsed.function.args || parsed.function.arguments || {});
            return { function: { name: parsed.function.name, arguments: args } };
        }
    }
    catch { }
    const tagMatch = text.match(/<\|tool_call\|>call:(\w+)\{([^}]*)\}<\|\/tool_call\|>/);
    if (tagMatch && tools_definition_2.TOOL_NAMES.has(tagMatch[1])) {
        try {
            const rawArgs = tagMatch[2].replace(/<\|"([^"]*)"\|>/g, '"$1"');
            return { function: { name: tagMatch[1], arguments: JSON.parse(`{${rawArgs}}`) } };
        }
        catch { }
        const cmdMatch = tagMatch[2].match(/"command"\s*:\s*"([^"]+)"/);
        if (cmdMatch) {
            return { function: { name: tagMatch[1], arguments: { command: cmdMatch[1] } } };
        }
    }
    return null;
}
// Scans the round messages for any assistant tool_call that targets a build/
// compile/package command. Used as a safety net so build tasks don't end
// with only file edits and no actual command run.
function lastBuildAttempted(messages) {
    const buildRe = /\b(build|compile|package|tsc|vsce|webpack|rollup|esbuild|jest|vitest|pytest|cargo build|go build|mvn|gradle)\b/i;
    for (const m of messages) {
        const toolCalls = m.tool_calls;
        if (!toolCalls?.length) {
            continue;
        }
        for (const tc of toolCalls) {
            const fn = tc?.function?.name;
            if (fn !== 'run_command') {
                continue;
            }
            const args = typeof tc.function?.arguments === 'string'
                ? tc.function.arguments
                : JSON.stringify(tc.function?.arguments || {});
            if (buildRe.test(args)) {
                return true;
            }
        }
    }
    return false;
}
// Keeps only the last `maxPairs` assistant/tool pairs from the current round,
// dropping older ones so the context window doesn't overflow on long tasks.
// System message, history messages, and the initial user message are preserved.
function pruneRoundToolMessages(messages, maxPairs) {
    // Find pairs (assistant with tool_calls + tool result) added during this round.
    // They always appear after the last 'user' message that started the round.
    let lastUserIdx = -1;
    for (let i = messages.length - 1; i >= 0; i--) {
        if (messages[i].role === 'user' && !messages[i].tool_call_id) {
            lastUserIdx = i;
            break;
        }
    }
    if (lastUserIdx === -1) {
        return;
    }
    // Collect indices of assistant+tool pairs after the last user message
    const pairStarts = [];
    for (let i = lastUserIdx + 1; i < messages.length - 1; i++) {
        if (messages[i].tool_calls?.length > 0 && messages[i + 1]?.role === 'tool') {
            pairStarts.push(i);
            i++; // skip the tool message
        }
    }
    // If within limit, nothing to do
    if (pairStarts.length <= maxPairs) {
        return;
    }
    // Drop oldest pairs that exceed the limit
    const toDrop = pairStarts.length - maxPairs;
    const dropUntilIdx = pairStarts[toDrop - 1] + 2; // +2 to include the tool message
    messages.splice(lastUserIdx + 1, dropUntilIdx - (lastUserIdx + 1));
}
async function runAgentLoop(userPrompt, contextBlock, defaultCwd, endpoint, authHeaders, sessionHistory, onStatus, onCommandStart, onCommandOutput, onCommandEnd, onConfirmWrite, onConfirmCommand, onGetDiagnostics, onTodoUpdate, model = constants_1.DEFAULT_MODEL, autoMode = false, signal, onInjectMessage, provider, anthropicApiKey, enabledTools, onStreamChunk, onTelemetry, ragEndpoint, ragCollection, onLiveTelemetry, onFileTouched, hybridConfig, onHybridActivity, sessionId, chatMode = false, hybridIntensity = 50, projectIntelEnabled = true) {
    // CHAT mode skips all coding-agent ceremony: no AUTO/HYBRID guards
    // applied, no RAG, no session memory injection, no workspace context.
    // The system prompt is just the conversational instructions.
    const effectiveAutoMode = chatMode ? false : autoMode;
    const effectiveHybridConfig = chatMode ? undefined : hybridConfig;
    // Bloco do modo AUTO: conciso e em PT-BR. Modelo pequeno segue melhor 4
    // princípios curtos do que 25 linhas com MAIÚSCULAS e "NEVER/ALWAYS"
    // repetidos. O detalhe da sequência de build é tratado em runtime pelos
    // guards (ExecutionGuardService), não empurrado preventivamente aqui.
    const autoBlock = effectiveAutoMode
        ? `\nModo AUTO ativo:
- Execute a tarefa de ponta a ponta sem perguntar nada ao usuário.
- Depois de escrever arquivos, rode o build/teste para verificar (npm run build, npm test, tsc...).
- Comando falhou? Leia o erro, corrija o arquivo certo e rode de novo. Não descreva — corrija.
- Só conclua quando o build/teste sair com código 0 (ou quando a tarefa não exigir build). Encerre com uma frase.`
        : '';
    // ── Contexto LAZY ─────────────────────────────────────────────────
    // ProjectIntel e RAG são caros em tokens (~700+) e na maioria das rodadas
    // de continuação o modelo já tem o contexto na própria conversa. Em vez de
    // empurrá-los em TODO turno, só injetamos quando agregam: na 1ª rodada da
    // sessão (modelo ainda não conhece o projeto) ou quando o pedido sugere
    // navegar/encontrar código. Libera a janela do modelo pequeno para a tarefa.
    const isFirstRoundOfSession = sessionHistory.filter(h => h.role === 'assistant').length === 0;
    const promptNeedsCodebaseContext = /\b(onde|qual arquivo|encontr|busc|procur|refator|implement|adicion|cri[ae]|corrig|fix|where|find|search|implement|add|create|refactor)\b/i.test(userPrompt);
    const injectHeavyContext = isFirstRoundOfSession || promptNeedsCodebaseContext;
    // Optional RAG: query vector DB and prepend relevant context (skipped in CHAT)
    let ragContext = '';
    if (!chatMode && ragEndpoint && ragCollection && injectHeavyContext) {
        const ragResults = await (0, rag_client_1.queryRag)(ragEndpoint, ragCollection, userPrompt);
        ragContext = (0, rag_client_1.formatRagContext)(ragResults);
    }
    // Session memory: detect stack + inject summary (skipped in CHAT — chat mode
    // is meant to be a free-form conversation outside of project context).
    let memorySummary = '';
    if (!chatMode && sessionId) {
        (0, memory_service_1.detectAndRememberStack)(sessionId);
        memorySummary = (0, memory_service_1.buildMemorySummary)(sessionId);
    }
    // ProjectIntel: scan workspace lazily and inject a compact symbol index
    // so the model can find files by exported name without reading them.
    // Cap reduzido de 40 para 20 arquivos (libera ~700 tokens em todo prompt).
    // Pode ser desligado nas configuracoes para modelos < 4B ou monorepos.
    let projectIntelSummary = '';
    if (!chatMode && projectIntelEnabled && defaultCwd && injectHeavyContext) {
        try {
            const intel = new project_intel_1.ProjectIntelService(defaultCwd);
            projectIntelSummary = intel.summarizeForPrompt(20, 120);
        }
        catch { /* scan failures shouldn't block the round */ }
    }
    const systemContent = chatMode
        ? prompt_1.CHAT_SYSTEM_PROMPT
        : [prompt_1.SYSTEM_PROMPT + autoBlock, memorySummary, projectIntelSummary, ragContext, contextBlock].filter(Boolean).join('\n\n');
    // In auto mode include only the last 1 history pair so the model knows what
    // the user was working on — skipping history entirely left it context-blind.
    // The round's own tool chain still grows large, so keep it to 1 pair max.
    const historySlice = sessionHistory.slice(0, -1);
    const priorMessages = effectiveAutoMode
        ? (0, history_service_1.buildMessagesFromHistory)(historySlice.slice(-2)) // last user+assistant pair
        : (0, history_service_1.buildMessagesFromHistory)(historySlice);
    const roundMessages = [
        { role: 'system', content: systemContent },
        ...priorMessages,
        { role: 'user', content: userPrompt },
    ];
    // Queue (not single slot) so multiple user messages sent during a slow
    // API call are all preserved instead of last-write-wins.
    const injectedMessages = [];
    if (onInjectMessage) {
        onInjectMessage((msg) => { injectedMessages.push(msg); });
    }
    const filesReadThisRound = new Set();
    // Pre-populate from persisted memory so previously-approved commands
    // don't need re-confirmation across reloads of the same session.
    const sessionApprovedCommands = new Set(sessionId ? (0, memory_service_1.loadSessionMemory)(sessionId).approvedCommands : []);
    const fileCache = new Map();
    const dirCache = new Map();
    // Guard único de execução — fonte única dos nudges corretivos do loop.
    const executionGuard = new execution_guard_1.ExecutionGuardService();
    const counters = {
        filesWritten: 0,
        lastCommandFailed: false,
        lastBuildPassed: false,
        lastErrorFiles: [],
        lastErrorSummary: '',
        lastEditedFile: '',
    };
    const toolHandlers = buildToolHandlers(onStatus, onCommandStart, onCommandOutput, onCommandEnd, onConfirmWrite, onConfirmCommand, onGetDiagnostics, onTodoUpdate, effectiveAutoMode, filesReadThisRound, sessionApprovedCommands, fileCache, dirCache, counters, onFileTouched, sessionId);
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
    const maxSteps = effectiveAutoMode ? 40 : constants_2.MAX_AGENT_STEPS;
    let step = 0;
    let emptyResponseStreak = 0;
    let pendingActionStreak = 0;
    // Auto-continuação: em modo AUTO o usuário não quer clicar "continuar" a
    // cada parada branda (contexto cheio / limite de passos). O loop retoma
    // sozinho do checkpoint até MAX_AUTO_CONTINUES vezes; só então devolve o
    // botão para clique manual — teto que evita loop infinito queimando recursos.
    const MAX_AUTO_CONTINUES = 3;
    let autoContinueCount = 0;
    // Quando o agente atinge um limite (passos ou respostas vazias) sem concluir,
    // salva um resumo do progresso na memoria da sessao. Assim, ao continuar, o
    // proximo turno recebe esse contexto (via buildMemorySummary) e retoma de
    // onde parou em vez de zerar. Retorna a frase de status para o usuario.
    const persistProgressCheckpoint = (reason) => {
        if (!sessionId) {
            return;
        }
        const readList = Array.from(filesReadThisRound)
            .map(p => path.basename(p)).slice(0, 12);
        const parts = [];
        parts.push(`[CHECKPOINT passo ${step}/${maxSteps}] Tarefa em andamento, nao concluida (${reason}).`);
        parts.push(`Pedido original: ${userPrompt.slice(0, 200)}`);
        if (readList.length) {
            parts.push(`Arquivos ja analisados: ${readList.join(', ')}.`);
        }
        if (counters.filesWritten > 0) {
            parts.push(`Arquivos escritos/editados: ${counters.filesWritten}${counters.lastEditedFile ? ' (ultimo: ' + path.basename(counters.lastEditedFile) + ')' : ''}.`);
        }
        if (counters.lastCommandFailed && counters.lastErrorSummary) {
            parts.push(`Ultimo erro: ${counters.lastErrorSummary.slice(0, 150)}.`);
        }
        parts.push('Ao continuar, retome deste ponto sem refazer o que ja foi feito.');
        const note = parts.join(' ').slice(0, 480);
        try {
            (0, memory_service_1.rememberDecision)(sessionId, note, 'agent');
        }
        catch { /* noop */ }
        onStatus('Progresso salvo na memoria — posso continuar de onde parei.');
    };
    // Trata uma parada BRANDA (contexto cheio ou limite de passos). Em modo
    // AUTO, retoma a tarefa sozinho do checkpoint enquanto houver orçamento de
    // auto-continuação. Retorna:
    //   - null  → a execução deve CONTINUAR (o while segue); o estado foi
    //             resetado e uma mensagem de continuação foi injetada.
    //   - string→ texto final a ser retornado ao usuário (com [CONTINUE_BUTTON]
    //             em AUTO já sem orçamento, ou texto puro fora do AUTO).
    const handleSoftStop = (reason, manualText) => {
        persistProgressCheckpoint(reason);
        if (effectiveAutoMode && autoContinueCount < MAX_AUTO_CONTINUES) {
            autoContinueCount++;
            onStatus(`AUTO: retomando sozinho do checkpoint (${autoContinueCount}/${MAX_AUTO_CONTINUES})...`);
            // Reseta os contadores de parada e poda o contexto para liberar a
            // janela, igual ao que o clique manual provocaria — mas sem clique.
            emptyResponseStreak = 0;
            pendingActionStreak = 0;
            step = 0;
            pruneRoundToolMessages(roundMessages, 1);
            roundMessages.push({
                role: 'user',
                content: 'Continue a tarefa de onde parou. Voce nao terminou — execute as proximas etapas ate o build passar com sucesso. Nao refaca o que ja foi feito.',
            });
            lastToolName = '';
            return null;
        }
        emitTelemetry();
        if (effectiveAutoMode) {
            // Esgotou o teto de auto-continuação — devolve o botão para o usuário.
            return `${manualText}\n\n[CONTINUE_BUTTON]`;
        }
        // Fora do AUTO o comportamento original: oferece o botão de continuar.
        return `${manualText}\n\n[CONTINUE_BUTTON]`;
    };
    // Tracks repeated identical tool calls (tool name + args). If the model
    // keeps calling the same thing, we nudge it to do something else.
    const toolCallSignatures = new Map();
    let totalPromptTokens = 0;
    let totalCompletionTokens = 0;
    let totalElapsedMs = 0;
    const sessionStart = Date.now();
    const emitTelemetry = () => {
        if (!onTelemetry) {
            return;
        }
        if (totalCompletionTokens === 0 && totalElapsedMs === 0) {
            return;
        }
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
    // CHAT mode forces HYBRID off via effectiveHybridConfig (set to undefined).
    const hybridActive = !!(effectiveHybridConfig?.enabled && effectiveHybridConfig.apiKey);
    // ── HYBRID intensity gating ───────────────────────────────────────
    // The user controls how much the paid model is invoked via a 4-level
    // slider. Each trigger has a minimum intensity threshold to fire.
    const HYBRID_TRIGGER_MIN = {
        recover_stop: 25, // critical recovery: always fires when hybrid active
        recover_command: 25,
        recover_syntax: 50,
        plan: 50,
        verify_build: 75,
        verify_write: 100,
    };
    const hybridAllowsTrigger = (reason) => {
        if (!hybridActive) {
            return false;
        }
        return hybridIntensity >= HYBRID_TRIGGER_MIN[reason];
    };
    const HYBRID_STATUS_BY_REASON = {
        plan: 'Planejando estrategia da tarefa',
        verify_write: 'Verificando se a escrita foi feita corretamente',
        verify_build: 'Confirmando que o build esta saudavel',
        recover_command: 'Analisando falha de comando e sugerindo correcao',
        recover_syntax: 'Analisando erro de sintaxe persistente',
        recover_stop: 'Local travou — pedindo plano de recuperacao',
    };
    async function askSupport(reason, system, user, maxTokens = 800) {
        if (!hybridActive || !effectiveHybridConfig) {
            return null;
        }
        // Respect user-defined hybrid intensity — skip non-essential triggers
        // when the slider is set to a lower level.
        if (!hybridAllowsTrigger(reason)) {
            return null;
        }
        const statusText = HYBRID_STATUS_BY_REASON[reason];
        onHybridActivity?.({
            provider: effectiveHybridConfig.provider,
            reason,
            statusText,
            success: false, // pending; UI will update on second event
        });
        const res = await (0, hybrid_client_1.callSupportProvider)({
            provider: effectiveHybridConfig.provider,
            apiKey: effectiveHybridConfig.apiKey,
            model: effectiveHybridConfig.model,
            system,
            user,
            maxTokens,
        });
        const ok = !res.error && res.text.length > 0;
        onHybridActivity?.({
            provider: effectiveHybridConfig.provider,
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
    function v1VerifyWrite(absPath, claim) {
        try {
            const stat = fs.statSync(absPath);
            return `[V1 OK] "${path.basename(absPath)}" exists (${stat.size} bytes). Local model claim: "${claim.slice(0, 200)}"`;
        }
        catch {
            return `[V1 FAIL] "${absPath}" was NOT created on disk, but the model claimed it was. Try again with write_local_file.`;
        }
    }
    // ── GATILHO 1: planejamento inicial ────────────────────────────────
    // Antes da primeira iteracao do loop, consulta o pago para gerar um
    // plano de execucao. O plano vira contexto adicional injetado como
    // mensagem do usuario que o local executa passo a passo.
    if (hybridActive) {
        const planSystem = `You are a senior architect helping a small local LLM (14B, 2048 ctx) execute a coding task. The local model has very limited context space — every token in your plan reduces what it has to work with.

Output a NUMBERED list of 3-7 short steps. STRICT format rules:
- Use RELATIVE paths only (e.g. "package.json", "src/extension.ts") — never absolute paths
- Each step: one line, one tool call (verb + relative path + brief why)
- No prose, no headers, no introduction, no markdown bold/italic
- Total output under 200 words
- If the task needs a build/compile/package — explicitly include the run_command step (e.g. "3. run_command: npm run build") and a verification step (e.g. "4. list_directory to confirm output exists")`;
        const planUser = `User request:\n${userPrompt}\n\nProject root: ${defaultCwd.split(/[/\\]/).pop()}\n\nGenerate the plan now (under 200 words, relative paths only).`;
        const plan = await askSupport('plan', planSystem, planUser, 350);
        if (plan) {
            roundMessages.push({
                role: 'user',
                content: `[PLAN] Execute each step in order using tools:\n${plan}`,
            });
        }
    }
    // ── Âncora de plano local (sem HYBRID) ─────────────────────────────
    // Modelo pequeno se perde em tarefas multi-passo sem um plano que o
    // ancore. Quando NÃO há HYBRID gerando o plano e a tarefa parece ter
    // vários passos, pedimos que ele próprio comece pelo todo_update — isso
    // cria um scratchpad de estado que guia as rodadas seguintes muito melhor
    // do que regras abstratas. Mensagem curta, só uma vez, na 1ª rodada.
    const taskLooksMultiStep = userPrompt.trim().split(/\s+/).length >= 12
        || /\b(e depois|então|primeiro|em seguida|todos os|cada|refator|implement|migr|criar?\s+\w+.*\be\b)\b/i.test(userPrompt);
    if (!chatMode && !hybridActive && isFirstRoundOfSession && taskLooksMultiStep) {
        roundMessages.push({
            role: 'user',
            content: 'Antes de agir, chame todo_update com 3 a 5 passos curtos para esta tarefa. Depois execute o primeiro passo.',
        });
    }
    // Loop externo: permite que o limite de passos seja "rearmado" pela
    // auto-continuação em modo AUTO (handleSoftStop reseta step=0). Sem AUTO,
    // ou esgotado o teto, sai com o texto final.
    autoContinueLoop: while (true) {
        while (++step <= maxSteps) {
            if (signal?.aborted) {
                emitTelemetry();
                return '[INTERRUPTED] Execution cancelled by user.';
            }
            if (injectedMessages.length > 0) {
                const combined = injectedMessages.splice(0).join('\n');
                roundMessages.push({ role: 'user', content: `[USER INTERRUPTED]: ${combined}` });
                lastToolName = '';
            }
            const statusAfterTool = {
                list_directory: 'Analyzing project structure...',
                read_local_file: 'Processing file contents...',
                edit_file: 'Working out next action...',
                search_in_workspace: 'Analyzing search results...',
                get_diagnostics: 'Analyzing editor diagnostics...',
                write_local_file: 'Working out next action...',
                run_command: 'Analyzing command output...',
                run_git: 'Analyzing git result...',
                web_search: 'Analyzing web results...',
                todo_update: 'Updating task list...',
            };
            const thinking = lastToolName && statusAfterTool[lastToolName]
                ? statusAfterTool[lastToolName]
                : thinkingStatus[step % thinkingStatus.length];
            onStatus(thinking);
            // In CHAT mode, only expose web_search (and only if the user
            // explicitly enabled it). All code-editing tools are hidden.
            const baseTools = enabledTools?.length
                ? tools_definition_2.TOOLS.filter(t => enabledTools.includes(t.name))
                : tools_definition_2.TOOLS;
            // Gating de ferramentas por fase: para modelo pequeno, menos opções =
            // decisão mais fácil. Escondemos run_git e web_search a menos que a
            // tarefa os peça (palavra-chave no prompt) ou o modelo já os tenha usado
            // nesta rodada. As ferramentas de edição/leitura ficam sempre visíveis.
            const gitRelevant = /\b(git|commit|push|pull|branch|merge|stash|diff|checkout|rebase|tag)\b/i.test(userPrompt)
                || lastToolName === 'run_git';
            const webRelevant = /\b(http|https|www\.|documenta|pesquis|search|web|api d[eo]|como usar|biblioteca|library|erro desconhecido)\b/i.test(userPrompt)
                || lastToolName === 'web_search';
            const activeTools = chatMode
                ? baseTools.filter(t => t.name === 'web_search')
                : baseTools.filter(t => (t.name !== 'run_git' || gitRelevant) &&
                    (t.name !== 'web_search' || webRelevant));
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
                    pruneRoundToolMessages(roundMessages, effectiveAutoMode ? 3 : 2);
                }
            }
            // Only stream text to UI when there's a chance this is the final reply.
            // If the model ends up calling a tool instead, onStreamChunk output is
            // discarded — the UI bubble gets cleared before the tool result is shown.
            let streamedSoFar = '';
            const onChunk = onStreamChunk
                ? (text) => { streamedSoFar += text; onStreamChunk(text); }
                : undefined;
            const result = provider === 'anthropic' && anthropicApiKey
                ? await (0, api_client_1.callAnthropicAI)(anthropicApiKey, roundMessages, activeTools, model, signal, onChunk, onLiveTelemetry)
                : await (0, api_client_1.callAI)(endpoint, authHeaders, roundMessages, activeTools, model, signal, onChunk, onLiveTelemetry);
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
                // Se o stream ja tinha gerado texto antes de cair, preserva o que
                // veio em vez de descartar — o usuario pode aproveitar a resposta
                // parcial mesmo com erro. A mensagem de diagnostico vai junto.
                const detail = result.errorDetail || 'Erro ao chamar o modelo.';
                if (result.partialText && result.partialText.length > 20) {
                    return `${result.partialText}\n\n---\n\n⚠ ${detail}\n(resposta interrompida apos ${result.partialText.length} chars)`;
                }
                return `⚠ ${detail}`;
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
                    ? await handler(args, defaultCwd, step, constants_2.MAX_AGENT_STEPS)
                    : `ERRO: Ferramenta "${name}" nao reconhecida.`;
                // Limpa o output antes de mandar pro LLM: remove lixo (ANSI, barras
                // de progresso, linhas em branco/spinners repetidos), aplica limpeza
                // por tool (run_command prioriza erros + cauda, git diff descarta
                // contexto, search deduplica) e so entao trunca de forma inteligente
                // (head+tail em limites de linha) se ainda passar do limite.
                // Substitui o slice cego antigo. Limpeza adaptativa por modo:
                // agressiva em AUTO (contexto apertado), leve no modo manual.
                const truncatedOutput = context_sanitizer_1.contextSanitizer.clean(name, toolOutput, {
                    autoMode: effectiveAutoMode,
                });
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
                        const fp = args.filePath || '';
                        if (fp) {
                            const absPath = (0, validation_1.resolveFilePath)(fp, defaultCwd);
                            const v1 = v1VerifyWrite(absPath, toolOutput);
                            roundMessages.push({
                                role: 'user',
                                content: `[VERIFICATION] ${v1}`,
                            });
                        }
                    }
                    else if (name === 'run_command' && counters.lastBuildPassed && !counters.lastCommandFailed) {
                        // V2: build acabou de passar — pago confirma se de fato esta tudo certo
                        const verifySystem = 'You are a code reviewer. The local agent just ran a build/test command successfully. Look at the command output and decide: is the build truly OK, or are there warnings/skipped tests/incomplete work the local agent might be ignoring? Reply in ONE LINE: either "BUILD OK" or "BUILD CONCERN: <one sentence>".';
                        const verifyUser = `Command: ${args.command || ''}\nOutput:\n${toolOutput.slice(0, 1500)}`;
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
                pruneRoundToolMessages(roundMessages, effectiveAutoMode ? 3 : 6);
            }
            else if (result.responseText !== undefined) {
                const text = result.responseText || '';
                // Only treat completely empty response as recoverable overflow.
                // Short responses are legitimate (model may say "Ok." then call a tool).
                if (!text) {
                    emptyResponseStreak++;
                    onStatus(`Modelo retornou vazio — recarregando contexto (tentativa ${emptyResponseStreak}/3)`);
                    if (emptyResponseStreak >= 3) {
                        // Parada branda: contexto do modelo encheu. Em AUTO o loop
                        // retoma sozinho do checkpoint (handleSoftStop); só devolve o
                        // botão quando esgota o teto de auto-continuação ou fora do AUTO.
                        const outcome = handleSoftStop('o modelo ficou sem contexto', 'A tarefa e longa e o contexto do modelo encheu. Salvei o progresso ate aqui na memoria. Clique para continuar de onde parei.');
                        if (outcome === null) {
                            continue;
                        }
                        return outcome;
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
                const modelIsPlanning = effectiveAutoMode && counters.filesWritten === 0 && !lastToolName;
                const lastCommandFailed = effectiveAutoMode && counters.lastCommandFailed;
                const buildNotYetPassed = effectiveAutoMode && counters.filesWritten > 0 && !counters.lastBuildPassed;
                const dumpedInsteadOfWriting = effectiveAutoMode && dumpedCodeInChat;
                if (detectsPendingAction(text, effectiveAutoMode) || modelIsPlanning || lastCommandFailed || buildNotYetPassed || dumpedInsteadOfWriting) {
                    pendingActionStreak++;
                    // ── GATILHOS 3/4/5: recuperacao via pago ───────────────
                    // Cap antigo era 5 com recovery no strike 4. Agora vai ate 15
                    // com recovery em CADA multiplo de 4 (4, 8, 12) — cada chamada
                    // tenta dar um plano novo se o anterior nao destravou.
                    const RECOVERY_INTERVAL = 4;
                    const HARD_CAP_AUTO = 15;
                    if (hybridActive && pendingActionStreak > 0 && pendingActionStreak % RECOVERY_INTERVAL === 0) {
                        const reason = lastCommandFailed
                            ? 'recover_command'
                            : buildNotYetPassed
                                ? 'recover_syntax'
                                : 'recover_stop';
                        const sys = 'You are a senior engineer helping a stuck local agent. The local agent failed multiple attempts. Diagnose and produce a SHORT, SPECIFIC corrective plan in 3-5 bullets. Name exact files and exact actions. Be concrete.';
                        const errCtx = counters.lastErrorFiles.length > 0
                            ? `\nError files: ${counters.lastErrorFiles.join(', ')}\nError summary: ${counters.lastErrorSummary}`
                            : '';
                        const usr = `Original task: ${userPrompt}\n\nLast agent response: ${text.slice(0, 800)}\n\nLast edited file: ${counters.lastEditedFile || 'none'}${errCtx}\n\nAttempt: ${pendingActionStreak}/${HARD_CAP_AUTO}\n\nWhat should the local agent do next?`;
                        const recovery = await askSupport(reason, sys, usr, 500);
                        if (recovery) {
                            roundMessages.push({ role: 'assistant', content: text });
                            roundMessages.push({
                                role: 'user',
                                content: `[HYBRID RECOVERY from support model] Tentativa ${pendingActionStreak}/${HARD_CAP_AUTO}. Follow this exactly:\n\n${recovery}`,
                            });
                            lastToolName = '';
                            continue;
                        }
                    }
                    if (pendingActionStreak >= HARD_CAP_AUTO) {
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
                    // Fonte ÚNICA de nudge: o ExecutionGuardService decide qual
                    // correção injetar (PT-BR, curta, colaborativa). Antes havia um
                    // bloco de ternários aqui que duplicava — e divergia — da mesma
                    // lógica do guard. Montamos o estado a partir dos counters do loop.
                    // O loop não mantém o ToolCallRecord completo. O guard só lê
                    // toolCalls em dois detectores: buildPendingNoCommand (algum
                    // run_command de build já rodou?) e modelPlanning (toolCalls
                    // vazio). Reconstruímos só esses dois sinais honestamente:
                    // marcador de build se ele ocorreu, marcador genérico se houve
                    // qualquer tool nesta rodada (lastToolName), senão vazio.
                    const buildWasAttempted = lastBuildAttempted(roundMessages);
                    const syntheticToolCalls = buildWasAttempted
                        ? [{ name: 'run_command', args: { command: 'npm run build' }, output: '', success: true, timestamp: Date.now() }]
                        : lastToolName
                            ? [{ name: lastToolName, args: {}, output: '', success: true, timestamp: Date.now() }]
                            : [];
                    const guardState = {
                        userPrompt,
                        autoMode: effectiveAutoMode,
                        hybridActive,
                        toolCalls: syntheticToolCalls,
                        filesWritten: counters.filesWritten,
                        filesRead: filesReadThisRound.size,
                        lastBuildPassed: counters.lastBuildPassed,
                        lastCommandFailed: counters.lastCommandFailed,
                        lastErrorFiles: counters.lastErrorFiles,
                        lastEditedFile: counters.lastEditedFile,
                        lastModelText: text,
                        pendingActionStreak,
                        emptyResponseStreak,
                    };
                    const guardResult = executionGuard.evaluate(guardState);
                    // Anexa a localização do erro quando há arquivos apontados — dá
                    // ao modelo o alvo concreto sem inflar o nudge base.
                    const errorContext = (lastCommandFailed && counters.lastErrorFiles.length > 0)
                        ? `\nArquivos do erro: ${counters.lastErrorFiles.join(', ')}${counters.lastErrorSummary ? ' — ' + counters.lastErrorSummary : ''}`
                        : '';
                    const nudge = guardResult
                        ? guardResult.message + (guardResult.reason === 'command_failed' ? '' : errorContext)
                        : 'Continue a tarefa.';
                    roundMessages.push({ role: 'assistant', content: text });
                    roundMessages.push({ role: 'user', content: nudge });
                    lastToolName = '';
                    continue;
                }
                pendingActionStreak = 0;
                // In auto mode: before returning, check editor diagnostics.
                // Only relevant if the model actually wrote/edited files this round.
                // Wait 2s for the TypeScript language server to process the new files.
                if (effectiveAutoMode && counters.filesWritten > 0) {
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
            }
            else {
                // result.responseText is undefined and no toolCall — API returned
                // an unexpected shape. Treat as infra issue, don't loop silently.
                emitTelemetry();
                return 'Resposta inesperada do modelo. Tente novamente.';
            }
        }
        // Atingiu o limite de passos sem concluir. Parada branda: em AUTO o loop
        // se rearma sozinho (handleSoftStop reseta step=0 e re-injeta continuação),
        // voltando ao topo do loop externo. Fora do AUTO ou esgotado o teto, retorna.
        const outcome = handleSoftStop('limite de passos atingido', 'Cheguei ao limite de passos desta rodada, mas salvei o progresso na memoria. Clique para continuar a tarefa de onde parei.');
        if (outcome === null) {
            continue autoContinueLoop;
        }
        return outcome;
    } // fim do autoContinueLoop
}
