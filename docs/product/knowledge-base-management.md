# 知识库管理

> 状态：第一至六阶段已落地（知识库与成员管理、文档上传与处理状态机、公开知识库查询、对话数据转知识库、权限收敛与归属锚点+知识管理页面、文档删除）
> 最后同步：2026-09-18
> 公开契约版本：`0.31.0`

## 1. 阶段范围

知识库属于租户业务域，业务事实源位于 `apps/api`。

第一阶段完成知识库本身和成员授权管理：

- 知识库创建、查询、修改和软删除；
- 知识库成员添加、权限修改和移除；
- `READER`、`EDITOR`、`MANAGER` 三级知识库权限；
- 当前租户隔离、成员可见范围和 `knowledge_base.manage_all` 管理范围；
- 乐观锁、RBAC 和操作审计；
- OpenAPI 契约和 TypeScript 客户端生成。

第二阶段落地文档上传与处理状态机：

- 复用文件模块上传文件对象，再关联为知识库文档；
- 文档版本管理，可见范围是版本级属性；
- `PENDING -> PARSING -> PARSED -> INDEXING -> READY / FAILED` 处理状态机；
- 失败自动重试（默认上限 3 次）与手动重试；
- 后台索引任务由 NestJS Worker 轮询推进，上传/新版本/重试后即时触发。

第三阶段落地公开知识库查询：

- 同步 REST 接口按知识库内容回答问题（`knowledge_base.query` 权限）；
- 服务端把组织数据范围、知识库成员、文档可见范围折叠成检索 scope，过滤在向量检索阶段完成；
- 答案只依据知识库内证据生成，证据不足明确拒答；引用明细（文档/版本/块/页码/位置）随响应返回；
- 每次提问写入 `KnowledgeQueryLog` 与审计；ai-service 暂不可用时返回 `503` 并记入失败审计。

文档解析已接入真机 MinerU 3.4.5（测试环境 192.168.5.29 完成端到端验收：上传 → 解析 → 索引 → 查询闭环）；`DocumentChunk` 表读写尚未启用，当前引用明细直接由 ai-service 响应携带。生产环境以 Docker 容器方式部署 MinerU 并换用大规模 GPU 硬件。

第四阶段落地对话数据转知识库：

- 附件文件、AI 生成文档、对话消息三类来源经来源锚定（`sourceType` + `sourceId`）转存为知识库文档；
- 转存先把来源物化为文件快照，进入与人工上传相同的解析 → 索引链路；同一来源只能存入一个知识库，重复转存到同一知识库追加新版本；
- 转存要求成员 `EDITOR` 权限；桌面端提供生成文档卡片、消息、附件标签三处「存入知识库」入口与确认框（选目标库与可见范围），Assistant 提供 `save_to_knowledge` 工具（自然语言快捷路径：模型只提议，后端校验 EDITOR 与来源归属）。对话中用户口述要保存的内容时，模型可整理为文本经 `content` 参数直存（物化为新文档，不锚定来源，每次直存都是新文档；内容必须来自用户明确口述或经用户确认）；
- `content` 直存是**短文本**通道，上限 800 字符：它是模型逐段生成的流式工具参数，受工具调用模型输出上限约束。长文档（附件、生成文档、对话中的长内容）必须走 `sourceType` + `sourceId` 引用；超过上限时参数校验会拒绝并提示模型改用引用路径，避免 JSON 中途截断导致整轮失败；
- 长文档的自然语言保存链路：助手上下文中会附带「本轮用户消息附带的文件」清单（`file_id` + 文件名），模型据此以 `sourceType: FILE_OBJECT` 调用 `save_to_knowledge`；若模型未能完成，历史消息上按每个文档附件直接提供「存入知识库（附件 N）」按钮，用户不必重新上传。
- Assistant 的 `list_knowledge_bases` 工具列出当前用户可见的全部知识库（含只读库）并标注每个库的成员权限（READER/EDITOR/MANAGER），回答「我有哪些知识库」；转存候选只取 EDITOR 及以上；
- Assistant 的 `create_knowledge_base` 工具在用户明确要求时创建知识库（`knowledge_base.create` 权限，创建者自动成为 MANAGER），名称与说明须经用户确认；
- 对话侧脱敏与语言约束：知识库 ID、权限枚举（READER/EDITOR/MANAGER）等内部标识不得出现在 AI 答复中（答复统一用简体中文，权限用「只读/可编辑/管理员」表述）；工具调用过程中的模型预告语不对用户展示；
- 检索优先：开关开启时，人员/团队/项目/制度等内部信息类问题必须先检索知识库再回答，不得未检索就声称没有信息或反问用户；
- 来源锚定字段、部分唯一索引与迁移落于 `20260916094414_add_knowledge_document_source_anchor`。

