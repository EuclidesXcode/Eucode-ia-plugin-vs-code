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
exports.IGNORE_FILENAME = void 0;
exports.isIgnored = isIgnored;
exports.getIgnorePatterns = getIgnorePatterns;
const fs = __importStar(require("fs"));
const path = __importStar(require("path"));
const constants_1 = require("./constants");
const IGNORE_FILENAME = '.eucodeIgnore';
exports.IGNORE_FILENAME = IGNORE_FILENAME;
// Cache: workspace root → set of patterns, invalidated when file changes
const cache = new Map();
function loadPatterns(workspaceRoot) {
    const filePath = path.join(workspaceRoot, IGNORE_FILENAME);
    try {
        const stat = fs.statSync(filePath);
        const mtime = stat.mtimeMs;
        const cached = cache.get(workspaceRoot);
        if (cached && cached.mtime === mtime) {
            return cached.patterns;
        }
        const lines = fs.readFileSync(filePath, 'utf8')
            .split('\n')
            .map(l => l.trim())
            .filter(l => l && !l.startsWith('#'));
        cache.set(workspaceRoot, { mtime, patterns: lines });
        return lines;
    }
    catch {
        return [];
    }
}
function matchesPattern(name, relPath, pattern) {
    // Strip leading slash for absolute-from-root patterns
    const p = pattern.startsWith('/') ? pattern.slice(1) : pattern;
    // Glob: trailing /** or * matches directory contents
    const base = p.endsWith('/**') ? p.slice(0, -3) : p.endsWith('/*') ? p.slice(0, -2) : p;
    // Match against full relative path or just the entry name
    return relPath === base || relPath.startsWith(base + '/') || name === base || name === p;
}
function isIgnored(entryName, relPath, workspaceRoot) {
    if (constants_1.IGNORED_DIRS.has(entryName)) {
        return true;
    }
    const patterns = loadPatterns(workspaceRoot);
    return patterns.some(p => matchesPattern(entryName, relPath, p));
}
function getIgnorePatterns(workspaceRoot) {
    return loadPatterns(workspaceRoot);
}
