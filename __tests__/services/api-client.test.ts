import * as http from 'http';
import { resolveModelId } from '../../src/services/api-client';

// Regression coverage for the bug hit while testing MLX + a local RAG
// embedding model side by side: mlx_lm.server's /v1/models scans the user's
// WHOLE Hugging Face cache (not just the model loaded via --model), so an
// unrelated cached model (e.g. an embedding model) can show up before the
// one actually running. resolveModelId must never swap out an explicit,
// correct model id typed by the user for something else on that list.
describe('resolveModelId', () => {
  let server: http.Server;
  let baseUrl: string;
  let modelIds: string[] = [];

  beforeAll(async () => {
    server = http.createServer((req, res) => {
      res.setHeader('Content-Type', 'application/json');
      res.end(JSON.stringify({ data: modelIds.map((id) => ({ id, object: 'model' })) }));
    });
    await new Promise<void>((resolve) => server.listen(0, resolve));
    const address = server.address();
    const port = typeof address === 'object' && address ? address.port : 0;
    baseUrl = `http://127.0.0.1:${port}/v1/chat/completions`;
  });

  afterAll(() => new Promise<void>((resolve) => server.close(() => resolve())));

  it('keeps the explicitly typed id even when an unrelated model is first in the cache scan', async () => {
    // e.g. an embedding model downloaded for RAG shows up before the chat model
    modelIds = ['mlx-community/all-MiniLM-L6-v2-4bit', 'mlx-community/Qwen2.5-Coder-14B-Instruct-4bit'];
    const resolved = await resolveModelId(baseUrl, {}, 'mlx-community/Qwen2.5-Coder-14B-Instruct-4bit');
    expect(resolved).toBe('mlx-community/Qwen2.5-Coder-14B-Instruct-4bit');
  });

  it('fills in a missing "org/" prefix by matching against the server list', async () => {
    modelIds = ['mlx-community/all-MiniLM-L6-v2-4bit', 'mlx-community/Qwen2.5-Coder-14B-Instruct-4bit'];
    const resolved = await resolveModelId(baseUrl, {}, 'Qwen2.5-Coder-14B-Instruct-4bit');
    expect(resolved).toBe('mlx-community/Qwen2.5-Coder-14B-Instruct-4bit');
  });

  it('falls back to the first server model when the field is left empty', async () => {
    modelIds = ['mlx-community/Qwen2.5-Coder-14B-Instruct-4bit'];
    const resolved = await resolveModelId(baseUrl, {}, '');
    expect(resolved).toBe('mlx-community/Qwen2.5-Coder-14B-Instruct-4bit');
  });

  it('returns the typed id verbatim when the server has no match at all', async () => {
    modelIds = ['mlx-community/all-MiniLM-L6-v2-4bit'];
    const resolved = await resolveModelId(baseUrl, {}, 'mlx-community/some-other-model');
    expect(resolved).toBe('mlx-community/some-other-model');
  });
});
