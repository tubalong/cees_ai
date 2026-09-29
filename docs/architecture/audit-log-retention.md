# 审计日志保留策略（设计与落地记录）

> 状态：**已落地**（契约 `0.48.0`，迁移 `20260929163000_audit_log_retention`）。本文件是该策略的主设计文档，
> 记录决定、阈值、执行方式、失败语义与验收口径。入口见 [总体架构](overview.md)、[文档地图](../README.md)、
> [数据库约定](../database/README.md) 与 [安全模型](../security/README.md)。

## 1. 要解决的问题

- `audit_logs` 是租户安全审计的唯一事实源，且只增不减：不设保留期时，表体积随租户数与调用量线性增长。
- 连接器调用审计是唯一可能放大到「业务审计量级以上」的来源：租户打开 `connectorReadAuditEnabled` 后，
  只读调用按次留痕，单轮对话最多产生 3 条 `CONNECTOR_READ_OPERATION`（`metadata.aggregated = false`），
  而写/破坏性调用与轮次级聚合审计都只有每轮一条。
- 同时审计是合规事实，不能为了省空间一刀切删除。

## 2. 决策：分级保留

| 审计类别 | 判定条件 | 保留期 | 到期处理 |
| --- | --- | --- | --- |
| 连接器只读逐条审计 | `resource_type = 'CONNECTOR'` 且 `action = 'CONNECTOR_READ_OPERATION'` 且 `metadata.aggregated = false` | 90 天 | 物理删除 |
| 连接器只读轮次级聚合 | 同上但 `metadata.aggregated = true` | 3 年 | 归档 |
| 连接器写/破坏性调用 | `action = 'CONNECTOR_WRITE_OPERATION'` | 3 年 | 归档 |
| 其他租户审计（含 `LOCAL_SYSTEM_OPERATION`） | 其余 `audit_logs` 行 | 3 年 | 归档 |
| 平台审计 | `platform_audit_logs` | 永久 | 不处理 |

理由：

- 只按「量级最高、单条追溯价值最低」这一类破例：逐条只读审计回答的是「谁在什么时候读了什么工具」，
  轮次级聚合审计已保留同样的可回答范围，因此 90 天后物理删除不会造成审计真空。
- 其余租户审计（写操作、权限、登录、业务状态变更）只归档不删除，事实与 `created_at` 原值都保留。
- 平台审计跨租户且量级最小，永久保留，不进本期流程。

## 3. 归档表 `audit_logs_archive`

- 字段与 `audit_logs` 完全一致（含 `id` 与 `created_at` 原值），只新增 `archived_at`；主键仍是 `id`，
  因此重复归档同一行只会主键冲突，不会产生重复事实。
- 不设外键，与 `audit_logs` 保持一致；新增索引 `(tenant_id, created_at)` 供合规按租户加时间检索。
- **不通过公开接口暴露**：`GET /audit-events` 与详情只查热表，归档数据由运维或合规通过数据库导出。

## 4. 执行方式

- 入口：`BackgroundJobsService` → `AuditRetentionService.runOnce(now)`，随既有后台任务执行，
  复用 `jobs:notification-center-runner` 的 Redis 锁，保证多实例下串行，不与自身或其他后台步骤并发。
- 每轮先清理只读逐条审计，再归档过期审计；每类最多 `AUDIT_RETENTION_MAX_BATCHES` 批、每批
  `AUDIT_RETENTION_BATCH_SIZE` 行，单批不足额即认为该类已排空并提前结束，因此积压是逐步排空而不是一次性冲高。
- 归档在**单条 SQL** 内完成「按时间取最老一批 → 写入归档表 → 删除热表行」，不把行读进 Node 进程；
  写入与删除在同一条语句里，不存在「删了却没归档」的中间态。
- 阈值与批量都可覆盖，非法值（非正整数）回退默认值。

### 4.1 配置项

| 环境变量 | 默认 | 说明 |
| --- | --- | --- |
| `AUDIT_RETENTION_ENABLED` | 启用 | 设为 `false` 关闭整个任务，不影响审计写入与查询 |
| `AUDIT_CONNECTOR_READ_RETENTION_DAYS` | `90` | 连接器只读逐条审计保留天数 |
| `AUDIT_ARCHIVE_AFTER_DAYS` | `1095` | 其余租户审计的归档阈值（3 年） |
| `AUDIT_RETENTION_BATCH_SIZE` | `1000` | 单批处理行数 |
| `AUDIT_RETENTION_MAX_BATCHES` | `5` | 单类单轮最多批数 |

### 4.2 支撑索引与取舍

迁移同时给 `audit_logs` 增加两个跨租户扫描索引：

| 索引 | 服务的查询 |
| --- | --- |
| `(created_at, id)` | 归档扫描「最老的一批行」 |
| `(action, created_at)` | 只读逐条审计按动作加时间定位 |

`audit_logs` 原有索引都以 `tenant_id` 打头，服务的是「单租户查询」；保留任务是跨租户扫描，用不上它们。
两个索引会增加审计写入的索引维护开销，因此只在能证明收益、且表还小时一次补齐——表变大后加索引代价更高。

## 5. 失败语义

- 异常像其他后台步骤一样向上抛出并记录日志；各批之间各自提交，失败不回滚已完成批次。
- 归档失败时热表行保持原样（语句原子性），只是本次没有推进。
- 关闭 `AUDIT_RETENTION_ENABLED` 只停止清理，不影响审计写入与查询行为。

## 6. 对外行为变化

- `GET /audit-events` 与 `GET /audit-events/{auditEventId}` 只返回热表数据：超过归档阈值的租户审计返回 404 / 不在列表中。
  契约 `0.48.0` 在接口描述中同步了这一点；响应结构与参数没有变化，旧客户端无需改动。
- 连接器只读逐条审计在保留期后被物理删除，之后无法通过任何接口或热表查询。

## 7. 已知边界与暂缓

- 归档数据没有查询接口，也没有恢复流程；需要时走数据库流程（暂缓）。
- 不做租户级自定义保留期，也不做按审计类别的租户配置。
- `platform_audit_logs` 永久保留，不参与归档或清理。
- 数据库分区、冷存储分层不在本期范围。

## 8. 验收基线

- jest：`apps/api/src/audit/audit-retention.service.spec.ts` 覆盖开关、默认阈值、批量推进、批量上限与非法配置回退；
  `apps/api/src/jobs/background-jobs.service.spec.ts` 覆盖锁内调用、跳过时不动保留任务与结果字段。
- 迁移：在一次性空库上 `prisma migrate deploy` 全部迁移，并确认 `prisma migrate diff` 与 `schema.prisma` 无差异。
- 真库行为：在一次性库上按阈值造数据，确认只有「超期且 `aggregated = false`」的只读审计被删除、
  只有超期租户审计被搬进归档表，且 `metadata`、`created_at` 原值与 `archived_at` 正确。