"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.IGNORED_DIRS = exports.BINARY_EXTS = exports.JARVIS_ENABLED = exports.contextPruneTokenThreshold = exports.CHARS_PER_TOKEN = exports.MAX_CONTEXT_TOKEN_BUDGET = exports.MIN_CONTEXT_TOKEN_BUDGET = exports.PROVIDER_CONTEXT_DEFAULTS = exports.CONTEXT_TOKEN_BUDGET = exports.MAX_HISTORY_PAIRS = exports.MAX_HISTORY_ENTRIES = exports.MAX_AGENT_STEPS = exports.DEFAULT_MODEL = exports.API_ENDPOINT = void 0;
exports.defaultContextBudgetForProvider = defaultContextBudgetForProvider;
exports.clampContextBudget = clampContextBudget;
exports.API_ENDPOINT = 'http://localhost:1234/v1/chat/completions';
exports.DEFAULT_MODEL = 'google/gemma-4-e4b';
exports.MAX_AGENT_STEPS = 20;
exports.MAX_HISTORY_ENTRIES = 60;
exports.MAX_HISTORY_PAIRS = 1;
// Orçamento de contexto (em tokens) que o Eucode assume para o modelo local.
// TODA a calibração de poda e de limpeza de output deriva daqui — em vez de
// numeros hardcoded espalhados. Historicamente o codigo assumia ~2048 (janela
// tipica de LM Studio com modelo pequeno). Modelos servidos via MLX/servidores
// modernos abrem janelas muito maiores (Qwen2.5 suporta 32k nativo); em Apple
// Silicon o limite real e a RAM para o KV cache, nao o modelo. Elevamos o
// default para 8192 — seguro para a maioria dos setups — e derivamos os limites
// de forma proporcional (ver contextPruneTokenThreshold / TOOL_CHAR_LIMITS).
// Quem roda em maquina muito apertada ainda funciona; quem tem janela grande
// para de desperdiça-la.
// Fallback global quando nenhum budget especifico e informado (defensivo).
exports.CONTEXT_TOKEN_BUDGET = 8192;
// Default de orcamento de contexto POR PROVEDOR. O usuario pode sobrescrever na
// UI (setting contextTokenBudget); ao trocar de provedor, a UI sugere este
// default. Racional:
//   - lmstudio: janela tipica de modelo pequeno local, conservador (2048)
//   - mlx: servidores MLX abrem janelas grandes; modelos Qwen suportam 32k
//     nativo, mas o KV cache come RAM — 8192 e o sweet spot p/ 16GB
//   - ollama: default do Ollama e 2048/4096 dependendo do modelo; conservador
//   - anthropic: modelo cloud com janela enorme — nao ha razao p/ apertar
exports.PROVIDER_CONTEXT_DEFAULTS = {
    lmstudio: 2048,
    mlx: 8192,
    ollama: 4096,
    anthropic: 32768,
};
// Faixa aceita para o setting (evita 0 / valores absurdos que travariam a poda).
exports.MIN_CONTEXT_TOKEN_BUDGET = 1024;
exports.MAX_CONTEXT_TOKEN_BUDGET = 200000;
function defaultContextBudgetForProvider(provider) {
    return exports.PROVIDER_CONTEXT_DEFAULTS[provider] ?? exports.CONTEXT_TOKEN_BUDGET;
}
function clampContextBudget(value) {
    if (!Number.isFinite(value)) {
        return exports.CONTEXT_TOKEN_BUDGET;
    }
    return Math.min(exports.MAX_CONTEXT_TOKEN_BUDGET, Math.max(exports.MIN_CONTEXT_TOKEN_BUDGET, Math.floor(value)));
}
// Aprox. de chars por token (heuristica padrao p/ texto latino/codigo).
exports.CHARS_PER_TOKEN = 4;
// Limite (em tokens estimados da rodada) acima do qual a poda preventiva
// dispara. Mantemos folga proporcional ao orcamento: podamos quando passamos de
// ~60% da janela, deixando espaco para a proxima geracao + KV cache.
const contextPruneTokenThreshold = (tokenBudget = exports.CONTEXT_TOKEN_BUDGET) => Math.floor(tokenBudget * 0.6);
exports.contextPruneTokenThreshold = contextPruneTokenThreshold;
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