第五阶段落地权限收敛与归属锚点、知识管理页面：

- 权限码收敛为五码（`knowledge_base.create`/`read`/`read_all`/`query`/`manage_all`），删除与库内成员等级重叠的 `update`/`delete`/`member.manage`/`document.manage` 旧码，旧码持有者不降权（写操作深度改由库内成员等级驱动）；迁移 `20260917064450_converge_knowledge_base_permissions`；
- 知识库归属锚点：`visibilityScope`（PRIVATE/DEPARTMENT/PROJECT/TENANT）+ `departmentId`/`projectId` 二选一互斥，锚点人群（部门树成员/项目成员/全员）动态计算为虚拟 `READER`（不物化成员行，只覆盖库级浏览）；创建/修改校验归属属于当前租户（`KNOWLEDGE_BASE_SCOPE_INVALID`）；迁移 `20260917065945_knowledge_base_visibility_scope`；
- 公开知识库响应增加 `myPermission` 标注当前用户成员等级（`manage_all` 恒 MANAGER、成员等级优先、其余恒 READER），前端据此控制编辑/成员管理入口；
- 桌面端「知识管理」页面：库列表与搜索、创建/修改（含归属表单：部门树/项目选择）、删除、成员管理（添加/改级/移除，创建者保留 MANAGER 不可降级移除）；页面入口按 `knowledge_base.read`、创建按 `knowledge_base.create`、编辑与成员管理按 `myPermission` 为 MANAGER（或 `manage_all`）。
- 桌面端「文档管理」面板：文档列表（名称/处理状态/版本/可见范围/失败原因）、上传文档（拖动或点击选择 PDF、Word、Excel、PPT、CSV、Markdown、TXT、JSON 与图片，文件先直传 COS 登记文件对象再关联创建文档进入解析索引队列，文档名默认取文件名可改）、失败重试、删除（带二次确认，`myPermission` 为 EDITOR 及以上或 `manage_all` 才展示入口）；库内上传统一按 `PRIVATE`（仅知识库成员可见）提交，不做文档级范围选择（文档级可见范围是版本级属性，后端与转存链路保留 `TENANT` 等能力）；上传/重试/删除按 `myPermission` 为 EDITOR 及以上（或 `manage_all`）开放，只读成员仅可浏览；存在处理中的文档时列表每 5 秒自动刷新，全部落定后停止。

第六阶段落地文档删除：

- 删除为软删除：业务记录打 `deletedAt`（列表与检索即时不可见），事务内写入 `KNOWLEDGE_DOCUMENT_DELETED` 审计，异步清理该文档全部版本的向量索引；处理中（`PARSING`/`INDEXING`）的文档同样允许删除，索引流程在提交 `READY` 前检查 `deletedAt`，已删文档不再标回 `READY` 并补删刚写入的向量索引，避免残留可检索向量；
- 删除门槛与文档写入一致：知识库成员 `EDITOR` 及以上（`manage_all` 短路放行），接口层要求 `knowledge_base.read` 权限码；
- 桌面端删除入口有两处：知识管理页文档列表（EDITOR 及以上可见，二次确认）与对话页知识库引用卡片（引用右上角删除图标）；引用卡片删除能力由后端逐用户计算 `deletable` 标记（当前用户为引用文档所属库的 EDITOR/MANAGER 成员或 `manage_all`），仅 `deletable` 的引用才展示删除入口，删除成功后卡片转为「已删除」态并同步会话级引用缓存；AI 工具层仍不提供删除能力，删除必须由人点击入口、经正式 API 执行；
- 引用契约 `KnowledgeToolCitation` 增加可选 `knowledgeBaseId` 与 `deletable` 字段（老缓存无该字段自然不展示删除入口）。

## 2. 知识库可见范围

所有查询都自动使用当前 JWT 中的 `tenantId`，客户端不能提交租户 ID 来改变数据范围：

