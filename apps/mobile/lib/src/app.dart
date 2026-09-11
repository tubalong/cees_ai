import 'package:flutter/material.dart';
import 'package:flutter_localizations/flutter_localizations.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import 'core/auth_controller.dart';
import 'core/l10n.dart';
import 'features/auth/login_page.dart';
import 'features/shell/mobile_shell.dart';
import 'features/work_record/work_record_page.dart';
import 'shared/module_page.dart';

class CeesMobileApp extends ConsumerWidget {
  const CeesMobileApp({super.key});

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
      theme: ThemeData(
        colorScheme: ColorScheme.fromSeed(seedColor: const Color(0xff4f67ff)),
        scaffoldBackgroundColor: const Color(0xfff3f5ff),
        cardTheme: const CardThemeData(margin: EdgeInsets.zero, shape: RoundedRectangleBorder(borderRadius: BorderRadius.all(Radius.circular(18)))),
        inputDecorationTheme: InputDecorationTheme(filled: true, fillColor: Colors.white, border: OutlineInputBorder(borderRadius: BorderRadius.circular(18), borderSide: BorderSide.none)),
        useMaterial3: true,
      ),
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