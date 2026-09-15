import 'dart:io';

import 'package:cees_mobile/src/core/auth_controller.dart';
import 'package:cees_mobile/src/core/l10n.dart';
import 'package:cees_mobile/src/core/mobile_api.dart';
import 'package:cees_mobile/src/features/shell/mobile_shell.dart';
import 'package:flutter/material.dart';
import 'package:flutter_localizations/flutter_localizations.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:hive_flutter/hive_flutter.dart';

class _FakeMobileApi extends MobileApi {
  _FakeMobileApi(super.box);

  @override
  Future<Map<String, dynamic>> profile() async => {'version': 1};

  @override
  Future<List<Map<String, dynamic>>> members() async => [];

  @override
  Future<List<Map<String, dynamic>>> departments() async => [];

  @override
  Future<List<Map<String, dynamic>>> roles() async => [];

  @override
  Future<List<Map<String, dynamic>>> invitations() async => [];
}

class _FakeAuthController extends AuthController {
  @override
  Future<AuthIdentity?> build() async => const AuthIdentity(
        user: {'id': 'u1', 'displayName': '测试用户'},
        tenant: {'id': 't1', 'code': 'cees', 'name': '测试企业'},
        membership: {'id': 'm1', 'account': 'admin', 'status': 'ACTIVE', 'roles': []},
        permissions: ['member.read', 'department.read', 'role.read', 'member.invite'],
      );
}

void main() {
  late Box<String> box;

  setUpAll(() async {
    Hive.init(Directory.systemTemp.createTempSync('cees_mobile_test').path);
    box = await Hive.openBox<String>('auth_session');
  });

  testWidgets('主导航和双模式首页可切换', (tester) async {
    tester.view.physicalSize = const Size(405, 900);
    tester.view.devicePixelRatio = 1;
    addTearDown(tester.view.resetPhysicalSize);
    addTearDown(tester.view.resetDevicePixelRatio);

    await tester.pumpWidget(
      ProviderScope(
        overrides: [
          mobileApiProvider.overrideWith((ref) => _FakeMobileApi(box)),
          authControllerProvider.overrideWith(() => _FakeAuthController()),
        ],
        child: MaterialApp(
          locale: const Locale('zh'),
          localizationsDelegates: const [
            AppLocalizationsDelegate(),
            GlobalMaterialLocalizations.delegate,
            GlobalWidgetsLocalizations.delegate,
            GlobalCupertinoLocalizations.delegate,
          ],
          supportedLocales: AppLocalizations.supportedLocales,
          home: const MobileShell(),
        ),
      ),
    );
    await tester.pumpAndSettle();

    expect(find.text('AI 助理'), findsOneWidget);
    expect(find.text('组织'), findsOneWidget);
    expect(find.text('工作台'), findsOneWidget);
    expect(find.text('我的'), findsOneWidget);
    expect(find.byIcon(Icons.hub_outlined), findsOneWidget);

    await tester.tap(find.text('闲聊'));
    await tester.pumpAndSettle();
    expect(find.text('闲聊模式'), findsOneWidget);

    await tester.tap(find.text('组织'));
    await tester.pumpAndSettle();
    expect(find.text('成员'), findsOneWidget);
    expect(find.text('部门'), findsOneWidget);
    expect(find.text('角色'), findsOneWidget);
    expect(find.text('邀请'), findsOneWidget);
  });
}
