# 企业角色与权限管理

## 当前实现

- Desktop 左侧导航在当前成员拥有 `role.read` 时显示“角色权限”。
- 角色页展示当前企业角色、系统标记、成员数量、数据范围、权限数量和分组权限详情。
- 企业管理员可以创建、编辑和删除自定义角色，并整体替换角色权限。
- `tenant_admin` 是平台维护的系统角色，客户端禁止编辑、替换权限和删除。

## 接口

| 接口 | 用途 | 权限 |
| --- | --- | --- |
| `GET /permissions` | 获取租户权限目录 | `role.read` |
| `GET /roles` | 查询当前企业角色 | `role.read` |
| `POST /roles` | 创建自定义角色 | `role.create` |
| `GET /roles/{roleId}` | 查询角色详情、权限和成员数量 | `role.read` |
| `PATCH /roles/{roleId}` | 修改名称、说明和数据范围 | `role.update` |
| `PUT /roles/{roleId}/permissions` | 整体替换权限集合 | `role.update` |
| `DELETE /roles/{roleId}?version=` | 删除未使用的自定义角色 | `role.delete` |

## 保存顺序

创建请求只允许以下字段：`code`、`name`、`description`、`dataScope`。客户端会将空说明规范化为 `description: null`，不会把 `permissionIds` 混入创建请求。

权限替换请求必须是完整的 `permissionIds + version`。未选择任何权限时，创建角色阶段不会额外发送权限替换请求；编辑已有角色时，提交空数组表示清空全部权限。

创建角色时：

1. 调用 `POST /roles` 创建角色。
2. 读取创建响应中的角色 `id` 和 `version`。
3. 调用 `PUT /roles/{roleId}/permissions`，提交完整 `permissionIds` 和创建返回的 `version`。

编辑角色时：

1. 调用 `PATCH /roles/{roleId}`，提交名称、说明、数据范围和当前 `version`。
2. 读取修改响应中的新 `version`。
3. 使用新 `version` 调用权限整体替换，避免用旧版本覆盖并发修改。

## 数据范围

- `SELF`：仅本人。
- `DEPARTMENT`：本部门。
- `DEPARTMENT_TREE`：本部门及下级。
- `PROJECT`：参与项目。
- `CUSTOM`：自定义范围，当前解析器尚未支持具体约束配置。
- `TENANT`：当前企业全部数据。

后端 `DataScopeResolverService` 将角色的 `dataScope` 解析为租户级、成员级、部门级或项目级过滤条件。未配置角色的成员默认按 `SELF` 处理；遇到 `CUSTOM` 时返回 `DATA_SCOPE_CUSTOM_UNSUPPORTED`，避免出现“已配置但不生效”的静默越权。

## 邀请联动

- 角色保存或删除后会刷新 React Query 的 `tenant-roles` 缓存。
- 邀请同事窗口使用同一个角色查询键，因此下次打开时立即获得最新角色。
- 创建邀请提交角色 ID 完整集合，不按角色名称或编码自行推断。
- 所有角色和邀请接口均来自当前租户 Token，不接收客户端提交的 `tenantId`。

## 删除限制

- 系统角色永远不可删除。
- 自定义角色只有在未被成员和资源 ACL 使用时才能删除。
- 删除请求携带当前角色 `version`；冲突时由服务端返回 `409`，客户端不自动覆盖。
