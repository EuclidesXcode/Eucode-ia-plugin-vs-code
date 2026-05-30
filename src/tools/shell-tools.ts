import { spawn } from 'child_process';
import * as path from 'path';

const ALWAYS_BLOCKED = [
    /rm\s+-rf/i, /rm\s+-r\s/i,
    /sudo/i,
    />\s*\/dev\/(sd|hd|nvme)/i,
    /mkfs/i, /fdisk/i, /parted/i,
    /curl\s+.*\|\s*(bash|sh|zsh)/i,
    /wget\s+.*\|\s*(bash|sh|zsh)/i,
    /chmod\s+777/i,
    /:\(\)\{.*\}/i,
    /git\s+push\s+.*--force/i,
    /git\s+reset\s+--hard/i,
    /git\s+clean\s+-f/i,
];

// Subcomandos git que apenas leem — aprovados sem confirmacao do usuario
const GIT_READ_ONLY = new Set([
    'status', 'log', 'diff', 'branch', 'show', 'stash', 'remote', 'tag',
    'shortlog', 'describe', 'rev-parse', 'ls-files', 'blame',
]);

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
            resolve('[OK] Command executed without output.');
        });
        child.on('error', (e) => resolve(`[ERRO] ${e.message}`));
    });
}

function isRgAvailable(): Promise<boolean> {
    return new Promise(resolve => {
        const child = spawn('rg', ['--version'], {});
        child.on('error', () => resolve(false));
        child.on('close', (code) => resolve(code === 0));
    });
}

export async function searchInWorkspace(query: string, dirPath: string, workspaceRoot?: string): Promise<string> {
    const escaped = query.replace(/'/g, "'\\''");
    const rgAvailable = await isRgAvailable();

    // Build ignore flags from .eucodeIgnore
    let ignoreFlags = '';
    if (workspaceRoot) {
        const { getIgnorePatterns } = await import('../utils/ignore');
        const patterns = getIgnorePatterns(workspaceRoot);
        ignoreFlags = patterns.map(p => `--glob '!${p}'`).join(' ');
    }

    if (rgAvailable) {
        const cmd = `rg -n --max-count=3 -e '${escaped}' --type-add 'src:*.{ts,tsx,js,jsx,py,go,rs,java,dart,c,cpp,cs,rb,php,swift,kt}' -t src ${ignoreFlags} ${JSON.stringify(dirPath)} 2>/dev/null | head -60`;
        const result = await runAsync(cmd, '/', 10000);
        if (!result.startsWith('[ERRO]') && result !== '[OK] Command executed without output.') {
            return result;
        }
    }

    // fallback: grep
    const cmd = `grep -rn --include="*.ts" --include="*.tsx" --include="*.js" --include="*.jsx" --include="*.py" --include="*.go" --include="*.rs" --include="*.java" --include="*.dart" -e '${escaped}' ${JSON.stringify(dirPath)} 2>/dev/null | head -60`;
    const result = await runAsync(cmd, '/', 10000);
    return result === '[OK] Comando executado sem saida.'
        ? `Nenhum resultado para "${query}" em ${dirPath}`
        : result;
}

export function isCommandBlocked(command: string): boolean {
    return ALWAYS_BLOCKED.some(p => p.test(command));
}

export async function runCommand(command: string, cwd?: string): Promise<string> {
    const trimmed = command.trim();
    if (isCommandBlocked(trimmed)) {
        return `[BLOCKED] Command refused by security policy: "${trimmed}"`;
    }
    const workDir = cwd ? path.resolve(cwd) : process.cwd();
    return runAsync(trimmed, workDir, 30000);
}

export function isGitReadOnly(subcommand: string): boolean {
    const first = subcommand.trim().split(/\s+/)[0];
    return GIT_READ_ONLY.has(first);
}

export async function runGit(subcommand: string, cwd: string): Promise<string> {
    const trimmed = subcommand.trim();
    if (!trimmed) { return '[ERRO] Subcomando git vazio.'; }

    // Bloqueados absolutamente (mesmo com confirmacao)
    if (/push\s+.*--force/i.test(trimmed) || /reset\s+--hard/i.test(trimmed) || /clean\s+-f/i.test(trimmed)) {
        return `[BLOCKED] Destructive git operation not allowed: "git ${trimmed}". If necessary, instruct the user to run it manually.`;
    }

    return runAsync(`git ${trimmed}`, cwd, 30000);
}
