# 知识库 RAG（MinerU + LlamaIndex）

> 状态：分块实施中。块 1（本文档与内部契约 `index`/`retrieve`）、块 2（ai-service 内存闭环 + HTTP 路由）、块 3（NestJS 文档状态机与上传触发索引）、块 4（真实 pgvector Gateway + `index/delete`）已落地，其余按第 8 节分块计划推进。
> 最后同步：2026-09-16
> 内部契约版本：`0.4.0`
> 公开契约版本：`0.23.0`（块 3 文档接口）

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

一句话概括"文件如何变成知识"：**文件 → 解析成文本 → 切成小块 → 每块转成向量 → 存进向量库**；提问时把问题也转成向量，按相似度找出最相关的块，交给模型基于证据作答。各技术栈的分工（通俗版）：

| 环节 | 谁来承担 | 通俗解释 |
| --- | --- | --- |
| 文件上传、状态、权限、审计 | NestJS API（`apps/api`） | 档案管理员：文件属于哪个知识库、处理到哪一步、谁能看、谁问过，都由它记账 |
| PDF/Word/图片转文本 | MinerU（GPU 服务器，独立部署） | 扫描仪：把版式复杂的文件还原成带页码、带位置坐标的纯文本 |
| 切块与向量化 | ai-service（LlamaIndex + EmbeddingRouter） | 翻译官：把文本切成小段，每段翻译成一串数字（向量），意思相近的段落数字也相近 |
| 存储与相似检索 | 独立 pgvector database | 图书馆检索台：存下所有向量，提问时按相似度快速找出最相关的段落 |
| 基于证据作答 | LLMRouter（ai-service，`rag` role） | 撰稿人：只依据检索到的证据段落组织答案，证据不足就明说，不许凭空编造 |

两条硬约束，与项目架构边界一致：

1. ai-service 不直接连接、不写入 `apps/api` 业务数据库；向量库是独立 database，由 ai-service 的 `VectorStoreGateway` 管理。
2. 答案生成必须走现有 `LLMRouter`（`rag` role），不允许 LlamaIndex QueryEngine 自带 LLM 绕过路由。

## 2. 现状与差距

已就绪：

| 能力 | 位置 |
| --- | --- |
| 知识库 CRUD、成员授权、租户隔离、审计 | `apps/api/src/knowledge`（[产品文档](../product/knowledge-base-management.md)） |
| `KnowledgeBase` / `KnowledgeBaseMember` / `KnowledgeDocument` / `DocumentVersion` / `DocumentChunk` / `KnowledgeQueryLog` 数据模型 | `apps/api/prisma/schema.prisma` |
| `KnowledgeDocument` 处理状态机、失败重试、后台索引 Worker（块 3） | `apps/api/src/knowledge/knowledge-indexing.service.ts` |
| 文档上传/版本/重试公开接口与版本级可见范围（块 3） | `apps/api/src/knowledge/knowledge-document.service.ts` |
| ai-service 内存索引与检索验证（LlamaIndex 薄适配，不用全局 Settings） | [ai-service-foundation.md](ai-service-foundation.md) |
| ai-service 知识内存闭环：EmbeddingRouter、节点构建、内存 VectorStore、HTTP `index`/`retrieve` | `apps/ai-service/app/{embeddings,knowledge}`、`app/api/routes/knowledge.py` |
| 真实 pgvector Gateway（独立 `cees_ai_vectors` 库，upsert/delete/检索过滤下推 SQL）与 `index/delete` 路由（块 4） | `apps/ai-service/app/knowledge/pgvector_store.py`、`app/knowledge/deletion.py` |
| 真实 Embedding provider 接入（`models.toml` `embedding_profiles`，openai_compatible + L2 归一化，块 4） | `apps/ai-service/app/embeddings/` |
| LLMRouter 多模型路由与 `rag` role | `apps/ai-service/app/llm` |

缺失：

- `DocumentChunk` 仍无读写代码（业务侧引用定位事实源，块 5 检索/引用链路上线时启用）
- MinerU 真机服务（块 6）；解析产物到 `ParsedDocument` 的真实转换（块 3 为占位解析器，块 6 真机替换）；答案生成与引用校验（块 5）
- 内部契约 `answer`

## 3. 关键决策

### 3.1 向量库：独立 pgvector database

