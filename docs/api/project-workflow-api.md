# 项目工作流 API

> 契约版本：`0.37.0`
> 契约事实源：`packages/contracts/openapi/openapi.yaml`

## 项目动态与汇总

- `GET /api/v1/projects/{projectId}/workflow-summary`
- `GET /api/v1/projects/{projectId}/activities?limit=100`

读取要求 `project.read` 且当前用户属于项目；`project.manage_all` 仍要求有效租户成员身份，但没有项目成员关系时不授予项目访问权。

## 项目决策

- `GET /api/v1/projects/{projectId}/decisions`
- `POST /api/v1/projects/{projectId}/decisions`
- `GET /api/v1/projects/{projectId}/decisions/{decisionId}`
- `PATCH /api/v1/projects/{projectId}/decisions/{decisionId}`
- `POST /api/v1/projects/{projectId}/decisions/{decisionId}/publish`
- `DELETE /api/v1/projects/{projectId}/decisions/{decisionId}?version={version}`

创建草稿要求项目成员。修改和删除草稿要求作者或项目负责人/经理。发布要求 `project.update` 和项目负责人/经理，且需要最终结论。发布后写正式决策和项目动态，不回写旧聊天消息。

## 项目里程碑

- `GET /api/v1/projects/{projectId}/milestones`
- `POST /api/v1/projects/{projectId}/milestones`
- `GET /api/v1/projects/{projectId}/milestones/{milestoneId}`
- `PATCH /api/v1/projects/{projectId}/milestones/{milestoneId}`
- `POST /api/v1/projects/{projectId}/milestones/{milestoneId}/start`
- `POST /api/v1/projects/{projectId}/milestones/{milestoneId}/acceptance`
- `POST /api/v1/projects/{projectId}/milestones/{milestoneId}/complete`
- `POST /api/v1/projects/{projectId}/milestones/{milestoneId}/cancel`
- `POST /api/v1/projects/{projectId}/milestones/{milestoneId}/reopen`

写入要求 `project.update` 和项目负责人/经理。进度由关联任务计算，逾期和风险由服务端计算；完成必须人工确认。

## 项目仓库

- `GET /api/v1/projects/{projectId}/repositories`
- `POST /api/v1/projects/{projectId}/repositories`
- `PATCH /api/v1/projects/{projectId}/repositories/{repositoryId}`
- `DELETE /api/v1/projects/{projectId}/repositories/{repositoryId}?version={version}`

仓库 URL 必须是 HTTP(S)，不得包含用户名、密码或 Token。支持 GITHUB、GITLAB、GITEE 和 OTHER，允许配置多个仓库。仓库是否显示由已持久化配置决定，而不是输入框草稿值。

## 项目会话

`POST /api/v1/conversations` 兼容新增字段：

```json
{
  "title": "项目 AI 权限边界",
  "mode": "standard",
  "contextType": "PROJECT",
  "projectId": "00000000-0000-0000-0000-000000000000"
}
```

- `GENERAL`：通用会话，不能携带 `projectId`；
- `PROJECT`：必须携带有效 `projectId`，且当前成员属于项目；
- `GET /api/v1/conversations?contextType=PROJECT&projectId=...` 过滤项目会话；
- 会话仍只属于创建成员，其他成员不可见；
- 项目知识库检索在项目会话中额外限制为该项目归属且当前用户可读的知识库。

## 日报复用

项目日报使用现有 WorkReport 接口，并新增 `projectId` 查询过滤：

- `GET /api/v1/work-reports?type=DAILY&projectId=...`
- `POST /api/v1/work-reports/daily`
- `PATCH /api/v1/work-reports/{reportId}`
- `POST /api/v1/work-reports/{reportId}/submit`
- `POST /api/v1/work-reports/{reportId}/withdraw`

任务完成时，NestJS 在同一事务中把负责人任务带入其当天日报草稿；已提交/已通过的日报不会被静默修改。

## 项目知识库文件

`GET /api/v1/knowledge-bases?projectId=...` 只返回该项目的可见知识库。项目文件页面通过既有知识库上传、解析、重试和删除接口操作，文档写入继续受知识库成员权限约束。
