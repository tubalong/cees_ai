export interface WebSearchConfig {
  provider: 'tavily';
  apiKey: string | null;
  timeoutMs: number;
  maxResults: number;
  maxSnippetChars: number;
}

export function loadWebSearchConfig(): WebSearchConfig {
  const provider = process.env.WEB_SEARCH_PROVIDER?.trim() || 'tavily';
  if (provider !== 'tavily') {
    throw new Error('WEB_SEARCH_PROVIDER must be tavily');
  }

  const apiKey = process.env.WEB_SEARCH_API_KEY?.trim() || null;
  if (process.env.NODE_ENV === 'production' && (!apiKey || apiKey.startsWith('change_me'))) {
    throw new Error('WEB_SEARCH_API_KEY must be configured in production');
  }

  return {
    provider,
    apiKey,
    timeoutMs: positiveInteger('WEB_SEARCH_TIMEOUT_MS', 10_000, 1_000, 60_000),
    maxResults: positiveInteger('WEB_SEARCH_MAX_RESULTS', 5, 1, 10),
    maxSnippetChars: positiveInteger('WEB_SEARCH_MAX_SNIPPET_CHARS', 1_500, 100, 5_000),
  };
}

function positiveInteger(name: string, fallback: number, minimum: number, maximum: number): number {
  const raw = process.env[name]?.trim();
  if (!raw) return fallback;
  const value = Number(raw);
  if (!Number.isSafeInteger(value) || value < minimum || value > maximum) {
    throw new Error(`${name} must be an integer between ${minimum} and ${maximum}`);
  }
  return value;
}

