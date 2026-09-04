import 'package:flutter/material.dart';
import 'package:go_router/go_router.dart';

import 'features/home/home_page.dart';
import 'features/work_record/work_record_page.dart';
import 'shared/module_page.dart';

final router = GoRouter(
  initialLocation: '/',
  routes: [
    GoRoute(path: '/', builder: (_, __) => const HomePage()),
    GoRoute(path: '/work-record', builder: (_, __) => const WorkRecordPage()),
    for (final route in const {
      '/login': '登录', '/tasks': '任务', '/task-detail': '任务详情', '/task-edit': '新建或更新任务',
      '/reports': '日报周报', '/knowledge': '知识库问答', '/notifications': '消息通知',
      '/meetings': '会议', '/briefing': '管理简报', '/profile': '我的',
    }.entries)
      GoRoute(path: route.key, builder: (_, __) => ModulePage(title: route.value)),
  ],
);

class CeesMobileApp extends StatelessWidget {
  const CeesMobileApp({super.key});

  @override
  Widget build(BuildContext context) {
    return MaterialApp.router(
      title: 'CEES',
      debugShowCheckedModeBanner: false,
      theme: ThemeData(
        colorScheme: ColorScheme.fromSeed(seedColor: const Color(0xff1677ff)),
        scaffoldBackgroundColor: const Color(0xfff4f6f8),
        cardTheme: const CardThemeData(margin: EdgeInsets.zero, shape: RoundedRectangleBorder(borderRadius: BorderRadius.all(Radius.circular(6)))),
        useMaterial3: true,
      ),
      routerConfig: router,
    );
  }
}