import 'dart:async';

import 'package:dio/dio.dart';
import 'package:hive_flutter/hive_flutter.dart';

const apiBaseUrl = 'http://192.168.5.29:3000/api/';

class MobileApi {
  MobileApi(this._tokens) {
    _dio = Dio(BaseOptions(baseUrl: apiBaseUrl, connectTimeout: const Duration(seconds: 8), receiveTimeout: const Duration(seconds: 15), headers: {'Content-Type': 'application/json'}));
    _dio.interceptors.add(InterceptorsWrapper(onRequest: _authorize, onError: _handleUnauthorized));
  }

  final Box<String> _tokens;
  late final Dio _dio;
  Future<void>? _refreshing;

  bool get hasSession => _tokens.get('accessToken') != null && _tokens.get('refreshToken') != null;

  Future<Map<String, dynamic>> login(String tenantCode, String account, String password) async {
    final data = await _publicPost('v1/auth/login', {'tenantCode': tenantCode.trim(), 'account': account.trim().toLowerCase(), 'password': password, 'deviceName': 'CEES Mobile'});
    await _storeTokens(data);
    return data;
  }

  Future<Map<String, dynamic>> me() => _getMap('v1/auth/me');
  Future<Map<String, dynamic>> profile() => _getMap('v1/users/me/profile');
  Future<Map<String, dynamic>> updateProfile(String displayName, int version) => _patchMap('v1/users/me/profile', {'displayName': displayName.trim(), 'version': version});
  Future<void> changePassword(String currentPassword, String newPassword) => _postVoid('v1/auth/change-password', {'currentPassword': currentPassword, 'newPassword': newPassword});

  Future<void> logout() async {
    try { await _dio.post<void>('v1/auth/logout'); } finally { await clearSession(); }
  }

  Future<Map<String, dynamic>> activate({required String tenantCode, required String account, required String invitationToken, required String password}) => _publicPost('v1/auth/activate', {'tenantCode': tenantCode.trim(), 'account': account.trim().toLowerCase(), 'invitationToken': invitationToken.trim(), 'password': password});

  Future<List<Map<String, dynamic>>> members() => _getItems('v1/tenants/current/members?limit=100');
  Future<List<Map<String, dynamic>>> departments() => _getItems('v1/tenants/current/departments');
  Future<List<Map<String, dynamic>>> departmentMembers(String departmentId) => _getItems('v1/tenants/current/departments/$departmentId/members?limit=100');
  Future<List<Map<String, dynamic>>> roles() => _getItems('v1/roles?limit=100');
  Future<List<Map<String, dynamic>>> permissions() => _getItems('v1/permissions');
  Future<List<Map<String, dynamic>>> invitations() => _getItems('v1/tenants/current/invitations?limit=100');
  Future<List<Map<String, dynamic>>> documents() => _getItems('v1/documents?limit=100');
  Future<Map<String, dynamic>> suggestAccount(String displayName) => _postMap('v1/tenants/current/account-suggestions', {'displayName': displayName.trim()});
  Future<Map<String, dynamic>> createInvitation(Map<String, dynamic> input) => _postMap('v1/tenants/current/invitations', input);
  Future<void> revokeInvitation(String id) => _deleteVoid('v1/tenants/current/invitations/$id');

  Future<Map<String, dynamic>> createDepartment(Map<String, dynamic> input) => _postMap('v1/tenants/current/departments', input);
  Future<Map<String, dynamic>> updateDepartment(String id, Map<String, dynamic> input) => _patchMap('v1/tenants/current/departments/$id', input);
  Future<void> deleteDepartment(String id, int version) => _deleteVoid('v1/tenants/current/departments/$id?version=$version');
  Future<Map<String, dynamic>> assignMemberDepartment(String memberId, String? departmentId, int version) => _putMap('v1/tenants/current/members/$memberId/department', {'departmentId': departmentId, 'version': version});

  Future<Map<String, dynamic>> getMember(String memberId) => _getMap('v1/tenants/current/members/$memberId');
  Future<Map<String, dynamic>> updateMember(String memberId, Map<String, dynamic> input) => _patchMap('v1/tenants/current/members/$memberId', input);
  Future<void> removeMember(String memberId) => _deleteVoid('v1/tenants/current/members/$memberId');
  Future<Map<String, dynamic>> replaceMemberRoles(String memberId, List<String> roleIds, int version) => _putMap('v1/tenants/current/members/$memberId/roles', {'roleIds': roleIds, 'version': version});
  Future<Map<String, dynamic>> updateMemberAccount(String memberId, String account, int version) => _patchMap('v1/tenants/current/members/$memberId/account', {'account': account.trim().toLowerCase(), 'version': version});
  Future<Map<String, dynamic>> resetMemberCredential(String memberId) => _postMap('v1/tenants/current/members/$memberId/credential-reset', {});

