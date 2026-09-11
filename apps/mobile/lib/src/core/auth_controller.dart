import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:hive_flutter/hive_flutter.dart';

import 'mobile_api.dart';

class AuthIdentity {
  const AuthIdentity({required this.user, required this.tenant, required this.membership, required this.permissions});
  final Map<String, dynamic> user;
  final Map<String, dynamic> tenant;
  final Map<String, dynamic> membership;
  final List<String> permissions;

  factory AuthIdentity.fromJson(Map<String, dynamic> json) => AuthIdentity(
    user: Map<String, dynamic>.from(json['user'] as Map),
    tenant: Map<String, dynamic>.from(json['tenant'] as Map),
    membership: Map<String, dynamic>.from(json['membership'] as Map),
    permissions: (json['permissions'] as List<dynamic>? ?? []).cast<String>(),
  );
}

final mobileApiProvider = Provider<MobileApi>((ref) => MobileApi(Hive.box<String>('auth_session')));
final authControllerProvider = AsyncNotifierProvider<AuthController, AuthIdentity?>(AuthController.new);

bool hasPermission(AuthIdentity? identity, String code) =>
  identity?.permissions.contains(code) ?? false;

/// 将服务端返回的角色列表统一解析为展示名列表。
/// 兼容对象数组（[{id, code, name}]）与字符串编码数组（["tenant_admin"]）两种形态。
List<String> roleNames(dynamic roles) {
  if (roles is! List) return const [];
  return roles
      .map((role) {
        if (role is Map) {
          return (role['name']?.toString() ?? role['code']?.toString() ?? '').trim();
        }
        return role.toString().trim();
      })
      .where((name) => name.isNotEmpty)
      .toList();
}

class AuthController extends AsyncNotifier<AuthIdentity?> {
  @override
  Future<AuthIdentity?> build() async {
    final api = ref.read(mobileApiProvider);
    if (!api.hasSession) return null;
    try { return AuthIdentity.fromJson(await api.me()); } catch (_) { await api.clearSession(); return null; }
  }

  Future<void> login(String tenantCode, String account, String password) async {
    state = const AsyncLoading();
    state = await AsyncValue.guard(() async {
      final api = ref.read(mobileApiProvider);
      await api.login(tenantCode, account, password);
      return AuthIdentity.fromJson(await api.me());
    });
  }

  Future<void> logout() async {
    await ref.read(mobileApiProvider).logout();
    state = const AsyncData(null);
  }

  Future<void> refreshIdentity() async {
    state = AsyncData(AuthIdentity.fromJson(await ref.read(mobileApiProvider).me()));
  }
}