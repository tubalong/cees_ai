# 知识库 RAG（MinerU + LlamaIndex）

> 状态：分块实施中。块 1（本文档与内部契约 `index`/`retrieve`）、块 2（ai-service 内存闭环 + HTTP 路由）、块 3（NestJS 文档状态机与上传触发索引）、块 4（真实 pgvector Gateway + `index/delete`）、块 5（公开 Query API + `answer` 契约与引用校验 + 索引删除 NestJS 接线）、块 6（MinerU 真机联调验收）、块 7a（解析器格式分流 + pgvector HNSW 索引）、块 7b（Assistant RAG 工具接入：`knowledge_search` 工具 + 对话级知识库开关 + 权限折叠检索）、块 7c（对话数据转知识库：双层入口 + 助手工具）、块 8（知识库归属锚点管理与自动授权 + 权限码收敛 + 知识管理页面与文档管理面板）、块 9（文档删除：公开 DELETE 端点 + 软删/审计/异步向量清理 + 索引删除竞态 + 对话引用卡片 deletable 删除入口）已落地；块 7d（助手人设功能告知）部分落地，按第 8 节分块计划推进。
> 最后同步：2026-09-18
> 内部契约版本：`0.5.0`
> 公开契约版本：`0.31.0`（公开知识库管理/查询 API）

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
  -> ai-service /internal/v1/knowledge/answer 内部先按 scope 检索，再由 rag role 基于证据生成带引用校验的答案（块 5 落地）
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
| 解析器格式分流：文本原生（md/txt/csv/json/docx/pptx/xlsx）走 ai-service 本地提取，pdf/图片走 MinerU，统一 `ParsedDocument` 中间格式（块 7a） | `apps/api/src/knowledge/knowledge-document-parser.ts`、`text-artifact-reader.ts` |
| pgvector HNSW 索引（m=16 / ef_construction=64 / ef_search=64 / cosine，块 7a） | `apps/ai-service/app/knowledge/pgvector_store.py` |

预留未启用（不影响验收，非缺口）：

- `DocumentChunk` 表为预留的引用定位事实源，当前无读写代码：引用明细随 ai-service 检索响应携带（citation 映射 document / version / chunk / page / bbox / text），业务侧无需查表；如未来要求从业务库独立恢复/审计引用内容，再启用读写

缺失：

- MinerU 真机联调已在测试环境（192.168.5.29）完成端到端验收（块 6）；生产环境以 Docker 容器方式部署 MinerU 并换用大规模 GPU 硬件
- 助手人设未包含知识库功能告知话术与诱导提问对抗用例（3.9 节，块 7d 剩余部分；语言约束与内部标识脱敏已提前落地）

## 3. 关键决策

### 3.1 向量库：独立 pgvector database

选择**独立 pgvector database**（建议名 `cees_ai_vectors`，与业务库同 PostgreSQL 实例），不使用 Qdrant 或腾讯云 VectorDB：

- 业务库已启用 pgvector 扩展，新开独立 database 不新增任何基础设施；
- 独立 database 保证 ai-service 不接触业务表，边界清晰；
- LlamaIndex 官方 `PGVectorStore` 支持 metadata filter、批量 upsert、按 filter 删除；
- `VectorStoreGateway` 屏蔽后端差异，数据量增长后可替换 Qdrant 而不改契约。

向量库 schema 由 ai-service 自己管理，**不进 Prisma**，治理机制（块 4 落地）：

- **库**：`cees_ai_vectors` 由 `infra/database/manage-db.sh <env> create-vector-db` 在运行中的 postgres 容器里创建（CREATE DATABASE + CREATE EXTENSION vector），与业务库同实例，不新增基础设施；
- **表**：`knowledge_chunks` 由 ai-service 首次使用时自动创建（PGVectorStore 初始化时建表并启用 vector 扩展），向量维度由 `KNOWLEDGE_VECTOR_DIMENSION` 决定；LlamaIndex PGVectorStore（0.9.x）会在传入表名前加 `data_` 前缀，数据实际落在 `data_knowledge_chunks`（索引名与检索 SQL 同理按 `data_` 前缀处理）；
- **HNSW 索引**：PGVectorStore 初始化时声明 `hnsw_kwargs`（`m=16`、`ef_construction=64`、`ef_search=64`、`vector_cosine_ops`）自动建 HNSW 索引，索引名 `data_knowledge_chunks_embedding_idx`；存量表由管理脚本补建索引（`manage-db.sh <env> create-vector-indexes`，建在 `data_knowledge_chunks` 上）。小数据量下与 IVFFlat 差异不大，HNSW 的查询性能优势随知识库规模增长体现（块 7a 已落地）；
- **版本治理**：向量表结构不原地迁移——切换 embedding 模型或切分策略时创建新 `index_version` 并行重建，旧版本由 `index/delete` 清理（见 3.4），避免重建期间读请求落在半迁移表上。

`DocumentChunk` 表保留为业务侧引用定位事实源（citation 映射 document / page / bbox 时由 NestJS 查询），其 `embedding` 字段已在块 3 迁移 0026 中删除。

### 3.2 编排：NestJS Job Worker 编排

采用方案推荐的 API Worker 编排：NestJS 从 COS 取文件、调用 MinerU、把解析产物转成中间格式后提交 ai-service 索引。