  Future<Map<String, dynamic>> createRole(Map<String, dynamic> input) => _postMap('v1/roles', input);
  Future<Map<String, dynamic>> updateRole(String id, Map<String, dynamic> input) => _patchMap('v1/roles/$id', input);
  Future<Map<String, dynamic>> replaceRolePermissions(String id, List<String> permissionIds, int version) => _putMap('v1/roles/$id/permissions', {'permissionIds': permissionIds.toSet().toList(), 'version': version});
  Future<void> deleteRole(String id, int version) => _deleteVoid('v1/roles/$id?version=$version');

  Future<void> clearSession() => _tokens.clear();

  void _authorize(RequestOptions options, RequestInterceptorHandler handler) {
    final token = _tokens.get('accessToken');
    if (token != null) options.headers['Authorization'] = 'Bearer $token';
    handler.next(options);
  }

  Future<void> _handleUnauthorized(DioException error, ErrorInterceptorHandler handler) async {
    if (error.response?.statusCode != 401 || error.requestOptions.extra['retried'] == true || error.requestOptions.path.contains('/refresh')) return handler.next(error);
    try {
      await _refresh();
      final request = error.requestOptions..extra['retried'] = true;
      request.headers['Authorization'] = 'Bearer ${_tokens.get('accessToken')}';
      handler.resolve(await _dio.fetch(request));
    } catch (_) {
      await clearSession();
      handler.next(error);
    }
  }

  Future<void> _refresh() async {
    if (_refreshing != null) return _refreshing;
    final completer = Completer<void>();
    _refreshing = completer.future;
    try {
      final refreshToken = _tokens.get('refreshToken');
      if (refreshToken == null) throw StateError('登录状态已失效');
      final data = await _publicPost('v1/auth/refresh', {'refreshToken': refreshToken});
      await _storeTokens(data);
      completer.complete();
    } catch (error, stackTrace) {
      completer.completeError(error, stackTrace);
      rethrow;
    } finally {
      _refreshing = null;
    }
  }

  Future<void> _storeTokens(Map<String, dynamic> data) async {
    await _tokens.put('accessToken', data['accessToken'] as String);
    await _tokens.put('refreshToken', data['refreshToken'] as String);
  }

  Future<Map<String, dynamic>> _publicPost(String path, Map<String, dynamic> body) async => _unwrapMap(await Dio(BaseOptions(baseUrl: apiBaseUrl, headers: {'Content-Type': 'application/json'})).post<Map<String, dynamic>>(path, data: body));
  Future<Map<String, dynamic>> _getMap(String path) async => _unwrapMap(await _dio.get<Map<String, dynamic>>(path));
  Future<Map<String, dynamic>> _postMap(String path, Map<String, dynamic> body) async => _unwrapMap(await _dio.post<Map<String, dynamic>>(path, data: body));
  Future<Map<String, dynamic>> _patchMap(String path, Map<String, dynamic> body) async => _unwrapMap(await _dio.patch<Map<String, dynamic>>(path, data: body));
  Future<Map<String, dynamic>> _putMap(String path, Map<String, dynamic> body) async => _unwrapMap(await _dio.put<Map<String, dynamic>>(path, data: body));
  Future<void> _postVoid(String path, Map<String, dynamic> body) async => _dio.post<void>(path, data: body);
  Future<void> _deleteVoid(String path) async => _dio.delete<void>(path);
  Future<List<Map<String, dynamic>>> _getItems(String path) async { final data = await _getMap(path); return (data['items'] as List<dynamic>? ?? []).cast<Map<String, dynamic>>(); }

  Map<String, dynamic> _unwrapMap(Response<Map<String, dynamic>> response) {
    final envelope = response.data;
    if (envelope == null || envelope['success'] != true) throw StateError('接口响应格式不正确');
    return Map<String, dynamic>.from(envelope['data'] as Map);
  }
}

String apiErrorMessage(Object error) {
  if (error is DioException) {
    final data = error.response?.data;
    if (data is Map) {
      final apiError = data['error'];
      if (apiError is Map) {
        final details = apiError['details'];
        if (details is List && details.isNotEmpty) return details.first.toString();
        if (apiError['message'] != null) return apiError['message'].toString();
      }
    }
    if (error.type == DioExceptionType.connectionTimeout) return '连接服务器超时';
  }
  return error.toString().replaceFirst('Bad state: ', '');
}