import * as http from 'http';
import * as https from 'https';

export interface RagResult {
    content: string;
    source: string;
    score?: number;
}

// Queries a Chroma-compatible vector DB for relevant context.
// Supports Chroma v1 API (/api/v1/collections/{name}/query).
export async function queryRag(
    endpoint: string,
    collection: string,
    query: string,
    nResults: number = 3
): Promise<RagResult[]> {
    try {
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
    } catch {
        return [];
    }
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
