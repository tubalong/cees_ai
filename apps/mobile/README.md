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

当前主界面已实现 AI 助理双模式首页、组织、消息、我的和悬浮胶囊 TabBar。Web 平台目录已经生成；`android/`、`ios/` 等原生目录仍需在对应工具链安装后补充。

## 初始化与启动

Flutter SDK 安装在 `E:\tools\flutter`，并已加入当前用户 `PATH`。重新打开终端后，在 `apps/mobile` 目录执行：

```text
flutter doctor
flutter pub get
flutter devices
flutter run -d chrome
```

指定设备时使用：

```text
flutter run -d <device-id>
```

需要生成 Android 平台时，先安装 Android Studio 和 Android SDK，再执行：

```text
flutter create . --platforms=android
flutter run -d <android-device-id>
```

常用验证命令：

```text
flutter analyze
flutter test
```
