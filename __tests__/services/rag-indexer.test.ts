import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { chunkText, pointIdFor, isIndexableFile } from '../../src/services/rag-indexer';
import { isValidEmbeddingVector } from '../../src/services/rag-client';

describe('rag-indexer chunking', () => {
  it('keeps short text as a single chunk', () => {
    expect(chunkText('hello world')).toEqual(['hello world']);
  });

  it('splits long text into overlapping chunks that cover the whole text', () => {
    const text = 'a'.repeat(3000);
    const chunks = chunkText(text);
    expect(chunks.length).toBeGreaterThan(1);
    // every char position is covered by some chunk
    expect(chunks.join('').length).toBeGreaterThanOrEqual(text.length);
    // consecutive chunks overlap (last chars of one reappear at the start of the next)
    expect(chunks[1].startsWith(chunks[0].slice(-50))).toBe(true);
  });
});

describe('rag-indexer point ids', () => {
  it('is deterministic for the same file + chunk index', () => {
    expect(pointIdFor('src/foo.ts', 0)).toBe(pointIdFor('src/foo.ts', 0));
  });

  it('differs across chunk index and file path (so points do not collide)', () => {
    expect(pointIdFor('src/foo.ts', 0)).not.toBe(pointIdFor('src/foo.ts', 1));
    expect(pointIdFor('src/foo.ts', 0)).not.toBe(pointIdFor('src/bar.ts', 0));
  });

  it('produces a valid UUID shape (required by the Qdrant points API)', () => {
    expect(pointIdFor('src/foo.ts', 3)).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/);
  });
});

describe('isIndexableFile (gate for on-save incremental indexing)', () => {
  let root: string;

  beforeAll(() => {
    root = fs.mkdtempSync(path.join(os.tmpdir(), 'eucode-rag-test-'));
    fs.mkdirSync(path.join(root, 'node_modules'), { recursive: true });
    fs.writeFileSync(path.join(root, 'ok.ts'), 'export const x = 1;');
    fs.writeFileSync(path.join(root, 'empty.ts'), '');
    fs.writeFileSync(path.join(root, 'icon.png'), Buffer.from([0x89, 0x50, 0x4e, 0x47]));
    fs.writeFileSync(path.join(root, 'node_modules', 'dep.ts'), 'export const y = 1;');
  });

  afterAll(() => fs.rmSync(root, { recursive: true, force: true }));

  it('accepts a normal text file', () => {
    expect(isIndexableFile(root, path.join(root, 'ok.ts'), 'ok.ts')).toBe(true);
  });

  it('rejects an empty file (nothing to embed)', () => {
    expect(isIndexableFile(root, path.join(root, 'empty.ts'), 'empty.ts')).toBe(false);
  });

  it('rejects a binary extension', () => {
    expect(isIndexableFile(root, path.join(root, 'icon.png'), 'icon.png')).toBe(false);
  });

  it('rejects a file inside an ignored directory (node_modules)', () => {
    const p = path.join(root, 'node_modules', 'dep.ts');
    expect(isIndexableFile(root, p, 'node_modules/dep.ts')).toBe(false);
  });

  it('rejects a path that does not exist (e.g. already deleted)', () => {
    const p = path.join(root, 'missing.ts');
    expect(isIndexableFile(root, p, 'missing.ts')).toBe(false);
  });
});

describe('embedding vector validation', () => {
  it('accepts a normal finite vector', () => {
    expect(isValidEmbeddingVector([0.1, -0.2, 0.3])).toBe(true);
  });

  it('rejects a vector containing NaN (degenerate embedding from the model)', () => {
    expect(isValidEmbeddingVector([0.1, NaN, 0.3])).toBe(false);
  });

  it('rejects a vector containing Infinity', () => {
    expect(isValidEmbeddingVector([0.1, Infinity, 0.3])).toBe(false);
  });

  it('rejects non-array or empty input', () => {
    expect(isValidEmbeddingVector(undefined)).toBe(false);
    expect(isValidEmbeddingVector([])).toBe(false);
  });
});
