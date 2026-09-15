import { TavilyWebSearchProvider } from './tavily-web-search.provider';

describe('TavilyWebSearchProvider', () => {
  const originalEnv = process.env;
  const fetchMock = jest.fn();
  const originalFetch = global.fetch;

  beforeEach(() => {
    process.env = {
      ...originalEnv,
      NODE_ENV: 'test',
      WEB_SEARCH_PROVIDER: 'tavily',
      WEB_SEARCH_API_KEY: 'test-key',
      WEB_SEARCH_TIMEOUT_MS: '10000',
      WEB_SEARCH_MAX_RESULTS: '5',
    };
    fetchMock.mockReset();
    global.fetch = fetchMock as unknown as typeof fetch;
  });

  afterEach(() => {
    process.env = originalEnv;
    global.fetch = originalFetch;
  });
  it('calls Tavily with the normalized search request', async () => {
    fetchMock.mockResolvedValue(jsonResponse({
      query: 'CEES',
      results: [
        {
          title: 'CEES docs',
          url: 'https://example.com/docs',
          content: 'A useful result',
          published_date: '2026-09-14',
        },
      ],
    }));

    const provider = new TavilyWebSearchProvider();
    await expect(provider.search({
      query: 'CEES',
      recency: 'week',
      domains: ['example.com'],
      maxResults: 3,
    })).resolves.toEqual({
      query: 'CEES',
      provider: 'tavily',
      results: [{
        title: 'CEES docs',
        url: 'https://example.com/docs',
        domain: 'example.com',
        snippet: 'A useful result',
        publishedAt: '2026-09-14',
      }],
    });

    expect(fetchMock).toHaveBeenCalledWith(
      'https://api.tavily.com/search',
      expect.objectContaining({
        method: 'POST',
        headers: expect.objectContaining({ Accept: 'application/json' }),
        body: JSON.stringify({
          api_key: 'test-key',
          query: 'CEES',
          search_depth: 'basic',
          topic: 'general',
          time_range: 'week',
          include_domains: ['example.com'],
          max_results: 3,
          include_answer: false,
          include_raw_content: false,
          include_images: false,
        }),
      }),
    );
  });

  it('returns a configuration error without an API key', async () => {
    delete process.env.WEB_SEARCH_API_KEY;
    const provider = new TavilyWebSearchProvider();

    await expect(provider.search({
      query: 'CEES',
      recency: 'any',
      domains: [],
      maxResults: 5,
    })).rejects.toMatchObject({
      code: 'WEB_SEARCH_NOT_CONFIGURED',
      retryable: false,
    });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('maps non-success responses to an unavailable error', async () => {
    fetchMock.mockResolvedValue({ ok: false, status: 429 } as Response);
    const provider = new TavilyWebSearchProvider();

    await expect(provider.search({
      query: 'CEES',
      recency: 'any',
      domains: [],
      maxResults: 5,
    })).rejects.toMatchObject({
      code: 'WEB_SEARCH_UNAVAILABLE',
      retryable: true,
    });
  });

  it('maps invalid payloads to an invalid response error', async () => {
    fetchMock.mockResolvedValue(jsonResponse({ query: 'CEES' }));
    const provider = new TavilyWebSearchProvider();

    await expect(provider.search({
      query: 'CEES',
      recency: 'any',
      domains: [],
      maxResults: 5,
    })).rejects.toMatchObject({
      code: 'WEB_SEARCH_INVALID_RESPONSE',
      retryable: false,
    });
  });

  it('ignores malformed individual results while keeping the response valid', async () => {
    fetchMock.mockResolvedValue(jsonResponse({ results: [{ title: 'missing url' }] }));
    const provider = new TavilyWebSearchProvider();

    await expect(provider.search({
      query: 'CEES',
      recency: 'any',
      domains: [],
      maxResults: 5,
    })).resolves.toEqual({
      query: 'CEES',
      provider: 'tavily',
      results: [],
    });
  });

  it('maps timeout aborts to a retryable timeout error', async () => {
    process.env.WEB_SEARCH_TIMEOUT_MS = '1000';
    fetchMock.mockImplementation((_url: string, options: RequestInit) => new Promise((_resolve, reject) => {
      options.signal?.addEventListener('abort', () => reject(new DOMException('Aborted', 'AbortError')), { once: true });
    }));
    const provider = new TavilyWebSearchProvider();

    await expect(provider.search({
      query: 'CEES',
      recency: 'any',
      domains: [],
      maxResults: 5,
    })).rejects.toMatchObject({
      code: 'WEB_SEARCH_TIMEOUT',
      retryable: true,
    });
  });
});

function jsonResponse(body: unknown): Response {
  return {
    ok: true,
    status: 200,
    json: async () => body,
  } as Response;
}





