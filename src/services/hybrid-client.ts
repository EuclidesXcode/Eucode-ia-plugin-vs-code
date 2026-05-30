import * as http from 'http';
import * as https from 'https';
import { SupportProvider, DEFAULT_SUPPORT_MODELS } from '../config/settings';

export interface SupportResponse {
    text: string;
    promptTokens: number;
    completionTokens: number;
    elapsedMs: number;
    error?: string;
}

export interface SupportRequest {
    provider: SupportProvider;
    apiKey: string;
    model?: string;
    system: string;
    user: string;
    maxTokens?: number;
}

const ANTHROPIC_VERSION = '2023-06-01';

// Calls the configured paid provider in text-only mode (no tools). Used as a
// consultative companion to the local model: planning, verification, recovery
// from failure. Returns text + token usage; never throws — degraded mode on
// error so the local loop can keep going.
export async function callSupportProvider(req: SupportRequest): Promise<SupportResponse> {
    const t0 = Date.now();
    const model = req.model?.trim() || DEFAULT_SUPPORT_MODELS[req.provider];
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
    } catch (e) {
        return errorResponse(e instanceof Error ? e.message : String(e), t0);
    }
}

async function callAnthropic(apiKey: string, model: string, system: string, user: string, maxTokens: number, t0: number): Promise<SupportResponse> {
    const body = {
        model,
        max_tokens: maxTokens,
        system,
        messages: [{ role: 'user', content: user }],
    };
    const res = await postJson('https://api.anthropic.com/v1/messages', body, {
        'x-api-key': apiKey,
        'anthropic-version': ANTHROPIC_VERSION,
    }) as any;

    const text = (res?.content?.[0]?.text || '').trim();
    return {
        text,
        promptTokens: res?.usage?.input_tokens ?? 0,
        completionTokens: res?.usage?.output_tokens ?? 0,
        elapsedMs: Date.now() - t0,
    };
}

async function callOpenAI(apiKey: string, model: string, system: string, user: string, maxTokens: number, t0: number): Promise<SupportResponse> {
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
    }) as any;

    const text = (res?.choices?.[0]?.message?.content || '').trim();
    return {
        text,
        promptTokens: res?.usage?.prompt_tokens ?? 0,
        completionTokens: res?.usage?.completion_tokens ?? 0,
        elapsedMs: Date.now() - t0,
    };
}

async function callGemini(apiKey: string, model: string, system: string, user: string, maxTokens: number, t0: number): Promise<SupportResponse> {
    // Gemini uses a different schema: systemInstruction + contents[]
    const url = `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent?key=${encodeURIComponent(apiKey)}`;
    const body = {
        systemInstruction: { parts: [{ text: system }] },
        contents: [{ role: 'user', parts: [{ text: user }] }],
        generationConfig: { maxOutputTokens: maxTokens },
    };
    const res = await postJson(url, body, {}) as any;

    const text = (res?.candidates?.[0]?.content?.parts?.[0]?.text || '').trim();
    return {
        text,
        promptTokens: res?.usageMetadata?.promptTokenCount ?? 0,
        completionTokens: res?.usageMetadata?.candidatesTokenCount ?? 0,
        elapsedMs: Date.now() - t0,
    };
}

function errorResponse(message: string, t0: number): SupportResponse {
    return { text: '', promptTokens: 0, completionTokens: 0, elapsedMs: Date.now() - t0, error: message };
}

function postJson(url: string, body: unknown, headers: Record<string, string>): Promise<unknown> {
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
            const chunks: Buffer[] = [];
            res.on('data', (c: Buffer) => chunks.push(c));
            res.on('end', () => {
                const raw = Buffer.concat(chunks).toString('utf8');
                if (res.statusCode && res.statusCode >= 400) {
                    try {
                        const json = JSON.parse(raw);
                        const detail = json?.error?.message || json?.message || raw.slice(0, 200);
                        reject(new Error(`HTTP ${res.statusCode}: ${detail}`));
                    } catch {
                        reject(new Error(`HTTP ${res.statusCode}: ${res.statusMessage}`));
                    }
                    return;
                }
                try { resolve(JSON.parse(raw)); }
                catch { reject(new Error('Invalid JSON response')); }
            });
        });
        req.on('timeout', () => { req.destroy(); reject(new Error('Timeout (30s) on support provider')); });
        req.on('error', reject);
        req.write(payload);
        req.end();
    });
}
