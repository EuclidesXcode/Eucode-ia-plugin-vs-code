import * as fs from 'fs';
import * as path from 'path';
import * as crypto from 'crypto';
import { isIgnored } from '../utils/ignore';
import { BINARY_EXTS, IGNORED_DIRS } from '../utils/constants';
import { embedText, ensureQdrantCollection, upsertQdrantPoints, deletePointsBySource, RagProvider, QdrantPoint } from './rag-client';

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

const MAX_FILES_INDEXED = 500;       // same order of magnitude as ProjectIntelService's cap
const MAX_FILE_BYTES = 300 * 1024;   // skip generated/huge files
const CHUNK_CHARS = 1200;            // ~300 tokens; keeps each point small enough for a local model's context
const CHUNK_OVERLAP = 150;
const EMBED_BATCH_SIZE = 16;         // how many chunks are embedded/upserted per round-trip batch

export interface IndexProgress {
    filesScanned: number;
    filesIndexed: number;
    chunksIndexed: number;
    chunksSkipped: number;
}

export interface IndexOptions {
    workspaceRoot: string;
    provider: RagProvider;
    endpoint: string;
    collection: string;
    embedHost: string;
    embedModel: string;
    onProgress?: (progress: IndexProgress) => void;
}

function assertQdrantIndexable(opts: Pick<IndexOptions, 'provider' | 'embedHost' | 'embedModel'>): void {
    if (opts.provider !== 'qdrant') {
        throw new Error('Indexacao automatica so e suportada para o backend Qdrant. Chroma espera ser populado por um pipeline externo (ele embeda o texto no proprio servidor).');
    }
    if (!opts.embedHost || !opts.embedModel) {
        throw new Error('Configure o host e o modelo de embeddings (Qdrant nao embeda texto sozinho).');
    }
}

