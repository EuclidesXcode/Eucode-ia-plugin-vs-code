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

    const results = await post(url, body);
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

    const res = await post(url, body);
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
async function embedText(host: string, model: string, text: string): Promise<number[]> {
    const url = `${host.replace(/\/+$/, '')}/v1/embeddings`;
    const body = JSON.stringify({ model, input: text });
    const res = await post(url, body);
    const vector = (res as any)?.data?.[0]?.embedding;
    return Array.isArray(vector) ? vector : [];
}

export function formatRagContext(results: RagResult[]): string {
    if (results.length === 0) { return ''; }
    const lines = results.map(r => `# ${r.source}\n${r.content}`);
    return `# RELEVANT CONTEXT FROM VECTOR DB\n${lines.join('\n\n')}`;
}

function post(url: string, body: string): Promise<unknown> {
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
            const chunks: Buffer[] = [];
            res.on('data', (c: Buffer) => chunks.push(c));
            res.on('end', () => {
                try { resolve(JSON.parse(Buffer.concat(chunks).toString('utf8'))); }
                catch { reject(new Error('Invalid JSON from RAG endpoint')); }
            });
        });
        req.on('timeout', () => { req.destroy(); reject(new Error('RAG timeout')); });
        req.on('error', reject);
        req.write(body);
        req.end();
    });
}
