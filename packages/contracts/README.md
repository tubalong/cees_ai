# packages/contracts — 全仓唯一跨语言契约

存放 OpenAPI 契约与相关 JSON Schema，是前端（TS/Dart）与后端（TS/Python）之间唯一合法对齐点。

## 目录

```text
openapi/
├── openapi.yaml       # 主契约文件
└── components/        # 共享 Schema 组件
```

## 变更流程

1. 修改 `openapi.yaml`（兼容新增默认可选项）；
2. 校验契约（CI 强制）；
3. 重新生成客户端：TS → `packages/api-client`；Dart/Python → 各端生成目录；
4. 破坏性变更提升契约版本并在 `docs/api` 记录迁移说明。

TypeScript 客户端生成命令：

```text
pnpm contracts:generate
```