选择**独立 pgvector database**（建议名 `cees_ai_vectors`，与业务库同 PostgreSQL 实例），不使用 Qdrant 或腾讯云 VectorDB：

- 业务库已启用 pgvector 扩展，新开独立 database 不新增任何基础设施；
- 独立 database 保证 ai-service 不接触业务表，边界清晰；
- LlamaIndex 官方 `PGVectorStore` 支持 metadata filter、批量 upsert、按 filter 删除；
- `VectorStoreGateway` 屏蔽后端差异，数据量增长后可替换 Qdrant 而不改契约。

向量库 schema 由 ai-service 自己管理，**不进 Prisma**，治理机制（块 4 落地）：

- **库**：`cees_ai_vectors` 由 `infra/database/manage-db.sh <env> create-vector-db` 在运行中的 postgres 容器里创建（CREATE DATABASE + CREATE EXTENSION vector），与业务库同实例，不新增基础设施；
- **表**：`knowledge_chunks` 由 ai-service 首次使用时自动创建（PGVectorStore 初始化时建表并启用 vector 扩展），表名固定为 `knowledge_chunks`，向量维度由 `KNOWLEDGE_VECTOR_DIMENSION` 决定；
- **版本治理**：向量表结构不原地迁移——切换 embedding 模型或切分策略时创建新 `index_version` 并行重建，旧版本由 `index/delete` 清理（见 3.4），避免重建期间读请求落在半迁移表上。

`DocumentChunk` 表保留为业务侧引用定位事实源（citation 映射 document / page / bbox 时由 NestJS 查询），其 `embedding` 字段已在块 3 迁移 0026 中删除。

### 3.2 编排：NestJS Job Worker 编排

采用方案推荐的 API Worker 编排：NestJS 从 COS 取文件、调用 MinerU、把解析产物转成中间格式后提交 ai-service 索引。

理由：ai-service 不访问 COS（遵守「COS 长期凭证只由 NestJS 持有」）；业务任务状态、重试、幂等由 NestJS 持久化，与 Assistant turn 的状态机模式一致。MinerU 任务本身不是业务事实源。

### 3.3 中间格式

业务代码不直接依赖 MinerU 原始 JSON，中间格式在内部契约中定义（见第 6 节）：`ParsedDocument` 含 `document_id`、`document_version_id`、`parser_name`、`parser_version` 与有序 `blocks`；`ParsedBlock` 含 `block_id`、`type`、`text`、`page_index`、`bbox`、`heading_path`、`source_order`、`asset_ref`。

### 3.4 Embedding 与索引版本

新增 `EmbeddingRouter`（`app/embeddings/`），与 LLMRouter 分离；`models.toml` 的 `rag` role 只用于答案生成，不承担 embedding 配置。块 2 落地了路由解析与维度校验，块 4 已接入真实 provider：`[embedding_profiles.*]` 声明 OpenAI-compatible embedding 模型（`embedding_profiles.primary`，默认禁用，启用后 `EMBEDDING_API_KEY` 必填），输出统一 L2 归一化；未启用任何外部 profile 时回退确定性 `deterministic` provider（开发/测试用）。

版本三元组 `(chunking_version, embedding_profile, index_version)` 是索引身份的一部分：

- 切换 embedding 模型或切分策略时创建新 `index_version`，完成重建后再切换读取版本，不覆盖旧向量；
- 索引请求必须声明三元组，检索请求必须声明 `index_version`；
- 向量库中每个节点携带该三元组，删除按 `(tenant_id, document_version_id, index_version)` 过滤。

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

节点 metadata 至少携带 `tenant_id`、`knowledge_base_id`、`document_id`、`document_version_id`、`visibility_scope`、`department_id`、`project_id`、`acl_version`；其中 `visibility_scope` 目前只作记录与排查用途，检索过滤由 NestJS 把三层权限折叠成的 `scope` 完成（3.6），ai-service 不直接按 `visibility_scope` 过滤。检索查询缓存（如引入）的 key 必须包含 `tenant_id + 访问者 scope + knowledge_base_id + query + acl_version + index_version`，防止跨用户缓存泄漏。

### 3.6 知识库归属与权限颗粒

**归属锚点单一**：一个知识库只属于一个租户，`tenantId` 是企业隔离底线，不做"多租户字段存储"；租户内按锚点分类——挂项目为项目知识库（一个项目一个知识库，最常见形态）、挂部门为部门知识库、不挂锚点为公司级知识库。跨部门协作不靠锚点，靠成员授权（见下）。

