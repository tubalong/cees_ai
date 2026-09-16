# 钉钉组织架构与人员同步

## 1. 功能范围

本阶段支持一个 CEES 租户绑定一个钉钉企业，由租户管理员维护钉钉应用凭证、验证连接、全量同步组织架构和人员，并通过预览/确认流程将钉钉组织映射到 CEES。首次映射可以为未匹配人员创建待激活的 CEES 登录账号并签发一次性激活凭证，不覆盖已有 CEES 密码、角色和项目成员关系。

本阶段暂不包含考勤、请假、审批、钉钉文档、聊天消息、日程、待办和 AI 派发。

## 2. 业务规则

- `tenantId` 唯一：一个租户最多绑定一个钉钉企业。
- `corpId` 全局唯一：同一个钉钉企业不能绑定多个租户。
- `appSecret` 只在请求中接收，使用 AES-256-GCM 加密后保存，接口响应不返回明文或密文。
- 组织同步采用幂等 upsert；同一钉钉用户属于多个部门时只保存一条人员镜像和多个部门 ID。
- 本次同步未发现的部门标记 `isDeleted=true`，未发现或已停用的人员标记 `isDeleted=true`、`active=false`，不物理删除。
- 部门按同一父部门下同名唯一规则自动匹配；多候选部门由租户管理员确认，找不到时可创建 CEES 部门。
- 人员优先使用已有钉钉映射；同名且候选唯一时自动匹配，多候选由租户管理员确认，找不到时可创建待激活成员。
- 账号在整个租户内唯一，按姓名生成小写拼音，冲突时追加 `2`、`3` 等数字；不得只按部门范围判断冲突。
- 角色必须由租户管理员提前创建；一个角色可以分配给多人，一个钉钉人员可以拥有多个角色。
- `tenant_admin` 是受保护的租户管理员角色，不能通过钉钉映射批量分配；选择的角色必须属于当前租户且未删除。
- 新创建的 CEES 成员必须至少分配一个角色；已匹配成员默认保留原有角色，显式分配时追加角色而不覆盖。
- 同一钉钉集成同时只能有一个 `RUNNING` 同步任务。
- 所有接口都在当前租户上下文内执行，并受 JWT、租户守卫和权限守卫保护。

## 3. 使用流程

1. 租户管理员在钉钉开放平台创建企业内部应用，准备 `corpId`、`appKey` 和 `appSecret`。
2. 配置 `DINGTALK_CREDENTIAL_ENCRYPTION_KEY`，生产环境必须使用平台 Secrets 注入的 32 字节密钥，不能使用 `change_me`。
3. 调用 `POST /api/v1/dingtalk/integration` 创建绑定。服务端先向钉钉获取 Access Token，验证成功后才入库。
4. 调用 `POST /api/v1/dingtalk/integration/verify` 可再次验证凭证。
5. 调用 `POST /api/v1/dingtalk/organization/sync` 执行全量同步。
6. 使用部门、人员和同步任务查询接口检查结果。
7. 调用映射预览接口检查自动匹配、待创建项和重名冲突。
8. 租户管理员在映射页面为全部或部分人员选择一个或多个角色；新建成员未分配角色时不能应用。
9. 租户管理员补充冲突处理后调用映射应用接口；新建成员的激活凭证只在本次响应返回。

## 4. 数据模型

| 表 | 用途 |
| --- | --- |
| `dingtalk_integrations` | 租户与钉钉企业绑定、加密凭证、状态、最近验证/同步时间 |
| `dingtalk_departments` | 钉钉部门外部镜像，保留钉钉部门 ID 和层级 |
| `dingtalk_users` | 钉钉人员外部镜像，保留 UserId、姓名、职位、工号和部门 ID 列表 |
| `dingtalk_sync_jobs` | 记录同步任务状态、数量、错误和发起人 |

数据库迁移为 `apps/api/prisma/migrations/0016_dingtalk_organization_sync/migration.sql`；映射权限迁移为 `apps/api/prisma/migrations/0027_dingtalk_organization_mapping/migration.sql`。迁移包含枚举、索引、租户/集成/绑定外键、运行中任务部分唯一索引，以及全部表和字段的 PostgreSQL 中文注释。

## 5. 权限

| 权限 | 用途 |
| --- | --- |
| `dingtalk.integration.read` | 查看当前租户钉钉绑定 |
| `dingtalk.integration.manage` | 创建、修改和验证钉钉绑定 |
| `dingtalk.organization.read` | 查看部门和人员镜像 |
| `dingtalk.organization.sync` | 发起组织架构和人员同步 |
| `dingtalk.organization.mapping.preview` | 预览组织映射方案 |
| `dingtalk.organization.mapping.manage` | 应用组织映射、创建成员和签发激活凭证 |

