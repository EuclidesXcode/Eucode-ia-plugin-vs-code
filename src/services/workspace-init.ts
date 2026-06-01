import * as vscode from 'vscode';
import * as fs from 'fs';
import * as path from 'path';

// Single source of truth for all plugin files inside the workspace.
// Everything lives under .eucode/ — never scattered at the project root.
//
// Layout:
//   .eucode/
//     .gitignore          // ignores memory/ by default
//     eucodeIgnore        // user-defined globs the agent should skip
//     eucode.json         // user-defined /commands
//     memory/
//       session_<id>.json // per-session persistent memory (gitignored)

export const EUCODE_DIR = '.eucode';
export const EUCODE_IGNORE_FILENAME = 'eucodeIgnore';
export const EUCODE_COMMANDS_FILENAME = 'eucode.json';
export const EUCODE_MEMORY_SUBDIR = 'memory';
export const EUCODE_GITIGNORE_FILENAME = '.gitignore';

const SAMPLE_IGNORE = `# Padroes que o agente Eucode IA deve ignorar (sintaxe gitignore-style)
# Linhas comecando com # sao comentarios — descomente as que quiser ativar.
#
# .env
# .env.local
# *.lock
# coverage/
# .DS_Store
`;

const SAMPLE_COMMANDS = `[
]
`;

const SAMPLE_GITIGNORE = `# Arquivos do Eucode IA que sao por-sessao/por-usuario e nao
# devem ser commitados. Edite se quiser compartilhar a memoria.
memory/
`;

// Returns the absolute path of .eucode/ for the current workspace.
export function getEucodeDir(): string | null {
    const root = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
    if (!root) { return null; }
    return path.join(root, EUCODE_DIR);
}

// Resolves a file inside .eucode/ — null if no workspace open.
export function getEucodePath(...segments: string[]): string | null {
    const dir = getEucodeDir();
    if (!dir) { return null; }
    return path.join(dir, ...segments);
}

export interface InitResult {
    created: boolean;            // true if .eucode/ was created this run
    migrated: string[];          // legacy filenames that were moved into .eucode/
    dir: string | null;          // absolute path of .eucode/
}

// Idempotent. Creates .eucode/ + sample files if missing. Migrates legacy
// files from the workspace root if they're still there. Safe to call on
// every chat open.
export function ensureEucodeWorkspace(): InitResult {
    const root = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
    if (!root) { return { created: false, migrated: [], dir: null }; }

    const dir = path.join(root, EUCODE_DIR);
    const wasAlreadyThere = fs.existsSync(dir);
    const migrated: string[] = [];

    try {
        fs.mkdirSync(dir, { recursive: true });
        fs.mkdirSync(path.join(dir, EUCODE_MEMORY_SUBDIR), { recursive: true });

        // .gitignore inside .eucode/ — keeps memory/ out of version control
        const gitignorePath = path.join(dir, EUCODE_GITIGNORE_FILENAME);
        if (!fs.existsSync(gitignorePath)) {
            fs.writeFileSync(gitignorePath, SAMPLE_GITIGNORE, 'utf8');
        }

        // Migrate legacy .eucodeIgnore (workspace root) -> .eucode/eucodeIgnore
        const newIgnore = path.join(dir, EUCODE_IGNORE_FILENAME);
        const legacyIgnore = path.join(root, '.eucodeIgnore');
        if (!fs.existsSync(newIgnore) && fs.existsSync(legacyIgnore)) {
            try {
                fs.renameSync(legacyIgnore, newIgnore);
                migrated.push('.eucodeIgnore');
            } catch {
                // Cross-volume or perms issue — copy + leave original alone
                try {
                    fs.copyFileSync(legacyIgnore, newIgnore);
                    migrated.push('.eucodeIgnore');
                } catch { /* give up silently */ }
            }
        }
        // Create sample only if neither old nor new exists
        if (!fs.existsSync(newIgnore)) {
            fs.writeFileSync(newIgnore, SAMPLE_IGNORE, 'utf8');
        }

        // Migrate legacy eucode.json (workspace root) -> .eucode/eucode.json
        const newCommands = path.join(dir, EUCODE_COMMANDS_FILENAME);
        const legacyCommands = path.join(root, EUCODE_COMMANDS_FILENAME);
        if (!fs.existsSync(newCommands) && fs.existsSync(legacyCommands)) {
            try {
                fs.renameSync(legacyCommands, newCommands);
                migrated.push('eucode.json');
            } catch {
                try {
                    fs.copyFileSync(legacyCommands, newCommands);
                    migrated.push('eucode.json');
                } catch { /* give up silently */ }
            }
        }
        if (!fs.existsSync(newCommands)) {
            fs.writeFileSync(newCommands, SAMPLE_COMMANDS, 'utf8');
        }
    } catch (e) {
        console.warn('[Eucode] Falha ao inicializar .eucode/:', e);
        return { created: !wasAlreadyThere, migrated, dir };
    }

    return { created: !wasAlreadyThere, migrated, dir };
}

// Opens the .eucode/ folder in the OS file explorer or in VS Code's tree.
export async function revealEucodeDir(): Promise<void> {
    const dir = getEucodeDir();
    if (!dir) { return; }
    const uri = vscode.Uri.file(dir);
    await vscode.commands.executeCommand('revealInExplorer', uri);
}