**可见性分层**（版本级，`DocumentVersion.visibilityScope`）：

| 层级 | 谁能看到 |
| --- | --- |
| `TENANT` | 全公司 |
| `DEPARTMENT` | 本部门及全部子部门（按组织树向上递归解析，对应 `DataScope.DEPARTMENT_TREE`） |
| `PROJECT` | 项目成员 |
| `PRIVATE` | 仅知识库成员：**不同部门的人加为成员即可看到同一个知识库**，不要求同部门 |
| `CUSTOM` | 自定义范围（预留） |

**读写权限三层叠加**：

1. 组织数据范围：`Role.dataScope` 决定角色覆盖企业/部门/部门的树/项目等哪些数据；
2. 知识库成员：`KnowledgeBaseMember`（knowledgeBaseId + userId + permission）显式授权，是跨部门协作的落点，也是"以项目为颗粒分配读写"的落点（项目级知识库可由项目成员自动获得，也可按成员表逐个授权）；
3. 文档级可见范围：版本级 `visibilityScope` 在上述基础上进一步收窄；检索时 NestJS 把三层折叠成 `scope`（见 3.5）传给 ai-service，过滤在向量检索阶段完成。

**表设计现状与差距**：

- `KnowledgeBaseMember` 已存在（`@@unique([tenantId, knowledgeBaseId, userId])`），跨部门共享同一知识库的余地已留；应用层已有 `READER` / `EDITOR` / `MANAGER` 枚举常量与 DTO 校验、权限排名（`knowledge.types.ts`），但数据库层 `permission` 仍是裸 String 无枚举约束；
- `DocumentVersion` 已带 `visibilityScope` + `departmentId` / `projectId`；
- `KnowledgeBase` 自身尚无 `departmentId` / `projectId` 锚点字段：块 5 公开 Query API 前需补 migration，把归属锚点落到 `KnowledgeBase`，并把 `KnowledgeBaseMember.permission` 在数据库层收敛为枚举（Prisma enum，对应应用层 `READER` / `EDITOR` / `MANAGER`）。

## 4. 索引流程与状态机

`KnowledgeDocument` 的处理状态机由 NestJS 持久化（块 3 已落地）：

```text
PENDING -> PARSING -> PARSED -> INDEXING -> READY
                        |          |
                        +-> FAILED <+
```

落地细节：

- Worker（`KnowledgeIndexingService`）定时轮询 PENDING 文档，用 `updateMany` 条件更新声明所有权，多实例间以 Redis 锁（`jobs:knowledge-document-indexer`）互斥；
- 上传/新版本/重试后调用 `kick()` 即时触发，与轮询共用同一把锁，不会重复处理同一文档；
- 解析器经 `KNOWLEDGE_DOCUMENT_PARSER` 抽象注入，块 3 为 MinerU 占位实现（抛 `MINERU_NOT_CONFIGURED`），块 6 真机替换；
- 失败按 retryable 语义处理：可重试错误回 `PENDING` 并递增 `retryCount`，达到上限（默认 3，`KNOWLEDGE_INDEX_MAX_RETRIES`）置 `FAILED`；不可重试错误直接 `FAILED`；`FAILED` 可由用户手动重试；
- 可见范围（`visibilityScope`）是版本级属性，存储在 `DocumentVersion`，索引请求从当前处理版本读取；
- `acl_version` 当前由版本 ID 派生（`acl-{version.id 前 8 位}`），块 5 引入真正的 ACL 版本机制；
- 索引请求三元组可通过环境变量覆盖：`KNOWLEDGE_CHUNKING_VERSION`（默认 `knowledge-chunking-v1`）、`KNOWLEDGE_EMBEDDING_PROFILE`（默认 `deterministic`）、`KNOWLEDGE_INDEX_VERSION`（默认 `knowledge-index-v1`）；
- 幂等键 = `(document_id, document_version_id, chunking_version, embedding_profile, index_version)`，同一幂等键重复提交不产生重复节点；ai-service 的 index 是幂等 upsert，替换判定按 `(tenant_id, document_version_id, index_version)` 三元组执行，`chunking_version` / `embedding_profile` 作为索引身份写入节点 metadata，变更 profile 或切分策略必须换新 `index_version`（见 3.4）。块 4 起采用「先写新后删旧」语义：新节点先落地，再删除三元组内的旧行（含同 node_id 旧内容行），读请求只见全旧或全新，不存在先删后写的空桶窗口；add 失败时旧行原样保留，清理失败最坏出现重复行，幂等重试后收敛；
- `index/delete` 契约与 ai-service 端已实现（块 4），删除指定三元组的派生索引；NestJS 接线（文档删除、新版本上线替换旧版本、知识库删除时清理派生索引）尚未完成，随块 5 公开 Query API 一起落地。

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
| `POST /internal/v1/knowledge/index/delete` | 删除指定文档版本 + 索引版本的派生索引 | 已实现（块 4） |
| `POST /internal/v1/knowledge/answer` | retrieve + LLMRouter 生成带引用校验的答案 | 块 5 定义 |

