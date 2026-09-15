import { Inject, Injectable } from '@nestjs/common';
import { loadWebSearchConfig } from './web-search.config';
import { WebSearchError } from './web-search.errors';
import { WEB_SEARCH_PROVIDER } from './web-search.types';
import type {
  WebSearchProvider,
  WebSearchRequest,
  WebSearchResponse,
  WebSearchResult,
} from './web-search.types';

@Injectable()
export class WebSearchService {
  private readonly config = loadWebSearchConfig();

  constructor(@Inject(WEB_SEARCH_PROVIDER) private readonly provider: WebSearchProvider) {}

  async search(input: WebSearchRequest, signal?: AbortSignal): Promise<WebSearchResponse> {
    const query = input.query.trim();
    if (!query) {
      throw new WebSearchError('WEB_SEARCH_INVALID_RESPONSE', '搜索关键词不能为空', false);
    }

    const maxResults = Math.min(input.maxResults ?? this.config.maxResults, this.config.maxResults);
    const response = await this.provider.search(
      {
        query,
        recency: input.recency,
        domains: input.domains,
        maxResults,
      },
      signal,
    );
    return {
      ...response,
      query: response.query.trim() || query,
      results: normalizeResults(response.results, this.config.maxSnippetChars, maxResults),
    };
  }
}

function normalizeResults(
  results: WebSearchResult[],
  maxSnippetChars: number,
  maxResults: number,
): WebSearchResult[] {
  const seen = new Set<string>();
  const normalized: WebSearchResult[] = [];
  for (const result of results) {
    const url = normalizeUrl(result.url);
    if (!url || seen.has(url)) continue;
    seen.add(url);
    normalized.push({
      title: truncate(result.title.trim() || url, 300),
      url,
      domain: truncate(result.domain.trim() || new URL(url).hostname, 255),
      snippet: truncate(result.snippet.trim(), maxSnippetChars),
      publishedAt: normalizeDate(result.publishedAt),
    });
    if (normalized.length >= maxResults) break;
  }
  return normalized;
}

function normalizeUrl(value: string): string | null {
  if (value.length > 4096) return null;
  try {
    const url = new URL(value);
    if (url.protocol !== 'http:' && url.protocol !== 'https:') return null;
    return url.toString();
  } catch {
    return null;
  }
}

function normalizeDate(value: string | null): string | null {
  if (!value) return null;
  const timestamp = Date.parse(value);
  return Number.isNaN(timestamp) ? null : new Date(timestamp).toISOString();
}

function truncate(value: string, maxLength: number): string {
  return value.length <= maxLength ? value : `${value.slice(0, maxLength - 1)}…`;
}

