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
exports.embedText = embedText;
exports.isValidEmbeddingVector = isValidEmbeddingVector;
exports.formatRagContext = formatRagContext;
exports.ensureQdrantCollection = ensureQdrantCollection;
exports.upsertQdrantPoints = upsertQdrantPoints;
exports.deletePointsBySource = deletePointsBySource;
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
    const results = await request('POST', url, body);
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
    const res = await request('POST', url, body);
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
// Exported: also used by rag-indexer.ts to embed chunks before upserting.
async function embedText(host, model, text) {
    const url = `${host.replace(/\/+$/, '')}/v1/embeddings`;
    const body = JSON.stringify({ model, input: text });
    const res = await request('POST', url, body);
    const vector = res?.data?.[0]?.embedding;
    // Degenerate input (e.g. a chunk that's almost all punctuation/regex) can
    // make some local embedding models emit NaN/Infinity. Treat it the same
    // as "no vector" so one bad chunk doesn't take down a whole indexing run.
    return isValidEmbeddingVector(vector) ? vector : [];
}
function isValidEmbeddingVector(vector) {
    return Array.isArray(vector) && vector.length > 0 && vector.every((n) => typeof n === 'number' && Number.isFinite(n));
}
function formatRagContext(results) {
    if (results.length === 0) {
        return '';
    }
    const lines = results.map(r => `# ${r.source}\n${r.content}`);
    return `# RELEVANT CONTEXT FROM VECTOR DB\n${lines.join('\n\n')}`;
}
// ── Qdrant indexing (used by rag-indexer.ts) ───────────────────────────────
// The plugin only ever queries Chroma (it embeds server-side and is usually
// fed by an external ingestion pipeline). Qdrant is a pure vector store with
// no ingestion of its own, so the plugin has to create the collection and
// upsert points itself — that's what these two functions are for.
// Creates the collection if it doesn't exist yet, sized to match the
// embedding model's output. No-op if the collection is already there (so
// re-indexing is safe to call repeatedly).
async function ensureQdrantCollection(endpoint, collection, vectorSize) {
    const base = endpoint.replace(/\/+$/, '');
    const existing = await request('GET', `${base}/collections/${encodeURIComponent(collection)}`, undefined, /* allow404 */ true, INDEX_TIMEOUT_MS);
    if (existing !== null) {
        return;
    }
    await request('PUT', `${base}/collections/${encodeURIComponent(collection)}`, JSON.stringify({
        vectors: { size: vectorSize, distance: 'Cosine' },
    }), false, INDEX_TIMEOUT_MS);
}
// Upserts a batch of points. Points reuse a deterministic id (see
// rag-indexer.ts) so re-indexing the same chunk overwrites it in place
// instead of accumulating duplicates.
async function upsertQdrantPoints(endpoint, collection, points) {
    if (points.length === 0) {
        return;
    }
    const base = endpoint.replace(/\/+$/, '');
    await request('PUT', `${base}/collections/${encodeURIComponent(collection)}/points?wait=true`, JSON.stringify({ points }), false, INDEX_TIMEOUT_MS);
}
// Deletes every point whose payload.source matches the given path. Used before
// re-indexing a single file (so an edit that shrinks the file doesn't leave
// stale chunks from the old, longer version behind) and when a file is
// deleted/renamed (so the RAG context never serves content from a file that
// no longer exists — that's a direct source of hallucinated answers).
// No-op (not an error) if the collection doesn't exist yet.
async function deletePointsBySource(endpoint, collection, source) {
    const base = endpoint.replace(/\/+$/, '');
    await request('POST', `${base}/collections/${encodeURIComponent(collection)}/points/delete?wait=true`, JSON.stringify({
        filter: { must: [{ key: 'source', match: { value: source } }] },
    }), /* allow404 */ true, INDEX_TIMEOUT_MS);
}
// Query calls stay on the original 5s budget (never block the chat waiting on
// a slow/unreachable vector DB). Indexing is an explicit, user-initiated,
// potentially large operation, so it gets a much longer budget.
const QUERY_TIMEOUT_MS = 5000;
const INDEX_TIMEOUT_MS = 30000;
function request(method, url, body, allow404 = false, timeoutMs = QUERY_TIMEOUT_MS) {
    return new Promise((resolve, reject) => {
        const parsed = new URL(url);
        const options = {
            hostname: parsed.hostname,
            port: parsed.port || (parsed.protocol === 'https:' ? 443 : 80),
            path: parsed.pathname + parsed.search,
            method,
            headers: body
                ? { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(body) }
                : {},
            timeout: timeoutMs,
        };
        const transport = url.startsWith('https://') ? https : http;
        const req = transport.request(options, (res) => {
            const chunks = [];
            res.on('data', (c) => chunks.push(c));
            res.on('end', () => {
                if (allow404 && res.statusCode === 404) {
                    resolve(null);
                    return;
                }
                if ((res.statusCode ?? 0) >= 400) {
                    reject(new Error(`RAG endpoint returned ${res.statusCode}: ${Buffer.concat(chunks).toString('utf8').slice(0, 300)}`));
                    return;
                }
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
        if (body) {
            req.write(body);
        }
        req.end();
    });
}
