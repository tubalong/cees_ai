# Redis 基础能力

> 状态：基础能力已于 2026-09-08 在 `apps/api` 落地。Redis 只保存缓存、幂等、计数和短期协调数据，不作为任何正式业务数据的事实源。

## 1. 使用边界

- 只有 NestJS API 可以直接连接业务 Redis；桌面端、移动端和 ai-service 不获取 Redis 地址或密码。
- Staging 与 Production 使用独立 Redis 容器、密码和 `REDIS_KEY_PREFIX`。
- 调用方只传逻辑键，`RedisService` 自动附加环境前缀，避免不同环境使用相同物理键。
- 正式文件、租户、权限、额度和审计状态仍写入 PostgreSQL。
- 不提供 `KEYS`、清空数据库或任意模式批量删除等高风险公共方法。

## 2. 配置

```text
REDIS_URL=redis://:change_me@host:port/0
REDIS_KEY_PREFIX=cees:<environment>:
```

当前约定值分别为 `cees:local:`、`cees:staging:` 和 `cees:production:`。

生产环境发现示例密码时会拒绝启动。连接由 `RedisModule` 在 NestJS 生命周期中建立并在退出时关闭。

## 3. 调用接口

`RedisService` 当前提供：

| 方法 | 用途 |
| --- | --- |
| `get` / `set` | 字符串读取与写入，可设置 TTL |
| `getJson` / `setJson` | JSON 序列化数据读取与写入 |
| `delete` | 删除一个或多个明确逻辑键 |
| `exists` | 判断键是否存在 |
| `expire` / `ttl` | 设置和查询有效期 |
| `increment` | 原子整数累加 |
| `setIfAbsent` | 带 TTL 的原子 `SET NX`，用于幂等和短期占位 |
| `ping` | Redis 连通性检查 |

示例：

```ts
await redis.setJson(
    `tenant:${tenantId}:upload:${uploadSessionId}`,
    { state: 'pending' },
    { ttlSeconds: 600 },
);
```

实际物理键会变为类似 `cees:staging:tenant:<tenantId>:upload:<uploadSessionId>`。

## 4. 暂不提供

- Redis 充当业务数据库或存储额度事实源；
- 自制可靠任务队列；需要异步任务时应在该连接基础上引入 BullMQ 等具备确认和重试语义的队列；
- 跨租户通配扫描与删除；
- Redlock 等完整分布式锁协议。

源码入口：`apps/api/src/redis/redis.module.ts` 和 `apps/api/src/redis/redis.service.ts`。
