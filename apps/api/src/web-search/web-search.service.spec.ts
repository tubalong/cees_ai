import { WebSearchService } from './web-search.service';
import type { WebSearchProvider } from './web-search.types';

describe('WebSearchService', () => {
  const originalEnv = process.env;
  let provider: jest.Mocked<WebSearchProvider>;

  beforeEach(() => {
    process.env = {
      ...originalEnv,
      NODE_ENV: 'test',
      WEB_SEARCH_PROVIDER: 'tavily',
      WEB_SEARCH_API_KEY: 'test-key',
      WEB_SEARCH_MAX_RESULTS: '2',
      WEB_SEARCH_MAX_SNIPPET_CHARS: '100',
    };
    provider = {
      name: 'tavily',
      search: jest.fn(),
    };
  });

  afterEach(() => {
    process.env = originalEnv;
  });

  it('normalizes, deduplicates, truncates, and caps results', async () => {
    provider.search.mockResolvedValue({
      query: ' CEES ',
      provider: 'tavily',
      results: [
        {
          title: ' First ',
          url: 'https://example.com/a',
          domain: '',
          snippet: 'x'.repeat(120),
          publishedAt: '2026-09-14',
        },
        {
          title: 'Duplicate',
          url: 'https://example.com/a',
          domain: 'example.com',
          snippet: 'duplicate',
          publishedAt: null,
        },
        {
          title: 'Second',
          url: 'https://example.com/b',
          domain: 'example.com',
          snippet: 'second',
          publishedAt: 'not-a-date',
        },
        {
          title: 'Third',
          url: 'https://example.com/c',
          domain: 'example.com',
          snippet: 'third',
          publishedAt: null,
        },
      ],
    });

    const service = new WebSearchService(provider);
    await expect(service.search({
      query: ' CEES ',
      recency: 'any',
      domains: [],
      maxResults: 10,
    })).resolves.toEqual({
      query: 'CEES',
      provider: 'tavily',
      results: [
        {
          title: 'First',
          url: 'https://example.com/a',
          domain: 'example.com',
          snippet: 'x'.repeat(99) + '…',
          publishedAt: '2026-09-14T00:00:00.000Z',
        },
        {
          title: 'Second',
          url: 'https://example.com/b',
          domain: 'example.com',
          snippet: 'second',
          publishedAt: null,
        },
      ],
    });
  });

  it('passes the caller signal to the provider', async () => {
    const signal = new AbortController().signal;
    provider.search.mockResolvedValue({ query: 'q', provider: 'tavily', results: [] });
    const service = new WebSearchService(provider);

    await service.search({ query: 'q', recency: 'any', domains: [], maxResults: undefined }, signal);
    expect(provider.search).toHaveBeenCalledWith(expect.anything(), signal);
  });
});



