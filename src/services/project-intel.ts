import * as fs from 'fs';
import * as path from 'path';
import { isIgnored } from '../utils/ignore';

// Light-weight project intelligence: scans the workspace lazily and keeps
// a compact in-memory index of exported symbols per source file. The goal
// is to let the agent answer "where is X defined?" or "what does file Y
// expose?" WITHOUT having to read the full file content (which blows up
// the context window of small local LLMs).

export interface FileSymbols {
    file: string;            // relative path from workspace root
    mtime: number;           // for cache invalidation
    exports: string[];       // names of top-level exports (functions, classes, consts, types)
    imports: string[];       // names of modules imported (first path segment)
    language: string;        // 'ts' | 'js' | 'py' | 'go' | etc
}

export interface ProjectSnapshot {
    root: string;
    files: FileSymbols[];
    scannedAt: number;
}

const MAX_FILES_SCANNED = 400;          // hard cap to avoid scanning huge monorepos
const MAX_FILE_BYTES = 200 * 1024;      // skip files > 200KB (probably generated)
const SUPPORTED_EXT = new Set([
    '.ts', '.tsx', '.js', '.jsx', '.mjs', '.cjs',
    '.py', '.go', '.rs', '.java', '.kt', '.swift', '.dart',
    '.rb', '.php', '.cs', '.vue', '.svelte',
]);

const LANG_BY_EXT: Record<string, string> = {
    '.ts': 'ts', '.tsx': 'ts', '.js': 'js', '.jsx': 'js', '.mjs': 'js', '.cjs': 'js',
    '.py': 'py', '.go': 'go', '.rs': 'rs', '.java': 'java', '.kt': 'kt',
    '.swift': 'swift', '.dart': 'dart', '.rb': 'rb', '.php': 'php',
    '.cs': 'cs', '.vue': 'vue', '.svelte': 'svelte',
};

// Module-level cache keyed by workspace root. Survives across rounds in the
// same session but is invalidated per-file by mtime.
const snapshotCache = new Map<string, ProjectSnapshot>();
const fileSymbolCache = new Map<string, FileSymbols>(); // key: absolute path

export class ProjectIntelService {
    constructor(private root: string) {}

    // Returns a fresh-or-cached snapshot of the project. Cheap to call
    // repeatedly — only re-scans files whose mtime changed.
    getSnapshot(): ProjectSnapshot {
        const cached = snapshotCache.get(this.root);
        if (cached && Date.now() - cached.scannedAt < 30_000) {
            return cached;
        }
        const fresh = this.scan();
        snapshotCache.set(this.root, fresh);
        return fresh;
    }

    // Forces a rescan (called when files are written/edited by the agent).
    invalidate(absolutePath?: string): void {
        if (absolutePath) {
            fileSymbolCache.delete(absolutePath);
        } else {
            fileSymbolCache.clear();
        }
        snapshotCache.delete(this.root);
    }

    // Returns a 1-line summary per file: "path  — exports: a, b, c". Capped
    // to N entries so the injection into the system prompt stays small.
    summarizeForPrompt(maxEntries = 40, maxCharsPerLine = 140): string {
        const snap = this.getSnapshot();
        if (snap.files.length === 0) { return ''; }
        const lines = snap.files
            .filter(f => f.exports.length > 0)
            .slice(0, maxEntries)
            .map(f => {
                const exports = f.exports.slice(0, 8).join(', ');
                const line = `${f.file} — ${exports}`;
                return line.length > maxCharsPerLine ? line.slice(0, maxCharsPerLine - 1) + '…' : line;
            });
        if (lines.length === 0) { return ''; }
        return `# PROJECT INDEX (${snap.files.length} files indexed)\n${lines.join('\n')}`;
    }

    // Looks up which files export a given symbol. Returns relative paths.
    findSymbol(name: string): string[] {
        const snap = this.getSnapshot();
        return snap.files
            .filter(f => f.exports.includes(name))
            .map(f => f.file);
    }

    // Returns the full set of files that import the given module name.
    findImportersOf(moduleName: string): string[] {
        const snap = this.getSnapshot();
        return snap.files
            .filter(f => f.imports.includes(moduleName))
            .map(f => f.file);
    }

    // ── Internal ────────────────────────────────────────────────────

