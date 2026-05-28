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
exports.checkConnection = checkConnection;
exports.checkAnthropicConnection = checkAnthropicConnection;
exports.callAI = callAI;
exports.callAnthropicAI = callAnthropicAI;
exports.callAIWithVision = callAIWithVision;
const https = __importStar(require("https"));
const http = __importStar(require("http"));
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
        const req = transport.request(options, (res) => {
            if (res.statusCode && res.statusCode >= 400) {
                const chunks = [];
                res.on('data', (c) => chunks.push(c));
                res.on('end', () => {
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
            let buf = '';
            res.on('data', (chunk) => {
                buf += chunk.toString('utf8');
                const lines = buf.split('\n');
                buf = lines.pop() ?? '';
                for (const line of lines) {
                    onLine(line);
                }
            });
            res.on('end', () => {
                if (buf) {
                    onLine(buf);
                }
                resolve();
            });
        });
        signal?.addEventListener('abort', () => { req.destroy(); reject(new Error('ABORTED')); });
        req.on('error', reject);
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
    try {
        if (onChunk) {
            // ── Streaming path ──
            let textAcc = '';
            let toolId = '';
            let toolName = '';
            let toolArgsRaw = '';
            let promptTokens = 0;
            let completionTokens = 0;
            let liveTokens = 0;
            const t0 = Date.now();
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
                    const evt = JSON.parse(data);
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
            const usage = { promptTokens, completionTokens, elapsedMs: Date.now() - t0 };
            if (toolName) {
                const args = toolArgsRaw ? JSON.parse(toolArgsRaw) : {};
                return { responseText: '', toolCall: { id: toolId, function: { name: toolName, arguments: args } }, usage };
            }
            return { responseText: textAcc.trim(), usage };
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
                    ? JSON.parse(raw.function.arguments)
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
        console.error('[API] Falha ao chamar o LLM:', error);
        return { responseText: '__INFRA_ERROR__' };
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
    try {
        let textAcc = '';
        let toolId = '';
        let toolName = '';
        let toolArgsRaw = '';
        let currentBlockType = '';
        let liveTokens = 0;
        const t0 = Date.now();
        await requestStream(`${exports.ANTHROPIC_API_BASE}/v1/messages`, body, headers, signal, (line) => {
            if (!line.startsWith('data: ')) {
                return;
            }
            const data = line.slice(6).trim();
            try {
                const evt = JSON.parse(data);
                const type = evt?.type ?? '';
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
        if (toolName) {
            const args = toolArgsRaw ? JSON.parse(toolArgsRaw) : {};
            return { responseText: '', toolCall: { id: toolId, function: { name: toolName, arguments: args } } };
        }
        return { responseText: textAcc.trim() };
    }
    catch (error) {
        if (error instanceof Error && error.message === 'ABORTED') {
            return { responseText: '__ABORTED__' };
        }
        console.error('[API Anthropic] Falha:', error);
        return { responseText: '__INFRA_ERROR__' };
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
