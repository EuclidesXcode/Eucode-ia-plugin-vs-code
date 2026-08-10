"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.TOOL_NAMES = exports.TOOLS = exports.runCommandTool = void 0;
const child_process_1 = require("child_process");
const events_1 = require("events");
const SERVER_READY_PATTERNS = [
    /listening on/i, /server running/i, /started on/i, /ready on/i,
    /running at/i, /localhost:/i, /127\.0\.0\.1:/i, /0\.0\.0\.0:/i,
    /started server/i, /app running/i, /serving on/i, /devserver/i,
    /compiled successfully/i, /ready in/i, /vite v/i,
];
const LONG_RUNNING_PREFIXES = [
    'npm start', 'npm run start', 'npm run dev', 'npm run watch',
    'yarn start', 'yarn dev', 'yarn watch',
    'npx nodemon', 'npx ts-node-dev', 'node ', 'python ', 'python3 ',
];
// Hard timeout for any command. The plugin runs LM locally so build/test
// times vary with hardware — 5 min is a generous ceiling. After this we kill
// the child to prevent the agent loop from hanging forever.
const COMMAND_HARD_TIMEOUT_MS = 5 * 60 * 1000;
const runCommandTool = (command, cwd) => {
    const emitter = new events_1.EventEmitter();
    const processChild = (0, child_process_1.spawn)(command, [], { cwd: cwd || process.cwd(), shell: true });
    let outputBuffer = '';
    let resolved = false;
    const isLongRunning = LONG_RUNNING_PREFIXES.some(p => command.trim().startsWith(p));
    let longRunningTimer = null;
    if (isLongRunning) {
        longRunningTimer = setTimeout(() => {
            if (!resolved) {
                resolved = true;
                emitter.emit('long_running');
                emitter.emit('done', outputBuffer || '[Process running in background]');
            }
        }, 8000);
    }
    // Hard timeout — kills the process if it never exits.
    const hardTimer = setTimeout(() => {
        if (resolved) {
            return;
        }
        resolved = true;
        try {
            processChild.kill('SIGTERM');
        }
        catch { }
        setTimeout(() => { try {
            processChild.kill('SIGKILL');
        }
        catch { } }, 2000);
        if (longRunningTimer) {
            clearTimeout(longRunningTimer);
        }
        emitter.emit('exit_code', 124);
        emitter.emit('done', `${outputBuffer}\n[TIMEOUT] Command exceeded ${COMMAND_HARD_TIMEOUT_MS / 1000}s and was terminated. If this was a build on a slow machine, simplify the task or run it manually.`);
    }, COMMAND_HARD_TIMEOUT_MS);
    function checkServerReady(chunk) {
        if (!resolved && isLongRunning && SERVER_READY_PATTERNS.some(p => p.test(chunk))) {
            resolved = true;
            if (longRunningTimer) {
                clearTimeout(longRunningTimer);
            }
            clearTimeout(hardTimer);
            emitter.emit('long_running');
            setTimeout(() => emitter.emit('done', outputBuffer), 300);
        }
    }
    processChild.stdout?.on('data', (data) => {
        const chunk = data.toString();
        outputBuffer += chunk;
        emitter.emit('stdout', chunk);
        checkServerReady(chunk);
    });
    processChild.stderr?.on('data', (data) => {
        const chunk = data.toString();
        outputBuffer += chunk;
        emitter.emit('stderr', chunk);
        checkServerReady(chunk);
    });
    processChild.on('close', (code) => {
        if (longRunningTimer) {
            clearTimeout(longRunningTimer);
        }
        clearTimeout(hardTimer);
        if (!resolved) {
            resolved = true;
            emitter.emit('exit_code', code ?? 0);
            emitter.emit('done', outputBuffer || `[Process exited with code ${code}]`);
        }
    });
    processChild.on('error', (err) => {
        if (longRunningTimer) {
            clearTimeout(longRunningTimer);
        }
        clearTimeout(hardTimer);
        if (!resolved) {
            resolved = true;
            emitter.emit('exit_code', 1);
            emitter.emit('stderr', `[ERROR] ${err.message}`);
            emitter.emit('done', `[ERROR] ${err.message}`);
        }
    });
    return emitter;
};
exports.runCommandTool = runCommandTool;
exports.TOOLS = [
    {
        name: 'list_directory',
        description: 'Lists files and folders in a directory. Use to understand the project structure before taking any action.',
        parameters: {
            type: 'object',
            properties: {
                dirPath: { type: 'string', description: 'Absolute path of the directory to list.' },
            },
            required: ['dirPath'],
        },
    },
    {
        name: 'read_local_file',
        description: 'Reads the full content of a file. Use when you need to understand the code before editing, or when edit_file fails.',
        parameters: {
            type: 'object',
            properties: {
                filePath: { type: 'string', description: 'Absolute path of the file to read.' },
            },
            required: ['filePath'],
        },
    },
    {
        name: 'edit_file',
        description: 'PREFERRED TOOL for editing existing files. Replaces an exact string (old_string) with new content (new_string) without touching the rest of the file. old_string must be unique in the file — include enough surrounding lines to guarantee uniqueness. Use write_local_file only to create new files or intentionally rewrite the entire file.',
        parameters: {
            type: 'object',
            properties: {
                filePath: { type: 'string', description: 'Absolute path of the file to edit.' },
                old_string: { type: 'string', description: 'Exact string to replace. Must be unique in the file. Include neighboring lines if needed to ensure uniqueness.' },
                new_string: { type: 'string', description: 'New content that will replace old_string.' },
            },
            required: ['filePath', 'old_string', 'new_string'],
        },
    },
    {
        name: 'write_local_file',
        description: 'Creates a new file or overwrites the ENTIRE file. Use only for new files or when a full rewrite is intentional. For partial edits to existing files, use edit_file.',
        parameters: {
            type: 'object',
            properties: {
                filePath: { type: 'string', description: 'Absolute path of the file to create or overwrite.' },
                content: { type: 'string', description: 'Complete file content.' },
            },
            required: ['filePath', 'content'],
        },
    },
    {
        name: 'search_in_workspace',
        description: 'Searches for a term, function, class, or pattern across all project files. Uses ripgrep if available, falls back to grep. Returns file path, line number, and matching snippet.',
        parameters: {
            type: 'object',
            properties: {
                query: { type: 'string', description: 'Term or pattern to search for.' },
                dirPath: { type: 'string', description: 'Directory to search in. If omitted, searches from the workspace root.' },
            },
            required: ['query'],
        },
    },
    {
        name: 'get_diagnostics',
        description: 'Returns current errors and warnings from the VS Code editor (TypeScript, ESLint, etc.). Use when the user mentions errors or asks to fix bugs — do not ask the user to copy error messages.',
        parameters: {
            type: 'object',
            properties: {},
            required: [],
        },
    },
    {
        name: 'todo_update',
        description: 'Updates the task checklist visible to the user in the chat. Call this to show progress on multi-step tasks. Send the full list each time — it replaces the previous one.',
        parameters: {
            type: 'object',
            properties: {
                todos: {
                    type: 'array',
                    description: 'Full list of tasks.',
                    items: {
                        type: 'object',
                        properties: {
                            content: { type: 'string', description: 'Task description.' },
                            status: { type: 'string', enum: ['pending', 'in_progress', 'completed'], description: 'Current task status.' },
                        },
                        required: ['content', 'status'],
                    },
                },
            },
            required: ['todos'],
        },
    },
    {
        name: 'run_command',
        description: 'Executes a command in the terminal. Use to compile, install dependencies, run tests, start servers (npm start, node app.js, python main.py, etc.). Long-running processes like servers are detected automatically and the agent continues after the server starts. For git operations use run_git.',
        parameters: {
            type: 'object',
            properties: {
                command: { type: 'string', description: 'Command to execute, e.g.: npm run build.' },
                cwd: { type: 'string', description: 'Working directory. If omitted, uses the workspace root folder.' },
            },
            required: ['command'],
        },
    },
    {
        name: 'run_git',
        description: 'Executes git operations safely. Read-only operations (status, log, diff, branch, show) run directly. State-modifying operations (commit, add, push, checkout, merge) require user confirmation. Destructive operations (reset --hard, clean -f, push --force) are blocked.',
        parameters: {
            type: 'object',
            properties: {
                subcommand: { type: 'string', description: 'Git subcommand, e.g.: "status", "log --oneline -10", "diff HEAD", "commit -m \\"message\\"".' },
                cwd: { type: 'string', description: 'Git repository directory. If omitted, uses the workspace root folder.' },
            },
            required: ['subcommand'],
        },
    },
    {
        name: 'web_search',
        description: 'Searches the web via DuckDuckGo. Use to find documentation, troubleshoot unknown errors, check external APIs, or get code examples. Cite the source when using information from the web.',
        parameters: {
            type: 'object',
            properties: {
                query: { type: 'string', description: 'Term or question to search for.' },
            },
            required: ['query'],
        },
    },
    {
        name: 'memory_remember',
        description: 'Persists a short decision, preference, or architectural note in the session memory file (.eucode/memory/session_<id>.json). Use this when the user makes a non-obvious choice you should respect for the rest of this session (e.g. "use Zustand instead of Redux", "components are in /src/components in PascalCase", "tests run via vitest, not jest"). Keep notes under 500 chars. Do NOT use for trivia or transient state — only durable preferences.',
        parameters: {
            type: 'object',
            properties: {
                note: { type: 'string', description: 'Short decision or preference to remember (max 500 chars).' },
            },
            required: ['note'],
        },
    },
    {
        name: 'memory_read',
        description: 'Returns the full session memory JSON (stack, approved commands, decisions). Use when you need full details beyond the summary already in your system prompt — for example, to confirm a previously-stated user preference before making an architectural decision.',
        parameters: {
            type: 'object',
            properties: {},
            required: [],
        },
    },
    {
        name: 'browser_action',
        description: 'Controla um navegador web real de forma autonoma. Use para navegar em sites, capturar erros de console, inspecionar requests de rede, acessar cookies, clicar em elementos, preencher formularios e tirar screenshots. Suporta Chrome (chromium) e Safari (webkit). Sempre chame navigate antes de qualquer outra acao.',
        parameters: {
            type: 'object',
            properties: {
                action: {
                    type: 'string',
                    enum: [
                        'navigate',
                        'get_html',
                        'get_console',
                        'get_network',
                        'get_cookies',
                        'click',
                        'type',
                        'screenshot',
                        'evaluate',
                        'close',
                        'wait_for',
                        'get_text',
                        'get_attribute',
                        'select',
                        'hover',
                        'scroll',
                        'press',
                        'clear',
                        'get_title',
                        'get_url',
                        'reload',
                        'wait',
                        'get_errors_only',
                        'get_network_errors',
                        'network_filter',
                        'save_test',
                    ],
                    description: 'Acao a executar. navigate abre uma URL. get_console retorna logs de console. get_network retorna requests de rede. get_cookies retorna cookies. click clica num elemento CSS. type preenche um campo. screenshot captura a tela inteira. evaluate executa JavaScript na pagina. close fecha o navegador.',
                },
                url: { type: 'string', description: 'URL completa para navegar. Obrigatorio em navigate. Ex: http://localhost:3000' },
                selector: { type: 'string', description: 'Seletor CSS do elemento. Obrigatorio em click, type, wait_for, get_text, get_attribute, select, hover e clear. Ex: #email, .btn-submit, button[type=submit]' },
                text: { type: 'string', description: 'Texto a digitar no campo. Obrigatorio em type.' },
                script: { type: 'string', description: 'Codigo JavaScript a executar na pagina. Obrigatorio em evaluate. Ex: document.title' },
                browser: { type: 'string', enum: ['chromium', 'webkit'], description: 'Navegador a usar: chromium para Chrome, webkit para Safari. Padrao: chromium.' },
                attribute: {
                    type: 'string',
                    description: 'Nome do atributo a ler em get_attribute. Ex: href, src, value, aria-label.',
                },
                value: {
                    type: 'string',
                    description: 'Valor usado em select.',
                },
                key: {
                    type: 'string',
                    description: 'Tecla usada em press. Ex: Enter, Escape, Tab, ArrowDown.',
                },
                direction: {
                    type: 'string',
                    enum: ['up', 'down'],
                    description: 'Direcao do scroll.',
                },
                amount: {
                    type: 'number',
                    description: 'Quantidade de pixels para scroll.',
                },
                timeoutMs: {
                    type: 'number',
                    description: 'Tempo em milissegundos para wait_for ou wait.',
                },
                urlContains: {
                    type: 'string',
                    description: 'Filtro para requests cuja URL contem esse trecho.',
                },
                method: {
                    type: 'string',
                    description: 'Filtro de metodo HTTP. Ex: GET, POST, PUT, DELETE.',
                },
                statusMin: {
                    type: 'number',
                    description: 'Status HTTP minimo para filtro de rede.',
                },
                statusMax: {
                    type: 'number',
                    description: 'Status HTTP maximo para filtro de rede.',
                },
                testName: {
                    type: 'string',
                    description: 'Nome opcional do teste gerado por save_test.',
                },
                outputPath: {
                    type: 'string',
                    description: 'Caminho opcional para salvar o teste gerado.',
                },
            },
            required: ['action'],
        },
    },
];
exports.TOOL_NAMES = new Set(exports.TOOLS.map(t => t.name));
