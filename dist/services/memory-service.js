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
exports.getSessionMemoryPath = getSessionMemoryPath;
exports.loadSessionMemory = loadSessionMemory;
exports.rememberApprovedCommand = rememberApprovedCommand;
exports.rememberDecision = rememberDecision;
exports.detectAndRememberStack = detectAndRememberStack;
exports.buildMemorySummary = buildMemorySummary;
exports.dumpMemoryAsJson = dumpMemoryAsJson;
exports.deleteSessionMemory = deleteSessionMemory;
const vscode = __importStar(require("vscode"));
const fs = __importStar(require("fs"));
const path = __importStar(require("path"));
const workspace_init_1 = require("./workspace-init");
// Configurable cap to avoid bloating the system prompt with long memory.
const MAX_DECISIONS_IN_SUMMARY = 6;
const MAX_APPROVED_IN_SUMMARY = 8;
function getSessionMemoryPath(sessionId) {
    return (0, workspace_init_1.getEucodePath)(workspace_init_1.EUCODE_MEMORY_SUBDIR, `session_${sessionId}.json`);
}
function emptyMemory(sessionId) {
    return {
        sessionId,
        createdAt: Date.now(),
        updatedAt: Date.now(),
        approvedCommands: [],
        decisions: [],
    };
}
// Reads the memory file. Returns an empty in-memory object (not written to disk)
// if the file doesn't exist yet — lazy creation.
function loadSessionMemory(sessionId) {
    const fp = getSessionMemoryPath(sessionId);
    if (!fp || !fs.existsSync(fp)) {
        return emptyMemory(sessionId);
    }
    try {
        const raw = fs.readFileSync(fp, 'utf8');
        const parsed = JSON.parse(raw);
        // Defensive defaults for older/manually-edited files
        return {
            sessionId: parsed.sessionId || sessionId,
            createdAt: parsed.createdAt || Date.now(),
            updatedAt: parsed.updatedAt || Date.now(),
            stack: parsed.stack,
            approvedCommands: Array.isArray(parsed.approvedCommands) ? parsed.approvedCommands : [],
            decisions: Array.isArray(parsed.decisions) ? parsed.decisions : [],
        };
    }
    catch {
        return emptyMemory(sessionId);
    }
}
function writeMemory(memory) {
    const fp = getSessionMemoryPath(memory.sessionId);
    if (!fp) {
        return;
    }
    try {
        fs.mkdirSync(path.dirname(fp), { recursive: true });
        memory.updatedAt = Date.now();
        fs.writeFileSync(fp, JSON.stringify(memory, null, 2) + '\n', 'utf8');
    }
    catch (e) {
        console.warn('[Eucode] Falha ao gravar memoria da sessao:', e);
    }
}
// Adds an approved command to the session memory, dedup'd. Persists to disk.
function rememberApprovedCommand(sessionId, command) {
    const mem = loadSessionMemory(sessionId);
    const normalized = command.trim();
    if (!normalized || mem.approvedCommands.includes(normalized)) {
        return;
    }
    mem.approvedCommands.push(normalized);
    writeMemory(mem);
}
// Adds a free-form decision/note. Dedup on identical text.
function rememberDecision(sessionId, text, source) {
    const trimmed = text.trim();
    if (!trimmed) {
        return { ok: false, reason: 'empty' };
    }
    if (trimmed.length > 500) {
        return { ok: false, reason: 'too_long' };
    }
    const mem = loadSessionMemory(sessionId);
    if (mem.decisions.some(d => d.text === trimmed)) {
        return { ok: false, reason: 'duplicate' };
    }
    mem.decisions.push({ text: trimmed, addedAt: Date.now(), source });
    writeMemory(mem);
    return { ok: true };
}
// Detects project stack from filesystem markers. Best-effort, conservative —
// only writes the result the first time. Subsequent calls are no-ops if
// a stack is already recorded.
function detectAndRememberStack(sessionId) {
    const root = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
    if (!root) {
        return;
    }
    const mem = loadSessionMemory(sessionId);
    if (mem.stack) {
        return;
    }
    const has = (rel) => { try {
        return fs.existsSync(path.join(root, rel));
    }
    catch {
        return false;
    } };
    const languages = new Set();
    const frameworks = new Set();
    let packageManager;
    // Node ecosystem
    if (has('package.json')) {
        languages.add('javascript');
        try {
            const pkg = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'));
            const deps = { ...(pkg.dependencies || {}), ...(pkg.devDependencies || {}) };
            if (deps['typescript']) {
                languages.add('typescript');
            }
            if (deps['next']) {
                frameworks.add('nextjs');
            }
            if (deps['react']) {
                frameworks.add('react');
            }
            if (deps['vue']) {
                frameworks.add('vue');
            }
            if (deps['@angular/core']) {
                frameworks.add('angular');
            }
            if (deps['svelte']) {
                frameworks.add('svelte');
            }
            if (deps['express']) {
                frameworks.add('express');
            }
            if (deps['fastify']) {
                frameworks.add('fastify');
            }
            if (deps['nestjs'] || deps['@nestjs/core']) {
                frameworks.add('nestjs');
            }
            if (deps['jest']) {
                frameworks.add('jest');
            }
            if (deps['vitest']) {
                frameworks.add('vitest');
            }
        }
        catch { /* ignore parse errors */ }
        if (has('pnpm-lock.yaml')) {
            packageManager = 'pnpm';
        }
        else if (has('yarn.lock')) {
            packageManager = 'yarn';
        }
        else if (has('package-lock.json')) {
            packageManager = 'npm';
        }
        else {
            packageManager = 'npm';
        }
    }
    // Python
    if (has('requirements.txt') || has('pyproject.toml') || has('Pipfile')) {
        languages.add('python');
        if (has('Pipfile')) {
            packageManager = packageManager || 'pipenv';
        }
        else if (has('pyproject.toml')) {
            packageManager = packageManager || 'poetry';
        }
        else {
            packageManager = packageManager || 'pip';
        }
        try {
            const reqRaw = has('requirements.txt') ? fs.readFileSync(path.join(root, 'requirements.txt'), 'utf8') : '';
            if (/\bdjango\b/i.test(reqRaw)) {
                frameworks.add('django');
            }
            if (/\bflask\b/i.test(reqRaw)) {
                frameworks.add('flask');
            }
            if (/\bfastapi\b/i.test(reqRaw)) {
                frameworks.add('fastapi');
            }
        }
        catch { /* ignore */ }
    }
    // Rust
    if (has('Cargo.toml')) {
        languages.add('rust');
        packageManager = packageManager || 'cargo';
    }
    // Go
    if (has('go.mod')) {
        languages.add('go');
        packageManager = packageManager || 'go-modules';
    }
    // Java / Kotlin
    if (has('pom.xml')) {
        languages.add('java');
        packageManager = packageManager || 'maven';
    }
    if (has('build.gradle') || has('build.gradle.kts')) {
        languages.add(has('build.gradle.kts') ? 'kotlin' : 'java');
        packageManager = packageManager || 'gradle';
    }
    // C# / .NET
    if (has('*.csproj') || has('*.sln')) {
        languages.add('csharp');
        packageManager = packageManager || 'nuget';
    }
    // Dart / Flutter
    if (has('pubspec.yaml')) {
        languages.add('dart');
        packageManager = packageManager || 'pub';
        try {
            const pubRaw = fs.readFileSync(path.join(root, 'pubspec.yaml'), 'utf8');
            if (/\bflutter:/i.test(pubRaw)) {
                frameworks.add('flutter');
            }
        }
        catch { /* ignore */ }
    }
    if (languages.size === 0) {
        return;
    }
    mem.stack = {
        languages: Array.from(languages).sort(),
        frameworks: Array.from(frameworks).sort(),
        packageManager,
        detectedAt: Date.now(),
    };
    writeMemory(mem);
}
// Returns a compact text summary suitable for injection into the system prompt.
// Caps the size to keep token cost predictable.
function buildMemorySummary(sessionId) {
    const mem = loadSessionMemory(sessionId);
    const lines = [];
    if (mem.stack) {
        const { languages, frameworks, packageManager } = mem.stack;
        const parts = [];
        if (languages.length > 0) {
            parts.push(`languages=${languages.join('/')}`);
        }
        if (frameworks.length > 0) {
            parts.push(`frameworks=${frameworks.join('/')}`);
        }
        if (packageManager) {
            parts.push(`pkg=${packageManager}`);
        }
        if (parts.length > 0) {
            lines.push(`Project stack: ${parts.join(', ')}`);
        }
    }
    if (mem.decisions.length > 0) {
        const recent = mem.decisions.slice(-MAX_DECISIONS_IN_SUMMARY);
        lines.push('User/agent decisions noted in this session:');
        recent.forEach(d => lines.push(`  - ${d.text}`));
    }
    if (mem.approvedCommands.length > 0) {
        const recent = mem.approvedCommands.slice(-MAX_APPROVED_IN_SUMMARY);
        lines.push(`Commands the user already approved for this session: ${recent.join(', ')}`);
    }
    if (lines.length === 0) {
        return '';
    }
    return `# SESSION MEMORY\n${lines.join('\n')}`;
}
// Returns the full memory as a JSON string — used by the memory_remember tool
// when the agent wants to inspect what's already there.
function dumpMemoryAsJson(sessionId) {
    return JSON.stringify(loadSessionMemory(sessionId), null, 2);
}
// Removes the memory file when its session is deleted.
function deleteSessionMemory(sessionId) {
    const fp = getSessionMemoryPath(sessionId);
    if (!fp) {
        return;
    }
    try {
        if (fs.existsSync(fp)) {
            fs.unlinkSync(fp);
        }
    }
    catch (e) {
        console.warn('[Eucode] Falha ao apagar memoria da sessao:', e);
    }
}
