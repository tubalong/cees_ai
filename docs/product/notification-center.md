# 通知中心与后台任务

> 状态：已落地
> 最后同步：2026-09-11
> 公开契约版本：`0.17.0`

## 1. 功能范围

通知中心属于租户业务域，业务事实源位于 `apps/api`。当前版本包括：

- 当前租户成员的站内通知列表；
- 未读通知筛选和未读数量统计；
- 单条通知已读和全部通知已读；
- 通知与业务资源的关联信息；
- 通知接收人按用户保存独立阅读状态；
- 过期上传会话和过期 AI 动作草稿的自动处理；
- 前一天未提交日报的成员提醒；
- 通知创建幂等、租户隔离、RBAC 和已读审计。

当前版本不包含邮件、短信、浏览器推送、WebSocket 实时推送、用户自定义通知偏好、运营后台手工发通知和独立消息队列。通知目前只通过 `IN_APP` 渠道提供。

## 2. 通知可见范围

通知不是按租户全员自动可见，而是创建通知时明确写入接收人关系。成员只能查询同时满足以下条件的通知：

- 接收关系中的 `tenantId` 等于当前租户；
- 接收关系中的 `userId` 等于当前登录用户；
- 通知本身属于当前租户；
- 通知未被软删除。

即使两个用户属于同一租户，也不会因为同租户身份自动看到对方的通知。通知服务不提供普通用户直接创建通知的 HTTP 接口，业务模块或后台任务通过内部服务调用投递。

## 3. 通知字段和阅读状态

| 字段 | 含义 |
| --- | --- |
| `id` | 通知 UUID |
| `title` | 通知标题 |
| `content` | 通知正文 |
| `channel` | 通知渠道，当前为 `IN_APP` |
| `relationType` | 关联资源类型，例如 `WORK_REPORT` |
| `relationId` | 关联资源 UUID，可空 |
| `readAt` | 当前用户阅读时间，未读时为 `null` |
| `createdAt` | 通知投递时间 |

同一条通知可以有多个接收人，但每个接收人的 `readAt` 独立维护。标记一条已读是幂等操作，重复调用不会重复更新或重复写审计；全部已读只更新当前用户仍未读的通知。

## 4. 通知创建和幂等

内部创建输入包含租户、标题、正文、渠道、关联资源、接收人和可选 `dedupKey`。`dedupKey` 在租户内唯一：

- 没有 `dedupKey` 时，每次调用创建一条新通知；
- 有 `dedupKey` 时，重复调用复用已有通知，并补充尚未存在的接收关系；
- 后台任务使用业务日期组成去重键，避免多实例或重复轮询重复发送日报提醒。

通知创建、接收关系写入和业务动作应在同一个业务事务中完成。当前通知内部服务不开放给客户端，客户端只能查询和修改自己的阅读状态。

## 5. 后台任务

`BackgroundJobsService` 由 NestJS 进程内定时器驱动，默认每 60 秒尝试执行一次。每次执行前使用 Redis 分布式锁 `jobs:notification-center-runner`，只有成功获得锁的实例执行任务，避免多实例重复处理。

当前任务如下：

| 任务 | 条件 | 处理 |
| --- | --- | --- |
| 上传会话过期 | `upload_sessions.status = PENDING` 且 `expiresAt <= now` | 更新为 `EXPIRED`，写入 `UPLOAD_SESSION_EXPIRED` |
| AI 动作草稿过期 | 状态为 `PENDING_CONFIRMATION` 且已超过 `expiresAt` | 更新为 `EXPIRED` |
| 日报提交提醒 | 有效成员前一天没有已提交或已通过日报 | 为未提交成员创建一条站内提醒 |

日报提醒只面向有效租户成员和有效用户，不提醒已提交或已通过日报的成员。日报日期按 UTC 日界线计算，通知关联类型为 `WORK_REPORT`。

## 6. 配置

| 环境变量 | 默认值 | 说明 |
| --- | --- | --- |
| `BACKGROUND_JOBS_ENABLED` | 启用 | 设置为 `false` 可关闭应用进程内后台任务 |
| `BACKGROUND_JOBS_INTERVAL_SECONDS` | `60` | 定时轮询间隔，必须为正整数秒 |
| `REDIS_URL` | 无默认值 | Redis 连接地址，后台锁依赖 Redis |
| `REDIS_KEY_PREFIX` | 环境配置 | Redis 逻辑键的环境前缀 |

生产环境必须配置独立 Redis，并确保不同环境使用不同的 key 前缀。关闭后台任务不会影响通知查询接口，但会停止过期清理和日报提醒。

## 7. 权限与审计

通知读取使用租户权限 `notification.read`。已有租户角色在迁移中获得该权限；后续新增角色仍应按租户 RBAC 规则授予权限。权限只决定是否可以使用通知中心，不改变通知的接收人范围。

单条已读记录动作 `NOTIFICATION_READ`，全部已读记录动作 `NOTIFICATIONS_READ_ALL`。审计事件包含租户、操作者、成员身份、请求 ID、资源类型和批量更新数量等元数据。

## 8. 数据模型和迁移

```text
Tenant
  └── Notification
        └── NotificationRecipient ── User
```

- `notifications` 保存通知正文、渠道、关联资源和租户内去重键；
- `notification_recipients` 保存接收人和该接收人的阅读时间；
- `NotificationRecipient` 同时关联租户、通知和用户，查询条件始终带租户和用户；
- `0011_notification_center_and_jobs` 增加关系外键、去重唯一索引、未读查询索引、权限初始化和 PostgreSQL 中文注释；
- 数据库结构只通过 Prisma schema 和迁移演进，不能直接手工改共享数据库。

## 9. 当前限制和后续方向

- 通知发送目前是同步数据库写入，不保证实时到达；
- 后台任务是应用内定时器，不具备队列重试、任务历史和人工重跑能力；
- 日报提醒目前只覆盖日报，不自动提醒周报；
- COS 文件上传、邮件短信、WebSocket 和消息队列后续单独设计，不在本次范围内。

## 10. 契约、实现和验证

- 公开契约：`packages/contracts/openapi/openapi.yaml`；
- API 实现：`apps/api/src/notification`；
- 后台任务实现：`apps/api/src/jobs`；
- Prisma 迁移：`apps/api/prisma/migrations/0011_notification_center_and_jobs`；
- 客户端生成物位于 `packages/api-client/src/`，禁止手工修改。

验证命令：

```bash
pnpm --filter @cees/contracts lint
pnpm --filter @cees/contracts generate:public
pnpm --filter @cees/api-client typecheck
pnpm --filter @cees/api build
pnpm --filter @cees/api test
pnpm --filter @cees/api exec prisma validate
```