理由：ai-service 不访问 COS（遵守「COS 长期凭证只由 NestJS 持有」）；业务任务状态、重试、幂等由 NestJS 持久化，与 Assistant turn 的状态机模式一致。MinerU 任务本身不是业务事实源。

**块 6 真机接入（192.168.5.29，已端到端验收）**：MinerU 3.4.5 以 `mineru-api` FastAPI 服务常驻宿主机（端口 8002，与 ai-service 容器的 8000 错开），NestJS Worker 经 `MINERU_API_URL` 同步调用 `POST /file_parse`（multipart 上传原始文件，`backend=pipeline`、`return_content_list=true`、`return_md=true`）。解析产物在 NestJS 侧经 TS 版 `mineru-artifact-reader` 转为中间格式（语义与 ai-service 侧 Python reader 对齐，两侧各自测试），优先取 `content_list`，缺失时回退 Markdown。错误语义：网络错误/超时/5xx 与 COS 下载失败可重试（worker 已有 3 次上限），未配置 `MINERU_API_URL`、HTTP 4xx、解析失败（兼容 `PARSE_RC≠0` 与 3.4.5 服务模式顶层 `status≠completed`）、无可用产物直接置 FAILED。当前为单通道串行（不做多解析器并发），解析排队但不影响上传。配置项见 `.env.example`（`MINERU_API_URL`/`MINERU_API_TIMEOUT_MS`/`MINERU_API_LANG_LIST`）。

**MinerU 3.4.5 服务模式响应结构**（真机实测，TS parser 已按此适配）：`POST /file_parse` 返回 `{task_id, status: "completed"|failed", version, error, results}`——`results` 是按文件名（去扩展名）索引的对象，每项的 `content_list` 是 JSON **字符串**（解析后为 `[{type, text, bbox, page_idx}]`）；任务状态看顶层 `status`，失败时 `error` 携带原因，旧版 `PARSE_RC` 字段一并兼容。

**测试环境 Embedding**：29 宿主机以 systemd `cees-embedding` 常驻本地 BGE 服务（端口 8003，复用 MinerU venv，modelscope 下载 `bge-small-zh-v1.5`，512 维，OpenAI 兼容 `POST /v1/embeddings`，CPU 推理）。`models.staging.toml` 的 `embedding_profiles.primary` 指向该服务；API 侧 `KNOWLEDGE_EMBEDDING_PROFILE=primary` 保证索引与查询用同一 profile。此为测试环境临时方案，生产环境建议直接使用 OpenAI-compatible 云 embedding（如 DashScope/SiliconFlow）并同步调整 `KNOWLEDGE_VECTOR_DIMENSION`。

### 3.3 中间格式

业务代码不直接依赖 MinerU 原始 JSON，中间格式在内部契约中定义（见第 6 节）：`ParsedDocument` 含 `document_id`、`document_version_id`、`parser_name`、`parser_version` 与有序 `blocks`；`ParsedBlock` 含 `block_id`、`type`、`text`、`page_index`、`bbox`、`heading_path`、`source_order`、`asset_ref`。

### 3.4 Embedding 与索引版本

新增 `EmbeddingRouter`（`app/embeddings/`），与 LLMRouter 分离；`models.toml` 的 `rag` role 只用于答案生成，不承担 embedding 配置。块 2 落地了路由解析与维度校验，块 4 已接入真实 provider：`[embedding_profiles.*]` 声明 OpenAI-compatible embedding 模型（`embedding_profiles.primary`，默认禁用，启用后 `EMBEDDING_API_KEY` 必填），输出统一 L2 归一化；未启用任何外部 profile 时回退确定性 `deterministic` provider（开发/测试用）。OpenAI-compatible 客户端构造时关闭 langchain 的 `check_embedding_ctx_length`（开启会把文本转成 token ID 发给 `/embeddings`，自建服务如 BGE 只接受原始字符串，会以 422 拒绝）。

版本三元组 `(chunking_version, embedding_profile, index_version)` 是索引身份的一部分：

- 切换 embedding 模型或切分策略时创建新 `index_version`，完成重建后再切换读取版本，不覆盖旧向量；
- 索引请求必须声明三元组，检索请求必须声明 `index_version`；
- 向量库中每个节点携带该三元组，删除按 `(tenant_id, document_version_id, index_version)` 过滤。

pgvector 表维度在建表时固定（`KNOWLEDGE_VECTOR_DIMENSION`），而内置 `deterministic` 是 384 维开发用哈希向量：pgvector 模式下索引与检索若解析到 `deterministic`，ai-service 前置拒绝为配置错误 `EMBEDDING_PROFILE_MISCONFIGURED`（500，`retryable=false`），不会拖到写入阶段才报维度不匹配，也不会在维度碰巧一致时造成向量空间静默错乱；内存向量库不受此约束（开发/测试仍可用 deterministic）。

### 3.5 权限过滤

ai-service 不自行推断权限。NestJS 计算可信 scope 后随检索请求传入，过滤必须在**向量检索阶段**完成（metadata filter），不是先取全局 top-k 再过滤：

```json
{
  "scope": {
    "knowledge_base_ids": ["kb-1"],
    "allowed_document_ids": ["doc-1"],
    "department_ids": ["dept-2"],
    "project_ids": ["project-3"]
  }
}
```

