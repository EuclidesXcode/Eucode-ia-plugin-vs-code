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
exports.indexWorkspaceForRag = indexWorkspaceForRag;
exports.indexSingleFileForRag = indexSingleFileForRag;
exports.removeFileFromRag = removeFileFromRag;
exports.pointIdFor = pointIdFor;
exports.chunkText = chunkText;
exports.isIndexableFile = isIndexableFile;
const fs = __importStar(require("fs"));
const path = __importStar(require("path"));
const crypto = __importStar(require("crypto"));
const ignore_1 = require("../utils/ignore");
const constants_1 = require("../utils/constants");
const rag_client_1 = require("./rag-client");
// Populates a Qdrant collection from the workspace's text files, so the
// existing query path in rag-client.ts has something real to search.
// Qdrant is a pure vector store (no server-side text embedding, no built-in
// ingestion), so — unlike Chroma, which is normally fed by an external
// pipeline — the plugin has to do the whole read → chunk → embed → upsert
// cycle itself. Chroma indexing is intentionally out of scope here.
//
// Two entry points share the same per-file logic (indexFileContent):
//   - indexWorkspaceForRag: full scan, triggered manually by the user.
//   - indexSingleFileForRag: one file, triggered automatically on save, so
//     the RAG context stays close to what's actually on disk instead of
//     drifting stale — a file the agent already edited should show up (not
//     its pre-edit version) the next time RAG context is queried.
// removeFileFromRag handles the other half: a file that's deleted or renamed
// must stop being served as context, or the agent ends up "remembering"
// code that isn't there anymore — a direct source of hallucinated answers.
const MAX_FILES_INDEXED = 500; // same order of magnitude as ProjectIntelService's cap
const MAX_FILE_BYTES = 300 * 1024; // skip generated/huge files
const CHUNK_CHARS = 1200; // ~300 tokens; keeps each point small enough for a local model's context
const CHUNK_OVERLAP = 150;
const EMBED_BATCH_SIZE = 16; // how many chunks are embedded/upserted per round-trip batch
function assertQdrantIndexable(opts) {
    if (opts.provider !== 'qdrant') {
        throw new Error('Indexacao automatica so e suportada para o backend Qdrant. Chroma espera ser populado por um pipeline externo (ele embeda o texto no proprio servidor).');
    }
    if (!opts.embedHost || !opts.embedModel) {
        throw new Error('Configure o host e o modelo de embeddings (Qdrant nao embeda texto sozinho).');
    }
}
async function indexWorkspaceForRag(opts) {
    assertQdrantIndexable(opts);
    const files = collectFiles(opts.workspaceRoot);
    const progress = { filesScanned: files.length, filesIndexed: 0, chunksIndexed: 0, chunksSkipped: 0 };
    // Fail fast (and learn the vector size) instead of silently timing out on
    // every chunk of every file when the embedding server is unreachable.
    const probeVector = await (0, rag_client_1.embedText)(opts.embedHost, opts.embedModel, 'eucode-ia rag probe');
    if (probeVector.length === 0) {
        throw new Error(`Nao foi possivel gerar embeddings em ${opts.embedHost} com o modelo "${opts.embedModel}". Confirme que o servidor esta no ar e que o modelo existe.`);
    }
    await (0, rag_client_1.ensureQdrantCollection)(opts.endpoint, opts.collection, probeVector.length);
    let collectionEnsured = true;
    for (const file of files) {
        const relPath = path.relative(opts.workspaceRoot, file);
        let content;
        try {
            content = fs.readFileSync(file, 'utf8');
        }
        catch {
            continue;
        }
        const result = await indexFileContent(opts, relPath, content, () => collectionEnsured, (v) => { collectionEnsured = v; });
        progress.chunksIndexed += result.chunksIndexed;
        progress.chunksSkipped += result.chunksSkipped;
        progress.filesIndexed += 1;
        opts.onProgress?.(progress);
    }
    return progress;
}
// Re-indexes a single file — called on save so the RAG context tracks the
// file's current content instead of whatever it looked like at the last full
// index. Returns null (no-op) for files that wouldn't be indexed anyway
// (ignored, binary, empty, too large, outside the workspace).
async function indexSingleFileForRag(opts, absolutePath) {
    assertQdrantIndexable(opts);
    const relPath = path.relative(opts.workspaceRoot, absolutePath);
    if (relPath.startsWith('..') || !isIndexableFile(opts.workspaceRoot, absolutePath, relPath)) {
        return null;
    }
    let content;
    try {
        content = fs.readFileSync(absolutePath, 'utf8');
    }
    catch {
        return null;
    }
    let collectionEnsured = false;
    return indexFileContent(opts, relPath, content, () => collectionEnsured, (v) => { collectionEnsured = v; });
}
// Removes a file's points from the collection — called on delete/rename so a
// file that no longer exists on disk stops being served as RAG context.
async function removeFileFromRag(opts, absolutePath) {
    if (opts.provider !== 'qdrant') {
        return;
    }
    const relPath = path.relative(opts.workspaceRoot, absolutePath);
    if (relPath.startsWith('..')) {
        return;
    }
    await (0, rag_client_1.deletePointsBySource)(opts.endpoint, opts.collection, relPath);
}
// Shared read→chunk→embed→upsert cycle for one file's content. Always clears
// out any previously-indexed points for this path first (wait=true, so the
// delete is visible to the very next query) — cheap on a local Qdrant, and it
// means an edit that shortens a file can never leave orphaned chunks from the
// longer, stale version sitting in the index.
async function indexFileContent(opts, relPath, content, isCollectionEnsured, setCollectionEnsured) {
    const result = { chunksIndexed: 0, chunksSkipped: 0 };
    await (0, rag_client_1.deletePointsBySource)(opts.endpoint, opts.collection, relPath);
    if (!content.trim()) {
        return result;
    }
    const chunks = chunkText(content);
    const points = [];
    for (let i = 0; i < chunks.length; i++) {
        let vector;
        try {
            vector = await (0, rag_client_1.embedText)(opts.embedHost, opts.embedModel, chunks[i]);
        }
        catch {
            // A single bad chunk (malformed response, transient network error,
            // degenerate embedding) must not abort the rest of the indexing run.
            vector = [];
        }
        if (vector.length === 0) {
            result.chunksSkipped += 1;
            continue;
        }
        if (!isCollectionEnsured()) {
            await (0, rag_client_1.ensureQdrantCollection)(opts.endpoint, opts.collection, vector.length);
            setCollectionEnsured(true);
        }
        points.push({ id: pointIdFor(relPath, i), vector, payload: { content: chunks[i], source: relPath } });
        if (points.length >= EMBED_BATCH_SIZE) {
            await (0, rag_client_1.upsertQdrantPoints)(opts.endpoint, opts.collection, points.splice(0, points.length));
        }
    }
    if (points.length > 0) {
        await (0, rag_client_1.upsertQdrantPoints)(opts.endpoint, opts.collection, points);
    }
    result.chunksIndexed = chunks.length - result.chunksSkipped;
    return result;
}
// Deterministic UUID from the file path + chunk index, so re-indexing a file
// overwrites its previous points instead of piling up duplicates.
function pointIdFor(relPath, chunkIndex) {
    const hash = crypto.createHash('md5').update(`${relPath}::${chunkIndex}`).digest('hex');
    return `${hash.slice(0, 8)}-${hash.slice(8, 12)}-${hash.slice(12, 16)}-${hash.slice(16, 20)}-${hash.slice(20, 32)}`;
}
function chunkText(text) {
    if (text.length <= CHUNK_CHARS) {
        return [text];
    }
    const chunks = [];
    let start = 0;
    while (start < text.length) {
        const end = Math.min(start + CHUNK_CHARS, text.length);
        chunks.push(text.slice(start, end));
        if (end >= text.length) {
            break;
        }
        start = end - CHUNK_OVERLAP;
    }
    return chunks;
}
function isIndexableFile(root, absolutePath, relPath) {
    // isIgnored() only checks the leaf entry name against IGNORED_DIRS — fine
    // during a top-down walk (it skips the whole directory the moment it's
    // hit, so files inside are never reached individually), but this is
    // called directly on a leaf file from a save/delete event, so an ignored
    // ancestor (e.g. "node_modules/dep.ts") has to be checked explicitly.
    if (relPath.split(path.sep).some((segment) => constants_1.IGNORED_DIRS.has(segment))) {
        return false;
    }
    const name = path.basename(absolutePath);
    if ((0, ignore_1.isIgnored)(name, relPath, root)) {
        return false;
    }
    const ext = path.extname(name).toLowerCase();
    if (constants_1.BINARY_EXTS.has(ext)) {
        return false;
    }
    try {
        const stat = fs.statSync(absolutePath);
        if (!stat.isFile() || stat.size === 0 || stat.size > MAX_FILE_BYTES) {
            return false;
        }
    }
    catch {
        return false;
    }
    return true;
}
function collectFiles(root) {
    const out = [];
    walk(root, root, out);
    return out;
}
function walk(root, dir, out) {
    if (out.length >= MAX_FILES_INDEXED) {
        return;
    }
    let entries;
    try {
        entries = fs.readdirSync(dir, { withFileTypes: true });
    }
    catch {
        return;
    }
    for (const entry of entries) {
        if (out.length >= MAX_FILES_INDEXED) {
            return;
        }
        const full = path.join(dir, entry.name);
        const rel = path.relative(root, full);
        if ((0, ignore_1.isIgnored)(entry.name, rel, root)) {
            continue;
        }
        if (entry.isDirectory()) {
            walk(root, full, out);
            continue;
        }
        const ext = path.extname(entry.name).toLowerCase();
        if (constants_1.BINARY_EXTS.has(ext)) {
            continue;
        }
        try {
            const stat = fs.statSync(full);
            if (stat.size === 0 || stat.size > MAX_FILE_BYTES) {
                continue;
            }
        }
        catch {
            continue;
        }
        out.push(full);
    }
}