上述权限通过迁移授予已有 `tenant_admin` 系统角色；权限目录同步维护在 `apps/api/src/rbac/permission-catalog.ts`。

## 6. 失败与安全

- 钉钉网络、HTTP 或业务错误统一转换为 `502`，同步任务记录 `FAILED` 和错误信息，集成状态置为 `ERROR`。
- 凭证更新使用 `version` 乐观锁，版本不一致返回 `409`。
- 并发同步由数据库部分唯一索引兜底，重复请求返回同步已运行错误。
- 查询始终按当前租户过滤，禁止通过镜像 ID 访问其他租户数据。
- 当前同步接口为同步执行；大规模企业接入后应迁移到后台任务，并保留同一任务记录模型。

## 7. 组织映射与首次成员导入

映射接口只处理当前租户已经同步的、未删除的钉钉镜像数据。映射本身不跨租户，也不物理删除 CEES 部门或成员。

### 7.1 预览映射

```http
POST /api/v1/dingtalk/organization/mapping/preview
```

请求体可为空，也可以指定：

```json
{
  "activationExpiresInDays": 7,
  "createMissingDepartments": true,
  "createMissingMembers": true
}
```

预览结果分为：

- `MATCH_EXISTING`：已存在映射或同父级同名且唯一；
- `CREATE`：当前租户没有匹配项，应用时可创建；如果父部门本身也是 `CREATE`，子部门会把该父部门视为计划可用父级并继续自动分析，不会因此误报 `PARENT_MAPPING_MISSING`；
- `CONFLICT`：存在多个候选，需要管理员处理；
- `SKIP`：应用时由管理员明确跳过。

部门预览按父子关系处理。父部门完成预览后，子部门才会计算同父级同名候选；父部门计划创建时，子部门默认跟随创建，应用阶段会先创建父部门，再使用新父部门 ID 创建子部门。只有父部门存在无法解决的冲突或同步数据缺少父级时，子部门才会显示 `PARENT_MAPPING_MISSING` 并等待管理员处理。

### 7.2 应用映射

```http
POST /api/v1/dingtalk/organization/mapping/apply
```

管理员处理重名成员时示例：

```json
{
  "createMissingDepartments": true,
  "createMissingMembers": true,
  "activationExpiresInDays": 7,
  "roleAssignments": [
    {
      "roleId": "普通员工角色UUID",
      "dingtalkUserIds": [
        "钉钉用户镜像记录UUID-张三",
        "钉钉用户镜像记录UUID-王五"
      ]
    },
    {
      "roleId": "技术人员角色UUID",
      "dingtalkUserIds": [
        "钉钉用户镜像记录UUID-李四"
      ]
    }
  ],
  "userResolutions": [
    {
      "dingtalkUserId": "钉钉用户镜像记录UUID",
      "action": "BIND_EXISTING",
      "membershipId": "CEES租户成员UUID"
    }
  ]
}
```

`roleAssignments` 只需要提交管理员实际选择的分组，不需要为每个人单独调用接口。左侧角色列表可以选择一个角色，右侧人员列表可以全选当前筛选结果或勾选部分人员；同一人员可以加入多个角色分组。应用前端应确保所有 `CREATE` 人员至少出现在一个角色分组中。

部门冲突可以使用：

```json
{
  "dingtalkDepartmentId": "钉钉部门镜像记录UUID",
  "action": "BIND_EXISTING",
  "departmentId": "CEES部门UUID"
}
```

应用过程使用事务，并写入 `DINGTALK_ORGANIZATION_MAPPING_APPLIED` 审计事件。并发冲突需要重新预览后再应用。

### 7.3 自动创建账号和激活

找不到已有成员且确认创建时，服务端创建 `PENDING_ACTIVATION` 成员，不设置默认密码，签发一次性激活令牌。账号示例：

```text
张三       -> zhangsan
第二个张三 -> zhangsan2
第三个张三 -> zhangsan3
```

账号唯一范围是整个租户，已存在成员、有效邀请和本次批次都会参与冲突检查。激活凭证明文只在应用接口响应中返回一次，前端可以将返回的 `credentials` 生成 Excel；凭证中的 `roleIds`、`roleCodes` 是本次实际写入的新成员角色。

用户使用以下接口设置自己的密码：

```http
POST /api/v1/auth/activate
```

激活成功后再通过 `/api/v1/auth/login` 登录。重复同步已建立映射的钉钉用户不会重复创建账号，也不会重新生成激活凭证。

## 8. 暂不包含

当前仍不包含考勤、请假、审批、钉钉文档、聊天消息、日程、待办和 AI 派发；也不会根据钉钉管理员标记自动授予 CEES 管理员角色。
