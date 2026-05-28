import * as fs from 'fs';
import * as path from 'path';
import { IGNORED_DIRS } from './constants';

const IGNORE_FILENAME = '.eucodeIgnore';

// Cache: workspace root → set of patterns, invalidated when file changes
const cache = new Map<string, { mtime: number; patterns: string[] }>();

function loadPatterns(workspaceRoot: string): string[] {
    const filePath = path.join(workspaceRoot, IGNORE_FILENAME);
    try {
        const stat = fs.statSync(filePath);
        const mtime = stat.mtimeMs;
        const cached = cache.get(workspaceRoot);
        if (cached && cached.mtime === mtime) { return cached.patterns; }
        const lines = fs.readFileSync(filePath, 'utf8')
            .split('\n')
            .map(l => l.trim())
            .filter(l => l && !l.startsWith('#'));
        cache.set(workspaceRoot, { mtime, patterns: lines });
        return lines;
    } catch {
        return [];
    }
}

function matchesPattern(name: string, relPath: string, pattern: string): boolean {
    // Strip leading slash for absolute-from-root patterns
    const p = pattern.startsWith('/') ? pattern.slice(1) : pattern;
    // Glob: trailing /** or * matches directory contents
    const base = p.endsWith('/**') ? p.slice(0, -3) : p.endsWith('/*') ? p.slice(0, -2) : p;
    // Match against full relative path or just the entry name
    return relPath === base || relPath.startsWith(base + '/') || name === base || name === p;
}

export function isIgnored(entryName: string, relPath: string, workspaceRoot: string): boolean {
    if (IGNORED_DIRS.has(entryName)) { return true; }
    const patterns = loadPatterns(workspaceRoot);
    return patterns.some(p => matchesPattern(entryName, relPath, p));
}

export function getIgnorePatterns(workspaceRoot: string): string[] {
    return loadPatterns(workspaceRoot);
}

export { IGNORE_FILENAME };
