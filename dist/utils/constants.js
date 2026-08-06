"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.IGNORED_DIRS = exports.BINARY_EXTS = exports.JARVIS_ENABLED = exports.MAX_HISTORY_PAIRS = exports.MAX_HISTORY_ENTRIES = exports.MAX_AGENT_STEPS = exports.DEFAULT_MODEL = exports.API_ENDPOINT = void 0;
exports.API_ENDPOINT = 'http://localhost:1234/v1/chat/completions';
exports.DEFAULT_MODEL = 'google/gemma-4-e4b';
exports.MAX_AGENT_STEPS = 20;
exports.MAX_HISTORY_ENTRIES = 60;
exports.MAX_HISTORY_PAIRS = 1;
// JARVIS (voz) pausado: hoje exige que o usuário instale ffmpeg e suba um
// servidor Whisper — fricção de setup que contradiz a proposta "zero install".
// O código permanece no repositório, apenas desligado atrás desta flag. Enquanto
// off: o voice server HTTP nunca sobe, o wake word nunca inicia e a UI do JARVIS
// fica oculta. Retomar "voz nativo" (sem dependências externas) é um projeto à
// parte. Religar aqui reativa tudo, então as camadas de segurança do voice
// server e da blocklist continuam endurecidas mesmo com a flag off.
exports.JARVIS_ENABLED = false;
exports.BINARY_EXTS = new Set([
    '.png', '.jpg', '.jpeg', '.gif', '.svg', '.ico',
    '.woff', '.woff2', '.ttf', '.eot',
    '.zip', '.gz', '.pdf', '.lock',
]);
exports.IGNORED_DIRS = new Set([
    'node_modules', '.git', 'dist', 'out', 'build',
    '.next', '.cache', '__pycache__', '.vscode',
]);
