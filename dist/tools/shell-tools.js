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
            resolve('[OK] Comando executado sem saida.');
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
        if (result !== '[OK] Comando executado sem saida.' && !result.startsWith('[ERRO]')) {
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
function isCommandBlocked(command) {
    return ALWAYS_BLOCKED.some(p => p.test(command));
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
