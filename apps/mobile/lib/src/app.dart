import 'package:flutter/cupertino.dart';
import 'package:flutter/gestures.dart';
import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:flutter_localizations/flutter_localizations.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import 'core/auth_controller.dart';
import 'core/l10n.dart';
import 'features/auth/login_page.dart';
import 'features/shell/mobile_shell.dart';
import 'features/work_record/work_record_page.dart';
import 'shared/module_page.dart';

/// iOS 回弹滚动 + 触摸/鼠标/触控板拖拽，统一所有列表的惯性手感。
class _IosScrollBehavior extends MaterialScrollBehavior {
  const _IosScrollBehavior();

  @override
  ScrollPhysics getScrollPhysics(BuildContext context) =>
      const BouncingScrollPhysics(parent: AlwaysScrollableScrollPhysics());

  @override
  Set<PointerDeviceKind> get dragDevices => const {
        PointerDeviceKind.touch,
        PointerDeviceKind.mouse,
        PointerDeviceKind.trackpad,
        PointerDeviceKind.stylus,
      };
}

class CeesMobileApp extends ConsumerWidget {
  const CeesMobileApp({super.key});

  /// 品牌主色，同时供 Material 与 Cupertino 组件使用。
  static const Color seed = Color(0xff4f67ff);
  static const Color _scaffoldBg = Color(0xfff3f5ff);
  static const Color _ink = Color(0xff273142);

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final language = ref.watch(languageProvider);
    return MaterialApp(
      title: 'CEES',
      debugShowCheckedModeBanner: false,
      locale: language.locale,
      localizationsDelegates: const [
        AppLocalizationsDelegate(),
        GlobalMaterialLocalizations.delegate,
        GlobalWidgetsLocalizations.delegate,
        GlobalCupertinoLocalizations.delegate,
      ],
      supportedLocales: AppLocalizations.supportedLocales,
      // 全局滚动行为：iOS 回弹物理，避免列表滚动到底时生硬停住。
      scrollBehavior: const _IosScrollBehavior(),
      theme: ThemeData(
        useMaterial3: true,
        platform: TargetPlatform.iOS,
        colorScheme: ColorScheme.fromSeed(seedColor: seed),
        scaffoldBackgroundColor: _scaffoldBg,
        // iOS 不使用 compact 密度，否则会与 44x44pt 触控目标要求冲突。
        visualDensity: VisualDensity.standard,
        // 兜底：未显式指定尺寸的 Material 控件也满足 iOS 最小触控目标。
        materialTapTargetSize: MaterialTapTargetSize.padded,
        typography: Typography.material2021(platform: TargetPlatform.iOS),
        textTheme: const TextTheme(
          bodyLarge: TextStyle(height: 1.4),
          bodyMedium: TextStyle(height: 1.4),
          bodySmall: TextStyle(height: 1.35),
          titleLarge: TextStyle(height: 1.25),
          labelLarge: TextStyle(height: 1.2),
        ),
        // iOS 右滑返回转场（默认走 Material 转场，安卓感明显）。
        pageTransitionsTheme: const PageTransitionsTheme(
          builders: {
            TargetPlatform.iOS: CupertinoPageTransitionsBuilder(),
            TargetPlatform.android: ZoomPageTransitionsBuilder(),
          },
        ),
        // iOS 不应出现 Material 水波纹。
        splashFactory: NoSplash.splashFactory,
        highlightColor: Colors.transparent,
        appBarTheme: const AppBarTheme(
          centerTitle: true,
          elevation: 0,
          scrolledUnderElevation: 0.5,
          backgroundColor: _scaffoldBg,
          surfaceTintColor: Colors.transparent,
          systemOverlayStyle: SystemUiOverlayStyle.dark,
          titleTextStyle: TextStyle(
            fontSize: 17,
            fontWeight: FontWeight.w600,
            color: _ink,
          ),
        ),
        // 底部弹窗统一样式，业务侧不再各自重复写 shape。
        bottomSheetTheme: const BottomSheetThemeData(
          backgroundColor: Colors.white,
          surfaceTintColor: Colors.transparent,
          showDragHandle: true,
          dragHandleColor: Color(0xffd7dce7),
          shape: RoundedRectangleBorder(
            borderRadius: BorderRadius.vertical(top: Radius.circular(24)),
          ),
          clipBehavior: Clip.antiAlias,
        ),
        // 弹窗统一 insetPadding，解决紧凑屏贴边与键盘挤压。
        dialogTheme: const DialogThemeData(
          backgroundColor: Colors.white,
          surfaceTintColor: Colors.transparent,
          insetPadding: EdgeInsets.symmetric(horizontal: 20, vertical: 24),
          shape: RoundedRectangleBorder(
            borderRadius: BorderRadius.all(Radius.circular(20)),
          ),
        ),
        // 浮动 SnackBar：默认 fixed 会被 Home Indicator 与悬浮导航压住。
        snackBarTheme: SnackBarThemeData(
          behavior: SnackBarBehavior.floating,
          backgroundColor: _ink,
          contentTextStyle: const TextStyle(fontSize: 14, color: Colors.white),
          shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(14)),
          insetPadding: const EdgeInsets.fromLTRB(16, 0, 16, 16),
        ),
        listTileTheme: const ListTileThemeData(
          minVerticalPadding: 10,
          visualDensity: VisualDensity.standard,
          contentPadding: EdgeInsets.symmetric(horizontal: 14),
        ),
        // 触控目标兜底：保证所有图标按钮/文字按钮 ≥44x44pt。
        iconButtonTheme: IconButtonThemeData(
          style: IconButton.styleFrom(
            minimumSize: const Size(44, 44),
            padding: const EdgeInsets.all(10),
          ),
        ),
        filledButtonTheme: FilledButtonThemeData(
          style: FilledButton.styleFrom(minimumSize: const Size(44, 48)),
        ),
        outlinedButtonTheme: OutlinedButtonThemeData(
          style: OutlinedButton.styleFrom(minimumSize: const Size(44, 48)),
        ),
        textButtonTheme: TextButtonThemeData(
          style: TextButton.styleFrom(minimumSize: const Size(44, 44)),
        ),
        inputDecorationTheme: InputDecorationTheme(
          filled: true,
          fillColor: Colors.white,
          isDense: true,
          contentPadding: const EdgeInsets.symmetric(horizontal: 14, vertical: 14),
          border: OutlineInputBorder(
            borderRadius: BorderRadius.circular(18),
            borderSide: BorderSide.none,
          ),
        ),
        cardTheme: const CardThemeData(
          margin: EdgeInsets.zero,
          surfaceTintColor: Colors.transparent,
          shape: RoundedRectangleBorder(
            borderRadius: BorderRadius.all(Radius.circular(18)),
          ),
        ),
        // 日期/时间选择器等 Cupertino 组件跟随品牌主色。
        cupertinoOverrideTheme: const CupertinoThemeData(primaryColor: seed),
      ),
      builder: (context, child) {
        // 保留 iOS 动态字体（Dynamic Type），但把放大倍数限制在 1.0–1.3，
        // 避免超大字号撑破紧凑屏布局。
        final media = MediaQuery.of(context);
        return MediaQuery(
          data: media.copyWith(
            textScaler:
                media.textScaler.clamp(minScaleFactor: 1.0, maxScaleFactor: 1.3),
          ),
          child: child ?? const SizedBox.shrink(),
        );
      },
      home: const _AuthGate(),
      routes: {
        '/work-record': (_) => const WorkRecordPage(),
        '/tasks': (_) => const ModulePage(title: '任务'),
        '/knowledge': (_) => const ModulePage(title: '知识库问答'),
        '/notifications': (_) => const ModulePage(title: '消息通知'),
      },
    );
  }
}

class _AuthGate extends ConsumerWidget {
  const _AuthGate();

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final auth = ref.watch(authControllerProvider);
    return auth.when(
      loading: () => const Scaffold(body: Center(child: CircularProgressIndicator())),
      error: (_, __) => LoginPage(onLogin: (tenantCode, account, password) => ref.read(authControllerProvider.notifier).login(tenantCode, account, password)),
      data: (identity) => identity == null
          ? LoginPage(onLogin: (tenantCode, account, password) => ref.read(authControllerProvider.notifier).login(tenantCode, account, password))
          : const MobileShell(),
    );
  }
}