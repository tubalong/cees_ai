export type WebSearchSearchDepth = 'basic' | 'advanced';

export interface WebSearchConfig {
  provider: 'tavily';
  apiKey: string | null;
  timeoutMs: number;
  maxResults: number;
  maxSnippetChars: number;
  /**
   * 检索深度。`basic` 每条结果只带页面摘要片段（1 credit），
   * `advanced` 会抓取页面正文片段（2 credits）。
   *
   * 默认 `advanced`：销量、产量、财务这类需要“具体数字”的查询，
   * `basic` 经常只拿到目录页/导航文本，模型拿不到可引用的事实，
   * 表现为“只返回一条没用的结果”。可用 WEB_SEARCH_SEARCH_DEPTH 回退到 basic。
   */
  searchDepth: WebSearchSearchDepth;
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
    // 默认 15s：`advanced` 会抓取正文片段，耗时明显高于 `basic`（实测常在 5-10s），
    // 沿用 10s 会把本可成功的检索硬中断成“联网检索失败”。
    timeoutMs: positiveInteger('WEB_SEARCH_TIMEOUT_MS', 15_000, 1_000, 60_000),
    maxResults: positiveInteger('WEB_SEARCH_MAX_RESULTS', 5, 1, 10),
    maxSnippetChars: positiveInteger('WEB_SEARCH_MAX_SNIPPET_CHARS', 1_500, 100, 5_000),
    searchDepth: searchDepth('WEB_SEARCH_SEARCH_DEPTH', 'advanced'),
  };
}

function searchDepth(name: string, fallback: WebSearchSearchDepth): WebSearchSearchDepth {
  const raw = process.env[name]?.trim().toLowerCase();
  if (!raw) return fallback;
  if (raw !== 'basic' && raw !== 'advanced') {
    throw new Error(`${name} must be basic or advanced`);
  }
  return raw;
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

