import 'package:flutter/widgets.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:hive_flutter/hive_flutter.dart';

/// 支持的语言，与桌面端保持一致（简体中文 / 繁体中文 / 英文 / 日文）。
enum AppLanguage {
  zh('zh', '简体中文'),
  tw('zh-TW', '繁體中文'),
  en('en', 'English'),
  ja('ja', '日本語');

  const AppLanguage(this.code, this.label);
  final String code;
  final String label;

  Locale get locale => Locale(code);

  static AppLanguage fromCode(String? code) =>
      AppLanguage.values.firstWhere((l) => l.code == code, orElse: () => AppLanguage.zh);
}

/// 轻量本地化对象，通过 [AppLocalizationsDelegate] 挂载到 MaterialApp。
class AppLocalizations {
  const AppLocalizations(this.language);
  final AppLanguage language;

  String tr(String key) => _translate(key, language);

  static AppLocalizations of(BuildContext context) =>
      Localizations.of<AppLocalizations>(context, AppLocalizations)!;

  static const supportedLocales = <Locale>[
    Locale('zh'),
    Locale('zh', 'TW'),
    Locale('en'),
    Locale('ja'),
  ];
}

extension L10nContext on BuildContext {
  String tr(String key) => AppLocalizations.of(this).tr(key);
}

class AppLocalizationsDelegate extends LocalizationsDelegate<AppLocalizations> {
  const AppLocalizationsDelegate();

  @override
  bool isSupported(Locale locale) =>
      AppLanguage.values.any((l) => l.code == locale.languageCode);

  @override
  Future<AppLocalizations> load(Locale locale) async =>
      AppLocalizations(AppLanguage.fromCode(locale.languageCode));

  @override
  bool shouldReload(covariant AppLocalizationsDelegate old) => false;
}

final languageProvider =
    NotifierProvider<LanguageController, AppLanguage>(LanguageController.new);

class LanguageController extends Notifier<AppLanguage> {
  static const _boxName = 'settings';
  static const _key = 'language';

  @override
  AppLanguage build() {
    final box = Hive.box<dynamic>(_boxName);
    return AppLanguage.fromCode(box.get(_key) as String?);
  }

  Future<void> set(AppLanguage language) async {
    await Hive.box<dynamic>(_boxName).put(_key, language.code);
    state = language;
  }
}

String _translate(String key, AppLanguage lang) {
  final entry = _dictionary[key];
  if (entry == null) return key;
  return entry[lang.code] ?? entry['zh'] ?? key;
}

