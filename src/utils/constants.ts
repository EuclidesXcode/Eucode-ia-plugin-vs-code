export const API_ENDPOINT = 'http://localhost:1234/v1/chat/completions';
export const DEFAULT_MODEL = 'google/gemma-4-e4b';
export const MAX_AGENT_STEPS = 20;
export const MAX_HISTORY_ENTRIES = 60;
export const MAX_HISTORY_PAIRS = 5;

export const BINARY_EXTS = new Set([
    '.png', '.jpg', '.jpeg', '.gif', '.svg', '.ico',
    '.woff', '.woff2', '.ttf', '.eot',
    '.zip', '.gz', '.pdf', '.lock',
]);

export const IGNORED_DIRS = new Set([
    'node_modules', '.git', 'dist', 'out', 'build',
    '.next', '.cache', '__pycache__', '.vscode',
]);
