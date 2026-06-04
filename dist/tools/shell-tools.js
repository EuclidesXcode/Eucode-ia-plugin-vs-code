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
const path = __importStar(require("path"));
const fs = __importStar(require("fs"));
const child_process_1 = require("child_process");
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
    if (!query) {
        return 'Nenhum resultado para "" em ' + dirPath;
    }
    const root = path.resolve(dirPath || process.cwd());
    const results = [];
    function visit(currentPath) {
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