块 5 检索不传 `acl_version`（无部门/项目时必须显式传空数组，空白名单只放行不带该属性的节点）；该可选字段预留给后续引入 ACL 版本机制与查询缓存时使用（见 4 节）。

节点 metadata 至少携带 `tenant_id`、`knowledge_base_id`、`document_id`、`document_version_id`、`visibility_scope`、`department_id`、`project_id`、`acl_version`；其中 `visibility_scope` 目前只作记录与排查用途，检索过滤由 NestJS 把三层权限折叠成的 `scope` 完成（3.6），ai-service 不直接按 `visibility_scope` 过滤。检索查询缓存（如引入）的 key 必须包含 `tenant_id + 访问者 scope + knowledge_base_id + query + acl_version + index_version`，防止跨用户缓存泄漏。

### 3.6 知识库归属与权限颗粒

**归属锚点单一**：一个知识库只属于一个租户，`tenantId` 是企业隔离底线，不做"多租户字段存储"；租户内按锚点分类——挂项目为项目知识库（一个项目一个知识库，最常见形态）、挂部门为部门知识库、`TENANT` 全员可见、`PRIVATE` 仅成员可见（默认）。跨部门协作不靠锚点，靠成员授权（见下）。

**锚点的两层含义**：

1. 分类与展示：锚点决定知识库的归属类型（项目/部门/公司级），前端据此展示归属标签；
2. 默认访问人群（自动授权）：锚点定义"谁天然是这个知识库的 READER"——项目知识库的项目成员、部门知识库的部门及全部子部门成员（组织树递归，与 `DataScope.DEPARTMENT_TREE` 同口径）、`TENANT` 库全员 READER、`PRIVATE` 库无自动授权人群。

**锚点自动授权的权限边界**（块 8 已落地）：

- 自动授权是**动态计算的虚拟 READER**，不物化 `KnowledgeBaseMember` 行；访问判定 = 成员表显式授权 ∪ 锚点自动授权，自动授权恒为 `READER` 级、不升级为 `EDITOR`/`MANAGER`；
- 显式成员授权独立于锚点：锚点人群之外可通过成员表加入（跨部门/跨项目协作），锚点人群之内可通过成员表升级为 `EDITOR`/`MANAGER`；成员退出项目/部门后，其显式授权**不自动删除**（显式授权显式撤销）；
- RBAC 权限码仍是门槛：`knowledge_base.*` 权限由角色授予，锚点只解决资源归属判定（谁能读这个知识库），不替代权限码（能做什么）；
- 锚点人群变化即时生效（虚拟计算，无同步任务），项目/部门成员增删不需要批处理。

**锚点约束与生命周期**（块 8 已落地）：

- 二选一互斥：`departmentId` 与 `projectId` 不能同时设置，都空即 `PRIVATE`（仅成员）；创建/修改时校验指向的部门/项目属于当前租户且未删除；
- 修改规则：`MANAGER`（或 `knowledge_base.manage_all`）可修改锚点，走乐观锁 `version`，审计记录 before/after；
- 悬挂处理：锚点指向的项目/部门被删除后，锚点保留（历史归属可追溯）但自动授权自然失效（人群动态计算天然处理）；管理界面提示锚点已失效、MANAGER 可重新挂接或清空为 `PRIVATE` 的能力尚未落地（见产品文档后续阶段）。

**与查询链路的关系**：锚点不改变 ai-service 检索过滤——scope 折叠仍按文档版本可见范围（见下与 3.5），过滤在向量检索阶段完成；锚点影响的是 NestJS 侧的知识库成员判定（`requireKnowledgeBasePermission`）与列表可见范围（`listKnowledgeBases` 内联合并成员记录与 `listAnchorKnowledgeBaseIds` 的锚点库，并标注每库 `myPermission`），把锚点人群并入。锚点人群进入知识库后仍受文档版本可见范围收窄。

**可见性分层**（版本级，`DocumentVersion.visibilityScope`）：

| 层级 | 谁能看到 |
| --- | --- |
| `TENANT` | 全公司 |
| `DEPARTMENT` | 本部门及全部子部门（按组织树向下递归解析，对应 `DataScope.DEPARTMENT_TREE`） |
| `PROJECT` | 项目成员 |
| `PRIVATE` | 仅知识库成员：**不同部门的人加为成员即可看到同一个知识库**，不要求同部门 |
| `CUSTOM` | 自定义范围（预留） |

**读写权限三层叠加**：

1. 组织数据范围：`Role.dataScope` 决定角色覆盖企业/部门/部门的树/项目等哪些数据；
2. 知识库成员：`KnowledgeBaseMember`（knowledgeBaseId + userId + permission）显式授权，是跨部门协作的落点，也是"以项目为颗粒分配读写"的落点（项目级知识库可由项目成员自动获得，也可按成员表逐个授权）；
3. 文档级可见范围：版本级 `visibilityScope` 在上述基础上进一步收窄；检索时 NestJS 把三层折叠成 `scope`（见 3.5）传给 ai-service，过滤在向量检索阶段完成。

**表设计现状与差距**：

