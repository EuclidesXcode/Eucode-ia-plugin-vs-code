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
exports.searchInWorkspace = searchInWorkspace;
exports.isCommandBlocked = isCommandBlocked;
exports.runCommand = runCommand;
exports.isGitReadOnly = isGitReadOnly;
exports.runGit = runGit;
const child_process_1 = require("child_process");
const path = __importStar(require("path"));
const fs = __importStar(require("fs"));
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
function searchInWorkspaceJs(query, dirPath) {
    const root = path.resolve(dirPath || process.cwd());
    const results = [];
    const visit = (currentPath) => {
        if (results.length >= 60) {
            return;
        }
        let entries;
        try {
            entries = fs.readdirSync(currentPath, { withFileTypes: true });
        }
        catch {
            return;
        }
        for (const entry of entries) {
            if (results.length >= 60) {
                return;
            }
            if (SEARCH_IGNORED_DIRS.has(entry.name)) {
                continue;
            }
            const fullPath = path.join(currentPath, entry.name);
            if (entry.isDirectory()) {
                visit(fullPath);
                continue;
            }
            if (!entry.isFile() || !SEARCH_EXTS.has(path.extname(entry.name).toLowerCase())) {
                continue;
            }
            let content;
            try {
                content = fs.readFileSync(fullPath, 'utf8');
            }
            catch {
                continue;
            }
            const lines = content.split(/\r?\n/);
            for (let i = 0; i < lines.length && results.length < 60; i++) {
                if (lines[i].includes(query)) {
                    results.push(`${fullPath}:${i + 1}:${lines[i].trim()}`);
                }
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
    /\brm\s+-\w*r\w*f|\brm\s+-\w*f\w*r/i, // -rf / -fr combinadas
    /\brm\s+(-\w+\s+)*--(recursive|force)\b/i, // formas longas
    /\bsudo\b/i, /\bdoas\b/i,
    />\s*\/dev\/(sd|hd|nvme|disk)/i,
    /\b(mkfs|fdisk|parted|dd)\b/i,
    // pipe de download direto para um shell (curl/wget ... | sh)
    /\b(curl|wget|fetch)\b[^|]*\|\s*(bash|sh|zsh|ksh)\b/i,
    /\bchmod\s+(-\w+\s+)*(777|a\+rwx)\b/i,
    /:\s*\(\)\s*\{.*\}/i, // fork bomb :(){ }
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
function normalizeForBlocklist(command) {
    return command
        .replace(/\\\r?\n/g, ' ') // continuação de linha
        .replace(/[\t ]+/g, ' ') // espaços/tabs múltiplos → 1
        .trim();
}
// Subcomandos git que apenas leem — aprovados sem confirmacao do usuario
const GIT_READ_ONLY = new Set([
    'status', 'log', 'diff', 'branch', 'show', 'stash', 'remote', 'tag',
    'shortlog', 'describe', 'rev-parse', 'ls-files', 'blame',
]);
function runAsync(command, cwd, timeoutMs) {
    return new Promise(resolve => {
        const child = (0, child_process_1.spawn)('sh', ['-c', command], { cwd, timeout: timeoutMs });
        const stdout = [];
        const stderr = [];
        child.stdout.on('data', (d) => stdout.push(d.toString()));
        child.stderr.on('data', (d) => stderr.push(d.toString()));
        child.on('close', (code) => {
            const out = stdout.join('').trim();
            const err = stderr.join('').trim();
            if (out) {
                resolve(out);
                return;
            }
            if (code !== 0 && err) {
                resolve(`[ERRO] ${err}`);
                return;
            }
            resolve('[OK] Command executed without output.');
        });
        child.on('error', (e) => resolve(`[ERRO] ${e.message}`));
    });
}
function isRgAvailable() {
    return new Promise(resolve => {
        const child = (0, child_process_1.spawn)('rg', ['--version'], {});
        child.on('error', () => resolve(false));
        child.on('close', (code) => resolve(code === 0));
    });
}
async function searchInWorkspace(query, dirPath, workspaceRoot) {
    const escaped = query.replace(/'/g, "'\\''");
    const rgAvailable = await isRgAvailable();
    // Build ignore flags from .eucodeIgnore
    let ignoreFlags = '';
    if (workspaceRoot) {
        const { getIgnorePatterns } = await Promise.resolve().then(() => __importStar(require('../utils/ignore')));
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
function isCommandBlocked(command) {
    const normalized = normalizeForBlocklist(command);
    return ALWAYS_BLOCKED.some(p => p.test(normalized));
}
async function runCommand(command, cwd) {
    const trimmed = command.trim();
    if (isCommandBlocked(trimmed)) {
        return `[BLOCKED] Command refused by security policy: "${trimmed}"`;
    }
    const workDir = cwd ? path.resolve(cwd) : process.cwd();
    return runAsync(trimmed, workDir, 30000);
}
function isGitReadOnly(subcommand) {
    const first = subcommand.trim().split(/\s+/)[0];
    return GIT_READ_ONLY.has(first);
}
async function runGit(subcommand, cwd) {
    const trimmed = subcommand.trim();
    if (!trimmed) {
        return '[ERRO] Subcomando git vazio.';
    }
    // Bloqueados absolutamente (mesmo com confirmacao)
    if (/push\s+.*--force/i.test(trimmed) || /reset\s+--hard/i.test(trimmed) || /clean\s+-f/i.test(trimmed)) {
        return `[BLOCKED] Destructive git operation not allowed: "git ${trimmed}". If necessary, instruct the user to run it manually.`;
    }
    return runAsync(`git ${trimmed}`, cwd, 30000);
}