- 普通成员只能查询自己在 `knowledge_base_members` 中加入的知识库，以及归属锚点覆盖自己所在人群的知识库（挂部门的库对部门及全部子部门成员可见，挂项目的库对项目成员可见，`TENANT` 全员可见，`PRIVATE` 仅成员可见）；
- 锚点人群是动态计算的虚拟 `READER`，不物化成员行；锚点人群之外可通过成员表加入（跨部门/跨项目协作），锚点人群之内可通过成员表升级为 `EDITOR`/`MANAGER`；
- 拥有 `knowledge_base.manage_all` 的成员可以查询并管理当前租户全部未删除知识库，不受成员关系限制；`knowledge_base.read_all` 只读查询全部；
- 两个特权码只放开“库级范围”：检索与问答时，文档级可见范围（`DEPARTMENT` / `PROJECT` 版本）仍按查询者本人的部门树与可见项目过滤，不会自动覆盖租户内其他部门/项目的范围文档；
- 详情、修改、删除和成员管理都会再次校验知识库属于当前租户；
- 不存在、已删除或无权访问的知识库统一返回 `KNOWLEDGE_BASE_NOT_FOUND`，避免泄露跨租户数据。

## 3. 成员权限

| 权限 | 能力 |
| --- | --- |
| `READER` | 读取知识库及后续允许读取的内容 |
| `EDITOR` | 在 `READER` 基础上编辑知识库内容：上传/转存文档、文档新版本与文档删除（第四、六阶段落地） |
| `MANAGER` | 在 `EDITOR` 基础上管理知识库资料和成员 |

权限等级为 `READER < EDITOR < MANAGER`。知识库创建者创建时自动加入当前用户并获得 `MANAGER`。创建者不能被降级或移除，知识库不能移除最后一名 `MANAGER`。

添加成员时接口接收当前租户的 `membershipId`，服务端再解析对应的 `userId`。目标成员必须同时满足：成员属于当前租户、成员状态为 `ACTIVE`、用户状态为 `ACTIVE` 且未软删除。跨租户成员 ID 不会被接受。

## 4. 接口清单

以下路径均相对于 `/api/v1`，成功响应由公共响应拦截器包装为 `{ success: true, data, requestId }`：

| 方法与路径 | 用途 | 权限 |
| --- | --- | --- |
| `GET /knowledge-bases` | 分页查询当前成员可访问的知识库 | `knowledge_base.read` |
| `POST /knowledge-bases` | 创建知识库，创建者自动成为 MANAGER | `knowledge_base.create` |
| `GET /knowledge-bases/{knowledgeBaseId}` | 查询知识库详情 | `knowledge_base.read` + 知识库可见范围 |
| `PATCH /knowledge-bases/{knowledgeBaseId}` | 修改名称、说明或归属锚点 | `knowledge_base.read` + MANAGER |
| `DELETE /knowledge-bases/{knowledgeBaseId}?version=1` | 软删除知识库 | `knowledge_base.read` + MANAGER |
| `GET /knowledge-bases/{knowledgeBaseId}/members` | 查询知识库成员 | `knowledge_base.read` + MANAGER |
| `POST /knowledge-bases/{knowledgeBaseId}/members` | 添加知识库成员 | `knowledge_base.read` + MANAGER |
| `PATCH /knowledge-bases/{knowledgeBaseId}/members/{membershipId}` | 修改成员权限 | `knowledge_base.read` + MANAGER |
| `DELETE /knowledge-bases/{knowledgeBaseId}/members/{membershipId}` | 移除知识库成员 | `knowledge_base.read` + MANAGER |
| `GET /knowledge-bases/{knowledgeBaseId}/documents` | 分页查询知识库文档与处理状态 | `knowledge_base.read` + 知识库可见范围 |
| `POST /knowledge-bases/{knowledgeBaseId}/documents` | 关联文件对象或转存来源（附件/AI 生成文档/对话消息）创建文档，进入处理队列 | `knowledge_base.read` + EDITOR |
| `POST /knowledge-bases/{knowledgeBaseId}/documents/{documentId}/versions` | 上传新版本，重新进入处理队列 | `knowledge_base.read` + EDITOR |
| `POST /knowledge-bases/{knowledgeBaseId}/documents/{documentId}/retry` | 重试处理失败的文档 | `knowledge_base.read` + EDITOR |
| `DELETE /knowledge-bases/{knowledgeBaseId}/documents/{documentId}` | 软删除文档并异步清理全部版本的向量索引 | `knowledge_base.read` + EDITOR |
| `POST /knowledge-bases/{knowledgeBaseId}/query` | 按知识库内容回答问题，返回带引用的答案 | `knowledge_base.query` + 知识库成员（锚点人群虚拟 READER 不覆盖 AI 问答） |

