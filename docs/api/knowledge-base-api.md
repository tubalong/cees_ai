# 知识库管理 API

公开契约版本：`0.30.0`。所有接口使用租户 Access Token，路径基于 `/api/v1`。

## 知识库

```text
GET    /knowledge-bases?keyword={keyword}&limit={limit}&cursor={cursor}&permission={permission}
POST   /knowledge-bases
GET    /knowledge-bases/{knowledgeBaseId}
PATCH  /knowledge-bases/{knowledgeBaseId}
DELETE /knowledge-bases/{knowledgeBaseId}?version={version}
POST   /knowledge-bases/{knowledgeBaseId}/query
```

创建知识库时，当前登录用户自动获得 `MANAGER`。列表默认返回当前用户可见的知识库：自己加入的知识库（按成员等级），以及归属锚点覆盖人群内的知识库（虚拟 `READER`）——挂部门的库对部门及全部子部门成员可见，挂项目的库对项目成员可见，`TENANT` 全员可见，`PRIVATE` 仅成员可见。`knowledge_base.manage_all`（读写全部）或 `knowledge_base.read_all`（只读全部）可以查询当前租户全部知识库。`permission` 可选，传入 `READER`/`EDITOR`/`MANAGER` 时只返回当前用户达到该成员权限的知识库（转存目标库选择用；`READER` 级同时并入锚点人群库）。每个库返回 `myPermission` 标注当前用户的成员等级：`manage_all` 恒 `MANAGER`，成员等级优先，其余（`read_all` 与锚点人群）恒 `READER`。AI 问答接口（`query`）只对知识库真实成员（或 `read_all`/`manage_all`）放行，锚点人群的虚拟 `READER` 只覆盖库级浏览（列表/详情/文档列表）。

## 知识库成员

```text
GET    /knowledge-bases/{knowledgeBaseId}/members?cursor={cursor}
POST   /knowledge-bases/{knowledgeBaseId}/members
PATCH  /knowledge-bases/{knowledgeBaseId}/members/{membershipId}
DELETE /knowledge-bases/{knowledgeBaseId}/members/{membershipId}
```

成员请求示例：

```json
{
  "membershipId": "20000000-0000-0000-0000-000000000001",
  "permission": "READER"
}
```

`membershipId` 是当前租户成员关系 ID，不是全局 `userId`。服务端会校验成员租户、成员状态和用户状态。

## 知识库文档

```text
GET    /knowledge-bases/{knowledgeBaseId}/documents?keyword={keyword}&limit={limit}&cursor={cursor}
POST   /knowledge-bases/{knowledgeBaseId}/documents
POST   /knowledge-bases/{knowledgeBaseId}/documents/{documentId}/versions
POST   /knowledge-bases/{knowledgeBaseId}/documents/{documentId}/retry
DELETE /knowledge-bases/{knowledgeBaseId}/documents/{documentId}
```

创建文档请求示例：

```json
{
  "fileObjectId": "60000000-0000-0000-0000-000000000001",
  "name": "产品手册",
  "visibilityScope": "DEPARTMENT",
  "departmentId": "70000000-0000-0000-0000-000000000001"
}
```

`fileObjectId` 来自文件上传接口返回的对象 ID，上传走文件模块、再关联为知识库文档。同一个文件对象只能作为一个文档版本的内容源，重复关联返回 `KNOWLEDGE_FILE_OBJECT_IN_USE`。

转存路径（把附件、AI 生成文档或对话消息存入知识库）请求示例：

```json
{
  "sourceType": "MESSAGE",
  "sourceId": "90000000-0000-0000-0000-000000000001",
  "visibilityScope": "TENANT"
}
```

`sourceType` 为 `FILE_OBJECT`（附件文件）/ `DOCUMENT`（AI 生成文档）/ `MESSAGE`（对话消息），与 `sourceId` 配套；`fileObjectId` 与 `sourceType`+`sourceId` 只能二选一。转存先把来源物化为文件快照，再进入与人工上传相同的解析→索引链路；同一来源（sourceType+sourceId）只能存入一个知识库，重复转存到同一知识库追加新版本，转存到其他知识库返回 `KNOWLEDGE_SOURCE_ALREADY_SAVED`。`name` 省略时沿用来源资源名称。

文档创建后立即进入后台处理队列，状态机为 `PENDING -> PARSING -> PARSED -> INDEXING -> READY`，失败置 `FAILED`。可重试错误自动回 `PENDING` 重试，达到上限（默认 3 次）后置 `FAILED`，此时可调用 retry 接口手动重试。文档列表返回当前版本的可见范围、版本号与最新处理状态。

