import * as http from 'http';
import * as https from 'https';

export type RagProvider = 'chroma' | 'qdrant';

export interface RagResult {
    content: string;
    source: string;
    score?: number;
}

export interface RagQueryOptions {
    provider: RagProvider;
    endpoint: string;
    collection: string;
    query: string;
    nResults?: number;
    // Qdrant only: the self-hosted image does NOT embed text, so the plugin
    // must turn the query into a vector first. These point at an OpenAI-compatible
    // /v1/embeddings endpoint (typically the same LM Studio host used for chat).
    embedHost?: string;
    embedModel?: string;
}

// Queries a vector DB for relevant context. Dispatches by provider:
//   - chroma: sends raw text; Chroma embeds server-side (/api/v1 query API).
//   - qdrant: embeds the query locally first (LM Studio /v1/embeddings), then
//     runs a vector search. The official self-hosted Qdrant image has no
//     built-in inference, so server-side text embedding is not available.
export async function queryRag(opts: RagQueryOptions): Promise<RagResult[]> {
    const nResults = opts.nResults ?? 3;
    try {
        if (opts.provider === 'qdrant') {
            return await queryQdrant(opts, nResults);
        }
        return await queryChroma(opts.endpoint, opts.collection, opts.query, nResults);
    } catch {
        return [];
    }
}

// ── Chroma (raw text, server embeds) ──────────────────────────────────────
async function queryChroma(
    endpoint: string,
    collection: string,
    query: string,
    nResults: number
): Promise<RagResult[]> {
    const url = `${endpoint}/api/v1/collections/${encodeURIComponent(collection)}/query`;
    const body = JSON.stringify({
        query_texts: [query],
        n_results: nResults,
        include: ['documents', 'metadatas', 'distances'],
    });

    const results = await request('POST', url, body);
    const documents: string[][] = (results as any)?.documents ?? [];
    const metadatas: any[][] = (results as any)?.metadatas ?? [];
    const distances: number[][] = (results as any)?.distances ?? [];

    return (documents[0] ?? []).map((doc, i) => ({
        content: doc,
        source: metadatas[0]?.[i]?.source ?? metadatas[0]?.[i]?.filename ?? 'unknown',
        score: distances[0]?.[i],
    }));
}

// ── Qdrant (embed locally, then vector search) ────────────────────────────
async function queryQdrant(opts: RagQueryOptions, nResults: number): Promise<RagResult[]> {
    if (!opts.embedHost || !opts.embedModel) {
        // Without an embedding endpoint we can't turn the query into a vector,
        // and self-hosted Qdrant won't do it for us. Degrade silently to no context.
        return [];
    }

    const vector = await embedText(opts.embedHost, opts.embedModel, opts.query);
    if (!vector || vector.length === 0) { return []; }

    const url = `${opts.endpoint}/collections/${encodeURIComponent(opts.collection)}/points/query`;
    const body = JSON.stringify({
        query: vector,
        limit: nResults,
        with_payload: true,
    });

    const res = await request('POST', url, body);
    const points: any[] = (res as any)?.result?.points ?? (res as any)?.result ?? [];
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
export async function embedText(host: string, model: string, text: string): Promise<number[]> {
    const url = `${host.replace(/\/+$/, '')}/v1/embeddings`;
    const body = JSON.stringify({ model, input: text });
    const res = await request('POST', url, body);
    const vector = (res as any)?.data?.[0]?.embedding;
    // Degenerate input (e.g. a chunk that's almost all punctuation/regex) can
    // make some local embedding models emit NaN/Infinity. Treat it the same
    // as "no vector" so one bad chunk doesn't take down a whole indexing run.
    return isValidEmbeddingVector(vector) ? vector : [];
}

export function isValidEmbeddingVector(vector: unknown): vector is number[] {
    return Array.isArray(vector) && vector.length > 0 && vector.every((n) => typeof n === 'number' && Number.isFinite(n));
}

export function formatRagContext(results: RagResult[]): string {
    if (results.length === 0) { return ''; }
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
export async function ensureQdrantCollection(endpoint: string, collection: string, vectorSize: number): Promise<void> {
    const base = endpoint.replace(/\/+$/, '');
    const existing = await request('GET', `${base}/collections/${encodeURIComponent(collection)}`, undefined, /* allow404 */ true, INDEX_TIMEOUT_MS);
    if (existing !== null) { return; }
    await request('PUT', `${base}/collections/${encodeURIComponent(collection)}`, JSON.stringify({
        vectors: { size: vectorSize, distance: 'Cosine' },
    }), false, INDEX_TIMEOUT_MS);
}

export interface QdrantPoint {
    id: string;
    vector: number[];
    payload: { content: string; source: string };
}

// Upserts a batch of points. Points reuse a deterministic id (see
// rag-indexer.ts) so re-indexing the same chunk overwrites it in place
// instead of accumulating duplicates.
export async function upsertQdrantPoints(endpoint: string, collection: string, points: QdrantPoint[]): Promise<void> {
    if (points.length === 0) { return; }
    const base = endpoint.replace(/\/+$/, '');
    await request('PUT', `${base}/collections/${encodeURIComponent(collection)}/points?wait=true`, JSON.stringify({ points }), false, INDEX_TIMEOUT_MS);
}

// Deletes every point whose payload.source matches the given path. Used before
// re-indexing a single file (so an edit that shrinks the file doesn't leave
// stale chunks from the old, longer version behind) and when a file is
// deleted/renamed (so the RAG context never serves content from a file that
// no longer exists — that's a direct source of hallucinated answers).
// No-op (not an error) if the collection doesn't exist yet.
export async function deletePointsBySource(endpoint: string, collection: string, source: string): Promise<void> {
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

function request(method: string, url: string, body?: string, allow404 = false, timeoutMs = QUERY_TIMEOUT_MS): Promise<unknown> {
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
            const chunks: Buffer[] = [];
            res.on('data', (c: Buffer) => chunks.push(c));
            res.on('end', () => {
                if (allow404 && res.statusCode === 404) { resolve(null); return; }
                if ((res.statusCode ?? 0) >= 400) {
                    reject(new Error(`RAG endpoint returned ${res.statusCode}: ${Buffer.concat(chunks).toString('utf8').slice(0, 300)}`));
                    return;
                }
                try { resolve(JSON.parse(Buffer.concat(chunks).toString('utf8'))); }
                catch { reject(new Error('Invalid JSON from RAG endpoint')); }
            });
        });
        req.on('timeout', () => { req.destroy(); reject(new Error('RAG timeout')); });
        req.on('error', reject);
        if (body) { req.write(body); }
        req.end();
    });
}
