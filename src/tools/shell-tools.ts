import { spawn } from 'child_process';
import * as path from 'path';

const ALLOWED_PREFIXES = [
    'python', 'python3', 'node', 'npm', 'npx', 'yarn',
    'tsc', 'eslint', 'prettier', 'jest', 'vitest', 'mocha',
    'git status', 'git log', 'git diff', 'git branch',
    'ls', 'cat', 'find', 'grep', 'mkdir', 'cp', 'mv',
    'echo', 'pwd', 'which',
];

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
    const escaped = query.replace(/'/g, "'\\''");
    const cmd = `grep -rn --include="*.ts" --include="*.tsx" --include="*.js" --include="*.jsx" --include="*.py" --include="*.go" --include="*.rs" --include="*.java" --include="*.dart" -e '${escaped}' ${JSON.stringify(dirPath)} 2>/dev/null | head -60`;
    const result = await runAsync(cmd, '/', 10000);
    return result === '[OK] Comando executado sem saida.'
        ? `Nenhum resultado para "${query}" em ${dirPath}`
        : result;
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
