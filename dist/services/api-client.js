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
exports.checkConnection = checkConnection;
exports.callAI = callAI;
exports.callAIWithVision = callAIWithVision;
const https = __importStar(require("https"));
const http = __importStar(require("http"));
const constants_1 = require("../utils/constants");
function request(url, method, body, headers, timeoutMs) {
    return new Promise((resolve, reject) => {
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
                if (res.statusCode && res.statusCode >= 400) {
                    reject(new Error(`API retornou ${res.statusCode}: ${res.statusMessage}`));
                    return;
                }
                try {
                    resolve(JSON.parse(Buffer.concat(chunks).toString('utf8')));
                }
                catch (e) {
                    reject(new Error('Resposta nao e JSON valido.'));
                }
            });
        });
        req.on('timeout', () => { req.destroy(); reject(new Error('Timeout ao conectar.')); });
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
async function callAI(endpoint, authHeaders, messages, tools) {
    const formattedTools = tools.map(t => ({
        type: 'function',
        function: { name: t.name, description: t.description, parameters: t.parameters },
    }));
    try {
        const data = await request(endpoint, 'POST', {
            model: constants_1.MODEL, messages, tools: formattedTools, tool_choice: 'auto',
        }, authHeaders, 120000);
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
        return { responseText: message.content || 'Nao foi possivel obter resposta.' };
    }
    catch (error) {
        console.error('[API] Falha ao chamar o LLM:', error);
        return {
            responseText: `ERRO DE CONEXAO: Nao foi possivel conectar com a IA em ${endpoint}. Verifique se o servico esta rodando. Detalhe: ${error instanceof Error ? error.message : String(error)}`,
        };
    }
}
async function callAIWithVision(endpoint, authHeaders, userText, imageBase64, imageMimeType, systemContent) {
    try {
        const data = await request(endpoint, 'POST', {
            model: constants_1.MODEL,
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
        }, authHeaders, 120000);
        return data?.choices?.[0]?.message?.content || 'Nao foi possivel analisar a imagem.';
    }
    catch (error) {
        return `ERRO ao analisar imagem: ${error instanceof Error ? error.message : String(error)}`;
    }
}
