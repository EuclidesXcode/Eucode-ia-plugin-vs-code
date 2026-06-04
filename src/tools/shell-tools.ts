import * as path from 'path';
import * as fs from 'fs';
import { spawn } from 'child_process';

const ALLOWED_PREFIXES = [
    'python', 'python3', 'node', 'npm', 'npx', 'yarn',
    'tsc', 'eslint', 'prettier', 'jest', 'vitest', 'mocha',
    'git status', 'git log', 'git diff', 'git branch',
    'ls', 'cat', 'find', 'grep', 'mkdir', 'cp', 'mv',
    'echo', 'pwd', 'which',
];

const SEARCH_EXTS = new Set([
    '.ts', '.tsx', '.js', '.jsx', '.py', '.go', '.rs', '.java', '.dart',
]);

const SEARCH_IGNORED_DIRS = new Set([
    'node_modules', '.git', 'dist', 'out', 'build', 'coverage',
]);

const BLOCKED_PATTERNS = [
    /rm\s+-rf/i, /rm\s+-r/i,
    /sudo/i,
    />\s*\/dev\/(sd|hd|nvme)/i,
    /mkfs/i, /fdisk/i, /parted/i,
    /curl\s+.*\|\s*(bash|sh|zsh)/i,
    /wget\s+.*\|\s*(bash|sh|zsh)/i,
    /chmod\s+777/i,
    /:\(\)\{.*\}/i,
];

function runAsync(command: string, cwd: string, timeoutMs: number): Promise<string> {
    return new Promise(resolve => {
        const child = spawn('sh', ['-c', command], { cwd, timeout: timeoutMs });
        const stdout: string[] = [];
        const stderr: string[] = [];
        child.stdout.on('data', (d: Buffer) => stdout.push(d.toString()));
        child.stderr.on('data', (d: Buffer) => stderr.push(d.toString()));
        child.on('close', (code) => {
            const out = stdout.join('').trim();
            const err = stderr.join('').trim();
            if (out) { resolve(out); return; }
            if (code !== 0 && err) { resolve(`[ERRO] ${err}`); return; }
            resolve('[OK] Comando executado sem saida.');
        });
        child.on('error', (e) => resolve(`[ERRO] ${e.message}`));
    });
}

export async function searchInWorkspace(query: string, dirPath: string): Promise<string> {
    if (!query) { return 'Nenhum resultado para "" em ' + dirPath; }

    const root = path.resolve(dirPath || process.cwd());
    const results: string[] = [];

    function visit(currentPath: string): void {
        if (results.length >= 60) { return; }

        let entries: fs.Dirent[];
        try {
            entries = fs.readdirSync(currentPath, { withFileTypes: true });
        } catch {
            return;
        }

        for (const entry of entries) {
            if (results.length >= 60) { return; }
            if (SEARCH_IGNORED_DIRS.has(entry.name)) { continue; }

            const fullPath = path.join(currentPath, entry.name);
            if (entry.isDirectory()) {
                visit(fullPath);
                continue;
            }
            if (!entry.isFile() || !SEARCH_EXTS.has(path.extname(entry.name).toLowerCase())) {
                continue;
            }

            let content: string;
            try {
                content = fs.readFileSync(fullPath, 'utf8');
            } catch {
                continue;
            }

            const lines = content.split(/\r?\n/);
            for (let index = 0; index < lines.length && results.length < 60; index++) {
                if (lines[index].includes(query)) {
                    results.push(`${fullPath}:${index + 1}:${lines[index].trim()}`);
                }
            }
        }
    }

    visit(root);

    return results.length > 0
        ? results.join('\n')
        : `Nenhum resultado para "${query}" em ${root}`;
}

export async function runCommand(command: string, cwd?: string): Promise<string> {
    const trimmed = command.trim();

    for (const pattern of BLOCKED_PATTERNS) {
        if (pattern.test(trimmed)) {
            return `[BLOQUEADO] Comando recusado por politica de seguranca: "${trimmed}"`;
        }
    }

    if (!ALLOWED_PREFIXES.some(prefix => trimmed.startsWith(prefix))) {
        return `[BLOQUEADO] Comando nao permitido: "${trimmed}". Permitidos: ${ALLOWED_PREFIXES.join(', ')}`;
    }

    const workDir = cwd ? path.resolve(cwd) : process.cwd();
    return runAsync(trimmed, workDir, 30000);
}
