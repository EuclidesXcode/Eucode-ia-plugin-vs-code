"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.IGNORED_DIRS = exports.BINARY_EXTS = exports.MAX_HISTORY_PAIRS = exports.MAX_HISTORY_ENTRIES = exports.MAX_AGENT_STEPS = exports.DEFAULT_MODEL = exports.API_ENDPOINT = void 0;
exports.API_ENDPOINT = 'http://localhost:1234/v1/chat/completions';
exports.DEFAULT_MODEL = 'google/gemma-4-e4b';
exports.MAX_AGENT_STEPS = 20;
exports.MAX_HISTORY_ENTRIES = 60;
exports.MAX_HISTORY_PAIRS = 1;
exports.BINARY_EXTS = new Set([
    '.png', '.jpg', '.jpeg', '.gif', '.svg', '.ico',
    '.woff', '.woff2', '.ttf', '.eot',
    '.zip', '.gz', '.pdf', '.lock',
]);
exports.IGNORED_DIRS = new Set([
    'node_modules', '.git', 'dist', 'out', 'build',
    '.next', '.cache', '__pycache__', '.vscode',
]);
