# 分配策略请假可用性过滤

> 状态：已实现基础能力
> Owner：C
> 更新日期：2026-09-18
> 公开契约版本：`0.31.0`
> 关联：`packages/contracts/openapi/openapi.yaml`、[分配策略与人财法 API](../api/assignment-and-hr-finance-legal-api.md)、[通用任务 tasks.scope 方案](task-scope-proposal.md)

## 1. 目标

在不修改 D 负责的 Task 表、任务状态机和负责人写入逻辑的前提下，为 AssignmentPolicy 提供通用的成员时间可用性过滤能力。当前阶段只处理与指定时间窗口重叠的已批准请假，为后续 Boss 或部门领导发布任务后的智能推荐和自动分配提供确定性规则基础。

## 2. 边界

- Assignment 负责展开候选池、调用可用性过滤、执行兜底并返回解析结果。
- HR 请假申请是成员请假事实源；`apps/api/src/hr/hr-availability.service.ts` 对外提供只读可用性判断，Assignment 不复制请假状态机，也不修改请假数据。
- 当前解析接口只返回候选人，不创建任务、不写任务负责人、不修改 `apps/api/src/task/**`。
- AI 后续只负责从自然语言中提取时间、领域和技能等结构化草稿，正式过滤和分配仍由 NestJS 执行。

## 3. 请求时间窗口

`POST /api/v1/assignment/policies/resolve` 新增可选字段：

```json
{
  "availabilityWindow": {
    "startAt": "2026-09-21T09:00:00+08:00",
    "endAt": "2026-09-21T18:00:00+08:00"
  }
}
```

- 两个时间都是带时区的绝对时刻，`endAt` 必须晚于 `startAt`。
- 非法窗口返回 `400 ASSIGNMENT_AVAILABILITY_WINDOW_INVALID`。
- 没有时间窗口时不按服务器日期或“今天”猜测成员可用性，保持原候选结果，并返回 `leaveFilterApplied = false`。

## 4. 过滤规则

只有策略 `skipOnLeave = true` 且请求提供有效时间窗口时执行过滤。命中条件为：

```text
leave.status = APPROVED
leave.startAt < availabilityWindow.endAt
leave.endAt > availabilityWindow.startAt
```

- `SUBMITTED`、`REJECTED`、`CANCELLED` 等状态不影响候选人。
- 使用严格时间区间重叠判断，支持全天、半天和按小时请假。
- 返回的 `skippedOnLeave` 只包含成员 ID，不暴露请假类型、原因或其他敏感信息。

## 5. 解析顺序

```text
项目覆盖策略 → 租户默认策略 → 展开候选池 → 请假过滤
→ 候选为空时执行 fallback → 对 fallback 候选再次过滤 → 返回结果
```

兜底候选人不能绕过请假规则。最终候选为空时，解析接口返回空数组，由未来任务模块决定人工选择、保持未分配或终止自动创建。

## 6. 返回与审计

- `candidates`：最终可用候选成员。
- `skippedOnLeave`：因已批准请假与窗口重叠而被跳过的成员。
- `leaveFilterApplied`：本次是否实际查询并应用请假过滤。
- 审计记录时间窗口、是否执行过滤、跳过数量和最终候选数量，不记录请假原因。

## 7. 与 D 的后续接线

D 的任务模型稳定后，Task 应把计划开始和结束时间映射为 `availabilityWindow`，调用 Assignment 解析候选人。正式写入负责人前仍需在任务事务边界附近再次校验成员有效性和可用性，避免解析后新请假或成员状态变化造成竞态。

当前未实现：任务工作量评分、技能匹配、正式负责人写入、自动分配模式、并发抢占和请假审批后的任务重评估。

## 8. 验收

- 只过滤与时间窗口重叠的 `APPROVED` 请假。
- 候选池和 fallback 候选均执行同一过滤规则。
- 未传时间窗口时保持兼容且明确返回未执行过滤。
- OpenAPI、生成客户端、API 单测和 Desktop 解析预览保持一致。