- `KnowledgeBaseMember` 已存在（`@@unique([tenantId, knowledgeBaseId, userId])`），跨部门共享同一知识库的余地已留；块 5 迁移已把 `KnowledgeBaseMember.permission` 在数据库层收敛为枚举（Prisma enum，对应应用层 `READER` / `EDITOR` / `MANAGER`）；
- `DocumentVersion` 已带 `visibilityScope` + `departmentId` / `projectId`；
- `KnowledgeBase` 的 `departmentId` / `projectId` 锚点字段已由块 5 迁移补上（可选，二选一，都空即 `PRIVATE`）；块 8 已落地锚点管理与自动授权：公开契约暴露 `visibilityScope` / `departmentId` / `projectId` 与每库 `myPermission` 标注，创建/修改接口校验归属指向当前租户且互斥（`KNOWLEDGE_BASE_SCOPE_INVALID`），锚点人群动态计算为虚拟 READER（不物化成员行），查询库列表/详情/文档列表对锚点人群放行；`POST /knowledge-bases/{id}/query` 与助手检索不对锚点人群放行（成员-only）；知识库权限码收敛为五码（`create` / `read` / `read_all` / `query` / `manage_all`），写操作深度由成员等级校验（MANAGER 管理资料与成员、EDITOR 写文档）。

### 3.7 解析器格式分流（MinerU + 本地提取）

文档按本质分两类解析路径，统一由 NestJS `KnowledgeDocumentParser` 按 mimeType 分流，知识库链路与对话附件注入共用同一分流规则：

| 类别 | 格式 | 解析路径 | 依据 |
| --- | --- | --- | --- |
| 文本原生格式 | md / txt / csv / json / docx / pptx / xlsx | 本地确定性提取（ai-service `app/extraction`：python-docx / stdlib zip-xml / 直接读取） | 文本本来就在文件里，提取是无损、毫秒级、零模型依赖的操作 |
| 视觉/版式格式 | pdf / 图片 | MinerU pipeline（版面分析 → OCR → 表格重建） | 文本"画"在页面上（扫描件/复杂版式），需要 GPU 模型还原 |

设计要点：

- 分流按 mimeType 判断（上传链路已有白名单，`apps/api/src/file/file.service.ts` 的 `ALLOWED_ATTACHMENT_CONTENT_TYPES`）；
- 文本类提取产物无页码/bbox，包装为 `ParsedDocument` 时按段落切 block、`page_index`/`bbox` 为 null，与 MinerU 产物同构（citation 的定位信息缺失时前端不展示）；
- 错误语义：本地提取失败不可重试（文件损坏/不支持/超过接口上限 10 MiB 直接 FAILED）；提取服务不可用（网络/5xx）可重试；MinerU 的网络错误/超时/5xx 可重试（与块 6 语义一致）；
- **PDF 双态**：当前阶段 pdf 一律走 MinerU（块 6 已端到端验收，质量有保证）；文本型 pdf 的 pymupdf 快速路径作为可选优化延后评估；
- docx/pptx 内嵌图片：本地提取只拿文本，内嵌视觉内容不在当前阶段解析（验收标准为"可抽取为文本"）；后续需要时把内嵌图片单独抽出走 MinerU OCR；
- 落点：ai-service extraction 已具备文本类能力（附件注入在用）；知识库侧接入点为 NestJS 组合解析器 `RoutedKnowledgeDocumentParser`（块 7a 已落地），文本类走 `/internal/v1/files/extract`（`FileExtractionRequest`，上限 10 MiB，提取引擎记入 `parser_version`），提取文本经 `text-artifact-reader.ts` 按段落包装为 `ParsedDocument`。

### 3.8 对话数据转知识库（块 7c）

把对话中产生的三类数据（附件文件、AI 生成文档、对话消息）转存为知识库文档，走既有「解析 → 索引」链路。转存是写入操作，比检索的 READER 门槛更高（EDITOR），且**与对话级"知识库"检索开关解耦**：勾选开关管"读"（AI 回答时引用知识库），转存是资源级"写"动作，不依赖开关状态。AI 生成产物默认只存于受控文档（document 模块），**绝不自动全存**——进入知识库永远是显式动作（资源卡片按钮或自然语言），否则知识库沦为垃圾场。

**统一物化模型（三类来源同构）**：转存 = 把来源内容物化为一个 FileObject 快照 → 首次转存 `createDocument`、重复转存 `createDocumentVersion`，与人工上传文档完全同构（同一状态机、同一索引链路、同一审计）：

- 附件文件：直接复用其 FileObject；
- AI 生成文档 / 对话消息：以当前内容物化新 FileObject（文本快照，写入 COS）。

**版本演进（同源重复转存 = 追加新版本，不覆盖不新建）**：来源锚定用 `source_type`（FILE_OBJECT / DOCUMENT / MESSAGE）+ `source_id` 唯一约束（块 7c 迁移落于 KnowledgeDocument）；同源重复转存命中已有文档 → 追加 DocumentVersion（内容为最新快照），状态回 PENDING 重新解析索引，旧版本索引后台清理（"先写新后删旧"，读请求只见全旧或全新）；同源文档被删除后再转存到同一库 → 恢复文档（软删回滚 + 审计 `KNOWLEDGE_DOCUMENT_RESTORED`）并追加新版本，仍拒绝对其他库的转存。AI 修改受控文档**不自动同步**知识库，必须再次显式转存。

**双层入口，同一落点**：

