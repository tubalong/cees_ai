# API 约定

- `packages/contracts/openapi/openapi.yaml` 是公开 API 的唯一事实源。
- 客户端代码一律由契约生成（TS：`packages/api-client`；Dart/Python：各端生成目录），禁止手写替代。
- 变更规则：兼容新增默认可选项并声明默认值；破坏性变更必须提升契约版本，并在此说明迁移方式。
- 统一错误格式、鉴权方式与分页约定（待细化后补充于此）。

文件上传的跨领域设计草案见 [文件上传设计](../architecture/file-upload.md)。其中的路径和 Schema 只有写入 `packages/contracts/openapi/openapi.yaml` 并通过评审后，才构成正式 API 契约。