权限码（租户级开关）收敛为五码：`knowledge_base.create`（创建）、`knowledge_base.read`（查看自己可访问的知识库，所有写操作的基础门槛）、`knowledge_base.query`（知识库问答的 AI 额度）、`knowledge_base.read_all`（只读查看当前租户全部知识库）与 `knowledge_base.manage_all`（读写管理当前租户全部知识库）。写操作的深度由库内成员等级校验（对象级）：编辑资料/成员管理要求 `MANAGER`，文档写入与删除要求 `EDITOR`。

**名称唯一**：同一租户内知识库名称不能重复，判定按**大小写不敏感 + 忽略首尾空格**（归一值 `lower(btrim(name))`），冲突返回 `409 KNOWLEDGE_BASE_NAME_TAKEN`。名称在**软删除后释放**，因此删掉「公司共用库」之后可以再用同名重建；释放的做法是软删除时把归一值改写为 `<归一名称>#<id>`。归一值只用于唯一性判定，列表与详情始终展示用户输入的原始名称。助手建库会在生成确认草稿前先做一次可用性预检，重名时直接告诉模型「换一个名称」，而不是先建一份注定失败的草稿。

### 4.1 创建示例

```json
{
  "name": "产品知识库",
  "description": "产品说明、研发规范和支持资料",
  "visibilityScope": "DEPARTMENT",
  "departmentId": "70000000-0000-0000-0000-000000000001"
}
```

`visibilityScope` 可选，默认 `PRIVATE`（仅成员可见）；`DEPARTMENT` 必填 `departmentId`、`PROJECT` 必填 `projectId`，两者互斥，部门/项目必须属于当前租户。

### 4.2 修改示例

```json
{
  "name": "产品与研发知识库",
  "version": 1
}
```

`PATCH` 和 `DELETE` 必须提交读取到的当前 `version`。更新成功后版本号递增；版本过期返回 `409 RESOURCE_VERSION_CONFLICT`。

### 4.3 添加成员示例

```json
{
  "membershipId": "租户成员 UUID",
  "permission": "EDITOR"
}
```

## 5. 错误语义

| HTTP | code | 含义 |
| --- | --- | --- |
| `400` | `KNOWLEDGE_BASE_UPDATE_EMPTY` | 修改请求没有提供名称、说明或归属字段 |
| `400` | `KNOWLEDGE_BASE_SCOPE_INVALID` | 归属无效：范围缺少部门/项目，或部门/项目不属于当前租户 |
| `400` | `PAGINATION_CURSOR_INVALID` | 游标不属于当前租户或当前可见范围 |
| `404` | `KNOWLEDGE_BASE_NOT_FOUND` | 知识库不存在、已删除或当前成员无权访问 |
| `404` | `KNOWLEDGE_BASE_MEMBER_NOT_FOUND` | 目标成员不存在、非当前租户成员或已失效 |
| `409` | `RESOURCE_VERSION_CONFLICT` | 知识库版本已被其他请求更新 |
| `409` | `KNOWLEDGE_BASE_MEMBER_EXISTS` | 成员已经加入该知识库 |
| `409` | `KNOWLEDGE_BASE_NAME_TAKEN` | 同租户内已存在同名知识库（大小写不敏感、忽略首尾空格；软删除后释放） |
| `409` | `KNOWLEDGE_BASE_OWNER_REQUIRED` | 创建者必须保留 MANAGER，不能降级或移除 |
| `409` | `KNOWLEDGE_BASE_LAST_MANAGER` | 不能移除最后一名 MANAGER |
| `404` | `KNOWLEDGE_DOCUMENT_NOT_FOUND` | 文档不存在、已删除或不属于该知识库 |
| `403` | `KNOWLEDGE_BASE_MEMBER_PERMISSION_DENIED` | 成员权限不满足操作要求（转存与文档删除要求 `EDITOR`） |
| `409` | `KNOWLEDGE_DOCUMENT_RETRY_INVALID` | 只有 `FAILED` 状态的文档可以重试 |
| `400` | `KNOWLEDGE_DOCUMENT_SCOPE_INVALID` | 可见范围缺少部门/项目，或部门/项目不属于当前租户 |
| `404` | `KNOWLEDGE_FILE_OBJECT_NOT_FOUND` | 文件不存在、非当前租户或已删除 |
| `409` | `KNOWLEDGE_FILE_OBJECT_IN_USE` | 文件已作为其他文档版本的内容源 |
| `409` | `KNOWLEDGE_SOURCE_ALREADY_SAVED` | 来源已存入其他知识库，一份来源只能存一个知识库 |
| `404` | `KNOWLEDGE_SOURCE_DOCUMENT_NOT_FOUND` | 转存的 AI 生成文档不存在或无权访问 |
| `404` | `KNOWLEDGE_SOURCE_MESSAGE_NOT_FOUND` | 转存的对话消息不存在或无权访问 |
| `400` | `KNOWLEDGE_SOURCE_MESSAGE_INVALID` | 该消息类型不支持转存（仅用户或助手消息） |
| `503` | `KNOWLEDGE_QUERY_SERVICE_UNAVAILABLE` | AI 服务暂不可用，本次查询已记入失败审计，可稍后重试 |