1. **确定性按钮**（不经过模型）：附件卡片 / 生成文档卡片 / 消息上的"存入知识库"操作，弹确认框选目标库（列出用户 EDITOR 权限的库）与可见范围，直接调 `POST /knowledge-bases/{id}/documents`；
2. **`save_to_knowledge` 工具**（自然语言快捷路径）：用户用自然语言表达存储意图时，模型识别意图、定位资源、提议目标库后调用；工具只是提议，落库复用同一公开接口（AI 产物与人工产物同构）。两条参数路径：引用已存在资源（`sourceType`+`sourceId`，如附件/生成文档/消息）或**内容直存**（`content`，用户口述或模型整理自用户表达的内容文本，物化为新文档、不锚定来源，每次直存都是新文档）。

**目标库选择**（用户决定，AI 只提议）：自然语言明确指明 → 模型解析该库、后端校验 EDITOR；未指明且有歧义 → 模型回问用户列出候选库，绝不替用户挑；校验失败（无权限/库不存在）→ 拒绝并回喂模型更换目标。一份来源同时只存一个库（来源锚定唯一约束）；要多库存储需再次物化。转存文档可见范围默认 PRIVATE，用户在确认界面可调整。`list_knowledge_bases` 列出用户可见的全部知识库并标注各自成员权限：回答「我有哪些知识库」时如实全列；转存场景只从 EDITOR 及以上候选中提议。

**模型侧约束（写入工具描述与系统提示词；早期称「三条红线」，后扩展为以下五条）**：

1. 无明确存储意图 → 模型绝不自主转存：用户未明确表达"保存/存入/收录"等意图时不得调用存储工具，不做自动知识沉淀；
2. 转存只能引用真实资源：引用资源时工具参数必须引用已存在的资源 ID（fileObjectId / documentId / messageId），模型不得把自创文本作为来源引用；内容直存路径（`content` 参数）的内容必须来自用户明确口述或经用户确认的整理文本，模型不得编造内容写入；
3. 目标知识库由后端校验：模型建议的目标库经 NestJS 校验用户 EDITOR 权限，校验失败拒绝并回喂模型更换目标；执行前仍走 ToolPolicy 权限码审批（第二点检查）。
4. 工具回喂脱敏与语言约束：summary 中 `knowledge_base_id` 等内部标识只供后续工具调用引用，不得转述给用户；权限向用户说明时只用中文表述（只读/可编辑/管理员），不输出 READER/EDITOR/MANAGER 枚举词（写入工具 instruction）；对话系统提示词（ai-service `BASE_SYSTEM_PROMPT`）要求始终以简体中文回复、不向用户暴露任何内部标识（资源 ID / 文档 ID / 知识库 ID / 权限枚举）。
5. 检索优先：`knowledge_search` 工具可用时（开关开启），用户询问人员/团队/项目/制度等内部信息类问题必须先调用检索，不得在未检索时声称没有信息或反问用户（写入 `BASE_SYSTEM_PROMPT` 与工具 description）。

**落地状态（块 7c 已落地）**：

- 后端：`KnowledgeDocument` 增加 `source_type` / `source_id` 锚定与部分唯一索引（同库同源唯一，跨库拒绝 `KNOWLEDGE_SOURCE_ALREADY_SAVED`）；`FileService` 提供文本物化快照；`KnowledgeDocumentService.saveFromSource` 统一承接三类来源（FILE_OBJECT / DOCUMENT / MESSAGE），首次转存 `createDocument`、同源重复转存追加新版本并回 PENDING；MESSAGE 校验租户、`conversation.ownerMembershipId === actor.membershipId`、拒绝 TOOL 角色，工具路径另限定 `conversationId`；DOCUMENT 要求用户可读；name 留空时按来源取默认（FILE_OBJECT 用原文件名、DOCUMENT 用文档标题、MESSAGE 用「对话消息 {YYYY-MM-DD HH:mm}」）；`saveDirectContent` 承接内容直存（物化 Markdown 快照 + 无锚定新建文档 + 审计 `directContent: true`，name 留空取「对话内容 {YYYY-MM-DD HH:mm}」）；`save_to_knowledge` 工具参数校验强制 `sourceType+sourceId` 与 `content` 二选一（content 上限 20000 字符）；`save_to_knowledge` / `list_knowledge_bases` 两个 Assistant 工具已注册（提议 + 后端 EDITOR 校验 + 权限码审批）；`list_knowledge_bases` 返回当前用户可见的全部知识库（任意成员等级，含 READER）并标注每个库的成员权限 `myPermission`，既回答「我有哪些知识库」也为转存提供候选（转存仅 EDITOR/MANAGER 可写，`manage_all` 短路统一标 MANAGER，`read_all` 短路统一标 READER）；`create_knowledge_base` 工具已注册（`knowledge_base.create` 权限，WRITE 风险级）：用户明确要求创建知识库时以用户确认的名称创建（创建者自动成为 MANAGER），与公开创建接口共用同一事务体。工具回喂脱敏：summary 携带内部 ID 的 instruction 均明确「不得向用户展示」；工具调用轮次的模型文本（如「I'll check…」预告语）由 turn-runner 缓存，不发布为公开事件，纯回答轮再补发（保持最终回答流式）。
- `list_documents` 工具（`document.read` 权限，READ 风险级）于 2026-09-20 落地（见 [AI 助手工具循环](assistant-tool-loop.md) 第 18 节）：助手可在对话中检索当前用户可读的文档库文档，并在用户确认后经 `save_to_knowledge`（`sourceType: DOCUMENT`）把指定文档转存为知识库内容，「文档库 → 知识库」的自然语言转存路径由此闭合；转存仍走块 7c 的 `saveFromSource` 统一链路（用户可读文档 + 目标库 EDITOR 校验）。
- 桌面端（desktop）：三处确定性按钮入口——生成文档卡片、已持久化消息、附件标签，均弹确认框：列出用户 EDITOR 权限的库（`GET /knowledge-bases?permission=EDITOR&limit=100`）供选择，可见范围提供 PRIVATE / TENANT 两级（DEPARTMENT / PROJECT 需归属 id，当前 UI 不提供，后端能力完整保留）；消息入口以该消息文本为内容，名称可在确认框拟定；入口按 `knowledge_base.read` 权限过滤，后端仍二次校验（红线 3）。