const Map<String, Map<String, String>> _dictionary = <String, Map<String, String>>{
  // 导航
  'nav.ai': {'zh': 'AI 助理', 'tw': 'AI 助理', 'en': 'AI Assistant', 'ja': 'AI アシスタント'},
  'nav.org': {'zh': '组织', 'tw': '組織', 'en': 'Organization', 'ja': '組織'},
  'nav.messages': {'zh': '消息', 'tw': '訊息', 'en': 'Messages', 'ja': 'メッセージ'},
  'nav.profile': {'zh': '我的', 'tw': '我的', 'en': 'Me', 'ja': 'マイページ'},

  // 通用
  'common.cancel': {'zh': '取消', 'tw': '取消', 'en': 'Cancel', 'ja': 'キャンセル'},
  'common.save': {'zh': '保存', 'tw': '儲存', 'en': 'Save', 'ja': '保存'},
  'common.confirm': {'zh': '确定', 'tw': '確定', 'en': 'Confirm', 'ja': '確定'},
  'common.delete': {'zh': '删除', 'tw': '刪除', 'en': 'Delete', 'ja': '削除'},
  'common.edit': {'zh': '编辑', 'tw': '編輯', 'en': 'Edit', 'ja': '編集'},
  'common.create': {'zh': '创建', 'tw': '建立', 'en': 'Create', 'ja': '作成'},
  'common.retry': {'zh': '重试', 'tw': '重試', 'en': 'Retry', 'ja': '再試行'},

  // 登录
  'login.title': {'zh': '欢迎登录 CEES AI', 'tw': '歡迎登入 CEES AI', 'en': 'Welcome to CEES AI', 'ja': 'CEES AI へようこそ'},
  'login.subtitle': {'zh': '使用企业标识、账号和密码登录', 'tw': '使用企業標識、帳號和密碼登入', 'en': 'Sign in with tenant code, account and password', 'ja': '企業コード・アカウント・パスワードでログイン'},
  'login.tenantCode': {'zh': '企业标识', 'tw': '企業標識', 'en': 'Tenant code', 'ja': '企業コード'},
  'login.account': {'zh': '账号', 'tw': '帳號', 'en': 'Account', 'ja': 'アカウント'},
  'login.password': {'zh': '密码', 'tw': '密碼', 'en': 'Password', 'ja': 'パスワード'},
  'login.submit': {'zh': '登录', 'tw': '登入', 'en': 'Sign in', 'ja': 'ログイン'},
  'login.activate': {'zh': '使用邀请激活账号', 'tw': '使用邀請啟用帳號', 'en': 'Activate account with invitation', 'ja': '招待でアカウントを有効化'},
  'login.required': {'zh': '此项不能为空', 'tw': '此項不能為空', 'en': 'This field is required', 'ja': '必須項目です'},
  'login.passwordMin': {'zh': '密码至少为 8 位', 'tw': '密碼至少為 8 位', 'en': 'Password must be at least 8 characters', 'ja': 'パスワードは8文字以上'},

  // 激活
  'activate.title': {'zh': '激活企业成员账号', 'tw': '啟用企業成員帳號', 'en': 'Activate member account', 'ja': 'メンバーアカウントを有効化'},
  'activate.memberAccount': {'zh': '成员账号', 'tw': '成員帳號', 'en': 'Member account', 'ja': 'メンバーアカウント'},
  'activate.token': {'zh': '激活令牌', 'tw': '啟用令牌', 'en': 'Activation token', 'ja': '有効化トークン'},
  'activate.newPassword': {'zh': '设置新密码', 'tw': '設定新密碼', 'en': 'Set new password', 'ja': '新しいパスワードを設定'},
  'activate.submit': {'zh': '激活账号', 'tw': '啟用帳號', 'en': 'Activate', 'ja': '有効化'},
  'activate.loading': {'zh': '激活中…', 'tw': '啟用中…', 'en': 'Activating…', 'ja': '有効化中…'},
  'activate.success': {'zh': '激活成功，请使用新密码登录', 'tw': '啟用成功，請使用新密碼登入', 'en': 'Activated. Please sign in with your new password', 'ja': '有効化しました。新しいパスワードでログインしてください'},

  // 我的
  'profile.title': {'zh': '我的', 'tw': '我的', 'en': 'Me', 'ja': 'マイページ'},
  'profile.enterprise': {'zh': '我的企业', 'tw': '我的企業', 'en': 'My company', 'ja': '所属企業'},
  'profile.verified': {'zh': '已认证', 'tw': '已認證', 'en': 'Verified', 'ja': '認証済み'},
  'profile.account': {'zh': '账号', 'tw': '帳號', 'en': 'Account', 'ja': 'アカウント'},
  'profile.department': {'zh': '部门', 'tw': '部門', 'en': 'Department', 'ja': '部署'},
  'profile.roles': {'zh': '角色', 'tw': '角色', 'en': 'Roles', 'ja': 'ロール'},
  'profile.unassigned': {'zh': '未分配', 'tw': '未指派', 'en': 'Unassigned', 'ja': '未割り当て'},
  'profile.none': {'zh': '无', 'tw': '無', 'en': 'None', 'ja': 'なし'},
  'profile.editName': {'zh': '编辑展示名', 'tw': '編輯顯示名稱', 'en': 'Edit display name', 'ja': '表示名を編集'},
  'profile.changePassword': {'zh': '修改密码', 'tw': '修改密碼', 'en': 'Change password', 'ja': 'パスワード変更'},
  'profile.language': {'zh': '语言 / Language', 'tw': '語言 / Language', 'en': 'Language', 'ja': '言語'},
  'profile.logout': {'zh': '退出登录', 'tw': '退出登入', 'en': 'Sign out', 'ja': 'ログアウト'},
  'profile.logoutConfirm': {'zh': '确定要退出当前账号吗？', 'tw': '確定要退出目前帳號嗎？', 'en': 'Sign out of the current account?', 'ja': '現在のアカウントからログアウトしますか？'},
  'profile.logoutAction': {'zh': '退出', 'tw': '退出', 'en': 'Sign out', 'ja': 'ログアウト'},
  'profile.nameUpdated': {'zh': '展示名已更新', 'tw': '顯示名稱已更新', 'en': 'Display name updated', 'ja': '表示名を更新しました'},
  'profile.passwordUpdated': {'zh': '密码已修改，其他会话已退出', 'tw': '密碼已修改，其他工作階段已退出', 'en': 'Password changed, other sessions signed out', 'ja': 'パスワードを変更しました。他のセッションはログアウトされました'},
  'profile.currentPassword': {'zh': '当前密码', 'tw': '目前密碼', 'en': 'Current password', 'ja': '現在のパスワード'},
  'profile.newPassword': {'zh': '新密码（至少 8 位）', 'tw': '新密碼（至少 8 位）', 'en': 'New password (8+ chars)', 'ja': '新しいパスワード（8文字以上）'},
  'profile.confirmChange': {'zh': '确认修改', 'tw': '確認修改', 'en': 'Confirm', 'ja': '変更を確定'},
  'profile.passwordMin': {'zh': '新密码至少 8 位', 'tw': '新密碼至少 8 位', 'en': 'New password must be at least 8 characters', 'ja': '新しいパスワードは8文字以上'},
  'profile.displayName': {'zh': '展示名', 'tw': '顯示名稱', 'en': 'Display name', 'ja': '表示名'},

  // 组织
  'org.title': {'zh': '组织', 'tw': '組織', 'en': 'Organization', 'ja': '組織'},
  'org.noPermission': {'zh': '当前账号无组织管理权限', 'tw': '目前帳號無組織管理權限', 'en': 'No organization management permission', 'ja': '組織管理権限がありません'},
  'org.members': {'zh': '成员', 'tw': '成員', 'en': 'Members', 'ja': 'メンバー'},
  'org.departments': {'zh': '部门', 'tw': '部門', 'en': 'Departments', 'ja': '部署'},
  'org.roles': {'zh': '角色', 'tw': '角色', 'en': 'Roles', 'ja': 'ロール'},
  'org.invitations': {'zh': '邀请', 'tw': '邀請', 'en': 'Invitations', 'ja': '招待'},

  // 成员
  'member.search': {'zh': '搜索成员姓名或账号', 'tw': '搜尋成員姓名或帳號', 'en': 'Search name or account', 'ja': '名前またはアカウントを検索'},
  'member.empty': {'zh': '暂无成员', 'tw': '暫無成員', 'en': 'No members', 'ja': 'メンバーがいません'},
  'member.departmentUpdated': {'zh': '部门已更新', 'tw': '部門已更新', 'en': 'Department updated', 'ja': '部署を更新しました'},
  'member.adjustDepartment': {'zh': '调整部门', 'tw': '調整部門', 'en': 'Change department', 'ja': '部署を変更'},
  'member.details': {'zh': '成员详情', 'tw': '成員詳情', 'en': 'Member details', 'ja': 'メンバー詳細'},
  'member.editName': {'zh': '编辑展示名', 'tw': '編輯顯示名稱', 'en': 'Edit display name', 'ja': '表示名を編集'},
  'member.assignRoles': {'zh': '分配角色', 'tw': '指派角色', 'en': 'Assign roles', 'ja': 'ロールを割り当て'},
  'member.changeAccount': {'zh': '修改账号', 'tw': '修改帳號', 'en': 'Change account', 'ja': 'アカウント変更'},
  'member.resetCredential': {'zh': '重置凭证', 'tw': '重設憑證', 'en': 'Reset credential', 'ja': '認証情報をリセット'},
  'member.remove': {'zh': '移除成员', 'tw': '移除成員', 'en': 'Remove member', 'ja': 'メンバーを削除'},
  'member.enable': {'zh': '启用', 'tw': '啟用', 'en': 'Enable', 'ja': '有効化'},
  'member.disable': {'zh': '禁用', 'tw': '停用', 'en': 'Disable', 'ja': '無効化'},
  'member.updated': {'zh': '成员已更新', 'tw': '成員已更新', 'en': 'Member updated', 'ja': 'メンバーを更新しました'},
  'member.rolesUpdated': {'zh': '角色已更新', 'tw': '角色已更新', 'en': 'Roles updated', 'ja': 'ロールを更新しました'},
  'member.accountUpdated': {'zh': '账号已修改', 'tw': '帳號已修改', 'en': 'Account changed', 'ja': 'アカウントを変更しました'},
  'member.removed': {'zh': '成员已移除', 'tw': '成員已移除', 'en': 'Member removed', 'ja': 'メンバーを削除しました'},
  'member.removeConfirm': {'zh': '确定将该成员从租户移除吗？此操作会撤销其会话。', 'tw': '確定將該成員從租戶移除嗎？此操作會撤銷其工作階段。', 'en': 'Remove this member from the tenant? Their session will be revoked.', 'ja': 'このメンバーをテナントから削除しますか？セッションが失効します。'},
  'member.resetDesc': {'zh': '请通过受控渠道将以下信息交给成员，令牌仅显示这一次：', 'tw': '請透過受控管道將以下資訊交給成員，令牌僅顯示這一次：', 'en': 'Deliver the following to the member via a controlled channel. The token is shown only once.', 'ja': '以下を管理された経路でメンバーに伝えてください。トークンは一度だけ表示されます。'},
  'member.copy': {'zh': '复制令牌', 'tw': '複製令牌', 'en': 'Copy token', 'ja': 'トークンをコピー'},
  'member.copied': {'zh': '已复制', 'tw': '已複製', 'en': 'Copied', 'ja': 'コピーしました'},
  'member.newAccount': {'zh': '新账号', 'tw': '新帳號', 'en': 'New account', 'ja': '新しいアカウント'},
  'member.gotIt': {'zh': '知道了', 'tw': '知道了', 'en': 'Got it', 'ja': 'OK'},

  // 状态徽标
  'status.active': {'zh': '正常', 'tw': '正常', 'en': 'Active', 'ja': '有効'},
  'status.pending': {'zh': '待激活', 'tw': '待啟用', 'en': 'Pending', 'ja': '有効化待ち'},
  'status.disabled': {'zh': '已禁用', 'tw': '已停用', 'en': 'Disabled', 'ja': '無効'},

  // 部门
  'dept.subtitle': {'zh': '部门树（最多 10 级）', 'tw': '部門樹（最多 10 級）', 'en': 'Department tree (max 10 levels)', 'ja': '部署ツリー（最大10階層）'},
  'dept.create': {'zh': '新建部门', 'tw': '新增部門', 'en': 'New department', 'ja': '部署を新規作成'},
  'dept.empty': {'zh': '暂无部门', 'tw': '暫無部門', 'en': 'No departments', 'ja': '部署がありません'},
  'dept.name': {'zh': '部门名称', 'tw': '部門名稱', 'en': 'Department name', 'ja': '部署名'},
  'dept.created': {'zh': '部门已创建', 'tw': '部門已建立', 'en': 'Department created', 'ja': '部署を作成しました'},
  'dept.updated': {'zh': '部门已更新', 'tw': '部門已更新', 'en': 'Department updated', 'ja': '部署を更新しました'},
  'dept.deleted': {'zh': '部门已删除', 'tw': '部門已刪除', 'en': 'Department deleted', 'ja': '部署を削除しました'},
  'dept.deleteConfirm': {'zh': '仅空部门可删除。', 'tw': '僅空部門可刪除。', 'en': 'Only empty departments can be deleted.', 'ja': '空の部署のみ削除できます。'},
  'dept.viewMembers': {'zh': '查看成员', 'tw': '查看成員', 'en': 'View members', 'ja': 'メンバーを表示'},
  'dept.editName': {'zh': '编辑名称', 'tw': '編輯名稱', 'en': 'Edit name', 'ja': '名前を編集'},
  'dept.membersEmpty': {'zh': '该部门暂无成员', 'tw': '該部門暫無成員', 'en': 'No members in this department', 'ja': 'この部署にはメンバーがいません'},
  'dept.disabled': {'zh': '已停用', 'tw': '已停用', 'en': 'Disabled', 'ja': '無効'},
  'dept.members': {'zh': '名成员', 'tw': '名成員', 'en': 'members', 'ja': '名のメンバー'},

  // 角色
  'role.subtitle': {'zh': '角色与数据范围', 'tw': '角色與資料範圍', 'en': 'Roles & data scope', 'ja': 'ロールとデータ範囲'},
  'role.create': {'zh': '新建角色', 'tw': '新增角色', 'en': 'New role', 'ja': 'ロールを新規作成'},
  'role.empty': {'zh': '暂无角色', 'tw': '暫無角色', 'en': 'No roles', 'ja': 'ロールがありません'},
  'role.system': {'zh': '系统', 'tw': '系統', 'en': 'System', 'ja': 'システム'},
  'role.permissions': {'zh': '权限', 'tw': '權限', 'en': 'Permissions', 'ja': '権限'},
  'role.code': {'zh': '编码（小写字母开头）', 'tw': '編碼（小寫字母開頭）', 'en': 'Code (lowercase start)', 'ja': 'コード（小文字で始まる）'},
  'role.name': {'zh': '名称', 'tw': '名稱', 'en': 'Name', 'ja': '名前'},
  'role.description': {'zh': '说明（可选）', 'tw': '說明（可選）', 'en': 'Description (optional)', 'ja': '説明（任意）'},
  'role.dataScope': {'zh': '数据范围', 'tw': '資料範圍', 'en': 'Data scope', 'ja': 'データ範囲'},
  'role.created': {'zh': '角色已创建', 'tw': '角色已建立', 'en': 'Role created', 'ja': 'ロールを作成しました'},
  'role.updated': {'zh': '角色已更新', 'tw': '角色已更新', 'en': 'Role updated', 'ja': 'ロールを更新しました'},
  'role.deleted': {'zh': '角色已删除', 'tw': '角色已刪除', 'en': 'Role deleted', 'ja': 'ロールを削除しました'},
  'role.deleteConfirm': {'zh': '仅未被使用的自定义角色可删除。', 'tw': '僅未被使用的自訂角色可刪除。', 'en': 'Only unused custom roles can be deleted.', 'ja': '未使用のカスタムロールのみ削除できます。'},
  'role.permissionsUpdated': {'zh': '权限已更新', 'tw': '權限已更新', 'en': 'Permissions updated', 'ja': '権限を更新しました'},
  'role.fillRequired': {'zh': '请填写必填项', 'tw': '請填寫必填項', 'en': 'Please fill in required fields', 'ja': '必須項目を入力してください'},

  // 邀请
  'inv.subtitle': {'zh': '成员邀请（令牌仅返回一次）', 'tw': '成員邀請（令牌僅返回一次）', 'en': 'Invitations (token returned once)', 'ja': '招待（トークンは一度だけ返却）'},
  'inv.create': {'zh': '邀请成员', 'tw': '邀請成員', 'en': 'Invite member', 'ja': 'メンバーを招待'},
  'inv.empty': {'zh': '暂无邀请', 'tw': '暫無邀請', 'en': 'No invitations', 'ja': '招待がありません'},
  'inv.revoke': {'zh': '撤销邀请', 'tw': '撤銷邀請', 'en': 'Revoke invitation', 'ja': '招待を取り消す'},
  'inv.revoked': {'zh': '邀请已撤销', 'tw': '邀請已撤銷', 'en': 'Invitation revoked', 'ja': '招待を取り消しました'},
  'inv.displayName': {'zh': '展示名', 'tw': '顯示名稱', 'en': 'Display name', 'ja': '表示名'},
  'inv.account': {'zh': '账号（可选）', 'tw': '帳號（可選）', 'en': 'Account (optional)', 'ja': 'アカウント（任意）'},
  'inv.roles': {'zh': '分配角色', 'tw': '指派角色', 'en': 'Assign roles', 'ja': 'ロールを割り当て'},
  'inv.createSubmit': {'zh': '创建邀请', 'tw': '建立邀請', 'en': 'Create invitation', 'ja': '招待を作成'},
  'inv.createdTitle': {'zh': '邀请已创建', 'tw': '邀請已建立', 'en': 'Invitation created', 'ja': '招待を作成しました'},
  'inv.createdDesc': {'zh': '请通过受控渠道将以下信息交给被邀请人，令牌仅显示这一次：', 'tw': '請透過受控管道將以下資訊交給被邀請人，令牌僅顯示這一次：', 'en': 'Deliver the following to the invitee via a controlled channel. The token is shown only once.', 'ja': '以下を管理された経路で招待者に伝えてください。トークンは一度だけ表示されます。'},
  'inv.copy': {'zh': '复制令牌', 'tw': '複製令牌', 'en': 'Copy token', 'ja': 'トークンをコピー'},
  'inv.copied': {'zh': '已复制', 'tw': '已複製', 'en': 'Copied', 'ja': 'コピーしました'},
  'inv.gotIt': {'zh': '知道了', 'tw': '知道了', 'en': 'Got it', 'ja': 'OK'},
  'inv.status.pending': {'zh': '待使用', 'tw': '待使用', 'en': 'Pending', 'ja': '未使用'},
  'inv.status.accepted': {'zh': '已接受', 'tw': '已接受', 'en': 'Accepted', 'ja': '受領済み'},
  'inv.status.revoked': {'zh': '已撤销', 'tw': '已撤銷', 'en': 'Revoked', 'ja': '取消済み'},
  'inv.status.expired': {'zh': '已过期', 'tw': '已過期', 'en': 'Expired', 'ja': '期限切れ'},
  'inv.accountPending': {'zh': '账号待定', 'tw': '帳號待定', 'en': 'Account pending', 'ja': 'アカウント未定'},
  'inv.suggestedAccount': {'zh': '建议账号', 'tw': '建議帳號', 'en': 'Suggested account', 'ja': '提案アカウント'},
  'inv.revokeConfirm': {'zh': '确定撤销该邀请吗？', 'tw': '確定撤銷該邀請嗎？', 'en': 'Revoke this invitation?', 'ja': 'この招待を取り消しますか？'},
  'inv.fillDisplayName': {'zh': '请填写展示名', 'tw': '請填寫顯示名稱', 'en': 'Please enter a display name', 'ja': '表示名を入力してください'},

  // 消息
  'messages.title': {'zh': '消息', 'tw': '訊息', 'en': 'Messages', 'ja': 'メッセージ'},
  'messages.search': {'zh': '搜索同事或群聊', 'tw': '搜尋同事或群聊', 'en': 'Search contacts or groups', 'ja': '連絡先やグループを検索'},
  'messages.recent': {'zh': '最近消息', 'tw': '最近訊息', 'en': 'Recent', 'ja': '最近のメッセージ'},

  // 首页
  'home.casual': {'zh': '闲聊', 'tw': '閒聊', 'en': 'Chat', 'ja': '雑談'},
  'home.work': {'zh': '工作', 'tw': '工作', 'en': 'Work', 'ja': '仕事'},
};
