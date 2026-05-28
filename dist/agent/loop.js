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
function buildToolHandlers(onStatus, onCommandStart, onCommandOutput, onCommandEnd, onConfirmWrite, onConfirmCommand, onGetDiagnostics, onTodoUpdate, autoMode, filesReadThisRound, sessionApprovedCommands, fileCache, dirCache, counters, onFileTouched) {
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
                return '[ERROR] filePath not provided.';
            }
            if (oldString === '') {
                return '[ERROR] old_string cannot be empty.';
            }
            let before = null;
            try {
                const fullPath = (0, validation_1.resolveFilePath)(filePath, cwd);
                before = fs.readFileSync(fullPath, 'utf8');
            }
            catch {
                before = null;
            }
            const after = before ? before.replace(oldString, newString) : newString;
            if (autoMode) {
                onStatus(`Editing: ${path.basename(filePath)}`);
                const editResult = (0, file_tools_1.editLocalFile)(filePath, oldString, newString, cwd);
                fileCache.delete((0, validation_1.resolveFilePath)(filePath, cwd));
                counters.filesWritten++;
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
                        onStatus('Process running — awaiting your response...');
                        counters.lastCommandFailed = false;
                        resolve(`[PROCESS STARTED] Command "${cmd}" is running in the background. Output so far:\n${output}\nThe server is up. Inform the user they can interact.`);
                    }
                    else if (exitCode !== 0) {
                        counters.lastCommandFailed = true;
                        if (looksLikeBuild) {
                            counters.lastBuildPassed = false;
                        }
                        resolve(`[FAILED exit=${exitCode}] Command "${cmd}" failed. You MUST diagnose and fix the underlying issue, then re-run. Do not give up. Output:\n${output || '(no output)'}`);
                    }
                    else {
                        counters.lastCommandFailed = false;
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
async function runAgentLoop(userPrompt, contextBlock, defaultCwd, endpoint, authHeaders, sessionHistory, onStatus, onCommandStart, onCommandOutput, onCommandEnd, onConfirmWrite, onConfirmCommand, onGetDiagnostics, onTodoUpdate, model = constants_1.DEFAULT_MODEL, autoMode = false, signal, onInjectMessage, provider, anthropicApiKey, enabledTools, onStreamChunk, onTelemetry, ragEndpoint, ragCollection, onLiveTelemetry, onFileTouched) {
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
        const ragResults = await (0, rag_client_1.queryRag)(ragEndpoint, ragCollection, userPrompt);
        ragContext = (0, rag_client_1.formatRagContext)(ragResults);
    }
    const systemContent = [prompt_1.SYSTEM_PROMPT + autoBlock, ragContext, contextBlock].filter(Boolean).join('\n\n');
    // In auto mode include only the last 1 history pair so the model knows what
    // the user was working on — skipping history entirely left it context-blind.
    // The round's own tool chain still grows large, so keep it to 1 pair max.
    const historySlice = sessionHistory.slice(0, -1);
    const priorMessages = autoMode
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
    const sessionApprovedCommands = new Set();
    const fileCache = new Map();
    const dirCache = new Map();
    const counters = { filesWritten: 0, lastCommandFailed: false, lastBuildPassed: false };
    const toolHandlers = buildToolHandlers(onStatus, onCommandStart, onCommandOutput, onCommandEnd, onConfirmWrite, onConfirmCommand, onGetDiagnostics, onTodoUpdate, autoMode, filesReadThisRound, sessionApprovedCommands, fileCache, dirCache, counters, onFileTouched);
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
    const maxSteps = autoMode ? 40 : constants_2.MAX_AGENT_STEPS;
    let step = 0;
    let emptyResponseStreak = 0;
    let pendingActionStreak = 0;
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
        const activeTools = enabledTools?.length
            ? tools_definition_2.TOOLS.filter(t => enabledTools.includes(t.name))
            : tools_definition_2.TOOLS;
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
                onStatus('Compactando contexto...');
                // Keep more pairs in auto mode so model doesn't lose what it just read
                pruneRoundToolMessages(roundMessages, autoMode ? 3 : 2);
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
                ? await handler(args, defaultCwd, step, constants_2.MAX_AGENT_STEPS)
                : `ERRO: Ferramenta "${name}" nao reconhecida.`;
            // Truncate large tool outputs to avoid filling the context window.
            // In auto mode limits are tighter — no history budget and test/build
            // output (jest, coverage tables) can be thousands of chars.
            // Calibrated for 2048-token context: system (~250t) + prompt + response (1024t).
            // Leaves ~750 tokens (~3000 chars) for tool output + conversation.
            const TOOL_OUTPUT_LIMITS = {
                list_directory: 600,
                search_in_workspace: 800,
                read_local_file: 1200,
                run_command: 800,
                run_git: 600,
                web_search: 1000,
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
            // In auto mode keep fewer pairs since there's no history budget to spare.
            pruneRoundToolMessages(roundMessages, autoMode ? 3 : 6);
        }
        else if (result.responseText !== undefined) {
            const text = result.responseText || '';
            // Only treat completely empty response as recoverable overflow.
            // Short responses are legitimate (model may say "Ok." then call a tool).
            if (!text) {
                emptyResponseStreak++;
                onStatus('Compactando contexto...');
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
            // ── Auto mode: force continuation rules ────────────────────────
            // The user activated AUTO expecting the agent NOT to stop until
            // the build passes. Any of these conditions mean "not done yet":
            //   - model described an action but didn't call a tool
            //   - planning text without ever writing a file
            //   - last command failed (build/test/install error)
            //   - never ran a successful build
            // In all cases: push the model to act, don't return to the user.
            const modelIsPlanning = autoMode && counters.filesWritten === 0 && !lastToolName;
            const lastCommandFailed = autoMode && counters.lastCommandFailed;
            const buildNotYetPassed = autoMode && counters.filesWritten > 0 && !counters.lastBuildPassed;
            if (detectsPendingAction(text, autoMode) || modelIsPlanning || lastCommandFailed || buildNotYetPassed) {
                pendingActionStreak++;
                if (pendingActionStreak >= 5) {
                    // Hard cap to avoid eternal loop. Surface what happened
                    // so the user knows the agent gave up and why.
                    pendingActionStreak = 0;
                    emitTelemetry();
                    const reason = lastCommandFailed
                        ? 'O ultimo comando falhou e o agente nao conseguiu corrigir apos varias tentativas.'
                        : !counters.lastBuildPassed && counters.filesWritten > 0
                            ? 'O build ainda nao passou apos varias tentativas.'
                            : 'O modelo descreveu acoes mas nao executou.';
                    return `[AUTO PAUSADO] ${reason}\n\nUltima resposta do modelo:\n${text}`;
                }
                const nudge = lastCommandFailed
                    ? 'The last command failed. Read the error output carefully, identify the root cause, and use edit_file or write_local_file to fix it. Then re-run the command. Do not stop or ask the user — fix and retry.'
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
        }
        else {
            // result.responseText is undefined and no toolCall — API returned
            // an unexpected shape. Treat as infra issue, don't loop silently.
            emitTelemetry();
            return 'Resposta inesperada do modelo. Tente novamente.';
        }
    }
    emitTelemetry();
    return 'Limite de passos atingido. A tarefa pode estar muito grande — tente dividir em pedidos menores.';
}
