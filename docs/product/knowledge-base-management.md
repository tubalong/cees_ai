# 知识库管理

> 状态：第一阶段已落地
> 最后同步：2026-09-14
> 公开契约版本：`0.20.0`

## 1. 第一阶段范围

知识库属于租户业务域，业务事实源位于 `apps/api`。本阶段只完成知识库本身和成员授权管理：

- 知识库创建、查询、修改和软删除；
- 知识库成员添加、权限修改和移除；
- `READER`、`EDITOR`、`MANAGER` 三级知识库权限；
- 当前租户隔离、成员可见范围和 `knowledge_base.manage_all` 管理范围；
- 乐观锁、RBAC 和操作审计；
- OpenAPI 契约和 TypeScript 客户端生成。

本阶段不实现文件上传、腾讯云 COS 关联、文档解析、文档版本处理、切片、Embedding、向量检索和 RAG。`KnowledgeDocument`、`DocumentVersion`、`DocumentChunk`、`KnowledgeQueryLog` 只是后续阶段的数据库基础，不能据此认为对应接口已经可用。

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

## 6. 审计与数据模型

知识库写操作在同一事务中写入租户审计日志，事件包括：

- `KNOWLEDGE_BASE_CREATED`；
- `KNOWLEDGE_BASE_UPDATED`；
- `KNOWLEDGE_BASE_DELETED`；
- `KNOWLEDGE_BASE_MEMBER_ADDED`；
- `KNOWLEDGE_BASE_MEMBER_UPDATED`；
- `KNOWLEDGE_BASE_MEMBER_REMOVED`。

当前阶段使用以下模型：

```text
KnowledgeBase
  └── KnowledgeBaseMember ── User / TenantMembership
```

`KnowledgeBaseMember` 以 `tenantId + knowledgeBaseId + userId` 保证成员关系唯一。知识库删除采用软删除；成员关系当前没有 `deletedAt` 字段，移除采用硬删除。

数据库迁移为 `apps/api/prisma/migrations/0015_knowledge_base_management/migration.sql`，负责初始化知识库权限、为 `tenant_admin` 授权并补齐知识库表和字段的 PostgreSQL 中文注释。

## 7. 后续阶段

后续实现应在新的契约和迁移中逐步加入：

1. 文件和 COS 对象绑定；
2. 文档上传、版本和处理状态；
3. 文档解析与切片；
4. Embedding、向量索引和权限过滤后的 RAG 查询；
5. 文档处理失败重试、配额、病毒扫描和后台任务。

