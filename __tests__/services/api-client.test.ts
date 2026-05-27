import { ApiClient } from '../../src/services/api-client';

// Mockar a dependência de fetch ou qualquer chamada de rede externa se necessário
jest.mock('node-fetch', () => jest.fn());

describe('ApiClient', () => {
  let apiClient; // Removido o tipo explícito para evitar erro de sintaxe no ambiente de teste

  beforeEach(() => {
    // Inicializa o cliente antes de cada teste
    apiClient = new ApiClient();
    jest.clearAllMocks();
  });

  it('should initialize correctly', () => {
    expect(apiClient).toBeInstanceOf(ApiClient);
  });

  describe('fetchData', () => {
    const mockFetch = jest.fn();

    beforeEach(() => {
      // Mocka a função de fetch para simular respostas HTTP
      mockFetch.mockResolvedValue({
        ok: true,
        json: () => Promise.resolve({ message: 'Success' }),
      });
    });

    it('should fetch data successfully and return the parsed JSON', async () => {
      // Mocka a função global de fetch para o escopo do teste
      global.fetch = mockFetch;

      const result = await apiClient.fetchData('https://api.example.com/data');
      
      expect(global.fetch).toHaveBeenCalledWith('https://api.example.com/data', expect.any(Object));
      expect(result).toEqual({ message: 'Success' });
    });

    it('should handle network errors gracefully', async () => {
      // Simula um erro de rede
      global.fetch = jest.fn(() => Promise.reject(new Error('Network Failure')));

      await expect(apiClient.fetchData('http://error')).rejects.toThrow('Network Failure');
    });

    it('should handle non-2xx status codes', async () => {
        // Simula uma resposta de erro HTTP (ex: 404)
        global.fetch = jest.fn(() => Promise.resolve({
            ok: false,
            status: 404,
            json: () => Promise.resolve({ error: 'Not Found' }),
        }));

        await expect(apiClient.fetchData('http://notfound')).rejects.toEqual({ status: 404, message: 'Request failed with status code 404' });
    });
  });
});