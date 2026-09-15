import { loadWebSearchConfig } from './web-search.config';

describe('loadWebSearchConfig', () => {
  const originalEnv = process.env;

  beforeEach(() => {
    process.env = {
      ...originalEnv,
      NODE_ENV: 'test',
      WEB_SEARCH_PROVIDER: 'tavily',
      WEB_SEARCH_API_KEY: 'test-key',
      WEB_SEARCH_TIMEOUT_MS: '8000',
      WEB_SEARCH_MAX_RESULTS: '7',
      WEB_SEARCH_MAX_SNIPPET_CHARS: '1200',
    };
  });

  afterEach(() => {
    process.env = originalEnv;
  });

  it('loads the Tavily configuration', () => {
    expect(loadWebSearchConfig()).toEqual({
      provider: 'tavily',
      apiKey: 'test-key',
      timeoutMs: 8000,
      maxResults: 7,
      maxSnippetChars: 1200,
    });
  });

  it('defaults the provider and optional limits', () => {
    delete process.env.WEB_SEARCH_PROVIDER;
    delete process.env.WEB_SEARCH_TIMEOUT_MS;
    delete process.env.WEB_SEARCH_MAX_RESULTS;
    delete process.env.WEB_SEARCH_MAX_SNIPPET_CHARS;

    expect(loadWebSearchConfig()).toEqual(expect.objectContaining({
      provider: 'tavily',
      timeoutMs: 10_000,
      maxResults: 5,
      maxSnippetChars: 1_500,
    }));
  });

  it('rejects providers other than Tavily in this release', () => {
    process.env.WEB_SEARCH_PROVIDER = 'brave';
    expect(() => loadWebSearchConfig()).toThrow('WEB_SEARCH_PROVIDER must be tavily');
  });

  it('rejects missing or example credentials in production', () => {
    process.env.NODE_ENV = 'production';
    process.env.WEB_SEARCH_API_KEY = 'change_me';
    expect(() => loadWebSearchConfig()).toThrow('WEB_SEARCH_API_KEY');

    delete process.env.WEB_SEARCH_API_KEY;
    expect(() => loadWebSearchConfig()).toThrow('WEB_SEARCH_API_KEY');
  });
  it('rejects limits outside the safe range', () => {
    process.env.WEB_SEARCH_TIMEOUT_MS = '500';
    expect(() => loadWebSearchConfig()).toThrow('WEB_SEARCH_TIMEOUT_MS');
  });
});