## 7. 与后续公开 API 的关系

公开知识库问答 API（如 `POST /knowledge-bases/{id}/query`）与 Assistant RAG 工具都属于 NestJS 公开侧，共用上述内部契约：

- 阶段 A：先做独立公开 Query API，跑通「解析产物 → 索引 → 检索 → 引用」闭环；
- 阶段 B：把 RAG 检索注册为 Assistant 工具（`knowledge_base.query` 权限码已存在），复用工具执行前二次校验、幂等与脱敏链路。

## 8. 分块实施计划

| 块 | 内容 | 依赖 | 状态 |
| --- | --- | --- | --- |
| 1 | 本文档 + 内部契约 `index`/`retrieve`（0.3.0） | 无 | ✅ 已落地 |
| 2 | ai-service 内存闭环（`parsed_models`、`mineru_artifact_reader`、`node_builder`、`EmbeddingRouter`、内存 VectorStore、`ingestion`/`retrieval`、HTTP 路由 `index`/`retrieve`），pytest 覆盖 | 块 1 | ✅ 已落地 |
| 3 | NestJS `KnowledgeDocument` 状态机 + `DocumentChunk` 迁移改造（删除 embedding 字段）+ 上传触发索引任务 | 块 1 | ✅ 已落地 |
| 4 | 真实 pgvector Gateway（独立 `cees_ai_vectors` database）+ `index/delete` 契约 | 块 2 | ✅ 已落地 |
| 5 | 公开 Query API + `answer` 契约（LLMRouter rag role）+ citation 校验 | 块 2、4 | 待开始 |
| 6 | MinerU 真机联调（192.168.5.29，pip 版部署中） | 块 3 | 待开始 |
| 7 | Assistant RAG 工具接入（阶段 B） | 块 5 | 待开始 |

每块独立可验证、可提交；块 2 使用内存向量库与假解析产物，不依赖 GPU 服务器。

## 9. 明确不实现（当前阶段）

- ai-service 不实现知识库/文档 CRUD、成员权限、文件上传、COS 签名、配额、审计；
- 不把全部知识库内容加载进进程内存；
- 不做多解析器并发、批量并行解析与 MinerU Router；
- 不做查询缓存（如引入必须遵守 3.5 的缓存 key 规则）；
- 不接入 Qdrant / 腾讯云 VectorDB（Gateway 保留切换空间）。

## 10. 验证

每块的最低验证：

| 块 | 验证 | 状态 |
| --- | --- | --- |
| 1 | `pnpm contracts:lint` + `pnpm contracts:check` + 文档评审 | ✅ 完成 |
| 2 | ✅ pytest 全绿：解析产物转换、切分稳定性、重复索引幂等、租户与 scope 过滤、index_version 隔离、文档版本删除；ruff 与契约漂移测试通过 | ✅ 完成 |
| 3 | jest：状态机迁移、上传触发、失败重试（32 用例通过）；Prisma 迁移检查 | ✅ 完成 |
| 4 | pytest：Gateway upsert/delete/filter；幂等与部分失败；真实 embedding 归一化与缺失 key 拒绝 | ✅ 完成 |
| 5 | jest + pytest：citation ID 校验、无证据拒答、查询日志写入 | 待验证 |
| 6 | 真机解析样例 → 索引 → 检索端到端验收 | 待验证 |
| 7 | jest：工具 approve/执行前二次校验/失败语义；契约兼容检查 | 待验证 |