删除文档需要知识库成员权限 `EDITOR` 及以上（`manage_all` 短路放行），与文档写入同门槛。删除为软删除：业务记录打 `deletedAt` 后不再出现在列表与检索结果中，同时异步清理该文档全部版本的向量索引；处理中（`PARSING`/`INDEXING`）的文档同样允许删除，索引流程在提交 `READY` 前检查 `deletedAt`，已删文档不再标回 `READY` 并补删刚写入的向量索引，避免已删文档残留可检索向量。删除成功返回 HTTP `204`。

## 知识库查询

```text
POST /knowledge-bases/{knowledgeBaseId}/query
```

需要 `knowledge_base.query` 权限，且查询者必须是知识库成员（或持有 `knowledge_base.read_all`/`manage_all`）：锚点人群的虚拟 `READER` 不覆盖 AI 问答，避免 `PRIVATE` 文档内容外泄。请求示例：

```json
{
  "query": "项目延期怎么处理？",
  "indexVersion": "knowledge-index-v1"
}
```

`query` 必填（1 到 4096 字符）；`indexVersion` 可选，不传时使用服务端默认索引版本（与索引写入侧一致）。

返回 `Envelope`（`{ success, data, requestId }`），`data` 为：

```json
{
  "answer": "延期超过两周需要升级到项目委员会。",
  "grounded": true,
  "insufficientEvidence": false,
  "citations": [
    {
      "citationId": "S1",
      "documentId": "40000000-0000-0000-0000-000000000001",
      "documentVersionId": "50000000-0000-0000-0000-000000000001",
      "chunkId": "chunk-1",
      "text": "项目延期超过两周时需要升级到项目委员会。",
      "score": 0.92,
      "pageIndex": 3,
      "bbox": [10.2, 30.5, 200.0, 45.1]
    }
  ]
}
```

- 答案只依据知识库内检索到的证据生成；检索无结果或证据不足时 `answer` 为空、`grounded=false`、`insufficientEvidence=true`，模型不会凭空作答；
- `citations` 是被答案引用的证据片段来源，`citationId` 对应答案正文中的引用编号；
- 服务端同步写入 `KnowledgeQueryLog`（问题、答案、grounded、耗时与 Token 用量）与审计记录；
- ai-service 暂不可用时返回 `503 KNOWLEDGE_QUERY_SERVICE_UNAVAILABLE`，本次提问记入失败审计，可稍后重试。

## 请求字段

| 字段 | 适用接口 | 说明 |
| --- | --- | --- |
| `name` | 知识库创建、修改；文档创建 | 1 到 200 个字符；服务端会去除首尾空白；文档转存路径下省略时沿用来源资源名称 |
| `description` | 创建、修改 | 知识库说明，最多 2000 个字符；空字符串会规范化为 `null` |
| `visibilityScope` | 知识库创建、修改；文档创建、新版本 | 知识库归属/文档可见范围：`PRIVATE`、`DEPARTMENT`、`PROJECT` 或 `TENANT`；知识库归属改为 `PRIVATE`/`TENANT` 时锚点自动置空 |
| `departmentId` | 知识库创建、修改；文档创建、新版本 | `DEPARTMENT` 时必填，服务端校验属于当前租户；知识库修改传 `null` 清除锚点（须与归属范围配套） |
| `projectId` | 知识库创建、修改；文档创建、新版本 | `PROJECT` 时必填，服务端校验属于当前租户；知识库修改传 `null` 清除锚点（须与归属范围配套） |
| `version` | 修改、删除 | 当前知识库版本，修改成功后递增 |
| `keyword` | 列表 | 按名称（知识库含说明）不区分大小写搜索 |
| `limit` | 列表 | 每页 1 到 100 条，默认 20 |
| `cursor` | 列表 | 上一页返回的 UUID 游标 |
| `permission` | 成员添加、修改；知识库列表过滤 | `READER`、`EDITOR` 或 `MANAGER` |
| `fileObjectId` | 文档创建（人工上传）、新版本 | 文件对象 UUID，必须属于当前租户且未删除；与 `sourceType`/`sourceId` 二选一 |
| `sourceType` | 文档创建（转存） | `FILE_OBJECT`、`DOCUMENT` 或 `MESSAGE`，与 `sourceId` 配套 |
| `sourceId` | 文档创建（转存） | 来源资源 UUID（附件文件 / AI 生成文档 / 对话消息） |
| `query` | 知识库查询 | 提问内容，1 到 4096 字符 |
| `indexVersion` | 知识库查询 | 可选，指定检索的索引版本，不传时用服务端默认版本 |

## 返回字段

