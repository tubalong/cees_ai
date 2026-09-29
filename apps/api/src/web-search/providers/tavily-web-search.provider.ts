import { Injectable } from '@nestjs/common';
import { loadWebSearchConfig } from '../web-search.config';
import { WebSearchError } from '../web-search.errors';
import type {
  WebSearchProvider,
  WebSearchRequest,
  WebSearchResponse,
  WebSearchResult,
} from '../web-search.types';


@Injectable()
export class TavilyWebSearchProvider implements WebSearchProvider {
  readonly name = 'tavily' as const;
  private readonly config = loadWebSearchConfig();

  async search(input: WebSearchRequest, signal?: AbortSignal): Promise<WebSearchResponse> {
    if (!this.config.apiKey) {
      throw new WebSearchError(
        'WEB_SEARCH_NOT_CONFIGURED',
        '联网搜索尚未配置 WEB_SEARCH_API_KEY',
        false,
      );
    }

    const controller = new AbortController();
    let timedOut = false;
    const timeout = setTimeout(() => {
      timedOut = true;
      controller.abort();
    }, this.config.timeoutMs);
    const abortParent = (): void => controller.abort();
    signal?.addEventListener('abort', abortParent, { once: true });

    try {
      const response = await fetch('https://api.tavily.com/search', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Accept': 'application/json',
        },
        body: JSON.stringify({
          api_key: this.config.apiKey,
          query: input.query,
          search_depth: this.config.searchDepth,
          topic: 'general',
          time_range: input.recency === 'any' ? undefined : input.recency,
          include_domains: input.domains.length > 0 ? input.domains : undefined,
          max_results: input.maxResults ?? this.config.maxResults,
          include_answer: false,
          include_raw_content: false,
          include_images: false,
        }),
        signal: controller.signal,
      });

      if (!response.ok) {
        const retryable = response.status === 408 || response.status === 429 || response.status >= 500;
        throw new WebSearchError(
          'WEB_SEARCH_UNAVAILABLE',
          `Tavily 搜索服务返回 HTTP ${response.status}`,
          retryable,
        );
      }

      let payload: unknown;
      try {
        payload = await response.json();
      } catch {
        throw new WebSearchError('WEB_SEARCH_INVALID_RESPONSE', 'Tavily 返回了无效 JSON', false);
      }
      return parseTavilyResponse(payload, input.query);
    } catch (error) {
      if (error instanceof WebSearchError) throw error;
      if (timedOut) {
        throw new WebSearchError('WEB_SEARCH_TIMEOUT', '联网搜索请求超时', true);
      }
      if (signal?.aborted) {
        throw new WebSearchError('WEB_SEARCH_TIMEOUT', '联网搜索已取消', true);
      }
      throw new WebSearchError('WEB_SEARCH_UNAVAILABLE', '无法连接 Tavily 搜索服务', true);
    } finally {
      clearTimeout(timeout);
      signal?.removeEventListener('abort', abortParent);
    }
  }
}

function parseTavilyResponse(payload: unknown, fallbackQuery: string): WebSearchResponse {
  if (!isRecord(payload) || !Array.isArray(payload.results)) {
    throw new WebSearchError('WEB_SEARCH_INVALID_RESPONSE', 'Tavily 返回结果结构无效', false);
  }

  const results: WebSearchResult[] = [];
  for (const item of payload.results) {
    if (!isRecord(item)) continue;
    const title = stringValue(item.title);
    const url = stringValue(item.url);
    if (!title || !url) continue;
    results.push({
      title,
      url,
      domain: hostname(url),
      snippet: stringValue(item.content) ?? '',
      publishedAt: stringValue(item.published_date),
    });
  }

  return {
    query: stringValue(payload.query) ?? fallbackQuery,
    provider: 'tavily',
    results,
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function stringValue(value: unknown): string | null {
  return typeof value === 'string' && value.trim() ? value.trim() : null;
}

function hostname(value: string): string {
  try {
    return new URL(value).hostname;
  } catch {
    return '';
  }
}


