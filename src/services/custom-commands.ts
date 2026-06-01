import * as vscode from 'vscode';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';

export interface CustomCommand {
    command: string;        // e.g. "/testar"
    prompt: string;         // text injected as the user input
    description?: string;   // short label shown in the autocomplete dropdown
    autoMode?: boolean;     // force AUTO when running
    hybridMode?: boolean;   // force HYBRID when running
}

export type CommandsScope = 'workspace' | 'global';

// Resolves the path of eucode.json for the given scope.
// - workspace: <first workspace folder>/eucode.json
// - global: ~/.eucode/eucode.json
export function getCommandsFilePath(scope: CommandsScope): string | null {
    if (scope === 'workspace') {
        const folders = vscode.workspace.workspaceFolders;
        if (!folders || folders.length === 0) { return null; }
        return path.join(folders[0].uri.fsPath, 'eucode.json');
    }
    return path.join(os.homedir(), '.eucode', 'eucode.json');
}

export interface LoadResult {
    commands: CustomCommand[];
    errors: string[];
}

// Reads + parses + validates the commands file. Never throws — returns
// errors as strings so the UI can surface them non-blockingly.
export function loadCommands(scope: CommandsScope): LoadResult {
    const filePath = getCommandsFilePath(scope);
    if (!filePath) { return { commands: [], errors: [] }; }
    if (!fs.existsSync(filePath)) { return { commands: [], errors: [] }; }

    let raw: string;
    try {
        raw = fs.readFileSync(filePath, 'utf8');
    } catch (e) {
        return { commands: [], errors: [`Nao foi possivel ler ${filePath}: ${e instanceof Error ? e.message : String(e)}`] };
    }

    let parsed: unknown;
    try {
        parsed = JSON.parse(raw);
    } catch (e) {
        return { commands: [], errors: [`eucode.json com JSON invalido: ${e instanceof Error ? e.message : String(e)}`] };
    }

    if (!Array.isArray(parsed)) {
        return { commands: [], errors: ['eucode.json deve ser um array de comandos.'] };
    }

    const out: CustomCommand[] = [];
    const errors: string[] = [];
    const seen = new Set<string>();

    parsed.forEach((entry, i) => {
        if (!entry || typeof entry !== 'object') {
            errors.push(`Item ${i}: deve ser objeto.`); return;
        }
        const e = entry as any;
        if (typeof e.command !== 'string' || !e.command.startsWith('/') || e.command.length < 2) {
            errors.push(`Item ${i}: campo "command" e obrigatorio e deve comecar com / (ex: "/testar").`); return;
        }
        if (typeof e.prompt !== 'string' || e.prompt.trim().length === 0) {
            errors.push(`Item ${i} (${e.command}): campo "prompt" e obrigatorio.`); return;
        }
        const normalized = e.command.trim().toLowerCase();
        if (seen.has(normalized)) {
            errors.push(`Item ${i}: comando "${e.command}" duplicado.`); return;
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
export async function appendCommand(scope: CommandsScope, cmd: CustomCommand): Promise<{ ok: boolean; error?: string; filePath?: string }> {
    const filePath = getCommandsFilePath(scope);
    if (!filePath) { return { ok: false, error: 'Sem workspace aberto para escopo workspace.' }; }

    try {
        // Ensure dir exists (relevant for global ~/.eucode/)
        fs.mkdirSync(path.dirname(filePath), { recursive: true });

        let list: CustomCommand[] = [];
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
    } catch (e) {
        return { ok: false, error: e instanceof Error ? e.message : String(e) };
    }
}

// Matches "/cmd anything else" — returns the command name (with /) and
// any free-form arguments after it (for future use; v1 ignores args).
export function parseSlashInput(text: string): { command: string; args: string } | null {
    const trimmed = text.trim();
    if (!trimmed.startsWith('/')) { return null; }
    const space = trimmed.indexOf(' ');
    if (space === -1) { return { command: trimmed, args: '' }; }
    return { command: trimmed.slice(0, space), args: trimmed.slice(space + 1).trim() };
}

// Watches the resolved eucode.json path and invokes onChange whenever it
// is created, edited, or deleted. Returns a Disposable.
export function watchCommandsFile(scope: CommandsScope, onChange: () => void): vscode.Disposable {
    const filePath = getCommandsFilePath(scope);
    if (!filePath) { return new vscode.Disposable(() => {}); }

    if (scope === 'workspace') {
        const folders = vscode.workspace.workspaceFolders;
        if (!folders || folders.length === 0) { return new vscode.Disposable(() => {}); }
        const pattern = new vscode.RelativePattern(folders[0], 'eucode.json');
        const watcher = vscode.workspace.createFileSystemWatcher(pattern);
        watcher.onDidChange(onChange);
        watcher.onDidCreate(onChange);
        watcher.onDidDelete(onChange);
        return watcher;
    }

    // Global: VS Code's FileSystemWatcher doesn't watch outside workspace,
    // so we use fs.watch directly. Debounced to avoid double-fire on save.
    let timer: NodeJS.Timeout | null = null;
    const dir = path.dirname(filePath);
    try {
        fs.mkdirSync(dir, { recursive: true });
    } catch { /* ignore */ }

    let watcher: fs.FSWatcher | null = null;
    try {
        watcher = fs.watch(dir, (_event, filename) => {
            if (filename !== 'eucode.json') { return; }
            if (timer) { clearTimeout(timer); }
            timer = setTimeout(onChange, 200);
        });
    } catch {
        // Watch may fail on some systems — degrade silently
    }

    return new vscode.Disposable(() => {
        if (timer) { clearTimeout(timer); }
        watcher?.close();
    });
}
