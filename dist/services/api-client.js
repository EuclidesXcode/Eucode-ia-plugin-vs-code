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
exports.ANTHROPIC_VERSION = exports.ANTHROPIC_API_BASE = void 0;
exports.tryParseJsonChunk = tryParseJsonChunk;
exports.stripSpecialTokens = stripSpecialTokens;
exports.classifyApiError = classifyApiError;
exports.checkConnection = checkConnection;
exports.fetchFirstModelId = fetchFirstModelId;
exports.checkAnthropicConnection = checkAnthropicConnection;
exports.callAI = callAI;
exports.callAnthropicAI = callAnthropicAI;
exports.callAIWithVision = callAIWithVision;
const https = __importStar(require("https"));
const http = __importStar(require("http"));
// Tolerantly parses a JSON chunk that may have junk appended (a second
// concatenated event, BOM, trailing whitespace, etc). Returns null if no
// valid JSON object can be extracted from the start of the string.
//
// Strategy: try the fast path first (JSON.parse on the trimmed input).
// If that fails, scan character-by-character tracking bracket depth and
// string boundaries to find the end of the first balanced `{...}` object,
// then parse just that prefix.
function tryParseJsonChunk(raw) {
    const trimmed = raw.trim();
    if (!trimmed.startsWith('{') && !trimmed.startsWith('[')) {
        return null;
    }
    try {
        return JSON.parse(trimmed);
    }
    catch { /* fall through */ }
    let depth = 0;
    let inString = false;
    let escape = false;
    const openChar = trimmed.charAt(0);
    const closeChar = openChar === '{' ? '}' : ']';
    for (let i = 0; i < trimmed.length; i++) {
        const c = trimmed.charAt(i);
        if (escape) {
            escape = false;
            continue;
        }
        if (inString) {
            if (c === '\\') {
                escape = true;
            }
            else if (c === '"') {
                inString = false;
            }
            continue;
        }
        if (c === '"') {
            inString = true;
            continue;
        }
        if (c === openChar) {
            depth++;
        }
        else if (c === closeChar) {
            depth--;
            if (depth === 0) {
                const candidate = trimmed.slice(0, i + 1);
                try {
                    return JSON.parse(candidate);
                }
                catch {
                    return null;
                }
            }
        }
    }
    return null;
}
// Remove special tokens do chat template que alguns servidores (ex:
// mlx_lm.server) nao filtram da saida — eles vazam como texto na resposta
// (<|im_start|>, <|im_end|>, <|endoftext|>, <|eot_id|>, etc). Puramente
// cosmetico: nunca fazem parte do conteudo util.
const SPECIAL_TOKEN_RE = /<\|(?:im_start|im_end|endoftext|eot_id|end_of_text|begin_of_text|start_header_id|end_header_id|assistant|user|system)\|>/gi;
function stripSpecialTokens(text) {
    return text.replace(SPECIAL_TOKEN_RE, '').trim();
}
// Maps a raw error message from the HTTP layer into a structured reason.
// Used by both callAI and callAnthropicAI to produce consistent diagnostics.
function classifyApiError(rawMessage) {
    const m = rawMessage.toLowerCase();
    if (/\b429\b|rate.?limit|too many requests/.test(m)) {
        return { reason: 'rate_limit', userMessage: 'Limite de chamadas atingido no provedor (rate limit). Aguarde alguns segundos e tente novamente, ou troque para outro provedor.' };
    }
    if (/context.{0,20}(length|window|too large)|exceeds? .{0,20}(max|maximum) (tokens|context)|prompt is too long|token limit/.test(m)) {
        return { reason: 'context_too_large', userMessage: 'A conversa excedeu o limite de tokens do modelo. Inicie uma nova sessao ou reduza arquivos abertos no editor.' };
    }
    if (/\b401\b|\b403\b|unauthorized|forbidden|invalid api key|authentication/.test(m)) {
        return { reason: 'auth', userMessage: 'API key invalida ou sem permissao. Verifique a configuracao do provedor.' };
    }
    if (/timeout|timed out|etimedout/.test(m)) {
        return { reason: 'timeout', userMessage: 'O modelo demorou demais para responder (timeout). Tente novamente — em modelos locais, verifique a memoria disponivel.' };
    }
    if (/econnrefused|enotfound|network|fetch failed|socket hang up|connection (reset|refused|closed)/.test(m)) {
        return { reason: 'connection', userMessage: 'Nao foi possivel conectar ao provedor. Verifique se o LM Studio esta rodando ou se ha internet.' };
    }
    if (/compute error|engine protocol|predict stream|out of memory|oom|failed to (load|run) model/.test(m)) {
        return { reason: 'server_error', userMessage: 'O modelo local falhou ao gerar a resposta (erro de compute no LM Studio). Isso costuma ser falta de memoria (VRAM/RAM) ou o modelo instavel. Tente: recarregar o modelo no LM Studio, usar um quant menor, ou reduzir o contexto.' };
    }
    if (/\b5\d\d\b|internal server error|bad gateway|service unavailable/.test(m)) {
        return { reason: 'server_error', userMessage: 'Erro no servidor do provedor. Tente novamente em instantes.' };
    }
    return { reason: 'unknown', userMessage: 'Erro ao chamar o modelo. Detalhe: ' + rawMessage.slice(0, 200) };
}
exports.ANTHROPIC_API_BASE = 'https://api.anthropic.com';
exports.ANTHROPIC_VERSION = '2023-06-01';
function request(url, method, body, headers, timeoutMs, signal) {
    return new Promise((resolve, reject) => {
        if (signal?.aborted) {
            return reject(new Error('ABORTED'));
        }
        const parsed = new URL(url);
        const payload = JSON.stringify(body);
        const options = {
            hostname: parsed.hostname,
            port: parsed.port || (parsed.protocol === 'https:' ? 443 : 80),
            path: parsed.pathname + parsed.search,
            method,
            headers: {
                'Content-Type': 'application/json',
                'Content-Length': Buffer.byteLength(payload),
                ...headers,
            },
            timeout: timeoutMs,
        };
        const transport = url.startsWith('https://') ? https : http;
        const req = transport.request(options, (res) => {
            const chunks = [];
            res.on('data', (chunk) => chunks.push(chunk));
            res.on('end', () => {
                const raw = Buffer.concat(chunks).toString('utf8');
                if (res.statusCode && res.statusCode >= 400) {
                    try {
                        const body = JSON.parse(raw);
                        const detail = body?.error?.message || body?.message || raw.slice(0, 200);
                        reject(new Error(`API retornou ${res.statusCode}: ${detail}`));
                    }
                    catch {
                        reject(new Error(`API retornou ${res.statusCode}: ${res.statusMessage}`));
                    }
                    return;
                }
                try {
                    resolve(JSON.parse(raw));
                }
                catch (e) {
                    reject(new Error('Resposta nao e JSON valido.'));
                }
            });
        });
        signal?.addEventListener('abort', () => { req.destroy(); reject(new Error('ABORTED')); });
        req.on('timeout', () => { req.destroy(); reject(new Error('Timeout ao conectar.')); });
        req.on('error', reject);
        req.write(payload);
        req.end();
    });
}
function requestStream(url, body, headers, signal, onLine) {
    return new Promise((resolve, reject) => {
        if (signal?.aborted) {
            return reject(new Error('ABORTED'));
        }
        const parsed = new URL(url);
        const payload = JSON.stringify(body);
        const options = {
            hostname: parsed.hostname,
            port: parsed.port || (parsed.protocol === 'https:' ? 443 : 80),
            path: parsed.pathname + parsed.search,
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Content-Length': Buffer.byteLength(payload),
                ...headers,
            },
        };
        const transport = url.startsWith('https://') ? https : http;
        // Timeout de INATIVIDADE do stream (nao do request inteiro). Modelos
        // locais lentos (ex: MLX num MacBook Air) levam 15-30s so processando um
        // prompt grande ANTES do 1o token. O default de socket do Node e curto
        // e derrubava a conexao nesse intervalo -> "[API] Falha ao chamar o LLM"
        // intermitente, sempre em prompts maiores. Aqui o timer e RE-ARMADO a
        // cada chunk (inclusive keepalives ": keepalive" que o MLX envia durante
        // o processamento), entao so dispara se o servidor ficar REALMENTE mudo.
        const IDLE_TIMEOUT_MS = 120000; // 2 min sem NENHUM byte = servidor travado
        let idleTimer = null;
        let settled = false;
        const clearIdle = () => { if (idleTimer) {
            clearTimeout(idleTimer);
            idleTimer = null;
        } };
        const armIdle = (req) => {
            clearIdle();
            idleTimer = setTimeout(() => {
                if (settled) {
                    return;
                }
                settled = true;
                req.destroy();
                reject(new Error('Timeout: o modelo ficou mais de 120s sem responder (servidor local travado ou sem memoria?).'));
            }, IDLE_TIMEOUT_MS);
        };
        const req = transport.request(options, (res) => {
            armIdle(req);
            if (res.statusCode && res.statusCode >= 400) {
                const chunks = [];
                res.on('data', (c) => chunks.push(c));
                res.on('end', () => {
                    clearIdle();
                    if (settled) {
                        return;
                    }
                    settled = true;
                    const raw = Buffer.concat(chunks).toString('utf8');
                    try {
                        const parsed = JSON.parse(raw);
                        const detail = parsed?.error?.message || parsed?.message || raw.slice(0, 200);
                        reject(new Error(`API retornou ${res.statusCode}: ${detail}`));
                    }
                    catch {
                        reject(new Error(`API retornou ${res.statusCode}: ${res.statusMessage}`));
                    }
                });
                return;
            }
            // SSE parser tolerante a multiplos cenarios de eventos colados:
            //   - "data: A\ndata: B"  (caso normal)
            //   - "data: AAdata: B"   (eventos colados sem \n entre eles)
            //   - "data: Aevent: foo\ndata: B"  (Anthropic mistura event: e data:)
            //   - "{...}\n\nextra-bytes" (chunks com lixo apos JSON valido)
            //
            // Estrategia: para cada linha bruta, encontra TODAS as posicoes onde
            // comeca um novo prefixo SSE ("data:", "event:", "id:", "retry:") e
            // separa em fragmentos. Cada fragmento e despachado individualmente.
            // No callback de parsing (onLine), se JSON.parse falhar, tenta
            // extrair o primeiro objeto JSON valido antes de desistir.
            const SSE_PREFIX_RE = /(?<=.)(?=(?:data:|event:|id:|retry:)\s)/g;
            let buf = '';
            const dispatchLine = (rawLine) => {
                if (!rawLine) {
                    return;
                }
                if (SSE_PREFIX_RE.test(rawLine)) {
                    SSE_PREFIX_RE.lastIndex = 0; // reset state after test()
                    const parts = rawLine.split(SSE_PREFIX_RE);
                    for (const p of parts) {
                        const trimmed = p.trim();
                        if (trimmed) {
                            onLine(trimmed);
                        }
                    }
                    return;
                }
                onLine(rawLine);
            };
            res.on('data', (chunk) => {
                armIdle(req); // atividade recebida (inclui keepalives) → re-arma
                buf += chunk.toString('utf8');
                const lines = buf.split('\n');
                buf = lines.pop() ?? '';
                for (const line of lines) {
                    dispatchLine(line);
                }
            });
            res.on('end', () => {
                clearIdle();
                if (settled) {
                    return;
                }
                settled = true;
                if (buf) {
                    dispatchLine(buf);
                }
                resolve();
            });
            res.on('error', (e) => {
                clearIdle();
                if (settled) {
                    return;
                }
                settled = true;
                reject(e instanceof Error ? e : new Error(String(e)));
            });
        });
        signal?.addEventListener('abort', () => { clearIdle(); if (!settled) {
            settled = true;
            req.destroy();
            reject(new Error('ABORTED'));
        } });
        req.on('error', (e) => { clearIdle(); if (!settled) {
            settled = true;
            reject(e instanceof Error ? e : new Error(String(e)));
        } });
        req.write(payload);
        req.end();
    });
}
function get(url, headers, timeoutMs) {
    return new Promise((resolve, reject) => {
        const parsed = new URL(url);
        const options = {
            hostname: parsed.hostname,
            port: parsed.port || (parsed.protocol === 'https:' ? 443 : 80),
            path: parsed.pathname + parsed.search,
            method: 'GET',
            headers: { 'Content-Type': 'application/json', ...headers },
            timeout: timeoutMs,
        };
        const transport = url.startsWith('https://') ? https : http;
        const req = transport.request(options, (res) => {
            res.on('data', () => { });
            res.on('end', () => resolve(res.statusCode));
        });
        req.on('timeout', () => { req.destroy(); reject(new Error('Timeout')); });
        req.on('error', reject);
        req.end();
    });
}
async function checkConnection(endpoint, authHeaders) {
    const base = endpoint.replace('/v1/chat/completions', '');
    try {
        const status = await get(`${base}/v1/models`, authHeaders, 4000);
        return status === 200;
    }
    catch {
        return false;
    }
}
// Consulta GET /v1/models e retorna o id do primeiro modelo servido, ou null.
// Usado pelo provider MLX: o mlx_lm.server conhece o modelo pelo id COMPLETO
// (ex: "mlx-community/Qwen2.5-Coder-14B-Instruct-4bit"). Se o usuário digitar o
// nome sem o prefixo (ou deixar vazio), o POST /v1/chat/completions dá 404.
// Resolver o id real evita esse 404 sem exigir que o usuário acerte o prefixo.
async function fetchFirstModelId(endpoint, authHeaders) {
    const base = endpoint.replace('/v1/chat/completions', '');
    try {
        const parsed = new URL(`${base}/v1/models`);
        const transport = parsed.protocol === 'https:' ? https : http;
        const raw = await new Promise((resolve, reject) => {
            const req = transport.request({
                hostname: parsed.hostname,
                port: parsed.port || (parsed.protocol === 'https:' ? 443 : 80),
                path: parsed.pathname + parsed.search,
                method: 'GET',
                headers: { 'Content-Type': 'application/json', ...authHeaders },
                timeout: 4000,
            }, (res) => {
                const chunks = [];
                res.on('data', (c) => chunks.push(c));
                res.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
            });
            req.on('timeout', () => { req.destroy(); reject(new Error('Timeout')); });
            req.on('error', reject);
            req.end();
        });
        const json = JSON.parse(raw);
        const id = json?.data?.[0]?.id;
        return typeof id === 'string' && id.length > 0 ? id : null;
    }
    catch {
        return null;
    }
}
async function checkAnthropicConnection(apiKey) {
    if (!apiKey) {
        return false;
    }
    try {
        const status = await get(`${exports.ANTHROPIC_API_BASE}/v1/models`, {
            'x-api-key': apiKey,
            'anthropic-version': exports.ANTHROPIC_VERSION,
        }, 8000);
        return status === 200;
    }
    catch {
        return false;
    }
}
async function callAI(endpoint, authHeaders, messages, tools, model, signal, onChunk, onLiveTelemetry) {
    const formattedTools = tools.map(t => ({
        type: 'function',
        function: { name: t.name, description: t.description, parameters: t.parameters },
    }));
    // Streaming state lifted to outer scope so the catch block can recover
    // any partial text that was already produced before the stream broke.
    let textAcc = '';
    try {
        if (onChunk) {
            // ── Streaming path ──
            let toolId = '';
            let toolName = '';
            let toolArgsRaw = '';
            let promptTokens = 0;
            let completionTokens = 0;
            let liveTokens = 0;
            const t0 = Date.now();
            // Erro reportado DENTRO do stream (ver abaixo). Capturado numa
            // variavel em vez de lancado no callback — o callback tem um
            // try/catch que engoliria o throw como "chunk malformado". Depois do
            // stream terminar, re-lancamos para cair no catch externo.
            let streamError = null;
            await requestStream(endpoint, {
                model, messages, tools: formattedTools, tool_choice: 'auto', stream: true,
            }, authHeaders, signal, (line) => {
                if (!line.startsWith('data: ')) {
                    return;
                }
                const data = line.slice(6).trim();
                if (data === '[DONE]') {
                    return;
                }
                try {
                    // Tolerant parse: extracts first valid JSON object even if
                    // the chunk has trailing junk from a concatenated event.
                    const evt = tryParseJsonChunk(data);
                    if (!evt) {
                        return;
                    }
                    // Erro reportado DENTRO do stream: LM Studio abre o SSE com
                    // status 200 e, se o engine falha no meio (ex: "Compute
                    // error"), manda um evento { error: {...} } ou { code: 500,
                    // message, type } em vez de um delta. Sem tratar isso, o
                    // stream terminava vazio e o loop interpretava como "contexto
                    // cheio" — mostrando um checkpoint enganoso.
                    const streamErr = evt.error || (typeof evt.code === 'number' && evt.code >= 400 ? evt : null);
                    if (streamErr) {
                        const detail = streamErr.message || streamErr.error?.message || 'erro reportado pelo modelo no stream';
                        streamError = new Error(`API stream error ${streamErr.code || ''}: ${detail}`.trim());
                        return;
                    }
                    // Capture usage when present (LM Studio sends it in last chunk)
                    if (evt?.usage) {
                        promptTokens = evt.usage.prompt_tokens ?? 0;
                        completionTokens = evt.usage.completion_tokens ?? 0;
                    }
                    const delta = evt?.choices?.[0]?.delta;
                    if (!delta) {
                        return;
                    }
                    if (delta.content) {
                        textAcc += delta.content;
                        onChunk(delta.content);
                        liveTokens++;
                        if (onLiveTelemetry) {
                            const elapsedMs = Date.now() - t0;
                            const tokensPerSec = elapsedMs > 0 ? Math.round(liveTokens / (elapsedMs / 1000)) : 0;
                            onLiveTelemetry(liveTokens, tokensPerSec, elapsedMs);
                        }
                    }
                    if (delta.tool_calls?.length > 0) {
                        const tc = delta.tool_calls[0];
                        if (tc.id) {
                            toolId = tc.id;
                        }
                        if (tc.function?.name) {
                            toolName += tc.function.name;
                        }
                        if (tc.function?.arguments) {
                            toolArgsRaw += tc.function.arguments;
                        }
                    }
                }
                catch { /* malformed chunk */ }
            });
            // Erro sinalizado dentro do stream — propaga para o catch externo,
            // que retorna __INFRA_ERROR__ com a mensagem classificada.
            if (streamError) {
                throw streamError;
            }
            const usage = { promptTokens, completionTokens, elapsedMs: Date.now() - t0 };
            if (toolName) {
                // Tool args are streamed in chunks and accumulated. If the
                // model produced malformed JSON, fall back to text-only
                // response instead of throwing — better to keep the partial
                // text than to discard everything.
                const args = toolArgsRaw ? tryParseJsonChunk(toolArgsRaw) : {};
                if (args !== null) {
                    return { responseText: '', toolCall: { id: toolId, function: { name: toolName, arguments: args } }, usage };
                }
                // Tool args failed to parse — log and degrade to text response
                console.warn('[API] Tool args JSON malformado, degradando para resposta de texto:', toolArgsRaw.slice(0, 200));
            }
            return { responseText: stripSpecialTokens(textAcc), usage };
        }
        else {
            // ── Non-streaming path (fallback) ──
            const data = await request(endpoint, 'POST', {
                model, messages, tools: formattedTools, tool_choice: 'auto',
            }, authHeaders, 600000, signal);
            const message = data?.choices?.[0]?.message;
            if (!message) {
                throw new Error('Resposta inesperada da API.');
            }
            if (message.tool_calls?.length > 0) {
                const raw = message.tool_calls[0];
                const args = typeof raw.function.arguments === 'string'
                    ? (tryParseJsonChunk(raw.function.arguments) ?? {})
                    : raw.function.arguments;
                return { responseText: '', toolCall: { id: raw.id, function: { name: raw.function.name, arguments: args } } };
            }
            return { responseText: (message.content || '').trim() };
        }
    }
    catch (error) {
        if (error instanceof Error && error.message === 'ABORTED') {
            return { responseText: '__ABORTED__' };
        }
        const rawMessage = error instanceof Error ? error.message : String(error);
        const { reason, userMessage } = classifyApiError(rawMessage);
        console.error('[API] Falha ao chamar o LLM:', { reason, rawMessage, partialLen: textAcc.length });
        return {
            responseText: '__INFRA_ERROR__',
            partialText: stripSpecialTokens(textAcc),
            errorReason: reason,
            errorDetail: userMessage,
        };
    }
}
async function callAnthropicAI(apiKey, messages, tools, model, signal, onChunk, onLiveTelemetry) {
    const systemMessage = messages.find(m => m.role === 'system');
    const systemContent = typeof systemMessage?.content === 'string' ? systemMessage.content : undefined;
    const chatMessages = messages
        .filter(m => m.role !== 'system')
        .map(m => {
        if (m.role === 'tool') {
            const msg = m;
            return {
                role: 'user',
                content: [{
                        type: 'tool_result',
                        tool_use_id: msg.tool_call_id,
                        content: typeof msg.content === 'string' ? msg.content : JSON.stringify(msg.content),
                    }],
            };
        }
        if (m.role === 'assistant' && m.tool_calls?.length > 0) {
            const tc = m.tool_calls[0];
            const args = typeof tc.function.arguments === 'string'
                ? JSON.parse(tc.function.arguments)
                : tc.function.arguments;
            return {
                role: 'assistant',
                content: [{ type: 'tool_use', id: tc.id, name: tc.function.name, input: args }],
            };
        }
        const content = m.content ?? '';
        return { role: m.role, content };
    });
    const anthropicTools = tools.map(t => ({
        name: t.name,
        description: t.description,
        input_schema: t.parameters,
    }));
    const body = {
        model,
        max_tokens: 8192,
        messages: chatMessages,
        tools: anthropicTools,
        tool_choice: { type: 'auto' },
        stream: true,
    };
    if (systemContent) {
        body.system = systemContent;
    }
    const headers = {
        'x-api-key': apiKey,
        'anthropic-version': exports.ANTHROPIC_VERSION,
    };
    // Lifted to outer scope so the catch can recover partial text from a
    // broken stream (e.g. network blip mid-response).
    let textAcc = '';
    try {
        let toolId = '';
        let toolName = '';
        let toolArgsRaw = '';
        let currentBlockType = '';
        let liveTokens = 0;
        const t0 = Date.now();
        // Erro sinalizado dentro do stream (Anthropic manda { type: 'error' }).
        // Capturado numa variavel e re-lancado apos o stream — o callback tem
        // try/catch que engoliria um throw como chunk malformado.
        let streamError = null;
        await requestStream(`${exports.ANTHROPIC_API_BASE}/v1/messages`, body, headers, signal, (line) => {
            if (!line.startsWith('data: ')) {
                return;
            }
            const data = line.slice(6).trim();
            try {
                // Tolerant parse: extracts first valid JSON object even if
                // the chunk has trailing junk from a concatenated event.
                const evt = tryParseJsonChunk(data);
                if (!evt) {
                    return;
                }
                const type = evt?.type ?? '';
                if (type === 'error') {
                    const detail = evt.error?.message || evt.error?.type || 'erro reportado pela API no stream';
                    streamError = new Error(`API stream error: ${detail}`);
                    return;
                }
                if (type === 'content_block_start') {
                    currentBlockType = evt.content_block?.type ?? '';
                    if (currentBlockType === 'tool_use') {
                        toolId = evt.content_block.id ?? '';
                        toolName = evt.content_block.name ?? '';
                    }
                }
                else if (type === 'content_block_delta') {
                    const delta = evt.delta ?? {};
                    if (delta.type === 'text_delta' && delta.text) {
                        textAcc += delta.text;
                        onChunk?.(delta.text);
                        liveTokens++;
                        if (onLiveTelemetry) {
                            const elapsedMs = Date.now() - t0;
                            const tokensPerSec = elapsedMs > 0 ? Math.round(liveTokens / (elapsedMs / 1000)) : 0;
                            onLiveTelemetry(liveTokens, tokensPerSec, elapsedMs);
                        }
                    }
                    else if (delta.type === 'input_json_delta' && delta.partial_json) {
                        toolArgsRaw += delta.partial_json;
                    }
                }
            }
            catch { /* malformed chunk */ }
        });
        if (streamError) {
            throw streamError;
        }
        if (toolName) {
            // Tool args are accumulated chunk-by-chunk. Use tolerant parser
            // and fall back to text response if JSON is malformed.
            const args = toolArgsRaw ? tryParseJsonChunk(toolArgsRaw) : {};
            if (args !== null) {
                return { responseText: '', toolCall: { id: toolId, function: { name: toolName, arguments: args } } };
            }
            console.warn('[API Anthropic] Tool args JSON malformado, degradando para texto:', toolArgsRaw.slice(0, 200));
        }
        return { responseText: stripSpecialTokens(textAcc) };
    }
    catch (error) {
        if (error instanceof Error && error.message === 'ABORTED') {
            return { responseText: '__ABORTED__' };
        }
        const rawMessage = error instanceof Error ? error.message : String(error);
        const { reason, userMessage } = classifyApiError(rawMessage);
        console.error('[API Anthropic] Falha:', { reason, rawMessage, partialLen: textAcc.length });
        return {
            responseText: '__INFRA_ERROR__',
            partialText: stripSpecialTokens(textAcc),
            errorReason: reason,
            errorDetail: userMessage,
        };
    }
}
async function callAIWithVision(endpoint, authHeaders, userText, imageBase64, imageMimeType, systemContent, model) {
    try {
        const data = await request(endpoint, 'POST', {
            model,
            messages: [
                { role: 'system', content: systemContent },
                {
                    role: 'user',
                    content: [
                        { type: 'text', text: userText },
                        { type: 'image_url', image_url: { url: `data:${imageMimeType};base64,${imageBase64}` } },
                    ],
                },
            ],
            temperature: 0.2,
        }, authHeaders, 600000);
        const content = data?.choices?.[0]?.message?.content || '';
        const cleaned = content
            .replace(/^(minha resposta|vou descrever|vou analisar|como sou|devo responder|meu papel)[^\n]*\n?/gim, '')
            .replace(/^(note que|observa[cç][aã]o|an[aá]lise|estrat[eé]gia)[^\n]*\n?/gim, '')
            .trim();
        return cleaned || 'Nao foi possivel analisar a imagem.';
    }
    catch (error) {
        return `ERRO ao analisar imagem: ${error instanceof Error ? error.message : String(error)}`;
    }
}
