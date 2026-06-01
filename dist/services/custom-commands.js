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
exports.getCommandsFilePath = getCommandsFilePath;
exports.loadCommands = loadCommands;
exports.appendCommand = appendCommand;
exports.parseSlashInput = parseSlashInput;
exports.watchCommandsFile = watchCommandsFile;
const vscode = __importStar(require("vscode"));
const fs = __importStar(require("fs"));
const path = __importStar(require("path"));
const os = __importStar(require("os"));
const workspace_init_1 = require("./workspace-init");
// Resolves the path of eucode.json for the given scope.
// - workspace: <first workspace folder>/.eucode/eucode.json
// - global: ~/.eucode/eucode.json
function getCommandsFilePath(scope) {
    if (scope === 'workspace') {
        return (0, workspace_init_1.getEucodePath)(workspace_init_1.EUCODE_COMMANDS_FILENAME);
    }
    return path.join(os.homedir(), '.eucode', 'eucode.json');
}
// Reads + parses + validates the commands file. Never throws — returns
// errors as strings so the UI can surface them non-blockingly.
function loadCommands(scope) {
    const filePath = getCommandsFilePath(scope);
    if (!filePath) {
        return { commands: [], errors: [] };
    }
    if (!fs.existsSync(filePath)) {
        return { commands: [], errors: [] };
    }
    let raw;
    try {
        raw = fs.readFileSync(filePath, 'utf8');
    }
    catch (e) {
        return { commands: [], errors: [`Nao foi possivel ler ${filePath}: ${e instanceof Error ? e.message : String(e)}`] };
    }
    let parsed;
    try {
        parsed = JSON.parse(raw);
    }
    catch (e) {
        return { commands: [], errors: [`eucode.json com JSON invalido: ${e instanceof Error ? e.message : String(e)}`] };
    }
    if (!Array.isArray(parsed)) {
        return { commands: [], errors: ['eucode.json deve ser um array de comandos.'] };
    }
    const out = [];
    const errors = [];
    const seen = new Set();
    parsed.forEach((entry, i) => {
        if (!entry || typeof entry !== 'object') {
            errors.push(`Item ${i}: deve ser objeto.`);
            return;
        }
        const e = entry;
        if (typeof e.command !== 'string' || !e.command.startsWith('/') || e.command.length < 2) {
            errors.push(`Item ${i}: campo "command" e obrigatorio e deve comecar com / (ex: "/testar").`);
            return;
        }
        if (typeof e.prompt !== 'string' || e.prompt.trim().length === 0) {
            errors.push(`Item ${i} (${e.command}): campo "prompt" e obrigatorio.`);
            return;
        }
        const normalized = e.command.trim().toLowerCase();
        if (seen.has(normalized)) {
            errors.push(`Item ${i}: comando "${e.command}" duplicado.`);
            return;
        }
        seen.add(normalized);
        out.push({
            command: e.command.trim(),
            prompt: e.prompt,
            description: typeof e.description === 'string' ? e.description : undefined,
            autoMode: e.autoMode === true,
            hybridMode: e.hybridMode === true,
        });
    });
    return { commands: out, errors };
}
// Appends a new command. Creates the file (and parent dir for global) if
// missing. Returns true on success.
async function appendCommand(scope, cmd) {
    const filePath = getCommandsFilePath(scope);
    if (!filePath) {
        return { ok: false, error: 'Sem workspace aberto para escopo workspace.' };
    }
    try {
        // Ensure dir exists (relevant for global ~/.eucode/)
        fs.mkdirSync(path.dirname(filePath), { recursive: true });
        let list = [];
        if (fs.existsSync(filePath)) {
            const existing = loadCommands(scope);
            list = existing.commands;
        }
        // Reject duplicate
        if (list.some(c => c.command.toLowerCase() === cmd.command.toLowerCase())) {
            return { ok: false, error: `Comando "${cmd.command}" ja existe.` };
        }
        list.push(cmd);
        fs.writeFileSync(filePath, JSON.stringify(list, null, 2) + '\n', 'utf8');
        return { ok: true, filePath };
    }
    catch (e) {
        return { ok: false, error: e instanceof Error ? e.message : String(e) };
    }
}
// Matches "/cmd anything else" — returns the command name (with /) and
// any free-form arguments after it (for future use; v1 ignores args).
function parseSlashInput(text) {
    const trimmed = text.trim();
    if (!trimmed.startsWith('/')) {
        return null;
    }
    const space = trimmed.indexOf(' ');
    if (space === -1) {
        return { command: trimmed, args: '' };
    }
    return { command: trimmed.slice(0, space), args: trimmed.slice(space + 1).trim() };
}
// Watches the resolved eucode.json path and invokes onChange whenever it
// is created, edited, or deleted. Returns a Disposable.
function watchCommandsFile(scope, onChange) {
    const filePath = getCommandsFilePath(scope);
    if (!filePath) {
        return new vscode.Disposable(() => { });
    }
    if (scope === 'workspace') {
        const folders = vscode.workspace.workspaceFolders;
        if (!folders || folders.length === 0) {
            return new vscode.Disposable(() => { });
        }
        const pattern = new vscode.RelativePattern(folders[0], '.eucode/eucode.json');
        const watcher = vscode.workspace.createFileSystemWatcher(pattern);
        watcher.onDidChange(onChange);
        watcher.onDidCreate(onChange);
        watcher.onDidDelete(onChange);
        return watcher;
    }
    // Global: VS Code's FileSystemWatcher doesn't watch outside workspace,
    // so we use fs.watch directly. Debounced to avoid double-fire on save.
    let timer = null;
    const dir = path.dirname(filePath);
    try {
        fs.mkdirSync(dir, { recursive: true });
    }
    catch { /* ignore */ }
    let watcher = null;
    try {
        watcher = fs.watch(dir, (_event, filename) => {
            if (filename !== 'eucode.json') {
                return;
            }
            if (timer) {
                clearTimeout(timer);
            }
            timer = setTimeout(onChange, 200);
        });
    }
    catch {
        // Watch may fail on some systems — degrade silently
    }
    return new vscode.Disposable(() => {
        if (timer) {
            clearTimeout(timer);
        }
        watcher?.close();
    });
}
