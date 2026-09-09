# 任务管理 API

> 状态：已实现
> 最后同步：2026-09-09
> 契约版本：`0.13.0`

## 1. 接口列表

所有接口都要求租户 Access Token、对应 `task.*` 权限以及当前项目成员身份。

| 方法与路径 | 用途 | 权限 |
| --- | --- | --- |
| `GET /projects/{projectId}/tasks` | 查询任务列表 | `task.read` |
| `POST /projects/{projectId}/tasks` | 创建任务 | `task.create` |
| `GET /projects/{projectId}/tasks/{taskId}` | 查询任务详情 | `task.read` |
| `PATCH /projects/{projectId}/tasks/{taskId}` | 修改任务资料或父任务 | `task.update` |
| `DELETE /projects/{projectId}/tasks/{taskId}` | 删除无子任务的任务 | `task.delete` |
| `POST /projects/{projectId}/tasks/{taskId}/transitions` | 任务状态流转 | `task.status.update` |
| `PUT /projects/{projectId}/tasks/{taskId}/assignees` | 整体替换执行人 | `task.assignee.manage` |
| `GET /projects/{projectId}/tasks/{taskId}/comments` | 查询评论 | `task.read` |
| `POST /projects/{projectId}/tasks/{taskId}/comments` | 新增评论 | `task.comment.create` |
| `PATCH /projects/{projectId}/tasks/{taskId}/comments/{commentId}` | 修改评论 | `task.comment.update` |
| `DELETE /projects/{projectId}/tasks/{taskId}/comments/{commentId}` | 删除评论 | `task.comment.delete` |
| `GET /projects/{projectId}/tasks/{taskId}/attachments` | 查询附件 | `task.read` |
| `POST /projects/{projectId}/tasks/{taskId}/attachments` | 关联已上传文件 | `task.attachment.manage` |
| `DELETE /projects/{projectId}/tasks/{taskId}/attachments/{attachmentId}` | 移除附件关系 | `task.attachment.manage` |
| `GET /projects/{projectId}/tasks/{taskId}/activities` | 查询任务动态 | `task.read` |

实际 HTTP 路径统一带 `/api/v1` 前缀。

## 2. 创建任务示例

```http
POST /api/v1/projects/30000000-0000-0000-0000-000000000001/tasks
Authorization: Bearer <accessToken>
Content-Type: application/json
```

```json
{
  title: 完成任务体系接口,
  description: 实现状态流转、评论、附件和动态,
  parentId: null,
  priority: HIGH,
  dueDate: 2026-09-15T10:00:00.000Z,
  ownerMembershipId: 20000000-0000-0000-0000-000000000001,
  collaboratorMembershipIds: [
    20000000-0000-0000-0000-000000000002
  ]
}
```

`ownerMembershipId` 和每个协作人 ID 都是 `tenant_memberships.id`，不是全局 `users.id`。

## 3. 查询参数

任务列表支持：

| 参数 | 含义 |
| --- | --- |
| `keyword` | 模糊搜索标题和说明 |
| `status` | 按任务状态过滤 |
| `priority` | 按优先级过滤 |
| `assigneeMembershipId` | 查询某成员负责或协作的任务 |
| `parentId` | 查询指定父任务的直接子任务 |
| `rootOnly` | 为 `true` 时只查询根任务，不能和 `parentId` 同时使用 |
| `limit/cursor` | UUID 游标分页，单页最多 100 条 |

评论和动态使用 `limit/cursor` 分页，附件当前一次返回全部有效关系。

## 4. 乐观锁

任务修改、删除、状态流转、执行人替换、评论修改/删除和附件移除都要求提交当前 `version`。写入成功后版本递增；版本过期返回：

```json
{
  code: TASK_VERSION_CONFLICT,
  message: 数据已被其他操作修改，请刷新后重试
}
```

## 5. 状态流转示例

```http
POST /api/v1/projects/{projectId}/tasks/{taskId}/transitions
```

```json
{
  status: BLOCKED,
  reason: 等待第三方接口联调,
  version: 3
}
```

`BLOCKED` 和 `CANCELLED` 必须填写非空 `reason`。不支持直接执行 `TODO → DONE`，也不支持从 `DONE/CANCELLED` 再次流转。

## 6. 附件流程

1. 调用 `POST /api/v1/upload-sessions` 创建 COS 上传会话；
2. 客户端使用预签名 URL 直接 PUT 到腾讯云 COS；
3. 调用上传完成接口，获得正式 `fileId`；
4. 将 `fileId` 作为 `fileObjectId` 调用任务附件新增接口；
5. 移除附件只删除任务关联，不删除 COS 文件。

## 7. 常见错误

| 状态码 | 错误码 | 含义 |
| --- | --- | --- |
| 400 | `TASK_ASSIGNEE_INVALID` | 负责人或协作人不是有效项目成员 |
| 400 | `TASK_PARENT_INVALID` | 父任务不存在或不属于当前项目 |
| 400 | `TASK_STATUS_REASON_REQUIRED` | 阻塞或取消时未填写原因 |
| 403 | `TASK_MANAGER_REQUIRED` | 当前成员不是项目管理者或任务负责人 |
| 403 | `TASK_EXECUTOR_REQUIRED` | 当前成员不是执行人或项目管理者 |
| 404 | `PROJECT_NOT_FOUND` | 项目不存在或当前成员未加入项目 |
| 404 | `TASK_NOT_FOUND` | 任务不存在或不属于当前项目 |
| 409 | `PROJECT_READ_ONLY` | 项目已经完成、取消或归档 |
| 409 | `TASK_READ_ONLY` | 任务已经完成或取消 |
| 409 | `TASK_STATUS_TRANSITION_INVALID` | 不允许的状态流转 |
| 409 | `TASK_HIERARCHY_CYCLE` | 父子任务形成循环 |
| 409 | `TASK_HIERARCHY_DEPTH_EXCEEDED` | 任务层级超过 10 层 |
| 409 | `TASK_HAS_CHILDREN` | 删除任务前仍有子任务 |
| 409 | `TASK_VERSION_CONFLICT` | 乐观锁版本冲突 |

完整请求和响应 Schema 以 `packages/contracts/openapi/openapi.yaml` 为准。
