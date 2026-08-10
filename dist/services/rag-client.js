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
exports.queryRag = queryRag;
exports.formatRagContext = formatRagContext;
const http = __importStar(require("http"));
const https = __importStar(require("https"));
// Queries a vector DB for relevant context. Dispatches by provider:
//   - chroma: sends raw text; Chroma embeds server-side (/api/v1 query API).
//   - qdrant: embeds the query locally first (LM Studio /v1/embeddings), then
//     runs a vector search. The official self-hosted Qdrant image has no
//     built-in inference, so server-side text embedding is not available.
async function queryRag(opts) {
    const nResults = opts.nResults ?? 3;
    try {
        if (opts.provider === 'qdrant') {
            return await queryQdrant(opts, nResults);
        }
        return await queryChroma(opts.endpoint, opts.collection, opts.query, nResults);
    }
    catch {
        return [];
    }
}
// ── Chroma (raw text, server embeds) ──────────────────────────────────────
async function queryChroma(endpoint, collection, query, nResults) {
    const url = `${endpoint}/api/v1/collections/${encodeURIComponent(collection)}/query`;
    const body = JSON.stringify({
        query_texts: [query],
        n_results: nResults,
        include: ['documents', 'metadatas', 'distances'],
    });
    const results = await post(url, body);
    const documents = results?.documents ?? [];
    const metadatas = results?.metadatas ?? [];
    const distances = results?.distances ?? [];
    return (documents[0] ?? []).map((doc, i) => ({
        content: doc,
        source: metadatas[0]?.[i]?.source ?? metadatas[0]?.[i]?.filename ?? 'unknown',
        score: distances[0]?.[i],
    }));
}
// ── Qdrant (embed locally, then vector search) ────────────────────────────
async function queryQdrant(opts, nResults) {
    if (!opts.embedHost || !opts.embedModel) {
        // Without an embedding endpoint we can't turn the query into a vector,
        // and self-hosted Qdrant won't do it for us. Degrade silently to no context.
        return [];
    }
    const vector = await embedText(opts.embedHost, opts.embedModel, opts.query);
    if (!vector || vector.length === 0) {
        return [];
    }
    const url = `${opts.endpoint}/collections/${encodeURIComponent(opts.collection)}/points/query`;
    const body = JSON.stringify({
        query: vector,
        limit: nResults,
        with_payload: true,
    });
    const res = await post(url, body);
    const points = res?.result?.points ?? res?.result ?? [];
    return points.map((p) => {
        const payload = p?.payload ?? {};
        return {
            content: payload.content ?? payload.document ?? payload.text ?? '',
            source: payload.source ?? payload.filename ?? payload.path ?? 'unknown',
            score: typeof p?.score === 'number' ? p.score : undefined,
        };
    }).filter((r) => r.content);
}
// Calls an OpenAI-compatible /v1/embeddings endpoint (LM Studio, Ollama, etc).
async function embedText(host, model, text) {
    const url = `${host.replace(/\/+$/, '')}/v1/embeddings`;
    const body = JSON.stringify({ model, input: text });
    const res = await post(url, body);
    const vector = res?.data?.[0]?.embedding;
    return Array.isArray(vector) ? vector : [];
}
function formatRagContext(results) {
    if (results.length === 0) {
        return '';
    }
    const lines = results.map(r => `# ${r.source}\n${r.content}`);
    return `# RELEVANT CONTEXT FROM VECTOR DB\n${lines.join('\n\n')}`;
}
function post(url, body) {
    return new Promise((resolve, reject) => {
        const parsed = new URL(url);
        const options = {
            hostname: parsed.hostname,
            port: parsed.port || (parsed.protocol === 'https:' ? 443 : 80),
            path: parsed.pathname + parsed.search,
            method: 'POST',
            headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(body) },
            timeout: 5000,
        };
        const transport = url.startsWith('https://') ? https : http;
        const req = transport.request(options, (res) => {
            const chunks = [];
            res.on('data', (c) => chunks.push(c));
            res.on('end', () => {
                try {
                    resolve(JSON.parse(Buffer.concat(chunks).toString('utf8')));
                }
                catch {
                    reject(new Error('Invalid JSON from RAG endpoint'));
                }
            });
        });
        req.on('timeout', () => { req.destroy(); reject(new Error('RAG timeout')); });
        req.on('error', reject);
        req.write(body);
        req.end();
    });
}
