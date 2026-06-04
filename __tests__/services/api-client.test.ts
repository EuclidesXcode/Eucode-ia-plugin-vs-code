import { callAI, callAIWithVision, checkConnection } from '../../src/services/api-client';

describe('api-client exports', () => {
  it('exports the API helper functions used by the extension', () => {
    expect(typeof callAI).toBe('function');
    expect(typeof callAIWithVision).toBe('function');
    expect(typeof checkConnection).toBe('function');
  });

  it('returns an aborted response when callAI receives an already aborted signal', async () => {
    const controller = new AbortController();
    controller.abort();

    const result = await callAI(
      'http://localhost:1234/v1/chat/completions',
      {},
      [],
      [],
      'test-model',
      controller.signal
    );

    expect(result).toEqual({ responseText: '__ABORTED__' });
  });
});
