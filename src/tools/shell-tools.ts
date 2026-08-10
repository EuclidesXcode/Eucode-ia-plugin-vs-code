import { spawn } from 'child_process';
import * as path from 'path';
import * as fs from 'fs';

// Fallback de busca em JS puro (sem shell/ripgrep) — usado quando nem rg nem
// grep respondem (ex: Windows sem essas ferramentas). Mantem a busca portavel.
const SEARCH_EXTS = new Set([
    '.ts', '.tsx', '.js', '.jsx', '.py', '.go', '.rs', '.java', '.dart',
    '.c', '.cpp', '.cs', '.rb', '.php', '.swift', '.kt', '.vue', '.svelte',
]);
const SEARCH_IGNORED_DIRS = new Set([
    'node_modules', '.git', 'dist', 'out', 'build', 'coverage', '.next', '.cache',
]);

// Varre o diretorio lendo arquivos-fonte e casando a query por substring.
// Puro Node — nao depende de shell. Teto de 60 resultados como o rg/grep.
function searchInWorkspaceJs(query: string, dirPath: string): string {
    const root = path.resolve(dirPath || process.cwd());
    const results: string[] = [];
    const visit = (currentPath: string): void => {
        if (results.length >= 60) { return; }
        let entries: fs.Dirent[];
        try { entries = fs.readdirSync(currentPath, { withFileTypes: true }); } catch { return; }
        for (const entry of entries) {
            if (results.length >= 60) { return; }
            if (SEARCH_IGNORED_DIRS.has(entry.name)) { continue; }
            const fullPath = path.join(currentPath, entry.name);
            if (entry.isDirectory()) { visit(fullPath); continue; }
            if (!entry.isFile() || !SEARCH_EXTS.has(path.extname(entry.name).toLowerCase())) { continue; }
            let content: string;
            try { content = fs.readFileSync(fullPath, 'utf8'); } catch { continue; }
            const lines = content.split(/\r?\n/);
            for (let i = 0; i < lines.length && results.length < 60; i++) {
                if (lines[i].includes(query)) { results.push(`${fullPath}:${i + 1}:${lines[i].trim()}`); }
            }
        }
    };
    visit(root);
    return results.length > 0 ? results.join('\n') : `Nenhum resultado para "${query}" em ${root}`;
}

// Blocklist de comandos destrutivos. IMPORTANTE: isto é defesa em
// profundidade, NÃO uma sandbox. Um shell é infinitamente contornável
// (aspas, variáveis, base64, encadeamento). O gate real de segurança é a
// confirmação do usuário no modo manual. Em modo AUTO não há confirmação, então
// esta lista é a única barreira automática — por isso normalizamos o comando
// antes de testar, para pegar as evasões triviais (flags separadas, espaços
// múltiplos) sem a falsa sensação de que isto bloqueia um atacante determinado.
const ALWAYS_BLOCKED = [
    // rm recursivo+forçado em qualquer ordem de flags (rm -rf, rm -fr, rm -r -f)
    /\brm\s+(-\w*\s+)*-\w*[rf]\w*\s+(-\w*\s+)*-\w*[rf]/i, // duas flags r e f separadas
    /\brm\s+-\w*r\w*f|\brm\s+-\w*f\w*r/i,                 // -rf / -fr combinadas
    /\brm\s+(-\w+\s+)*--(recursive|force)\b/i,            // formas longas
    /\bsudo\b/i, /\bdoas\b/i,
    />\s*\/dev\/(sd|hd|nvme|disk)/i,
    /\b(mkfs|fdisk|parted|dd)\b/i,
    // pipe de download direto para um shell (curl/wget ... | sh)
    /\b(curl|wget|fetch)\b[^|]*\|\s*(bash|sh|zsh|ksh)\b/i,
    /\bchmod\s+(-\w+\s+)*(777|a\+rwx)\b/i,
    /:\s*\(\)\s*\{.*\}/i,                                 // fork bomb :(){ }
    /\bgit\s+push\b[^&|;]*--force/i,
    /\bgit\s+reset\s+(-\w+\s+)*--hard/i,
    /\bgit\s+clean\s+(-\w+\s+)*-\w*f/i,
    // substituição de comando embutindo um destrutivo, ex: $(rm -rf /)
    /\$\(\s*(rm|sudo|mkfs|dd)\b/i,
    /`\s*(rm|sudo|mkfs|dd)\b/i,
];

// Normaliza o comando antes de testar contra a blocklist: colapsa espaços/tabs
// repetidos, remove quebras de linha de continuação. Reduz o espaço de evasões
// triviais (ex: "rm   -r    -f") sem tentar (impossivelmente) desfazer todo
// tipo de ofuscação de shell.
function normalizeForBlocklist(command: string): string {
    return command
        .replace(/\\\r?\n/g, ' ')   // continuação de linha
        .replace(/[\t ]+/g, ' ')    // espaços/tabs múltiplos → 1
        .trim();
}

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

    // fallback 1: grep (Unix shell)
    const cmd = `grep -rn --include="*.ts" --include="*.tsx" --include="*.js" --include="*.jsx" --include="*.py" --include="*.go" --include="*.rs" --include="*.java" --include="*.dart" -e '${escaped}' ${JSON.stringify(dirPath)} 2>/dev/null | head -60`;
    const result = await runAsync(cmd, '/', 10000);
    if (!result.startsWith('[ERRO]')
        && result !== '[OK] Command executed without output.'
        && result !== '[OK] Comando executado sem saida.') {
        return result;
    }

    // fallback 2: JS puro (sem shell). Garante busca portavel quando nem rg nem
    // grep respondem — ex: Windows, ou ambiente sem essas ferramentas.
    return searchInWorkspaceJs(query, dirPath);
}

export function isCommandBlocked(command: string): boolean {
    const normalized = normalizeForBlocklist(command);
    return ALWAYS_BLOCKED.some(p => p.test(normalized));
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
