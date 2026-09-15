# 知识库 RAG（MinerU + LlamaIndex）

> 状态：分块实施中。块 1（本文档与内部契约 `index`/`retrieve`）与块 2（ai-service 内存闭环 + HTTP 路由）已落地，其余内容按第 8 节分块计划推进。
> 最后同步：2026-09-15
> 内部契约版本：`0.3.0`

## 1. 目标与边界

知识库问答拆成四个职责层：

```text
MinerU       = 文档解析层（GPU 服务器，独立部署）
LlamaIndex   = 知识索引与检索层（ai-service 内）
LLMRouter    = 基于证据的答案生成层（ai-service 现有 LLMRouter）
NestJS API   = 业务事实、权限、状态与审计层（apps/api）
```

数据流：

```text
用户上传文件
  -> NestJS API 创建 KnowledgeDocument / DocumentVersion，状态 PENDING
  -> NestJS Job Worker 从 COS 取文件，调用 MinerU 解析
  -> MinerU 返回 Markdown / content_list.json / middle.json
  -> NestJS 把解析产物转成 ParsedDocument 提交 ai-service /internal/v1/knowledge/index
  -> ai-service 构建 TextNode、切分、Embedding、写入独立向量库
  -> 状态 READY
```

查询链路：

```text
用户提问
  -> NestJS 验证身份、计算有效访问范围（scope）
  -> ai-service /internal/v1/knowledge/retrieve 按 scope 过滤检索
  -> （后续块）ai-service /internal/v1/knowledge/answer 用 LLMRouter 基于证据生成答案
  -> NestJS 记录 KnowledgeQueryLog 与审计，返回客户端
```

两条硬约束，与项目架构边界一致：

1. ai-service 不直接连接、不写入 `apps/api` 业务数据库；向量库是独立 database，由 ai-service 的 `VectorStoreGateway` 管理。
2. 答案生成必须走现有 `LLMRouter`（`rag` role），不允许 LlamaIndex QueryEngine 自带 LLM 绕过路由。

## 2. 现状与差距

已就绪：

| 能力 | 位置 |
| --- | --- |
| 知识库 CRUD、成员授权、租户隔离、审计 | `apps/api/src/knowledge`（[产品文档](../product/knowledge-base-management.md)） |
| `KnowledgeBase` / `KnowledgeBaseMember` / `KnowledgeDocument` / `DocumentVersion` / `DocumentChunk` / `KnowledgeQueryLog` 数据模型 | `apps/api/prisma/schema.prisma` |
| `DocumentChunk` 已含 `visibilityScope`、`departmentId`、`projectId`、`version`、pgvector `embedding` 字段 | 同上 |
| ai-service 内存索引与检索验证（LlamaIndex 薄适配，不用全局 Settings） | [ai-service-foundation.md](ai-service-foundation.md) |
| ai-service 知识内存闭环：EmbeddingRouter、节点构建、内存 VectorStore、HTTP `index`/`retrieve` | `apps/ai-service/app/{embeddings,knowledge}`、`app/api/routes/knowledge.py` |
| LLMRouter 多模型路由与 `rag` role | `apps/ai-service/app/llm` |

缺失：

- `DocumentChunk` 无任何读写代码；`KnowledgeDocument` 无版本与处理状态机
- MinerU 服务；真实 Embedding provider 与独立 pgvector 向量库（块 4）
- 答案生成与引用校验（块 5）

## 3. 关键决策

### 3.1 向量库：独立 pgvector database

选择**独立 pgvector database**（建议名 `cees_ai_vectors`，与业务库同 PostgreSQL 实例），不使用 Qdrant 或腾讯云 VectorDB：

- 业务库已启用 pgvector 扩展，新开独立 database 不新增任何基础设施；
- 独立 database 保证 ai-service 不接触业务表，边界清晰；
- LlamaIndex 官方 `PGVectorStore` 支持 metadata filter、批量 upsert、按 filter 删除；
- `VectorStoreGateway` 屏蔽后端差异，数据量增长后可替换 Qdrant 而不改契约。

