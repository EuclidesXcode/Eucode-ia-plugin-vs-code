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
// Queries a Chroma-compatible vector DB for relevant context.
// Supports Chroma v1 API (/api/v1/collections/{name}/query).
async function queryRag(endpoint, collection, query, nResults = 3) {
    try {
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
    catch {
        return [];
    }
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