export async function indexWorkspaceForRag(opts: IndexOptions): Promise<IndexProgress> {
    assertQdrantIndexable(opts);

    const files = collectFiles(opts.workspaceRoot);
    const progress: IndexProgress = { filesScanned: files.length, filesIndexed: 0, chunksIndexed: 0, chunksSkipped: 0 };

    // Fail fast (and learn the vector size) instead of silently timing out on
    // every chunk of every file when the embedding server is unreachable.
    const probeVector = await embedText(opts.embedHost, opts.embedModel, 'eucode-ia rag probe');
    if (probeVector.length === 0) {
        throw new Error(`Nao foi possivel gerar embeddings em ${opts.embedHost} com o modelo "${opts.embedModel}". Confirme que o servidor esta no ar e que o modelo existe.`);
    }
    await ensureQdrantCollection(opts.endpoint, opts.collection, probeVector.length);
    let collectionEnsured = true;

    for (const file of files) {
        const relPath = path.relative(opts.workspaceRoot, file);
        let content: string;
        try {
            content = fs.readFileSync(file, 'utf8');
        } catch {
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
export async function indexSingleFileForRag(opts: IndexOptions, absolutePath: string): Promise<{ chunksIndexed: number; chunksSkipped: number } | null> {
    assertQdrantIndexable(opts);

    const relPath = path.relative(opts.workspaceRoot, absolutePath);
    if (relPath.startsWith('..') || !isIndexableFile(opts.workspaceRoot, absolutePath, relPath)) { return null; }

    let content: string;
    try {
        content = fs.readFileSync(absolutePath, 'utf8');
    } catch {
        return null;
    }
    let collectionEnsured = false;
    return indexFileContent(opts, relPath, content, () => collectionEnsured, (v) => { collectionEnsured = v; });
}

// Removes a file's points from the collection — called on delete/rename so a
// file that no longer exists on disk stops being served as RAG context.
export async function removeFileFromRag(opts: Pick<IndexOptions, 'provider' | 'endpoint' | 'collection' | 'workspaceRoot'>, absolutePath: string): Promise<void> {
    if (opts.provider !== 'qdrant') { return; }
    const relPath = path.relative(opts.workspaceRoot, absolutePath);
    if (relPath.startsWith('..')) { return; }
    await deletePointsBySource(opts.endpoint, opts.collection, relPath);
}

// Shared read→chunk→embed→upsert cycle for one file's content. Always clears
// out any previously-indexed points for this path first (wait=true, so the
// delete is visible to the very next query) — cheap on a local Qdrant, and it
// means an edit that shortens a file can never leave orphaned chunks from the
// longer, stale version sitting in the index.
async function indexFileContent(
    opts: IndexOptions,
    relPath: string,
    content: string,
    isCollectionEnsured: () => boolean,
    setCollectionEnsured: (v: boolean) => void,
): Promise<{ chunksIndexed: number; chunksSkipped: number }> {
    const result = { chunksIndexed: 0, chunksSkipped: 0 };
    await deletePointsBySource(opts.endpoint, opts.collection, relPath);
    if (!content.trim()) { return result; }

    const chunks = chunkText(content);
    const points: QdrantPoint[] = [];
    for (let i = 0; i < chunks.length; i++) {
        let vector: number[];
        try {
            vector = await embedText(opts.embedHost, opts.embedModel, chunks[i]);
        } catch {
            // A single bad chunk (malformed response, transient network error,
            // degenerate embedding) must not abort the rest of the indexing run.
            vector = [];
        }
        if (vector.length === 0) { result.chunksSkipped += 1; continue; }
        if (!isCollectionEnsured()) {
            await ensureQdrantCollection(opts.endpoint, opts.collection, vector.length);
            setCollectionEnsured(true);
        }
        points.push({ id: pointIdFor(relPath, i), vector, payload: { content: chunks[i], source: relPath } });
        if (points.length >= EMBED_BATCH_SIZE) {
            await upsertQdrantPoints(opts.endpoint, opts.collection, points.splice(0, points.length));
        }
    }
    if (points.length > 0) { await upsertQdrantPoints(opts.endpoint, opts.collection, points); }
    result.chunksIndexed = chunks.length - result.chunksSkipped;
    return result;
}

// Deterministic UUID from the file path + chunk index, so re-indexing a file
// overwrites its previous points instead of piling up duplicates.
export function pointIdFor(relPath: string, chunkIndex: number): string {
    const hash = crypto.createHash('md5').update(`${relPath}::${chunkIndex}`).digest('hex');
    return `${hash.slice(0, 8)}-${hash.slice(8, 12)}-${hash.slice(12, 16)}-${hash.slice(16, 20)}-${hash.slice(20, 32)}`;
}

export function chunkText(text: string): string[] {
    if (text.length <= CHUNK_CHARS) { return [text]; }
    const chunks: string[] = [];
    let start = 0;
    while (start < text.length) {
        const end = Math.min(start + CHUNK_CHARS, text.length);
        chunks.push(text.slice(start, end));
        if (end >= text.length) { break; }
        start = end - CHUNK_OVERLAP;
    }
    return chunks;
}

export function isIndexableFile(root: string, absolutePath: string, relPath: string): boolean {
    // isIgnored() only checks the leaf entry name against IGNORED_DIRS — fine
    // during a top-down walk (it skips the whole directory the moment it's
    // hit, so files inside are never reached individually), but this is
    // called directly on a leaf file from a save/delete event, so an ignored
    // ancestor (e.g. "node_modules/dep.ts") has to be checked explicitly.
    if (relPath.split(path.sep).some((segment) => IGNORED_DIRS.has(segment))) { return false; }
    const name = path.basename(absolutePath);
    if (isIgnored(name, relPath, root)) { return false; }
    const ext = path.extname(name).toLowerCase();
    if (BINARY_EXTS.has(ext)) { return false; }
    try {
        const stat = fs.statSync(absolutePath);
        if (!stat.isFile() || stat.size === 0 || stat.size > MAX_FILE_BYTES) { return false; }
    } catch {
        return false;
    }
    return true;
}

function collectFiles(root: string): string[] {
    const out: string[] = [];
    walk(root, root, out);
    return out;
}

function walk(root: string, dir: string, out: string[]): void {
    if (out.length >= MAX_FILES_INDEXED) { return; }
    let entries: fs.Dirent[];
    try {
        entries = fs.readdirSync(dir, { withFileTypes: true });
    } catch {
        return;
    }
    for (const entry of entries) {
        if (out.length >= MAX_FILES_INDEXED) { return; }
        const full = path.join(dir, entry.name);
        const rel = path.relative(root, full);
        if (isIgnored(entry.name, rel, root)) { continue; }
        if (entry.isDirectory()) {
            walk(root, full, out);
            continue;
        }
        const ext = path.extname(entry.name).toLowerCase();
        if (BINARY_EXTS.has(ext)) { continue; }
        try {
            const stat = fs.statSync(full);
            if (stat.size === 0 || stat.size > MAX_FILE_BYTES) { continue; }
        } catch {
            continue;
        }
        out.push(full);
    }
}