    private scan(): ProjectSnapshot {
        const files: FileSymbols[] = [];
        this.walk(this.root, files, 0);
        return { root: this.root, files, scannedAt: Date.now() };
    }

    private walk(dir: string, out: FileSymbols[], depth: number): void {
        if (out.length >= MAX_FILES_SCANNED) { return; }
        if (depth > 8) { return; }
        let entries: fs.Dirent[];
        try {
            entries = fs.readdirSync(dir, { withFileTypes: true });
        } catch {
            return;
        }
        for (const entry of entries) {
            if (out.length >= MAX_FILES_SCANNED) { return; }
            const full = path.join(dir, entry.name);
            const rel = path.relative(this.root, full);
            if (isIgnored(entry.name, rel, this.root)) { continue; }
            if (entry.isDirectory()) {
                this.walk(full, out, depth + 1);
                continue;
            }
            const ext = path.extname(entry.name).toLowerCase();
            if (!SUPPORTED_EXT.has(ext)) { continue; }
            try {
                const stat = fs.statSync(full);
                if (stat.size > MAX_FILE_BYTES) { continue; }
                const cached = fileSymbolCache.get(full);
                if (cached && cached.mtime === stat.mtimeMs) {
                    out.push({ ...cached, file: rel });
                    continue;
                }
                const content = fs.readFileSync(full, 'utf8');
                const symbols = extractSymbols(content, ext);
                const record: FileSymbols = {
                    file: rel,
                    mtime: stat.mtimeMs,
                    exports: symbols.exports,
                    imports: symbols.imports,
                    language: LANG_BY_EXT[ext] || 'unknown',
                };
                fileSymbolCache.set(full, record);
                out.push(record);
            } catch {
                // file disappeared or permission error — skip silently
            }
        }
    }
}

// Quick regex-based extractor. Not as accurate as a real AST parser but
// fast enough to scan hundreds of files in a few hundred ms.
function extractSymbols(content: string, ext: string): { exports: string[]; imports: string[] } {
    const exports = new Set<string>();
    const imports = new Set<string>();

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
            /^export\s*\{\s*([^}]+)\s*\}/gm,  // re-exports
        ];
        for (const re of exportPatterns) {
            let m;
            while ((m = re.exec(content)) !== null) {
                const raw = m[1];
                if (raw.includes(',')) {
                    raw.split(',').forEach(s => {
                        const name = s.trim().split(/\s+as\s+/)[0].trim();
                        if (name && /^\w+$/.test(name)) { exports.add(name); }
                    });
                } else {
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
            if (cleaned) { imports.add(cleaned); }
        }
    } else if (ext === '.py') {
        // Python
        const fnRe = /^def\s+(\w+)/gm;
        const classRe = /^class\s+(\w+)/gm;
        let m;
        while ((m = fnRe.exec(content)) !== null) {
            if (!m[1].startsWith('_')) { exports.add(m[1]); }
        }
        while ((m = classRe.exec(content)) !== null) { exports.add(m[1]); }
        const impRe = /^(?:from\s+([\w.]+)\s+import|import\s+([\w.]+))/gm;
        while ((m = impRe.exec(content)) !== null) {
            const mod = (m[1] || m[2] || '').split('.')[0];
            if (mod) { imports.add(mod); }
        }
    } else if (ext === '.go') {
        const fnRe = /^func\s+(?:\([^)]+\)\s+)?(\w+)/gm;
        const typeRe = /^type\s+(\w+)/gm;
        let m;
        while ((m = fnRe.exec(content)) !== null) {
            // Go convention: exported = capitalized
            if (/^[A-Z]/.test(m[1])) { exports.add(m[1]); }
        }
        while ((m = typeRe.exec(content)) !== null) {
            if (/^[A-Z]/.test(m[1])) { exports.add(m[1]); }
        }
    } else if (ext === '.rs') {
        const fnRe = /^pub\s+(?:async\s+)?fn\s+(\w+)/gm;
        const structRe = /^pub\s+(?:struct|enum|trait)\s+(\w+)/gm;
        let m;
        while ((m = fnRe.exec(content)) !== null) { exports.add(m[1]); }
        while ((m = structRe.exec(content)) !== null) { exports.add(m[1]); }
    }
    // Other languages: leave empty — extending here is trivial

    return {
        exports: Array.from(exports).slice(0, 20),
        imports: Array.from(imports).slice(0, 15),
    };
}
