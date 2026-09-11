# 通知中心 API

> 状态：已实现
> 最后同步：2026-09-11
> 公开契约版本：`0.17.0`

## 1. 通用约定

- 实际路径前缀为 `/api/v1`；
- 所有接口需要租户成员 JWT、有效租户上下文和 `notification.read` 权限；
- 返回值统一经过 API 响应包装器处理；
- 通知 ID 和游标均为 UUID；
- 接口只操作当前登录用户的接收关系，不接受 `tenantId` 或 `userId` 作为客户端过滤条件；
- 普通用户不能通过公开 API 创建、修改或删除通知。

## 2. 接口清单

| 方法与路径 | 用途 | 请求体或参数 | 权限 |
| --- | --- | --- | --- |
| `GET /notifications` | 查询当前成员的通知 | `unreadOnly/limit/cursor` | `notification.read` |
| `GET /notifications/unread-count` | 查询当前成员未读数 | 无 | `notification.read` |
| `POST /notifications/read-all` | 将当前成员所有可见未读通知标记为已读 | 无 | `notification.read` |
| `POST /notifications/{notificationId}/read` | 将当前成员的一条通知标记为已读 | 路径参数 `notificationId` | `notification.read` |

## 3. 查询通知

```http
GET /api/v1/notifications?unreadOnly=true&limit=20
Authorization: Bearer <accessToken>
```

查询参数：

| 参数 | 类型 | 默认值 | 约束 |
| --- | --- | --- | --- |
| `unreadOnly` | boolean | `false` | 只返回 `readAt = null` 的通知 |
| `limit` | integer | `20` | `1` 到 `100` |
| `cursor` | UUID | 无 | 上一页返回的 `nextCursor` |

返回数据中的 `unreadCount` 是当前成员全部可见未读通知数，不受本次 `unreadOnly` 或分页条件影响。

## 4. 返回字段

### 4.1 `NotificationResult`

| 字段 | 类型 | 说明 |
| --- | --- | --- |
| `id` | UUID | 通知 UUID |
| `title` | string | 通知标题 |
| `content` | string | 通知正文 |
| `channel` | string | 当前为 `IN_APP` |
| `relationType` | string/null | 关联资源类型，例如 `WORK_REPORT` |
| `relationId` | UUID/null | 关联资源 UUID |
| `readAt` | date-time/null | 当前成员阅读时间，未读为 `null` |
| `createdAt` | date-time | 通知投递时间 |

### 4.2 `NotificationList`

| 字段 | 类型 | 说明 |
| --- | --- | --- |
| `items` | `NotificationResult[]` | 按投递时间倒序的通知列表 |
| `nextCursor` | UUID/null | 下一页游标；没有下一页时为 `null` |
| `unreadCount` | integer | 当前成员全部未读通知数 |

示例响应：

```yaml
success: true
data:
  items:
    - id: 70000000-0000-0000-0000-000000000001
      title: 日报提交提醒
      content: 您尚未提交 2026-09-10 的日报，请及时补充。
      channel: IN_APP
      relationType: WORK_REPORT
      relationId: null
      readAt: null
      createdAt: 2026-09-11T00:00:00.000Z
  nextCursor: null
  unreadCount: 1
requestId: request-id
```

## 5. 标记已读

### 5.1 单条已读

```http
POST /api/v1/notifications/70000000-0000-0000-0000-000000000001/read
Authorization: Bearer <accessToken>
```

成功返回该通知的 `NotificationResult`，其中 `readAt` 为服务端写入的阅读时间。重复请求是幂等的，不会重复更新阅读时间或新增已读审计事件。

### 5.2 全部已读

```http
POST /api/v1/notifications/read-all
Authorization: Bearer <accessToken>
```

成功返回数据：

```yaml
updatedCount: 3
```

`updatedCount` 只统计本次从未读变为已读的数量。没有未读通知时返回 `0`，不会创建无意义的审计事件。

## 6. 内部通知投递

业务模块通过 `NotificationService.createForUsers` 创建通知，客户端不能调用该方法。输入字段如下：

| 字段 | 类型 | 约束 |
| --- | --- | --- |
| `tenantId` | UUID | 必须是业务上下文所属租户 |
| `title` | string | 去除首尾空白后不能为空 |
| `content` | string | 去除首尾空白后不能为空 |
| `channel` | string | 默认 `IN_APP` |
| `relationType` | string/null | 可选业务资源类型 |
| `relationId` | UUID/null | 可选业务资源 UUID |
| `dedupKey` | string/null | 租户内幂等键 |
| `recipientUserIds` | UUID[] | 至少一个接收人，重复用户会去重 |
| `createdBy` | UUID/null | 可选创建人 |

带 `dedupKey` 的通知使用租户内唯一约束。重复投递会复用已有通知，并通过 `createMany(..., skipDuplicates)` 补齐新接收人。

## 7. 权限、租户隔离与审计

- `TenantGuard` 和 `TenantContextInterceptor` 提供当前租户成员上下文；
- 查询条件同时包含 `tenantId`、`userId` 和通知未删除条件；
- 同租户其他成员的接收关系不可被当前用户读取；
- 不提供按通知 ID 的跨租户查询；
- 单条已读审计动作是 `NOTIFICATION_READ`；
- 全部已读审计动作是 `NOTIFICATIONS_READ_ALL`，元数据包含 `updatedCount`。

## 8. 错误码

| 错误码 | HTTP | 含义 |
| --- | --- | --- |
| `PAGINATION_CURSOR_INVALID` | 400 | 游标不存在或不属于当前成员可见范围 |
| `NOTIFICATION_RECIPIENT_REQUIRED` | 400 | 内部投递没有有效接收人 |
| `NOTIFICATION_NOT_FOUND` | 404 | 通知不存在、已删除或当前成员不可见 |
| `AUTH_UNAUTHORIZED` | 401 | JWT 无效、过期或缺少租户身份 |
| `AUTH_FORBIDDEN` | 403 | 当前成员缺少 `notification.read` 权限 |

## 9. 契约与客户端生成

公开契约唯一事实源是 `packages/contracts/openapi/openapi.yaml`。修改通知接口后执行：

```bash
pnpm --filter @cees/contracts lint
pnpm --filter @cees/contracts generate:public
pnpm --filter @cees/api-client typecheck
```

生成文件位于 `packages/api-client/src/`，不得手工修改。后台任务和 Redis 锁不是公开 HTTP 接口，设计说明见 [通知中心与后台任务](../product/notification-center.md)。
