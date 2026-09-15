export const WEB_SEARCH_PROVIDER = Symbol('WEB_SEARCH_PROVIDER');

export type WebSearchProviderKind = 'tavily';
export type WebSearchRecency = 'any' | 'day' | 'week' | 'month' | 'year';

export interface WebSearchRequest {
  query: string;
  recency: WebSearchRecency;
  domains: string[];
  maxResults: number | undefined;
}

export interface WebSearchResult {
  title: string;
  url: string;
  domain: string;
  snippet: string;
  publishedAt: string | null;
}

export interface WebSearchResponse {
  query: string;
  provider: WebSearchProviderKind;
  results: WebSearchResult[];
}

export interface WebSearchProvider {
  readonly name: WebSearchProviderKind;
  search(input: WebSearchRequest, signal?: AbortSignal): Promise<WebSearchResponse>;
}
