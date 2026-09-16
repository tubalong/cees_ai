import { WebSearchTool } from './web-search.tool';
import { ToolRegistryService } from '../tool-registry';
import type { ToolExecutionContext } from '../tool.types';
import type { WebSearchService } from '../../../web-search/web-search.service';

describe('WebSearchTool', () => {
  let registry: ToolRegistryService;
  let searchService: jest.Mocked<Pick<WebSearchService, 'search'>>;
  const context: ToolExecutionContext = {
    tenantId: 'tenant-1',
    userId: 'user-1',
    membershipId: 'membership-1',
    requestId: 'request-1',
    conversationId: 'conversation-1',
    turnId: 'turn-1',
    toolCallId: 'tool-1',
    executionOwner: 'api:test',
    executionToken: 'execution-token',
    permissions: ['ai.web.search'],
    knowledgeBaseEnabled: false,
  };

  beforeEach(() => {
    registry = new ToolRegistryService();
    searchService = { search: jest.fn() };
  });

  it('registers a read-only web search tool with the expected schema and permission', async () => {
    const tool = new WebSearchTool(registry, searchService as unknown as WebSearchService);
    tool.onModuleInit();
    const definition = registry.get('web_search');

    expect(definition).toEqual(expect.objectContaining({
      name: 'web_search',
      version: '1.1.0',
      requiredPermissions: ['ai.web.search'],
      riskLevel: 'READ',
    }));
    expect(definition?.parameters).toEqual(expect.objectContaining({
      required: ['query'],
    }));

    searchService.search.mockResolvedValue({
      query: 'CEES',
      provider: 'tavily',
      results: [{
        title: 'CEES',
        url: 'https://example.com/cees',
        domain: 'example.com',
        snippet: 'A result',
        publishedAt: null,
      }],
    });

    const result = await definition!.execute(context, {
      query: 'CEES',
      recency: 'any',
      domains: [],
      max_results: 5,
    });

    expect(result).toEqual({
      resourceType: null,
      resourceId: null,
      summary: expect.stringContaining('web_search_result'),
      sources: [{
        id: 'tool-1:1',
        title: 'CEES',
        url: 'https://example.com/cees',
        domain: 'example.com',
        snippet: 'A result',
        publishedAt: null,
      }],
    });
    expect(JSON.parse(result.summary)).toEqual(expect.objectContaining({
      type: 'web_search_result',
      query: 'CEES',
      results: [expect.objectContaining({ source_id: 'tool-1:1' })],
    }));
  });

  it('validates and normalizes model arguments', () => {
    const tool = new WebSearchTool(registry, searchService as unknown as WebSearchService);
    tool.onModuleInit();
    const definition = registry.get('web_search')!;

    expect(definition.validate({ query: '  CEES  ' })).toEqual({
      query: 'CEES',
      recency: 'any',
      domains: [],
    });
    expect(() => definition.validate({ query: 'x' })).toThrow('至少 2 个字符');
    expect(() => definition.validate({ query: 'CEES', max_results: 11 })).toThrow('max_results');
    expect(() => definition.validate({ query: 'CEES', domains: [''] })).toThrow('domains[0]');
  });

  it('returns sources as an empty list for a valid empty search', async () => {
    const tool = new WebSearchTool(registry, searchService as unknown as WebSearchService);
    tool.onModuleInit();
    const definition = registry.get('web_search')!;
    searchService.search.mockResolvedValue({ query: 'missing', provider: 'tavily', results: [] });

    const result = await definition.execute(context, {
      query: 'missing',
      recency: 'any',
      domains: [],
    });

    expect(result.sources).toEqual([]);
    expect(JSON.parse(result.summary)).toEqual(expect.objectContaining({
      results: [],
      notice: '未找到匹配的公开资料。',
    }));
  });
});
