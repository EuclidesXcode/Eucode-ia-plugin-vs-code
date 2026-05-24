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
exports.runCommand = runCommand;
const child_process_1 = require("child_process");
const path = __importStar(require("path"));
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
async function searchInWorkspace(query, dirPath) {
    const escaped = query.replace(/'/g, "'\\''");
    const cmd = `grep -rn --include="*.ts" --include="*.tsx" --include="*.js" --include="*.jsx" --include="*.py" --include="*.go" --include="*.rs" --include="*.java" --include="*.dart" -e '${escaped}' ${JSON.stringify(dirPath)} 2>/dev/null | head -60`;
    const result = await runAsync(cmd, '/', 10000);
    return result === '[OK] Comando executado sem saida.'
        ? `Nenhum resultado para "${query}" em ${dirPath}`
        : result;
}
async function runCommand(command, cwd) {
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
