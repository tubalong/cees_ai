# apps/mobile — Flutter 移动端

独立 pubspec，不参与 pnpm workspace；通过由 `packages/contracts` 生成的 Dart API 客户端接入。

## 目录说明

```text
lib/
├── main.dart          # 入口（待生成）
└── src/
    ├── core/          # 网络、离线同步、本地存储
    ├── features/      # 按业务功能组织页面与状态
    └── shared/        # 共享组件（含生成 API 客户端目录）
test/                  # 测试
```

原生 `android/`、`ios/` 等目录由 `flutter create` 初始化后补充。