向量库 schema 由 ai-service 自己管理，**不进 Prisma**。

`DocumentChunk` 表保留为业务侧引用定位事实源（citation 映射 document / page / bbox 时由 NestJS 查询），其 `embedding` 字段停用，后续迁移删除（见块 3）。

### 3.2 编排：NestJS Job Worker 编排

采用方案推荐的 API Worker 编排：NestJS 从 COS 取文件、调用 MinerU、把解析产物转成中间格式后提交 ai-service 索引。

理由：ai-service 不访问 COS（遵守「COS 长期凭证只由 NestJS 持有」）；业务任务状态、重试、幂等由 NestJS 持久化，与 Assistant turn 的状态机模式一致。MinerU 任务本身不是业务事实源。

### 3.3 中间格式

业务代码不直接依赖 MinerU 原始 JSON，中间格式在内部契约中定义（见第 6 节）：`ParsedDocument` 含 `document_id`、`document_version_id`、`parser_name`、`parser_version` 与有序 `blocks`；`ParsedBlock` 含 `block_id`、`type`、`text`、`page_index`、`bbox`、`heading_path`、`source_order`、`asset_ref`。

### 3.4 Embedding 与索引版本

新增 `EmbeddingRouter`（`app/embeddings/`），与 LLMRouter 分离；`models.toml` 的 `rag` role 只用于答案生成，不承担 embedding 配置。块 2 已落地：路由解析与维度校验就绪，目前只注册确定性 `deterministic` provider（开发/测试用），真实 provider 在块 4 接入。

版本三元组 `(chunking_version, embedding_profile, index_version)` 是索引身份的一部分：

- 切换 embedding 模型或切分策略时创建新 `index_version`，完成重建后再切换读取版本，不覆盖旧向量；
- 索引请求必须声明三元组，检索请求必须声明 `index_version`；
- 向量库中每个节点携带该三元组，删除按 `(document_version_id, index_version)` 过滤。

### 3.5 权限过滤

ai-service 不自行推断权限。NestJS 计算可信 scope 后随检索请求传入，过滤必须在**向量检索阶段**完成（metadata filter），不是先取全局 top-k 再过滤：

```json
{
  "scope": {
    "knowledge_base_ids": ["kb-1"],
    "allowed_document_ids": ["doc-1"],
    "department_ids": ["dept-2"],
    "project_ids": ["project-3"],
    "acl_version": "acl-2026-09-15-42"
  }
}
```

节点 metadata 至少携带 `tenant_id`、`knowledge_base_id`、`document_id`、`document_version_id`、`visibility_scope`、`department_id`、`project_id`、`acl_version`。检索查询缓存（如引入）的 key 必须包含 `tenant_id + 访问者 scope + knowledge_base_id + query + acl_version + index_version`，防止跨用户缓存泄漏。

## 4. 索引流程与状态机

`KnowledgeDocument` 的处理状态机由 NestJS 持久化：

```text
PENDING -> PARSING -> PARSED -> INDEXING -> READY
                        |          |
                        +-> FAILED <+
```

- 每个状态迁移记录重试次数、失败原因与幂等键；
- 幂等键 = `(document_id, document_version_id, chunking_version, embedding_profile, index_version)`，同一幂等键重复提交不产生重复节点；
- MinerU 调用超时/失败由 NestJS 重试；ai-service 的 index 是幂等 upsert；
- 文档删除或新版本上线时调用 `index/delete`（后续块）删除旧版本派生索引，不删除业务文档。

## 5. 检索与答案

`retrieve` 与 `answer` 分开：

- `retrieve` 只检索、只返回节点/分数/来源 metadata，不调用 LLM；
- `answer`（后续块）内部先 retrieve，再用 `LLMRouter`（`rag` role）基于证据生成结构化答案：

```json
{
  "answer": "项目延期超过两周时，需要升级到项目委员会。",
  "citation_ids": ["S1"],
  "insufficient_evidence": false
}
```

