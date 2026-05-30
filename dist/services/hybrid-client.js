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
exports.callSupportProvider = callSupportProvider;
const http = __importStar(require("http"));
const https = __importStar(require("https"));
const settings_1 = require("../config/settings");
const ANTHROPIC_VERSION = '2023-06-01';
// Calls the configured paid provider in text-only mode (no tools). Used as a
// consultative companion to the local model: planning, verification, recovery
// from failure. Returns text + token usage; never throws — degraded mode on
// error so the local loop can keep going.
async function callSupportProvider(req) {
    const t0 = Date.now();
    const model = req.model?.trim() || settings_1.DEFAULT_SUPPORT_MODELS[req.provider];
    const maxTokens = req.maxTokens ?? 1024;
    try {
        if (req.provider === 'anthropic') {
            return await callAnthropic(req.apiKey, model, req.system, req.user, maxTokens, t0);
        }
        if (req.provider === 'openai') {
            return await callOpenAI(req.apiKey, model, req.system, req.user, maxTokens, t0);
        }
        if (req.provider === 'gemini') {
            return await callGemini(req.apiKey, model, req.system, req.user, maxTokens, t0);
        }
        return errorResponse(`Provider not supported: ${req.provider}`, t0);
    }
    catch (e) {
        return errorResponse(e instanceof Error ? e.message : String(e), t0);
    }
}
async function callAnthropic(apiKey, model, system, user, maxTokens, t0) {
    const body = {
        model,
        max_tokens: maxTokens,
        system,
        messages: [{ role: 'user', content: user }],
    };
    const res = await postJson('https://api.anthropic.com/v1/messages', body, {
        'x-api-key': apiKey,
        'anthropic-version': ANTHROPIC_VERSION,
    });
    const text = (res?.content?.[0]?.text || '').trim();
    return {
        text,
        promptTokens: res?.usage?.input_tokens ?? 0,
        completionTokens: res?.usage?.output_tokens ?? 0,
        elapsedMs: Date.now() - t0,
    };
}
async function callOpenAI(apiKey, model, system, user, maxTokens, t0) {
    const body = {
        model,
        max_tokens: maxTokens,
        messages: [
            { role: 'system', content: system },
            { role: 'user', content: user },
        ],
    };
    const res = await postJson('https://api.openai.com/v1/chat/completions', body, {
        Authorization: `Bearer ${apiKey}`,
    });
    const text = (res?.choices?.[0]?.message?.content || '').trim();
    return {
        text,
        promptTokens: res?.usage?.prompt_tokens ?? 0,
        completionTokens: res?.usage?.completion_tokens ?? 0,
        elapsedMs: Date.now() - t0,
    };
}
async function callGemini(apiKey, model, system, user, maxTokens, t0) {
    // Gemini uses a different schema: systemInstruction + contents[]
    const url = `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent?key=${encodeURIComponent(apiKey)}`;
    const body = {
        systemInstruction: { parts: [{ text: system }] },
        contents: [{ role: 'user', parts: [{ text: user }] }],
        generationConfig: { maxOutputTokens: maxTokens },
    };
    const res = await postJson(url, body, {});
    const text = (res?.candidates?.[0]?.content?.parts?.[0]?.text || '').trim();
    return {
        text,
        promptTokens: res?.usageMetadata?.promptTokenCount ?? 0,
        completionTokens: res?.usageMetadata?.candidatesTokenCount ?? 0,
        elapsedMs: Date.now() - t0,
    };
}
function errorResponse(message, t0) {
    return { text: '', promptTokens: 0, completionTokens: 0, elapsedMs: Date.now() - t0, error: message };
}
function postJson(url, body, headers) {
    return new Promise((resolve, reject) => {
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
            timeout: 30000,
        };
        const transport = url.startsWith('https://') ? https : http;
        const req = transport.request(options, (res) => {
            const chunks = [];
            res.on('data', (c) => chunks.push(c));
            res.on('end', () => {
                const raw = Buffer.concat(chunks).toString('utf8');
                if (res.statusCode && res.statusCode >= 400) {
                    try {
                        const json = JSON.parse(raw);
                        const detail = json?.error?.message || json?.message || raw.slice(0, 200);
                        reject(new Error(`HTTP ${res.statusCode}: ${detail}`));
                    }
                    catch {
                        reject(new Error(`HTTP ${res.statusCode}: ${res.statusMessage}`));
                    }
                    return;
                }
                try {
                    resolve(JSON.parse(raw));
                }
                catch {
                    reject(new Error('Invalid JSON response'));
                }
            });
        });
        req.on('timeout', () => { req.destroy(); reject(new Error('Timeout (30s) on support provider')); });
        req.on('error', reject);
        req.write(payload);
        req.end();
    });
}