### 3.9 助手人设中的功能告知（块 7d）

对话助手（人设/系统提示词）在介绍类问题上主动告知知识库能力，并严守「交流层」边界：

**触发与话术层级**：

1. 用户问"你是谁 / 你能做什么"等介绍性问题：答复中带一句知识库能力（"我可以检索团队知识库，基于公司文档回答问题并标注出处"）；
2. 用户追问"知识库是什么 / 怎么用"：详细解释功能价值与使用方式（上传文档 → 自动解析 → 提问时引用出处；对话中勾选"知识库"开关；也可在对话中让我创建知识库、把对话内容存入知识库），不展开内部实现。

**交流层/系统层边界**（防泄露红线）：AI 答复永远只停留于交流层（功能价值、使用方式、业务规则），绝不涉及系统层——包括但不限于内部模块名（ai-service / NestJS / MinerU / pgvector 等）、内部错误码与权限码、模型名称与向量维度、接口路径与数据库结构、内部标识（documentId 等）。即使用户诱导（"你的系统架构是什么""用的什么数据库"），也拒绝展开并回归功能描述。落地时写入对话 role 的系统提示词，与工具执行器 summary 脱敏规范（回喂内容不含内部信息）互为呼应。

**部分落地（块 7c 收尾时提前落地）**：ai-service `BASE_SYSTEM_PROMPT` 已写入三条硬约束——①始终以简体中文回复（用户明确要求其他语言除外）；②内部标识（资源 ID / 文档 ID / 知识库 ID / 权限枚举）是工具链细节，不得在答复中暴露；③`knowledge_search` 可用时，内部信息类问题必须先检索再回答，不得未检索就声称没有信息或反问用户（检索优先，同时写入工具 description）。工具调用轮次的模型预告语（如英文「I'll check…」）由 turn-runner 缓存不发布。剩余部分（介绍性问题的知识库功能告知话术、诱导提问对抗用例）仍待块 7d。

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
- 孤儿状态回收：超过解析最长耗时 2 倍（`MINERU_API_TIMEOUT_MS` × 2，默认 60 分钟）仍停留在 `PARSING`/`INDEXING` 的文档视为处理进程已丢失（崩溃/重启），轮询时自动回 `PENDING` 重新排队（按原状态条件更新声明所有权，每轮至多 10 个），`lastError` 记录回收原因并写审计（`KNOWLEDGE_DOCUMENT_PROCESS_RECOVERED`，含原状态）；
- 可见范围（`visibilityScope`）是版本级属性，存储在 `DocumentVersion`，索引请求从当前处理版本读取；
- `acl_version` 仍由版本 ID 派生（`acl-{version.id 前 8 位}`）写入节点 metadata，但**不引入 ACL 版本机制**：检索 scope 的 `acl_version` 为可选字段，NestJS 检索时不传（权限由实时 scope 折叠保证），真正的 ACL 版本机制推迟到引入检索查询缓存时再设计；
- 索引请求三元组可通过环境变量覆盖：`KNOWLEDGE_CHUNKING_VERSION`（默认 `knowledge-chunking-v1`）、`KNOWLEDGE_EMBEDDING_PROFILE`（默认 `deterministic`）、`KNOWLEDGE_INDEX_VERSION`（默认 `knowledge-index-v1`）；
- 幂等键 = `(document_id, document_version_id, chunking_version, embedding_profile, index_version)`，同一幂等键重复提交不产生重复节点；ai-service 的 index 是幂等 upsert，替换判定按 `(tenant_id, document_version_id, index_version)` 三元组执行，`chunking_version` / `embedding_profile` 作为索引身份写入节点 metadata，变更 profile 或切分策略必须换新 `index_version`（见 3.4）。块 4 起采用「先写新后删旧」语义：新节点先落地，再删除三元组内的旧行（含同 node_id 旧内容行），读请求只见全旧或全新，不存在先删后写的空桶窗口；add 失败时旧行原样保留，清理失败最坏出现重复行，幂等重试后收敛；
- `index/delete` 契约与 ai-service 端已实现（块 4），删除指定三元组的派生索引；NestJS 接线随块 5 落地：新版本上线后 fire-and-forget 清理旧版本索引、知识库删除后批量清理其全部文档版本索引，清理失败只记日志不阻塞业务，幂等重试后收敛（文档删除功能本身尚未提供，上线后走同一入口）。

## 5. 检索与答案

`retrieve` 与 `answer` 分开：