- 模型只输出 `citation_ids`，服务端把 ID 映射回真实来源（document / version / chunk / page / bbox / text），不允许模型编造文档 ID、页码或 URL；
- 证据不足时返回 `grounded=false`、`insufficient_evidence=true`，不自由发挥；
- `KnowledgeQueryLog` 由 NestJS 记录，属于业务审计事实。

## 6. 内部契约

在 `packages/contracts/openapi/ai-service.openapi.yaml` 中新增 `knowledge` tag 与路径，全部受 `internalToken` 保护：

| 方法与路径 | 用途 | 状态 |
| --- | --- | --- |
| `POST /internal/v1/knowledge/index` | 接收 ParsedDocument，切分、Embedding、幂等写入向量库 | 已实现（块 2） |
| `POST /internal/v1/knowledge/retrieve` | 按可信 scope 检索，返回节点与来源 metadata | 已实现（块 2） |
| `POST /internal/v1/knowledge/index/delete` | 删除指定文档版本 + 索引版本的派生索引 | 块 4 定义 |
| `POST /internal/v1/knowledge/answer` | retrieve + LLMRouter 生成带引用校验的答案 | 块 5 定义 |

## 7. 与后续公开 API 的关系

公开知识库问答 API（如 `POST /knowledge-bases/{id}/query`）与 Assistant RAG 工具都属于 NestJS 公开侧，共用上述内部契约：

- 阶段 A：先做独立公开 Query API，跑通「解析产物 → 索引 → 检索 → 引用」闭环；
- 阶段 B：把 RAG 检索注册为 Assistant 工具（`knowledge_base.query` 权限码已存在），复用工具执行前二次校验、幂等与脱敏链路。

## 8. 分块实施计划

| 块 | 内容 | 依赖 |
| --- | --- | --- |
| 1 | 本文档 + 内部契约 `index`/`retrieve`（0.3.0） | 无 |
| 2 | ✅ 已落地：ai-service 内存闭环（`parsed_models`、`mineru_artifact_reader`、`node_builder`、`EmbeddingRouter`、内存 VectorStore、`ingestion`/`retrieval`、HTTP 路由 `index`/`retrieve`），pytest 覆盖 | 块 1 |
| 3 | NestJS `KnowledgeDocument` 状态机 + `DocumentChunk` 迁移改造（停用 embedding 字段）+ 上传触发索引任务 | 块 1 |
| 4 | 真实 pgvector Gateway（独立 `cees_ai_vectors` database）+ `index/delete` 契约 | 块 2 |
| 5 | 公开 Query API + `answer` 契约（LLMRouter rag role）+ citation 校验 | 块 2、4 |
| 6 | MinerU 真机联调（192.168.5.29，pip 版部署中） | 块 3 |
| 7 | Assistant RAG 工具接入（阶段 B） | 块 5 |

每块独立可验证、可提交；块 2 使用内存向量库与假解析产物，不依赖 GPU 服务器。

## 9. 明确不实现（当前阶段）

- ai-service 不实现知识库/文档 CRUD、成员权限、文件上传、COS 签名、配额、审计；
- 不把全部知识库内容加载进进程内存；
- 不做多解析器并发、批量并行解析与 MinerU Router；
- 不做查询缓存（如引入必须遵守 3.5 的缓存 key 规则）；
- 不接入 Qdrant / 腾讯云 VectorDB（Gateway 保留切换空间）。

## 10. 验证

每块的最低验证：

| 块 | 验证 |
| --- | --- |
| 1 | `pnpm contracts:lint` + `pnpm contracts:check` + 文档评审 |
| 2 | ✅ pytest 全绿：解析产物转换、切分稳定性、重复索引幂等、租户与 scope 过滤、index_version 隔离、文档版本删除；ruff 与契约漂移测试通过 |
| 3 | jest：状态机迁移、上传触发、失败重试；Prisma 迁移检查 |
| 4 | pytest：Gateway upsert/delete/filter；幂等与部分失败 |
| 5 | jest + pytest：citation ID 校验、无证据拒答、查询日志写入 |
| 6 | 真机解析样例 → 索引 → 检索端到端验收 |
| 7 | jest：工具 approve/执行前二次校验/失败语义；契约兼容检查 |
