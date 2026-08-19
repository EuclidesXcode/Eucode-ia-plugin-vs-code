import * as http from 'http';
import { deletePointsBySource } from '../../src/services/rag-client';

// Regression coverage for the incremental-indexing anti-hallucination fix:
// before re-indexing a file (or when it's deleted), the plugin must delete
// every previously-indexed point for that path so stale content never shows
// up as RAG context again.
describe('deletePointsBySource', () => {
  let server: http.Server;
  let baseUrl: string;
  let lastRequest: { method?: string; path?: string; body: string } | null = null;
  let respondStatus = 200;

  beforeAll(async () => {
    server = http.createServer((req, res) => {
      const chunks: Buffer[] = [];
      req.on('data', (c) => chunks.push(c));
      req.on('end', () => {
        lastRequest = { method: req.method, path: req.url, body: Buffer.concat(chunks).toString('utf8') };
        res.statusCode = respondStatus;
        res.setHeader('Content-Type', 'application/json');
        res.end(JSON.stringify({ status: respondStatus === 200 ? 'ok' : 'error' }));
      });
    });
    await new Promise<void>((resolve) => server.listen(0, resolve));
    const address = server.address();
    const port = typeof address === 'object' && address ? address.port : 0;
    baseUrl = `http://127.0.0.1:${port}`;
  });

  afterAll(() => new Promise<void>((resolve) => server.close(() => resolve())));

  beforeEach(() => { lastRequest = null; respondStatus = 200; });

  it('POSTs a delete-by-filter request scoped to the given source path', async () => {
    await deletePointsBySource(baseUrl, 'my_collection', 'src/agent/loop.ts');
    expect(lastRequest?.method).toBe('POST');
    expect(lastRequest?.path).toBe('/collections/my_collection/points/delete?wait=true');
    const body = JSON.parse(lastRequest!.body);
    expect(body).toEqual({ filter: { must: [{ key: 'source', match: { value: 'src/agent/loop.ts' } }] } });
  });

  it('does not throw when the collection does not exist yet (404)', async () => {
    respondStatus = 404;
    await expect(deletePointsBySource(baseUrl, 'not_yet_created', 'src/x.ts')).resolves.toBeUndefined();
  });
});
