# 联网搜索（Tavily）

> 状态：MVP 已落地。当前仅支持 Tavily；不包含知识库 RAG、LlamaIndex 检索、任意 URL 抓取或浏览器自动化。

## 1. 目标与边界

联网搜索由 NestJS 执行，ai-service 只负责模型 Tool Calling 与最终答案生成：

```text
用户提问
  -> NestJS TurnRunner
  -> ai-service /internal/v1/chat/tool-turn/stream
  -> 模型返回 web_search ToolCall
  -> NestJS WebSearchTool 调用 Tavily
  -> ToolMessage + 结构化来源回填
  -> 再次调用 ai-service
  -> 最终回答
```

ai-service 不保存搜索 Provider 配置，不直接访问 Tavily，不负责用户权限、额度、租户审计或来源持久化策略。

第一版只接受搜索关键词、时间范围、域名过滤和最大结果数。第一版不允许模型发起任意 HTTP 请求，也不实现 `fetch_web_page`。

## 2. 模块结构

```text
apps/api/src/web-search/
├── web-search.config.ts
├── web-search.errors.ts
├── web-search.module.ts
├── web-search.service.ts
├── web-search.types.ts
└── providers/
    └── tavily-web-search.provider.ts

apps/api/src/assistant/tools/executors/web-search.tool.ts
```

`WebSearchProvider` 是 Provider 抽象，当前实现为 `TavilyWebSearchProvider`。工具只依赖 `WebSearchService`，不直接依赖 Tavily HTTP 细节。

## 3. 配置

```env
WEB_SEARCH_PROVIDER=tavily
WEB_SEARCH_API_KEY=change_me
WEB_SEARCH_TIMEOUT_MS=10000
WEB_SEARCH_MAX_RESULTS=5
WEB_SEARCH_MAX_SNIPPET_CHARS=1500
```

Secret 只能通过环境变量或平台 Secrets 注入，不能写入代码或提交 `.env`。当前 `WEB_SEARCH_PROVIDER` 只接受 `tavily`；开发/测试环境缺少 `WEB_SEARCH_API_KEY` 时，工具返回 `WEB_SEARCH_NOT_CONFIGURED`，不会在模块加载时发起外部请求；生产环境会在配置加载时拒绝缺失或仍为 `change_me` 的密钥。

Tavily 请求固定使用基础搜索、普通资料主题，并关闭 Provider 生成答案、原始正文和图片返回。最终自然语言答案由 CEES 当前 ai-service 模型生成。

## 4. 工具与权限

工具名称为 `web_search`，风险级别为 `READ`，需要权限：

```text
ai.web.search
```

权限在 `ToolRegistry.listAllowed` 阶段过滤，并在 `ToolPolicyService.approve` 执行前再次校验。首版 Prisma migration 只默认授予系统 `tenant_admin` 角色，其他角色需要通过 RBAC 显式授予。

工具参数：

```json
{
  "query": "搜索问题",
  "recency": "any | day | week | month | year",
  "domains": ["example.com"],
  "max_results": 5
}
```

服务端会再次限制查询长度、域名数量、结果数量和摘要长度，不能由模型绕过。

## 5. 结果与来源

搜索结果会以 TOOL 消息回填模型，内容包含：

- `source_id`
- `title`
- `url`
- `domain`
- `snippet`
- `published_at`

每个搜索工具调用生成稳定的来源 ID。模型只能引用搜索结果中存在的 `source_id`，不能编造来源。

公开 `tool_result` 事件新增可选 `sources` 字段。来源不是 CEES 正式 `Resource`，因此搜索结果不创建图片、文档或其他业务资源。旧客户端可以忽略 `sources` 字段，来源通过事件重放保留。

## 6. 失败语义

| code | 说明 | retryable |
| --- | --- | --- |
| `WEB_SEARCH_NOT_CONFIGURED` | 未配置 `WEB_SEARCH_API_KEY` | `false` |
| `WEB_SEARCH_TIMEOUT` | Tavily 请求超时 | `true` |
| `WEB_SEARCH_UNAVAILABLE` | Tavily 返回 429、5xx 或网络不可用 | 按错误类型 |
| `WEB_SEARCH_INVALID_RESPONSE` | Provider 返回结构不符合预期 | `false` |

没有搜索结果不是工具失败。工具会返回空的 `results` 和说明，模型可以向用户解释或在工具循环上限允许时调整查询。

## 7. 安全与限制

- 只访问固定的 Tavily Search API；
- 不接受模型传入 API Key、请求 URL、timeout 或 Provider 原始参数；
- 设置请求超时和结果上限；
- 仅保留 `http`/`https` 来源 URL；
- 对重复 URL 去重；
- 不保存签名 URL；
- 不在日志中记录 API Key 或 Provider 原始响应；
- 任意网页抓取和 SSRF 防护属于后续独立能力，不在本版范围内。

## 8. 验证

最低验证：

```powershell
pnpm --filter @cees/api exec jest --runInBand src/web-search src/assistant/tools/executors/web-search.tool.spec.ts
pnpm --filter @cees/api exec jest --runInBand src/assistant/runtime/turn-state.service.spec.ts src/assistant/runtime/turn-runner.service.spec.ts
pnpm contracts:lint
pnpm contracts:check
pnpm --filter @cees/api build
```

当前实现状态：Provider、Service、Tool、权限、完整 Tool Loop、失败/超时/空结果、来源事件、测试、契约和环境变量示例均已落地。桌面端来源卡片展示不属于本次后端实现范围。

