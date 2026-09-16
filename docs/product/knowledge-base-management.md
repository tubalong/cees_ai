# 知识库管理

> 状态：第二阶段（文档上传与处理状态机）、第三阶段（公开知识库查询）已落地
> 最后同步：2026-09-16
> 公开契约版本：`0.25.0`

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

## 2. 知识库可见范围

所有查询都自动使用当前 JWT 中的 `tenantId`，客户端不能提交租户 ID 来改变数据范围：

- 普通成员只能查询自己在 `knowledge_base_members` 中加入的知识库；
- 拥有 `knowledge_base.manage_all` 的成员可以查询当前租户全部未删除知识库，并不受成员关系限制；
- 详情、修改、删除和成员管理都会再次校验知识库属于当前租户；
- 不存在、已删除或无权访问的知识库统一返回 `KNOWLEDGE_BASE_NOT_FOUND`，避免泄露跨租户数据。

## 3. 成员权限

| 权限 | 能力 |
| --- | --- |
| `READER` | 读取知识库及后续允许读取的内容 |
| `EDITOR` | 在 `READER` 基础上编辑知识库内容（后续阶段使用） |
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
| `PATCH /knowledge-bases/{knowledgeBaseId}` | 修改名称或说明 | `knowledge_base.update` + MANAGER |
| `DELETE /knowledge-bases/{knowledgeBaseId}?version=1` | 软删除知识库 | `knowledge_base.delete` + MANAGER |
| `GET /knowledge-bases/{knowledgeBaseId}/members` | 查询知识库成员 | `knowledge_base.member.manage` + MANAGER |
| `POST /knowledge-bases/{knowledgeBaseId}/members` | 添加知识库成员 | `knowledge_base.member.manage` + MANAGER |
| `PATCH /knowledge-bases/{knowledgeBaseId}/members/{membershipId}` | 修改成员权限 | `knowledge_base.member.manage` + MANAGER |
| `DELETE /knowledge-bases/{knowledgeBaseId}/members/{membershipId}` | 移除知识库成员 | `knowledge_base.member.manage` + MANAGER |
| `GET /knowledge-bases/{knowledgeBaseId}/documents` | 分页查询知识库文档与处理状态 | `knowledge_base.read` + 知识库可见范围 |
| `POST /knowledge-bases/{knowledgeBaseId}/documents` | 关联文件对象创建文档，进入处理队列 | `knowledge_base.document.manage` + EDITOR |
| `POST /knowledge-bases/{knowledgeBaseId}/documents/{documentId}/versions` | 上传新版本，重新进入处理队列 | `knowledge_base.document.manage` + EDITOR |
| `POST /knowledge-bases/{knowledgeBaseId}/documents/{documentId}/retry` | 重试处理失败的文档 | `knowledge_base.document.manage` + EDITOR |
| `POST /knowledge-bases/{knowledgeBaseId}/query` | 按知识库内容回答问题，返回带引用的答案 | `knowledge_base.query` + 知识库可见范围 |

### 4.1 创建示例

```json
{
  "name": "产品知识库",
  "description": "产品说明、研发规范和支持资料"
}
```

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
| `400` | `KNOWLEDGE_BASE_UPDATE_EMPTY` | 修改请求没有提供名称或说明 |
| `400` | `PAGINATION_CURSOR_INVALID` | 游标不属于当前租户或当前可见范围 |
| `404` | `KNOWLEDGE_BASE_NOT_FOUND` | 知识库不存在、已删除或当前成员无权访问 |
| `404` | `KNOWLEDGE_BASE_MEMBER_NOT_FOUND` | 目标成员不存在、非当前租户成员或已失效 |
| `409` | `RESOURCE_VERSION_CONFLICT` | 知识库版本已被其他请求更新 |
| `409` | `KNOWLEDGE_BASE_MEMBER_EXISTS` | 成员已经加入该知识库 |
| `409` | `KNOWLEDGE_BASE_OWNER_REQUIRED` | 创建者必须保留 MANAGER，不能降级或移除 |
| `409` | `KNOWLEDGE_BASE_LAST_MANAGER` | 不能移除最后一名 MANAGER |
| `404` | `KNOWLEDGE_DOCUMENT_NOT_FOUND` | 文档不存在、已删除或不属于该知识库 |
| `409` | `KNOWLEDGE_DOCUMENT_RETRY_INVALID` | 只有 `FAILED` 状态的文档可以重试 |
| `400` | `KNOWLEDGE_DOCUMENT_SCOPE_INVALID` | 可见范围缺少部门/项目，或部门/项目不属于当前租户 |
| `404` | `KNOWLEDGE_FILE_OBJECT_NOT_FOUND` | 文件不存在、非当前租户或已删除 |
| `409` | `KNOWLEDGE_FILE_OBJECT_IN_USE` | 文件已作为其他文档版本的内容源 |
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
- `KNOWLEDGE_DOCUMENT_INDEXED`（后台任务，无操作者）；
- `KNOWLEDGE_DOCUMENT_PROCESS_FAILED`（后台任务，无操作者）；
- `KNOWLEDGE_BASE_QUERIED`（知识库查询成功；失败时 outcome 为 `FAILURE` 并携带错误码）。

当前阶段使用以下模型：

```text
KnowledgeBase
  ├── KnowledgeBaseMember ── User / TenantMembership
  └── KnowledgeDocument
        └── DocumentVersion（版本级可见范围，fileObjectId 唯一）
```

`KnowledgeBaseMember` 以 `tenantId + knowledgeBaseId + userId` 保证成员关系唯一。知识库删除采用软删除；成员关系当前没有 `deletedAt` 字段，移除采用硬删除。

数据库迁移为 `apps/api/prisma/migrations/0015_knowledge_base_management/migration.sql`（第一阶段）、`0026_knowledge_document_indexing/migration.sql`（第二阶段：处理状态机字段、可见范围下沉 `DocumentVersion`、删除 `DocumentChunk.embedding`）与 `0028_knowledge_query_api/migration.sql`（第三阶段：知识库锚点字段、成员权限枚举、`KnowledgeQueryLog` 扩展）。

## 7. 后续阶段

后续实现应在新的契约和迁移中逐步加入：

1. 文档删除、配额、病毒扫描与后台任务监控；
2. 检索分数阈值拒答（块 6）、Assistant RAG 工具接入（块 7）；
3. 知识库归属锚点管理与自动授权：挂项目/挂部门/公司级分类，锚点人群自动获得 READER（权限边界见架构文档 knowledge-rag.md 3.6，块 8）。

