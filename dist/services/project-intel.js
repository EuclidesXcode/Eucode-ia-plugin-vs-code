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
exports.ProjectIntelService = void 0;
const fs = __importStar(require("fs"));
const path = __importStar(require("path"));
const ignore_1 = require("../utils/ignore");
const MAX_FILES_SCANNED = 400; // hard cap to avoid scanning huge monorepos
const MAX_FILE_BYTES = 200 * 1024; // skip files > 200KB (probably generated)
const SUPPORTED_EXT = new Set([
    '.ts', '.tsx', '.js', '.jsx', '.mjs', '.cjs',
    '.py', '.go', '.rs', '.java', '.kt', '.swift', '.dart',
    '.rb', '.php', '.cs', '.vue', '.svelte',
]);
const LANG_BY_EXT = {
    '.ts': 'ts', '.tsx': 'ts', '.js': 'js', '.jsx': 'js', '.mjs': 'js', '.cjs': 'js',
    '.py': 'py', '.go': 'go', '.rs': 'rs', '.java': 'java', '.kt': 'kt',
    '.swift': 'swift', '.dart': 'dart', '.rb': 'rb', '.php': 'php',
    '.cs': 'cs', '.vue': 'vue', '.svelte': 'svelte',
};
// Module-level cache keyed by workspace root. Survives across rounds in the
// same session but is invalidated per-file by mtime.
const snapshotCache = new Map();
const fileSymbolCache = new Map(); // key: absolute path
class ProjectIntelService {
    constructor(root) {
        this.root = root;
    }
    // Returns a fresh-or-cached snapshot of the project. Cheap to call
    // repeatedly — only re-scans files whose mtime changed.
    getSnapshot() {
        const cached = snapshotCache.get(this.root);
        if (cached && Date.now() - cached.scannedAt < 30000) {
            return cached;
        }
        const fresh = this.scan();
        snapshotCache.set(this.root, fresh);
        return fresh;
    }
    // Forces a rescan (called when files are written/edited by the agent).
    invalidate(absolutePath) {
        if (absolutePath) {
            fileSymbolCache.delete(absolutePath);
        }
        else {
            fileSymbolCache.clear();
        }
        snapshotCache.delete(this.root);
    }
    // Returns a 1-line summary per file: "path  — exports: a, b, c". Capped
    // to N entries so the injection into the system prompt stays small.
    summarizeForPrompt(maxEntries = 40, maxCharsPerLine = 140) {
        const snap = this.getSnapshot();
        if (snap.files.length === 0) {
            return '';
        }
        const lines = snap.files
            .filter(f => f.exports.length > 0)
            .slice(0, maxEntries)
            .map(f => {
            const exports = f.exports.slice(0, 8).join(', ');
            const line = `${f.file} — ${exports}`;
            return line.length > maxCharsPerLine ? line.slice(0, maxCharsPerLine - 1) + '…' : line;
        });
        if (lines.length === 0) {
            return '';
        }
        return `# PROJECT INDEX (${snap.files.length} files indexed)\n${lines.join('\n')}`;
    }
    // Looks up which files export a given symbol. Returns relative paths.
    findSymbol(name) {
        const snap = this.getSnapshot();
        return snap.files
            .filter(f => f.exports.includes(name))
            .map(f => f.file);
    }
    // Returns the full set of files that import the given module name.
    findImportersOf(moduleName) {
        const snap = this.getSnapshot();
        return snap.files
            .filter(f => f.imports.includes(moduleName))
            .map(f => f.file);
    }
    // ── Internal ────────────────────────────────────────────────────
    scan() {
        const files = [];
        this.walk(this.root, files, 0);
        return { root: this.root, files, scannedAt: Date.now() };
    }
    walk(dir, out, depth) {
        if (out.length >= MAX_FILES_SCANNED) {
            return;
        }
        if (depth > 8) {
            return;
        }
        let entries;
        try {
            entries = fs.readdirSync(dir, { withFileTypes: true });
        }
        catch {
            return;
        }
        for (const entry of entries) {
            if (out.length >= MAX_FILES_SCANNED) {
                return;
            }
            const full = path.join(dir, entry.name);
            const rel = path.relative(this.root, full);
            if ((0, ignore_1.isIgnored)(entry.name, rel, this.root)) {
                continue;
            }
            if (entry.isDirectory()) {
                this.walk(full, out, depth + 1);
                continue;
            }
            const ext = path.extname(entry.name).toLowerCase();
            if (!SUPPORTED_EXT.has(ext)) {
                continue;
            }
            try {
                const stat = fs.statSync(full);
                if (stat.size > MAX_FILE_BYTES) {
                    continue;
                }
                const cached = fileSymbolCache.get(full);
                if (cached && cached.mtime === stat.mtimeMs) {
                    out.push({ ...cached, file: rel });
                    continue;
                }
                const content = fs.readFileSync(full, 'utf8');
                const symbols = extractSymbols(content, ext);
                const record = {
                    file: rel,
                    mtime: stat.mtimeMs,
                    exports: symbols.exports,
                    imports: symbols.imports,
                    language: LANG_BY_EXT[ext] || 'unknown',
                };
                fileSymbolCache.set(full, record);
                out.push(record);
            }
            catch {
                // file disappeared or permission error — skip silently
            }
        }
    }
}
exports.ProjectIntelService = ProjectIntelService;
// Quick regex-based extractor. Not as accurate as a real AST parser but
// fast enough to scan hundreds of files in a few hundred ms.
function extractSymbols(content, ext) {
    const exports = new Set();
    const imports = new Set();
    if (ext === '.ts' || ext === '.tsx' || ext === '.js' || ext === '.jsx' || ext === '.mjs' || ext === '.cjs') {
        // TypeScript / JavaScript
        const exportPatterns = [
            /^export\s+(?:async\s+)?function\s+(\w+)/gm,
            /^export\s+(?:const|let|var)\s+(\w+)/gm,
            /^export\s+class\s+(\w+)/gm,
            /^export\s+interface\s+(\w+)/gm,
            /^export\s+type\s+(\w+)/gm,
            /^export\s+enum\s+(\w+)/gm,
            /^export\s+default\s+(?:async\s+)?(?:function|class)\s+(\w+)/gm,
            /^export\s*\{\s*([^}]+)\s*\}/gm, // re-exports
        ];
        for (const re of exportPatterns) {
            let m;
            while ((m = re.exec(content)) !== null) {
                const raw = m[1];
                if (raw.includes(',')) {
                    raw.split(',').forEach(s => {
                        const name = s.trim().split(/\s+as\s+/)[0].trim();
                        if (name && /^\w+$/.test(name)) {
                            exports.add(name);
                        }
                    });
                }
                else {
                    exports.add(raw);
                }
            }
        }
        const importRe = /^(?:import|from)\s+(?:[\w{},\s*]+\s+from\s+)?['"]([^'"]+)['"]/gm;
        let m;
        while ((m = importRe.exec(content)) !== null) {
            const mod = m[1];
            // Keep only the package root or the local file basename
            const cleaned = mod.startsWith('.')
                ? path.basename(mod, path.extname(mod))
                : mod.split('/')[0].replace('@', '');
            if (cleaned) {
                imports.add(cleaned);
            }
        }
    }
    else if (ext === '.py') {
        // Python
        const fnRe = /^def\s+(\w+)/gm;
        const classRe = /^class\s+(\w+)/gm;
        let m;
        while ((m = fnRe.exec(content)) !== null) {
            if (!m[1].startsWith('_')) {
                exports.add(m[1]);
            }
        }
        while ((m = classRe.exec(content)) !== null) {
            exports.add(m[1]);
        }
        const impRe = /^(?:from\s+([\w.]+)\s+import|import\s+([\w.]+))/gm;
        while ((m = impRe.exec(content)) !== null) {
            const mod = (m[1] || m[2] || '').split('.')[0];
            if (mod) {
                imports.add(mod);
            }
        }
    }
    else if (ext === '.go') {
        const fnRe = /^func\s+(?:\([^)]+\)\s+)?(\w+)/gm;
        const typeRe = /^type\s+(\w+)/gm;
        let m;
        while ((m = fnRe.exec(content)) !== null) {
            // Go convention: exported = capitalized
            if (/^[A-Z]/.test(m[1])) {
                exports.add(m[1]);
            }
        }
        while ((m = typeRe.exec(content)) !== null) {
            if (/^[A-Z]/.test(m[1])) {
                exports.add(m[1]);
            }
        }
    }
    else if (ext === '.rs') {
        const fnRe = /^pub\s+(?:async\s+)?fn\s+(\w+)/gm;
        const structRe = /^pub\s+(?:struct|enum|trait)\s+(\w+)/gm;
        let m;
        while ((m = fnRe.exec(content)) !== null) {
            exports.add(m[1]);
        }
        while ((m = structRe.exec(content)) !== null) {
            exports.add(m[1]);
        }
    }
    // Other languages: leave empty — extending here is trivial
    return {
        exports: Array.from(exports).slice(0, 20),
        imports: Array.from(imports).slice(0, 15),
    };
}