## 6. 审计与数据模型

知识库写操作在同一事务中写入租户审计日志，事件包括：

- `KNOWLEDGE_BASE_CREATED`；
- `KNOWLEDGE_BASE_UPDATED`；
- `KNOWLEDGE_BASE_DELETED`；
- `KNOWLEDGE_BASE_MEMBER_ADDED`；
- `KNOWLEDGE_BASE_MEMBER_UPDATED`；
- `KNOWLEDGE_BASE_MEMBER_REMOVED`。

文档相关事件：

- `KNOWLEDGE_DOCUMENT_CREATED`；
- `KNOWLEDGE_DOCUMENT_VERSION_CREATED`；
- `KNOWLEDGE_DOCUMENT_RETRY_REQUESTED`；
- `KNOWLEDGE_DOCUMENT_DELETED`；
- `KNOWLEDGE_DOCUMENT_INDEXED`（后台任务，无操作者）；
- `KNOWLEDGE_DOCUMENT_PROCESS_FAILED`（后台任务，无操作者）；
- `KNOWLEDGE_DOCUMENT_PROCESS_RECOVERED`（后台任务，无操作者；孤儿状态回收）；
- `KNOWLEDGE_BASE_QUERIED`（知识库查询成功；失败时 outcome 为 `FAILURE` 并携带错误码）。

当前阶段使用以下模型：

```text
KnowledgeBase
  ├── KnowledgeBaseMember ── User / TenantMembership
  └── KnowledgeDocument
        └── DocumentVersion（版本级可见范围，fileObjectId 唯一）
```

`KnowledgeBaseMember` 以 `tenantId + knowledgeBaseId + userId` 保证成员关系唯一。知识库与文档删除均采用软删除（`deletedAt`）；成员关系当前没有 `deletedAt` 字段，移除采用硬删除。

数据库迁移为 `apps/api/prisma/migrations/0015_knowledge_base_management/migration.sql`（第一阶段）、`0026_knowledge_document_indexing/migration.sql`（第二阶段：处理状态机字段、可见范围下沉 `DocumentVersion`、删除 `DocumentChunk.embedding`）、`0028_knowledge_query_api/migration.sql`（第三阶段：知识库锚点字段、成员权限枚举、`KnowledgeQueryLog` 扩展）、`20260916084227_assistant_knowledge_tool`（Assistant RAG 工具接入：对话级知识库开关字段）、`20260916094414_add_knowledge_document_source_anchor`（第四阶段：来源锚定字段与部分唯一索引）、`20260917064450_converge_knowledge_base_permissions`（第五阶段：权限码收敛为五码）与 `20260917065945_knowledge_base_visibility_scope`（第五阶段：库级归属锚点字段）。

## 7. 后续阶段

后续实现应在新的契约和迁移中逐步加入：

1. 文档配额、病毒扫描与后台任务监控；
2. 检索分数阈值拒答（原计划随块 6 落地，尚未实现）；
3. 锚点失效提醒：挂接的部门/项目被删除后管理界面提示重新挂接（悬挂数据保留，自动授权自然失效）。

