import 'dart:async';
import 'dart:convert';

import 'package:dio/dio.dart';
import 'package:hive_flutter/hive_flutter.dart';

// const apiBaseUrl = 'http://192.168.5.29:3000/api/';
const apiBaseUrl = 'http://localhost:3000/api/';

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
    try { await _dio.post<void>('v1/auth/logout'); } finally { await clearSession(); await clearChatCache(); }
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

  // ---- 项目与项目成员（0.11.0）----
  Future<List<Map<String, dynamic>>> projects({String? keyword, String? status, bool includeArchived = false}) {
    final query = 'v1/projects?limit=100'
        '${keyword != null && keyword.trim().isNotEmpty ? '&keyword=${Uri.encodeQueryComponent(keyword.trim())}' : ''}'
        '${status != null && status.isNotEmpty ? '&status=$status' : ''}'
        '${includeArchived ? '&includeArchived=true' : ''}';
    return _getItems(query);
  }

  Future<Map<String, dynamic>> createProject(Map<String, dynamic> input) => _postMap('v1/projects', input);
  Future<Map<String, dynamic>> getProject(String id) => _getMap('v1/projects/$id');
  Future<Map<String, dynamic>> updateProject(String id, Map<String, dynamic> input) => _patchMap('v1/projects/$id', input);
  Future<void> deleteProject(String id, int version) => _deleteVoid('v1/projects/$id?version=$version');
  Future<List<Map<String, dynamic>>> projectMembers(String projectId) => _getItems('v1/projects/$projectId/members');
  Future<Map<String, dynamic>> addProjectMember(String projectId, String membershipId, String role) => _postMap('v1/projects/$projectId/members', {'membershipId': membershipId, 'role': role});
  Future<Map<String, dynamic>> updateProjectMember(String projectId, String membershipId, String role, int version) => _patchMap('v1/projects/$projectId/members/$membershipId', {'role': role, 'version': version});
  Future<void> removeProjectMember(String projectId, String membershipId, int version) => _deleteVoid('v1/projects/$projectId/members/$membershipId?version=$version');
  Future<Map<String, dynamic>> transferProjectOwner(String projectId, String membershipId, int version) => _putMap('v1/projects/$projectId/owner', {'membershipId': membershipId, 'version': version});
  Future<Map<String, dynamic>> transitionProject(String projectId, String action, Map<String, dynamic> body) => _postMap('v1/projects/$projectId/$action', body);

  // ---- 任务、评论、附件和动态（0.13.0）----
  Future<List<Map<String, dynamic>>> tasks(String projectId, {String? status}) => _getItems('v1/projects/$projectId/tasks?limit=100${status != null && status.isNotEmpty ? '&status=$status' : ''}');
  Future<Map<String, dynamic>> createTask(String projectId, Map<String, dynamic> input) => _postMap('v1/projects/$projectId/tasks', input);
  Future<Map<String, dynamic>> getTask(String projectId, String taskId) => _getMap('v1/projects/$projectId/tasks/$taskId');
  Future<Map<String, dynamic>> updateTask(String projectId, String taskId, Map<String, dynamic> input) => _patchMap('v1/projects/$projectId/tasks/$taskId', input);
  Future<void> deleteTask(String projectId, String taskId, int version) => _deleteVoid('v1/projects/$projectId/tasks/$taskId?version=$version');
  Future<Map<String, dynamic>> transitionTask(String projectId, String taskId, String status, int version, {String? reason}) =>
      _postMap('v1/projects/$projectId/tasks/$taskId/transitions', {'status': status, if (reason != null && reason.trim().isNotEmpty) 'reason': reason.trim(), 'version': version});
  Future<Map<String, dynamic>> replaceTaskAssignees(String projectId, String taskId, String ownerMembershipId, List<String> collaboratorMembershipIds, int version) =>
      _putMap('v1/projects/$projectId/tasks/$taskId/assignees', {'ownerMembershipId': ownerMembershipId, 'collaboratorMembershipIds': collaboratorMembershipIds.toSet().toList(), 'version': version});
  Future<List<Map<String, dynamic>>> taskComments(String projectId, String taskId) => _getItems('v1/projects/$projectId/tasks/$taskId/comments?limit=50');
  Future<Map<String, dynamic>> createTaskComment(String projectId, String taskId, String content) => _postMap('v1/projects/$projectId/tasks/$taskId/comments', {'content': content.trim()});
  Future<void> deleteTaskComment(String projectId, String taskId, String commentId, int version) => _deleteVoid('v1/projects/$projectId/tasks/$taskId/comments/$commentId?version=$version');
  Future<List<Map<String, dynamic>>> taskAttachments(String projectId, String taskId) => _getItems('v1/projects/$projectId/tasks/$taskId/attachments');
  Future<Map<String, dynamic>> addTaskAttachment(String projectId, String taskId, String fileObjectId) => _postMap('v1/projects/$projectId/tasks/$taskId/attachments', {'fileObjectId': fileObjectId});
  Future<void> removeTaskAttachment(String projectId, String taskId, String attachmentId, int version) => _deleteVoid('v1/projects/$projectId/tasks/$taskId/attachments/$attachmentId?version=$version');
  Future<List<Map<String, dynamic>>> taskActivities(String projectId, String taskId) => _getItems('v1/projects/$projectId/tasks/$taskId/activities?limit=50');

  // ---- 会议管理（0.14.0）----
  Future<List<Map<String, dynamic>>> meetings({String? keyword, String? status}) => _getItems('v1/meetings?limit=50'
      '${keyword != null && keyword.trim().isNotEmpty ? '&keyword=${Uri.encodeQueryComponent(keyword.trim())}' : ''}'
      '${status != null && status.isNotEmpty ? '&status=$status' : ''}');
  Future<Map<String, dynamic>> createMeeting(Map<String, dynamic> input) => _postMap('v1/meetings', input);
  Future<Map<String, dynamic>> getMeeting(String id) => _getMap('v1/meetings/$id');
  Future<Map<String, dynamic>> updateMeeting(String id, Map<String, dynamic> input) => _patchMap('v1/meetings/$id', input);
  Future<void> deleteMeeting(String id, int version) => _deleteVoid('v1/meetings/$id?version=$version');
  Future<Map<String, dynamic>> transitionMeeting(String id, String status, int version, {String? reason}) =>
      _postMap('v1/meetings/$id/transitions', {'status': status, if (reason != null && reason.trim().isNotEmpty) 'reason': reason.trim(), 'version': version});
  Future<List<Map<String, dynamic>>> meetingParticipants(String meetingId) => _getItems('v1/meetings/$meetingId/participants');
  Future<Map<String, dynamic>> addMeetingParticipant(String meetingId, String membershipId, {String role = 'PARTICIPANT'}) => _postMap('v1/meetings/$meetingId/participants', {'membershipId': membershipId, 'role': role});
  Future<Map<String, dynamic>> updateMeetingParticipant(String meetingId, String membershipId, Map<String, dynamic> input) => _patchMap('v1/meetings/$meetingId/participants/$membershipId', input);
  Future<void> removeMeetingParticipant(String meetingId, String membershipId, int version) => _deleteVoid('v1/meetings/$meetingId/participants/$membershipId?version=$version');
  Future<Map<String, dynamic>> respondMeeting(String meetingId, String responseStatus, int version) => _patchMap('v1/meetings/$meetingId/participants/me/response', {'responseStatus': responseStatus, 'version': version});

  Future<Map<String, dynamic>?> meetingMinutes(String meetingId) async {
    try {
      return await _getMap('v1/meetings/$meetingId/minutes');
    } on DioException catch (error) {
      if (error.response?.statusCode == 404) return null;
      rethrow;
    }
  }

  Future<Map<String, dynamic>> upsertMeetingMinutes(String meetingId, Map<String, dynamic> content, {int? version}) =>
      _putMap('v1/meetings/$meetingId/minutes', {'content': content, if (version != null) 'version': version});
  Future<Map<String, dynamic>> publishMeetingMinutes(String meetingId, int version) => _postMap('v1/meetings/$meetingId/minutes/publish', {'version': version});
  Future<Map<String, dynamic>> reopenMeetingMinutes(String meetingId, int version) => _postMap('v1/meetings/$meetingId/minutes/reopen', {'version': version});

  // ---- 日报与周报（0.16.0；使用文档未提供路径，按 RESTful 惯例 /work-reports，后端不同时仅需调整本节）----
  Future<List<Map<String, dynamic>>> workReports({String? type, String? status}) => _getItems('v1/work-reports?limit=50${type != null && type.isNotEmpty ? '&type=$type' : ''}${status != null && status.isNotEmpty ? '&status=$status' : ''}');
  Future<Map<String, dynamic>> createWorkReport(String type, String periodStart, String content) => _postMap('v1/work-reports', {'type': type, 'periodStart': periodStart, 'content': content.trim()});
  Future<Map<String, dynamic>> updateWorkReport(String id, String content, int version) => _patchMap('v1/work-reports/$id', {'content': content.trim(), 'version': version});
  Future<void> deleteWorkReport(String id, int version) => _deleteVoid('v1/work-reports/$id?version=$version');
  Future<Map<String, dynamic>> submitWorkReport(String id, int version) => _postMap('v1/work-reports/$id/submit', {'version': version});
  Future<Map<String, dynamic>> withdrawWorkReport(String id, int version) => _postMap('v1/work-reports/$id/withdraw', {'version': version});
  Future<Map<String, dynamic>> reviewWorkReport(String id, bool approve, String comment, int version) =>
      _postMap('v1/work-reports/$id/${approve ? 'approve' : 'reject'}', {if (comment.trim().isNotEmpty) 'comment': comment.trim(), 'version': version});

  // ---- 通知中心（0.17.0）----
  Future<List<Map<String, dynamic>>> notificationList({bool unreadOnly = false}) async => ((await _getMap('v1/notifications?limit=50${unreadOnly ? '&unreadOnly=true' : ''}'))['items'] as List<dynamic>? ?? []).cast<Map<String, dynamic>>();
  Future<int> unreadNotificationCount() async => ((await _getMap('v1/notifications/unread-count'))['unreadCount'] as num?)?.toInt() ?? 0;
  Future<void> markAllNotificationsRead() => _dio.post<void>('v1/notifications/read-all');
  Future<void> markNotificationRead(String id) => _dio.post<void>('v1/notifications/$id/read');

  // ---- 工作台与数据看板（0.18.0）----
  Future<Map<String, dynamic>> dashboardOverview() => _getMap('v1/dashboard/overview');
  Future<Map<String, dynamic>> dashboardTodos({int taskLimit = 5, int reportLimit = 5, int meetingLimit = 5}) => _getMap('v1/dashboard/todos?taskLimit=$taskLimit&reportLimit=$reportLimit&meetingLimit=$meetingLimit');
  Future<List<Map<String, dynamic>>> dashboardUpcomingMeetings({int limit = 5}) => _getItems('v1/dashboard/upcoming-meetings?limit=$limit');

  // ---- AI 对话（0.19.0，服务端会话与 SSE）----
  Future<Map<String, dynamic>> createConversation({String? title}) => _postMap('v1/conversations', {if (title != null && title.trim().isNotEmpty) 'title': title.trim()});
  Future<List<Map<String, dynamic>>> conversations() => _getItems('v1/conversations?limit=100');
  Future<Map<String, dynamic>> conversation(String id) => _getMap('v1/conversations/$id');
  Stream<Map<String, dynamic>> _sse(String path, {String method = 'GET', Map<String, dynamic>? data, Map<String, String>? headers, CancelToken? cancelToken}) async* {
    final response = await _dio.request<ResponseBody>(path, data: data, cancelToken: cancelToken, options: Options(method: method, responseType: ResponseType.stream, headers: headers));
    var buffer = '';
    await for (final chunk in response.data!.stream.cast<List<int>>().transform(utf8.decoder)) {
      buffer += chunk;
      final frames = buffer.split(RegExp(r'\r?\n\r?\n'));
      buffer = frames.removeLast();
      for (final frame in frames) { final dataLines = frame.split(RegExp(r'\r?\n')).where((line) => line.startsWith('data:')).map((line) => line.substring(5).trimLeft()).join('\n'); if (dataLines.isNotEmpty && dataLines != '[DONE]') yield Map<String, dynamic>.from(jsonDecode(dataLines) as Map); }
    }
    if (buffer.trim().isNotEmpty) {
      final dataLines = buffer.split(RegExp(r'\r?\n')).where((line) => line.startsWith('data:')).map((line) => line.substring(5).trimLeft()).join('\n');
      if (dataLines.isNotEmpty && dataLines != '[DONE]') yield Map<String, dynamic>.from(jsonDecode(dataLines) as Map);
    }
  }
  Stream<Map<String, dynamic>> createTurnStream(String conversationId, String content, String idempotencyKey, String mode, {CancelToken? cancelToken}) => _sse('v1/conversations/$conversationId/turns', method: 'POST', data: {'content': content, 'mode': mode}, headers: {'Idempotency-Key': idempotencyKey}, cancelToken: cancelToken);
  Stream<Map<String, dynamic>> replayTurnStream(String conversationId, String turnId, int afterSeq, {CancelToken? cancelToken}) => _sse('v1/conversations/$conversationId/turns/$turnId/events?afterSeq=$afterSeq', cancelToken: cancelToken);
  Future<Map<String, dynamic>> cancelTurn(String conversationId, String turnId) => _postMap('v1/conversations/$conversationId/turns/$turnId/cancel', {});

  /// 确认并执行写操作草稿。只提交 draftId：参数快照存在服务端，
  /// 客户端无法在确认时替换业务参数（服务端会重新鉴权并重新校验）。
  Future<Map<String, dynamic>> confirmActionDraft(String draftId) => _postMap('v1/assistant/action-drafts/$draftId/confirm', {});

  /// 取消写操作草稿；取消后不可再确认，需重新发起对话。
  Future<Map<String, dynamic>> cancelActionDraft(String draftId) => _postMap('v1/assistant/action-drafts/$draftId/cancel', {});
  Future<Map<String, dynamic>> invokeChat(Map<String, dynamic> input) => _postMap('v1/chat/invoke', input);
  Future<Map<String, dynamic>> compactChat(Map<String, dynamic> input) => _postMap('v1/chat/compact', input);

  // ---- 组织批量导入（0.12.0；移动端仅封装 API，Excel 解析在桌面端完成）----
  Future<Map<String, dynamic>> validateOrganizationImport(Map<String, dynamic> input) => _postMap('v1/tenants/current/organization-imports/validate', input);
  Future<Map<String, dynamic>> confirmOrganizationImport(Map<String, dynamic> input) => _postMap('v1/tenants/current/organization-imports/confirm', input);

  // ---- 文件上传（0.9.0，短时预签名 PUT 直传 COS）----
  Future<Map<String, dynamic>> createUploadSession(String fileName, String contentType, int sizeBytes, String idempotencyKey) async {
    final data = _unwrapMap(await _dio.post<Map<String, dynamic>>(
      'v1/upload-sessions',
      options: Options(headers: {'Idempotency-Key': idempotencyKey}),
      data: {'purpose': 'attachment', 'fileName': fileName, 'contentType': contentType, 'sizeBytes': sizeBytes},
    ));
    // 后端返回嵌套结构：upload: { method, url, headers }，fileId 为文件对象 ID；顶层字段为兼容回退。
    final nested = (data['upload'] ?? const <String, dynamic>{}) as Map;
    final uploadUrl = nested['url'] ?? data['uploadUrl'] ?? data['putUrl'] ?? data['url'];
    if (uploadUrl is! String) throw StateError('上传会话响应缺少直传地址');
    final rawHeaders = nested['headers'] ?? data['uploadHeaders'] ?? data['headers'] ?? const {};
    final headers = <String, String>{};
    (rawHeaders as Map).forEach((key, value) { if (value is String) headers['$key'] = value; });
    return {'uploadSessionId': data['uploadSessionId'] ?? data['id'], 'fileObjectId': data['fileId'] ?? data['fileObjectId'], 'uploadUrl': uploadUrl, 'uploadHeaders': headers};
  }

  Future<void> uploadToPresignedUrl(String url, Map<String, String> headers, Stream<List<int>> byteStream, int contentLength, String contentType) async {
    final response = await Dio().put<void>(url, options: Options(headers: {
      ...headers,
      'Content-Length': contentLength,
      if (!headers.keys.any((key) => key.toLowerCase() == 'content-type')) 'Content-Type': contentType,
    }), data: byteStream);
    if ((response.statusCode ?? 500) >= 300) throw StateError('文件直传失败');
  }

  Future<Map<String, dynamic>> completeUploadSession(String sessionId) => _postMap('v1/upload-sessions/$sessionId/complete', {});

  Future<void> clearSession() => _tokens.clear();

  Future<void> clearChatCache() async {
    final box = Hive.box<dynamic>('settings');
    for (final key in box.keys.where((key) => key.toString().startsWith('chat.')).toList()) {
      await box.delete(key);
    }
  }

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