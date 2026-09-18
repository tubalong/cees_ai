import { Injectable, OnModuleInit } from '@nestjs/common';
import { WebSearchService } from '../../../web-search/web-search.service';
import type { WebSearchRecency } from '../../../web-search/web-search.types';
import { ToolPolicyError } from '../tool-policy.service';
import { ToolRegistryService } from '../tool-registry';
import type { ToolDefinition, ToolExecutionContext, ToolExecutionResult } from '../tool.types';

const RECENCY_VALUES = ['any', 'day', 'week', 'month', 'year'] as const;
const MAX_QUERY_LENGTH = 500;
const MAX_DOMAINS = 10;
const MAX_DOMAIN_LENGTH = 200;
const MAX_RESULTS = 10;

@Injectable()
export class WebSearchTool implements OnModuleInit {
  constructor(
    private readonly registry: ToolRegistryService,
    private readonly searchService: WebSearchService,
  ) { }

  onModuleInit(): void {
    this.registry.register(this.definition);
  }

  private readonly definition: ToolDefinition = {
    name: 'web_search',
    version: '1.1.0',
    displayName: '联网搜索',
    description: '搜索公开互联网中的资料，返回可引用的网页来源。遇到需要实时或外部资料的问题时使用。',
    parameters: {
      type: 'object',
      properties: {
        query: {
          type: 'string',
          minLength: 2,
          maxLength: MAX_QUERY_LENGTH,
          description: '要搜索的具体问题或关键词',
        },
        recency: {
          type: 'string',
          enum: [...RECENCY_VALUES],
          description: '资料时效范围；默认 any',
        },
        domains: {
          type: 'array',
          maxItems: MAX_DOMAINS,
          items: { type: 'string', maxLength: MAX_DOMAIN_LENGTH },
          description: '可选的限定网站域名列表',
        },
        max_results: {
          type: 'integer',
          minimum: 1,
          maximum: MAX_RESULTS,
          description: '最多返回的来源数量；默认由服务端配置决定',
        },
      },
      required: ['query'],
      additionalProperties: false,
    },
    requiredPermissions: ['ai.web.search'],
    riskLevel: 'READ',
    validate: validateWebSearchArguments,
    execute: (context, input) => this.executeSearch(context, input),
  };

  private async executeSearch(
    context: ToolExecutionContext,
    input: Record<string, unknown>,
  ): Promise<ToolExecutionResult> {
    // 开关兜底校验：正常情况下开关关闭时模型拿不到本工具，这里防止任何绕过路径。
    if (!context.webSearchEnabled) {
      throw new ToolPolicyError(
        'PERMISSION_DENIED',
        'webSearchEnabled=false 时拒绝执行 web_search',
        '本轮未启用联网搜索；请告知用户如需联网检索可在输入框开启相应选项，或直接说明需要联网',
        ['ai.web.search'],
      );
    }
    const response = await this.searchService.search({
      query: input.query as string,
      recency: input.recency as WebSearchRecency,
      domains: input.domains as string[],
      maxResults: input.max_results as number | undefined,
    }, context.signal);

    const sources = response.results.map((result, index) => ({
      id: `${context.toolCallId}:${index + 1}`,
      title: result.title,
      url: result.url,
      domain: result.domain,
      snippet: result.snippet,
      publishedAt: result.publishedAt,
    }));
    // 回喂模型的摘要只含公开搜索结果；provider 等内部信息不进入模型上下文。
    const summary = JSON.stringify({
      type: 'web_search_result',
      query: response.query,
      results: sources.map((source) => ({
        source_id: source.id,
        title: source.title,
        url: source.url,
        domain: source.domain,
        snippet: source.snippet,
        published_at: source.publishedAt,
      })),
      citation_instruction: '只能引用 results 中存在的 source_id，不得创建不存在的来源。',
      notice: sources.length === 0 ? '未找到匹配的公开资料。' : undefined,
    });

    return {
      resourceType: null,
      resourceId: null,
      summary,
      sources,
    };
  }
}

function validateWebSearchArguments(input: unknown): Record<string, unknown> {
  if (!input || typeof input !== 'object' || Array.isArray(input)) {
    throw new Error('工具参数必须为对象');
  }
  const raw = input as Record<string, unknown>;
  if (typeof raw.query !== 'string' || raw.query.trim().length < 2) {
    throw new Error('query 必须是至少 2 个字符的非空字符串');
  }
  if (raw.query.length > MAX_QUERY_LENGTH) {
    throw new Error(`query 不能超过 ${MAX_QUERY_LENGTH} 字符`);
  }

  const recency = raw.recency ?? 'any';
  if (!RECENCY_VALUES.includes(recency as (typeof RECENCY_VALUES)[number])) {
    throw new Error(`recency 必须是 ${RECENCY_VALUES.join('/')} 之一`);
  }

  const domains = raw.domains ?? [];
  if (!Array.isArray(domains) || domains.length > MAX_DOMAINS) {
    throw new Error(`domains 最多包含 ${MAX_DOMAINS} 个域名`);
  }
  const normalizedDomains = domains.map((domain, index) => {
    if (typeof domain !== 'string' || domain.trim().length === 0) {
      throw new Error(`domains[${index}] 必须是非空字符串`);
    }
    if (domain.length > MAX_DOMAIN_LENGTH) {
      throw new Error(`domains[${index}] 不能超过 ${MAX_DOMAIN_LENGTH} 字符`);
    }
    return normalizeDomain(domain);
  });

  const maxResults = raw.max_results;
  if (maxResults !== undefined && (!Number.isSafeInteger(maxResults) || (maxResults as number) < 1 || (maxResults as number) > MAX_RESULTS)) {
    throw new Error(`max_results 必须是 1-${MAX_RESULTS} 的整数`);
  }

  return {
    query: raw.query.trim(),
    recency,
    domains: normalizedDomains,
    ...(maxResults === undefined ? {} : { max_results: maxResults }),
  };
}
function normalizeDomain(value: string): string {
  try {
    const parsed = new URL(value.includes('://') ? value : `https://${value}`);
    if (!parsed.hostname || parsed.username || parsed.password) throw new Error();
    return parsed.hostname.toLowerCase();
  } catch {
    throw new Error(`无效域名：${value}`);
  }
}
