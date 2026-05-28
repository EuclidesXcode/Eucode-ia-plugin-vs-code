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
    function checkServerReady(chunk) {
        if (!resolved && isLongRunning && SERVER_READY_PATTERNS.some(p => p.test(chunk))) {
            resolved = true;
            if (longRunningTimer) {
                clearTimeout(longRunningTimer);
            }
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
];
exports.TOOL_NAMES = new Set(exports.TOOLS.map(t => t.name));
