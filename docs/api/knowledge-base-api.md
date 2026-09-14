# 知识库管理 API

公开契约版本：`0.20.0`。所有接口使用租户 Access Token，路径基于 `/api/v1`。

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

## 请求字段

| 字段 | 适用接口 | 说明 |
| --- | --- | --- |
| `name` | 创建、修改 | 知识库名称，1 到 200 个字符；服务端会去除首尾空白 |
| `description` | 创建、修改 | 知识库说明，最多 2000 个字符；空字符串会规范化为 `null` |
| `version` | 修改、删除 | 当前知识库版本，修改成功后递增 |
| `keyword` | 列表 | 按名称或说明不区分大小写搜索 |
| `limit` | 列表 | 每页 1 到 100 条，默认 20 |
| `cursor` | 列表 | 上一页返回的 UUID 游标 |
| `permission` | 成员添加、修改 | `READER`、`EDITOR` 或 `MANAGER` |

## 返回字段

`KnowledgeBase` 包含 `id`、`tenantId`、`name`、`description`、`memberCount`、`createdBy`、`updatedBy`、`version`、`createdAt` 和 `updatedAt`。

`KnowledgeBaseMember` 包含关系 `id`、`tenantId`、`knowledgeBaseId`、`membershipId`、`userId`、`account`、`displayName`、`permission` 和 `createdAt`。

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
| `PAGINATION_CURSOR_INVALID` | 游标无效或超出当前可见范围 |

详细业务边界见 [知识库管理](../product/knowledge-base-management.md)，完整字段约束以 `packages/contracts/openapi/openapi.yaml` 为准。