- `retrieve` 只检索、只返回节点/分数/来源 metadata，不调用 LLM；
- `answer`（块 5 已落地）内部先 retrieve，再用 `LLMRouter`（`rag` role）基于证据生成结构化答案：

```json
{
  "answer": "项目延期超过两周时，需要升级到项目委员会。",
  "citation_ids": ["S1"],
  "insufficient_evidence": false
}
```

- 模型只输出 `citation_ids`，服务端把 ID 映射回真实来源（document / version / chunk / page / bbox / text），不允许模型编造文档 ID、页码或 URL；
- 证据不足时返回 `grounded=false`、`insufficient_evidence=true`，不自由发挥；检索无结果时短路不调用模型；基于分数阈值的拒答尚未实现（原计划随块 6 落地，块 6 验收未纳入，待排期）；
- 公开侧为同步 REST：`POST /knowledge-bases/{id}/query`（公开侧保持同步 REST，不做流式；对话工具链的引用以流式事件 `TurnStreamToolResultEvent.citations` 携带，块 7b 落地）；NestJS 折叠三层权限为 scope、调用 `answer`，成功写入 `KnowledgeQueryLog`（含知识库、grounded、耗时与 Token 用量）与审计，ai-service 不可用时统一映射 `503 KNOWLEDGE_QUERY_SERVICE_UNAVAILABLE` 并写失败审计；

## 6. 内部契约

在 `packages/contracts/openapi/ai-service.openapi.yaml` 中新增 `knowledge` tag 与路径，全部受 `internalToken` 保护：

| 方法与路径 | 用途 | 状态 |
| --- | --- | --- |
| `POST /internal/v1/knowledge/index` | 接收 ParsedDocument，切分、Embedding、幂等写入向量库 | 已实现（块 2） |
| `POST /internal/v1/knowledge/retrieve` | 按可信 scope 检索，返回节点与来源 metadata | 已实现（块 2） |
| `POST /internal/v1/knowledge/index/delete` | 删除指定文档版本 + 索引版本的派生索引 | 已实现（块 4） |
| `POST /internal/v1/knowledge/answer` | retrieve + LLMRouter 生成带引用校验的答案 | 已实现（块 5） |

## 7. 与后续公开 API 的关系

公开知识库问答 API（`POST /knowledge-bases/{id}/query`，块 5 已落地）与 Assistant RAG 工具都属于 NestJS 公开侧，共用上述内部契约：

- 独立公开 Query API 已跑通「解析产物 → 索引 → 检索 → 引用」闭环（块 5 落地）；
- 把 RAG 检索注册为 Assistant 工具（块 7b 已落地）：
  - `knowledge_search` 工具（版本 1.0.0，`knowledge_base.query` 权限，READ 风险级）注册进 Assistant 工具链；
  - 对话级开关：`CreateTurnRequest.knowledgeBaseEnabled`（可选，默认 false）决定本轮是否暴露/允许 `knowledge_search`；关闭时工具列表被过滤，且工具执行前二次校验兼底（拒绝时 `ToolPolicyError` 告知用户「未在本轮启用」）；
  - 检索走 `KnowledgeService.searchKnowledgeForAssistant`：显式传 tenantId/userId/membershipId/permissions（后台执行不依赖 AsyncLocalStorage），`manage_all` / `read_all` 短路为全租户库，否则按成员可见库折叠三层 scope；ai-service 不返回标题时按 `document_id` 查 `KnowledgeDocument` 补标题；
  - 回喂模型的 summary 只含业务内容（S1 标签/标题/snippet/pageIndex），不含 document_id/chunk_id/知识库 ID 等内部标识；
  - 公开侧 `TurnStreamToolResultEvent` 新增可选 `citations`（兼容新增，老客户端忽略），desktop 渲染知识库引用卡片（标题+摘录+页码），并按轮次归组恢复：`GET /conversations/{id}` 的 TOOL 消息回传该轮次的 `citations`，前端按 `turnId` 挂回同一轮的助手回答，不再使用会话级 `localStorage` 缓存，避免历史引用串到最新回答；引用契约 `KnowledgeToolCitation` 新增可选 `knowledgeBaseId`/`deletable`（块 9 落地）：`deletable` 由 NestJS 按当前用户对引用文档所属库的成员等级（EDITOR/MANAGER 或 `manage_all`）逐用户计算，仅 `deletable` 的引用卡片展示删除入口（二次确认后调正式 DELETE 文档端点），AI 工具层不提供删除能力；
  - 多库检索时 `KnowledgeQueryLog.knowledgeBaseId` 记 null，审计 `resourceId` 为 null、`metadata.knowledgeBaseIds` 记录实际范围（块 7b 落地）。

## 8. 分块实施计划