`KnowledgeBase` 包含 `id`、`tenantId`、`name`、`description`、`visibilityScope`、`departmentId`、`projectId`、`memberCount`、`myPermission`（当前用户对该库的成员等级）、`createdBy`、`updatedBy`、`version`、`createdAt` 和 `updatedAt`。

`KnowledgeBaseMember` 包含关系 `id`、`tenantId`、`knowledgeBaseId`、`membershipId`、`userId`、`account`、`displayName`、`permission` 和 `createdAt`。

`KnowledgeDocument` 包含 `id`、`tenantId`、`knowledgeBaseId`、`fileObjectId`、`name`、`status`（`PENDING`/`PARSING`/`PARSED`/`INDEXING`/`READY`/`FAILED`）、`currentVersionId`、`versionNumber`、`retryCount`、`lastError`、`visibilityScope`、`departmentId`、`projectId`、`createdBy`、`updatedBy`、`version`、`createdAt` 和 `updatedAt`；`versionNumber` 与可见范围来自当前处理版本。

所有列表返回 `{ items, nextCursor }`；没有下一页时 `nextCursor` 为 `null`。删除成功返回 HTTP `204`，不返回 JSON 数据。查询接口返回 `Envelope`，`data` 为 `KnowledgeQuery`：`answer`、`grounded`、`insufficientEvidence` 与 `citations`（`citationId`/`documentId`/`documentVersionId`/`chunkId`/`text` 必填，`score`/`pageIndex`/`bbox` 可选）。

## 权限和常见错误

| code | 含义 |
| --- | --- |
| `KNOWLEDGE_BASE_NOT_FOUND` | 知识库不存在、已删除或无权访问 |
| `KNOWLEDGE_BASE_SCOPE_INVALID` | 知识库归属无效：范围缺少部门/项目，或部门/项目不属于当前租户 |
| `KNOWLEDGE_BASE_MEMBER_NOT_FOUND` | 成员不存在或不属于当前租户 |
| `KNOWLEDGE_BASE_UPDATE_EMPTY` | 修改请求没有可修改字段 |
| `RESOURCE_VERSION_CONFLICT` | 提交的版本不是当前版本 |
| `KNOWLEDGE_BASE_MEMBER_EXISTS` | 成员已经加入知识库 |
| `KNOWLEDGE_BASE_OWNER_REQUIRED` | 创建者不能降级或移除 |
| `KNOWLEDGE_BASE_LAST_MANAGER` | 不能移除最后一名 MANAGER |
| `KNOWLEDGE_DOCUMENT_NOT_FOUND` | 文档不存在、已删除或不属于该知识库 |
| `KNOWLEDGE_DOCUMENT_SOURCE_REQUIRED` | 必须提供 `fileObjectId`，或 `sourceType` + `sourceId` 之一 |
| `KNOWLEDGE_DOCUMENT_SOURCE_INCOMPLETE` | `sourceType` 与 `sourceId` 必须同时提供 |
| `KNOWLEDGE_DOCUMENT_SOURCE_AMBIGUOUS` | `fileObjectId` 与 `sourceType`/`sourceId` 只能二选一 |
| `KNOWLEDGE_SOURCE_ALREADY_SAVED` | 来源已存入其他知识库，一份来源只能存一个知识库 |
| `KNOWLEDGE_SOURCE_DOCUMENT_NOT_FOUND` | 转存的 AI 文档不存在或无权访问 |
| `KNOWLEDGE_SOURCE_MESSAGE_NOT_FOUND` | 转存的对话消息不存在或无权访问 |
| `KNOWLEDGE_SOURCE_MESSAGE_INVALID` | 该消息类型不支持转存（仅用户或助手消息） |
| `KNOWLEDGE_BASE_MEMBER_PERMISSION_DENIED` | 成员权限不满足操作要求（转存与文档删除要求 `EDITOR`） |
| `KNOWLEDGE_DOCUMENT_RETRY_INVALID` | 只有 `FAILED` 状态的文档可以重试 |
| `KNOWLEDGE_DOCUMENT_SCOPE_INVALID` | 可见范围缺少部门/项目，或部门/项目不属于当前租户 |
| `KNOWLEDGE_FILE_OBJECT_NOT_FOUND` | 文件不存在、非当前租户或已删除 |
| `KNOWLEDGE_FILE_OBJECT_IN_USE` | 文件已作为其他文档版本的内容源 |
| `KNOWLEDGE_QUERY_SERVICE_UNAVAILABLE` | AI 服务暂不可用，本次查询已记入失败审计，可稍后重试 |
| `PAGINATION_CURSOR_INVALID` | 游标无效或超出当前可见范围 |

详细业务边界见 [知识库管理](../product/knowledge-base-management.md)，完整字段约束以 `packages/contracts/openapi/openapi.yaml` 为准。

