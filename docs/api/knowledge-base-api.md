# 知识库管理 API

公开契约版本：`0.23.0`。所有接口使用租户 Access Token，路径基于 `/api/v1`。

## 知识库

```text
GET    /knowledge-bases?keyword={keyword}&limit={limit}&cursor={cursor}
POST   /knowledge-bases
GET    /knowledge-bases/{knowledgeBaseId}
PATCH  /knowledge-bases/{knowledgeBaseId}
DELETE /knowledge-bases/{knowledgeBaseId}?version={version}
```

创建知识库时，当前登录用户自动获得 `MANAGER`。列表普通成员只返回自己加入的知识库；`knowledge_base.manage_all` 可以查询当前租户全部知识库。

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
GET  /knowledge-bases/{knowledgeBaseId}/documents?keyword={keyword}&limit={limit}&cursor={cursor}
POST /knowledge-bases/{knowledgeBaseId}/documents
POST /knowledge-bases/{knowledgeBaseId}/documents/{documentId}/versions
POST /knowledge-bases/{knowledgeBaseId}/documents/{documentId}/retry
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

文档创建后立即进入后台处理队列，状态机为 `PENDING -> PARSING -> PARSED -> INDEXING -> READY`，失败置 `FAILED`。可重试错误自动回 `PENDING` 重试，达到上限（默认 3 次）后置 `FAILED`，此时可调用 retry 接口手动重试。文档列表返回当前版本的可见范围、版本号与最新处理状态。

## 请求字段

| 字段 | 适用接口 | 说明 |
| --- | --- | --- |
| `name` | 创建、修改 | 知识库名称，1 到 200 个字符；服务端会去除首尾空白 |
| `description` | 创建、修改 | 知识库说明，最多 2000 个字符；空字符串会规范化为 `null` |
| `version` | 修改、删除 | 当前知识库版本，修改成功后递增 |
| `keyword` | 列表 | 按名称（知识库含说明）不区分大小写搜索 |
| `limit` | 列表 | 每页 1 到 100 条，默认 20 |
| `cursor` | 列表 | 上一页返回的 UUID 游标 |
| `permission` | 成员添加、修改 | `READER`、`EDITOR` 或 `MANAGER` |
| `fileObjectId` | 文档创建、新版本 | 文件对象 UUID，必须属于当前租户且未删除 |
| `visibilityScope` | 文档创建、新版本 | `PRIVATE`、`DEPARTMENT`、`PROJECT` 或 `TENANT` |
| `departmentId` | 文档创建、新版本 | `DEPARTMENT` 时必填，服务端校验属于当前租户 |
| `projectId` | 文档创建、新版本 | `PROJECT` 时必填，服务端校验属于当前租户 |

## 返回字段

`KnowledgeBase` 包含 `id`、`tenantId`、`name`、`description`、`memberCount`、`createdBy`、`updatedBy`、`version`、`createdAt` 和 `updatedAt`。

`KnowledgeBaseMember` 包含关系 `id`、`tenantId`、`knowledgeBaseId`、`membershipId`、`userId`、`account`、`displayName`、`permission` 和 `createdAt`。

`KnowledgeDocument` 包含 `id`、`tenantId`、`knowledgeBaseId`、`fileObjectId`、`name`、`status`（`PENDING`/`PARSING`/`PARSED`/`INDEXING`/`READY`/`FAILED`）、`currentVersionId`、`versionNumber`、`retryCount`、`lastError`、`visibilityScope`、`departmentId`、`projectId`、`createdBy`、`updatedBy`、`version`、`createdAt` 和 `updatedAt`；`versionNumber` 与可见范围来自当前处理版本。

所有列表返回 `{ items, nextCursor }`；没有下一页时 `nextCursor` 为 `null`。删除成功返回 HTTP `204`，不返回 JSON 数据。

## 权限和常见错误

| code | 含义 |
| --- | --- |
| `KNOWLEDGE_BASE_NOT_FOUND` | 知识库不存在、已删除或无权访问 |
| `KNOWLEDGE_BASE_MEMBER_NOT_FOUND` | 成员不存在或不属于当前租户 |
| `KNOWLEDGE_BASE_UPDATE_EMPTY` | 修改请求没有可修改字段 |
| `RESOURCE_VERSION_CONFLICT` | 提交的版本不是当前版本 |
| `KNOWLEDGE_BASE_MEMBER_EXISTS` | 成员已经加入知识库 |
| `KNOWLEDGE_BASE_OWNER_REQUIRED` | 创建者不能降级或移除 |
| `KNOWLEDGE_BASE_LAST_MANAGER` | 不能移除最后一名 MANAGER |
| `KNOWLEDGE_DOCUMENT_NOT_FOUND` | 文档不存在、已删除或不属于该知识库 |
| `KNOWLEDGE_DOCUMENT_RETRY_INVALID` | 只有 `FAILED` 状态的文档可以重试 |
| `KNOWLEDGE_DOCUMENT_SCOPE_INVALID` | 可见范围缺少部门/项目，或部门/项目不属于当前租户 |
| `KNOWLEDGE_FILE_OBJECT_NOT_FOUND` | 文件不存在、非当前租户或已删除 |
| `KNOWLEDGE_FILE_OBJECT_IN_USE` | 文件已作为其他文档版本的内容源 |
| `PAGINATION_CURSOR_INVALID` | 游标无效或超出当前可见范围 |

详细业务边界见 [知识库管理](../product/knowledge-base-management.md)，完整字段约束以 `packages/contracts/openapi/openapi.yaml` 为准。