| 块 | 内容 | 依赖 | 状态 |
| --- | --- | --- | --- |
| 1 | 本文档 + 内部契约 `index`/`retrieve`（0.3.0） | 无 | ✅ 已落地 |
| 2 | ai-service 内存闭环（`parsed_models`、`mineru_artifact_reader`、`node_builder`、`EmbeddingRouter`、内存 VectorStore、`ingestion`/`retrieval`、HTTP 路由 `index`/`retrieve`），pytest 覆盖 | 块 1 | ✅ 已落地 |
| 3 | NestJS `KnowledgeDocument` 状态机 + `DocumentChunk` 迁移改造（删除 embedding 字段）+ 上传触发索引任务 | 块 1 | ✅ 已落地 |
| 4 | 真实 pgvector Gateway（独立 `cees_ai_vectors` database）+ `index/delete` 契约 | 块 2 | ✅ 已落地 |
| 5 | 公开 Query API + `answer` 契约（LLMRouter rag role）+ citation 校验 + 索引删除 NestJS 接线 | 块 2、4 | ✅ 已落地 |
| 6 | MinerU 真机联调（192.168.5.29，MinerU 3.4.5 + pipeline 后端已部署验证） | 块 3 | ✅ 已验收 |
| 7a | 解析器格式分流（3.7 节）+ pgvector HNSW 索引（3.1 节） | 块 3、6 | ✅ 已落地（真机待部署验收） |
| 7b | Assistant RAG 工具接入：`knowledge_search` 工具注册 + 对话级知识库开关 + 权限折叠检索 | 块 5 | ✅ 已落地 |
| 7c | 对话数据转知识库（3.8 节：双层入口 + 三条红线；附件/AI 生成文档/对话消息）+ 助手可见库清单与创建知识库工具 | 块 3、7b | ✅ 已落地 |
| 7d | 助手人设功能告知与交流层边界（3.9 节） | 块 7b | 部分落地（语言约束与内部标识脱敏已写入 BASE_SYSTEM_PROMPT；介绍类告知话术待落地） |
| 8 | 知识库归属锚点管理与自动授权（3.6 节：项目/部门/公司级分类、锚点人群虚拟 READER、悬挂处理）+ 权限码收敛与知识管理页面 | 块 5 | ✅ 已落地 |
| 9 | 文档删除（公开 DELETE 端点 + 软删/审计/异步向量清理 + 索引删除竞态处理 + 对话引用卡片 deletable 删除入口） | 块 4、7b、8 | ✅ 已落地 |

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
| 5 | jest 38 用例（scope 折叠、查询日志、失败审计、索引删除接线）+ pytest 全绿（answer 空结果短路、rag role、citation 校验、acl_version 可选、空白名单空数组保护）；契约校验与客户端重生成 | ✅ 完成 |
| 6 | jest 23 用例（TS 版转换器与真机 parser 错误映射、3.4.5 服务模式响应结构）+ pytest 全绿（embedding router/维度校验、pgvector 拒绝 deterministic 前置拦截）；29 真机端到端验收通过：上传 PDF → MinerU 解析 → pgvector 索引 → READY → 查询 grounded=true 带 citations | ✅ 完成 |
| 7a | jest 73 用例（mimeType 分流、提取错误语义、文本产物包装）+ pytest 16 用例（HNSW 索引落在 `data_knowledge_chunks`、hnsw_kwargs 每实例完整）+ ruff/tsc 全绿；29 真机 docx 上传经本地提取 READY 待部署后验收 | ✅ 本地完成 |
| 7b | jest 34 用例（开关关闭过滤工具并二次校验拒绝、权限折叠检索（成员+manage_all）、summary 脱敏、标题补全、多库日志与审计范围）；tsc 全绿；契约兼容检查（redocly lint + api-client 重新生成）；desktop tsc + 生产构建通过（开关结构化传参、citations 卡片渲染与恢复） | ✅ 完成 |
| 7c | jest：saveFromSource 13 用例（物化快照、EDITOR 校验、MESSAGE 归属/TOOL 拒绝、可读文档命名、同源追加版本、跨库拒绝、并发锚点冲突、source 字段互斥）+ saveDirectContent 2 用例（无锚定直存 + 权限拒绝）+ 工具 8 用例（save_to_knowledge 含 content 直存路径与二选一校验 / list_knowledge_bases 含脱敏指令：审批/EDITOR 校验/无意图不转存/引用不存在拒绝）+ 助手可见库清单 3 用例（权限标注/非成员空结果/manage_all 短路）+ create_knowledge_base 3 用例（注册/参数校验/显式上下文创建与回喂新库 id + 脱敏指令）+ turn-runner 工具轮预告语不发布 1 用例 + knowledge_search description 检索优先断言 2 例；pytest：chat context 7 用例（含语言/脱敏/检索优先约束 prompt）；tsc 全绿；契约校验 + 客户端重生成；desktop tsc + 生产构建通过（三入口 + 确认框） | ✅ 完成 |
| 8 | jest：权限收敛（5 码目录/迁移/旧码清理）与锚点行为 118 用例（创建互斥校验、部门树可见、项目/全员锚点、助手标注、query 拒绝锚点、审计 before/after）+ 更新锚点契约 null 语义；redocly lint + api-client 重新生成；desktop tsc + 生产构建通过（知识管理页面：库 CRUD/归属表单/成员管理） | ✅ 完成 |
| 9 | jest 117 用例（软删/审计/向量清理、READER 拒绝、文档不存在、索引删除竞态、deletable 逐用户计算与 citations 透传）；redocly lint + api-client 重新生成；desktop tsc + 生产构建通过（管理页删除入口 + 对话引用卡片删除与已删除态）；重复文档清理验证（业务表软删 + 审计 + 向量库一致） | ✅ 完成 |
| 7d | jest/真机：介绍性问题带知识库功能告知；诱导提问不泄露系统层信息（抽样对抗用例） | 待验证 |
