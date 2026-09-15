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
  'nav.workbench': {'zh': '工作台', 'tw': '工作台', 'en': 'Workbench', 'ja': 'ワークベンチ'},

  // 首页 AI 对话
  'home.workWelcome': {'zh': '你好，我是 CEES AI 工作助理。对话历史保存在本机，服务端只记录 Token 用量。有什么工作需要处理？', 'tw': '你好，我是 CEES AI 工作助理。對話歷史保存在本機，伺服器只記錄 Token 用量。有什麼工作需要處理？', 'en': "Hi, I'm your CEES AI work assistant. Chat history stays on this device; the server only records token usage. What can I help with?", 'ja': 'こんにちは、CEES AI ワークアシスタントです。会話履歴は端末内に保存され、サーバーはトークン量のみを記録します。何をお手伝いしますか？'},
  'home.casualWelcome': {'zh': '切换到轻松模式啦～聊点开心的吧！', 'tw': '切換到輕鬆模式啦～聊點開心的吧！', 'en': "Casual mode on! Let's chat about something fun.", 'ja': 'カジュアルモードに切り替わりました！楽しい話をしましょう。'},
  'home.thinking': {'zh': '正在思考…', 'tw': '正在思考…', 'en': 'Thinking…', 'ja': '考えています…'},
  'home.emptyAnswer': {'zh': '（模型未返回内容）', 'tw': '（模型未返回內容）', 'en': '(No content returned)', 'ja': '（応答なし）'},

  // 工作台
  'workbench.title': {'zh': '工作台', 'tw': '工作台', 'en': 'Workbench', 'ja': 'ワークベンチ'},
  'workbench.noPermission': {'zh': '暂无工作台权限，请联系管理员', 'tw': '暫無工作台權限，請聯繫管理員', 'en': 'No workbench permission, please contact your administrator', 'ja': 'ワークベンチの権限がありません。管理者に連絡してください'},
  'workbench.overview': {'zh': '概览', 'tw': '概覽', 'en': 'Overview', 'ja': '概要'},
  'workbench.projects': {'zh': '项目', 'tw': '專案', 'en': 'Projects', 'ja': 'プロジェクト'},
  'workbench.meetings': {'zh': '会议', 'tw': '會議', 'en': 'Meetings', 'ja': '会議'},
  'workbench.reports': {'zh': '报告', 'tw': '報告', 'en': 'Reports', 'ja': '報告'},
  'workbench.notifications': {'zh': '通知', 'tw': '通知', 'en': 'Notifications', 'ja': '通知'},
  'workbench.activeProjects': {'zh': '进行中项目', 'tw': '進行中專案', 'en': 'Active Projects', 'ja': '進行中プロジェクト'},
  'workbench.myTasks': {'zh': '我的任务', 'tw': '我的任務', 'en': 'My Tasks', 'ja': '自分のタスク'},
  'workbench.overdue': {'zh': '项逾期', 'tw': '項逾期', 'en': 'overdue', 'ja': '件期限超過'},
  'workbench.pendingReports': {'zh': '待审报告', 'tw': '待審報告', 'en': 'Pending Reports', 'ja': '審査待ち報告'},
  'workbench.upcomingMeetings': {'zh': '近期会议', 'tw': '近期會議', 'en': 'Upcoming Meetings', 'ja': '今後の会議'},
  'workbench.unread': {'zh': '未读', 'tw': '未讀', 'en': 'unread', 'ja': '未読'},
  'workbench.todos': {'zh': '待办事项', 'tw': '待辦事項', 'en': 'To-dos', 'ja': 'やること'},
  'workbench.noTodos': {'zh': '当前没有待办', 'tw': '目前沒有待辦', 'en': 'No pending items', 'ja': '対応すべき項目はありません'},
  'workbench.upcomingMeetingList': {'zh': '近期会议', 'tw': '近期會議', 'en': 'Upcoming Meetings', 'ja': '今後の会議'},
  'workbench.noMeetings': {'zh': '近期没有会议', 'tw': '近期沒有會議', 'en': 'No upcoming meetings', 'ja': '予定された会議はありません'},
  'workbench.all': {'zh': '全部', 'tw': '全部', 'en': 'All', 'ja': 'すべて'},
  'workbench.archived': {'zh': '已归档', 'tw': '已歸檔', 'en': 'Archived', 'ja': 'アーカイブ済み'},
  'workbench.newProject': {'zh': '新建项目', 'tw': '新建專案', 'en': 'New Project', 'ja': '新規プロジェクト'},
  'workbench.noProjects': {'zh': '暂无可见项目', 'tw': '暫無可見專案', 'en': 'No visible projects', 'ja': '表示できるプロジェクトはありません'},
  'workbench.members': {'zh': '成员 ', 'tw': '成員 ', 'en': 'Members ', 'ja': 'メンバー '},
  'workbench.tasks': {'zh': '任务 ', 'tw': '任務 ', 'en': 'Tasks ', 'ja': 'タスク '},
  'workbench.comments': {'zh': '评论 ', 'tw': '評論 ', 'en': 'Comments ', 'ja': 'コメント '},
  'workbench.noTasks': {'zh': '暂无任务', 'tw': '暫無任務', 'en': 'No tasks', 'ja': 'タスクはありません'},
  'workbench.noComments': {'zh': '暂无评论，发表第一条吧', 'tw': '暫無評論，發表第一條吧', 'en': 'No comments yet', 'ja': 'コメントはまだありません'},
  'workbench.commentHint': {'zh': '发表评论…', 'tw': '發表評論…', 'en': 'Write a comment…', 'ja': 'コメントを入力…'},
  'workbench.projectCreated': {'zh': '项目已创建', 'tw': '專案已建立', 'en': 'Project created', 'ja': 'プロジェクトを作成しました'},
  'workbench.projectCode': {'zh': '项目编码', 'tw': '專案編碼', 'en': 'Project code', 'ja': 'プロジェクトコード'},
  'workbench.projectName': {'zh': '项目名称', 'tw': '專案名稱', 'en': 'Project name', 'ja': 'プロジェクト名'},
  'workbench.projectDescription': {'zh': '项目说明（可选）', 'tw': '專案說明（可選）', 'en': 'Description (optional)', 'ja': '説明（任意）'},
  'workbench.projectMembers': {'zh': '项目成员', 'tw': '專案成員', 'en': 'Project Members', 'ja': 'プロジェクトメンバー'},
  'workbench.owner': {'zh': '负责人', 'tw': '負責人', 'en': 'Owner', 'ja': '担当者'},
  'workbench.myRole': {'zh': '我的角色', 'tw': '我的角色', 'en': 'My role', 'ja': '自分の役割'},
  'workbench.startsAt': {'zh': '开始时间', 'tw': '開始時間', 'en': 'Starts at', 'ja': '開始日時'},
  'workbench.endsAt': {'zh': '结束时间', 'tw': '結束時間', 'en': 'Ends at', 'ja': '終了日時'},
  'workbench.statusUpdated': {'zh': '状态已更新', 'tw': '狀態已更新', 'en': 'Status updated', 'ja': 'ステータスを更新しました'},
  'workbench.reasonRequired': {'zh': '请填写原因', 'tw': '請填寫原因', 'en': 'Reason required', 'ja': '理由を入力してください'},
  'workbench.status.PLANNING': {'zh': '规划中', 'tw': '規劃中', 'en': 'Planning', 'ja': '計画中'},
  'workbench.status.ACTIVE': {'zh': '进行中', 'tw': '進行中', 'en': 'Active', 'ja': '進行中'},
  'workbench.status.PAUSED': {'zh': '已暂停', 'tw': '已暫停', 'en': 'Paused', 'ja': '一時停止'},
  'workbench.status.COMPLETED': {'zh': '已完成', 'tw': '已完成', 'en': 'Completed', 'ja': '完了'},
  'workbench.status.CANCELLED': {'zh': '已取消', 'tw': '已取消', 'en': 'Cancelled', 'ja': 'キャンセル'},
  'workbench.status.ARCHIVED': {'zh': '已归档', 'tw': '已歸檔', 'en': 'Archived', 'ja': 'アーカイブ済み'},
  'workbench.transition.start': {'zh': '启动项目', 'tw': '啟動專案', 'en': 'Start', 'ja': '開始'},
  'workbench.transition.pause': {'zh': '暂停', 'tw': '暫停', 'en': 'Pause', 'ja': '一時停止'},
  'workbench.transition.resume': {'zh': '恢复', 'tw': '恢復', 'en': 'Resume', 'ja': '再開'},
  'workbench.transition.complete': {'zh': '完成项目', 'tw': '完成專案', 'en': 'Complete', 'ja': '完了にする'},
  'workbench.transition.reopen': {'zh': '重新开启', 'tw': '重新開啟', 'en': 'Reopen', 'ja': '再オープン'},
  'workbench.transition.cancel': {'zh': '取消', 'tw': '取消', 'en': 'Cancel', 'ja': 'キャンセル'},
  'workbench.transition.archive': {'zh': '归档', 'tw': '歸檔', 'en': 'Archive', 'ja': 'アーカイブ'},
  'workbench.transition.restore': {'zh': '恢复归档', 'tw': '恢復歸檔', 'en': 'Restore', 'ja': 'アーカイブ解除'},
  'workbench.taskTransition.IN_PROGRESS': {'zh': '开始处理', 'tw': '開始處理', 'en': 'Start', 'ja': '着手する'},
  'workbench.taskTransition.BLOCKED': {'zh': '标记阻塞', 'tw': '標記阻塞', 'en': 'Block', 'ja': 'ブロック'},
  'workbench.taskTransition.DONE': {'zh': '标记完成', 'tw': '標記完成', 'en': 'Done', 'ja': '完了にする'},
  'workbench.taskTransition.CANCELLED': {'zh': '取消任务', 'tw': '取消任務', 'en': 'Cancel', 'ja': 'キャンセル'},
  'workbench.newMeeting': {'zh': '新建会议', 'tw': '新建會議', 'en': 'New Meeting', 'ja': '新規会議'},
  'workbench.meetingCreated': {'zh': '会议已创建', 'tw': '會議已建立', 'en': 'Meeting created', 'ja': '会議を作成しました'},
  'workbench.meetingTitle': {'zh': '会议标题', 'tw': '會議標題', 'en': 'Meeting title', 'ja': '会議名'},
  'workbench.meetingDescription': {'zh': '会议说明（可选）', 'tw': '會議說明（可選）', 'en': 'Description (optional)', 'ja': '説明（任意）'},
  'workbench.minutes': {'zh': '分钟', 'tw': '分鐘', 'en': 'min', 'ja': '分'},
  'workbench.location': {'zh': '地点', 'tw': '地點', 'en': 'Location', 'ja': '会場'},
  'workbench.meetingUrl': {'zh': '会议链接', 'tw': '會議連結', 'en': 'Meeting URL', 'ja': '会議 URL'},
  'workbench.participants': {'zh': '参会人', 'tw': '參會人', 'en': 'Participants', 'ja': '参加者'},
  'workbench.noParticipants': {'zh': '暂无参会人', 'tw': '暫無參會人', 'en': 'No participants', 'ja': '参加者はいません'},
  'workbench.minutesSection': {'zh': '会议纪要', 'tw': '會議紀要', 'en': 'Minutes', 'ja': '議事録'},
  'workbench.noMinutes': {'zh': '尚未创建纪要', 'tw': '尚未建立紀要', 'en': 'No minutes yet', 'ja': '議事録はまだありません'},
  'workbench.published': {'zh': '已发布', 'tw': '已發布', 'en': 'Published', 'ja': '公開済み'},
  'workbench.draft': {'zh': '草稿', 'tw': '草稿', 'en': 'Draft', 'ja': '下書き'},
  'workbench.decisions': {'zh': '决议', 'tw': '決議', 'en': 'Decisions', 'ja': '決議'},
  'workbench.respondInvitation': {'zh': '邀请应答', 'tw': '邀請應答', 'en': 'Respond to invitation', 'ja': '招待への回答'},
  'workbench.response.accept': {'zh': '接受', 'tw': '接受', 'en': 'Accept', 'ja': '参加'},
  'workbench.response.tentative': {'zh': '待定', 'tw': '待定', 'en': 'Tentative', 'ja': '未定'},
  'workbench.response.decline': {'zh': '拒绝', 'tw': '拒絕', 'en': 'Decline', 'ja': '辞退'},
  'workbench.responseSubmitted': {'zh': '应答已提交', 'tw': '應答已提交', 'en': 'Response submitted', 'ja': '回答を送信しました'},
  'workbench.scheduleMeeting': {'zh': '安排会议', 'tw': '安排會議', 'en': 'Schedule', 'ja': '会議を確定'},
  'workbench.startMeeting': {'zh': '开始会议', 'tw': '開始會議', 'en': 'Start meeting', 'ja': '会議開始'},
  'workbench.completeMeeting': {'zh': '结束会议', 'tw': '結束會議', 'en': 'End meeting', 'ja': '会議終了'},
  'workbench.cancelMeeting': {'zh': '取消会议', 'tw': '取消會議', 'en': 'Cancel meeting', 'ja': '会議をキャンセル'},
  'workbench.cancelReason': {'zh': '取消原因', 'tw': '取消原因', 'en': 'Cancellation reason', 'ja': 'キャンセル理由'},
  'workbench.newReport': {'zh': '写报告', 'tw': '寫報告', 'en': 'New Report', 'ja': '報告を作成'},
  'workbench.daily': {'zh': '日报', 'tw': '日報', 'en': 'Daily', 'ja': '日報'},
  'workbench.weekly': {'zh': '周报', 'tw': '週報', 'en': 'Weekly', 'ja': '週報'},
  'workbench.noReports': {'zh': '暂无报告', 'tw': '暫無報告', 'en': 'No reports', 'ja': '報告はありません'},
  'workbench.periodStart': {'zh': '周期开始', 'tw': '週期開始', 'en': 'Period start', 'ja': '期間開始'},
  'workbench.weeklyMustStartMonday': {'zh': '周报开始日期必须是周一', 'tw': '週報開始日期必須是週一', 'en': 'Weekly reports must start on Monday', 'ja': '週報の開始日は月曜日である必要があります'},
  'workbench.reportContentHint': {'zh': '填写今天的工作内容…', 'tw': '填寫今天的工作內容…', 'en': "Write today's work…", 'ja': '今日の作業内容を入力…'},
  'workbench.reportCreated': {'zh': '报告已创建', 'tw': '報告已建立', 'en': 'Report created', 'ja': '報告を作成しました'},
  'workbench.reportSubmitted': {'zh': '报告已提交', 'tw': '報告已提交', 'en': 'Report submitted', 'ja': '報告を提出しました'},
  'workbench.reportWithdrawn': {'zh': '报告已撤回', 'tw': '報告已撤回', 'en': 'Report withdrawn', 'ja': '報告を取り下げました'},
  'workbench.reportDeleted': {'zh': '报告已删除', 'tw': '報告已刪除', 'en': 'Report deleted', 'ja': '報告を削除しました'},
  'workbench.reportApproved': {'zh': '报告已通过', 'tw': '報告已通過', 'en': 'Report approved', 'ja': '報告を承認しました'},
  'workbench.reportRejected': {'zh': '报告已驳回', 'tw': '報告已駁回', 'en': 'Report rejected', 'ja': '報告を差し戻しました'},
  'workbench.submitReport': {'zh': '提交', 'tw': '提交', 'en': 'Submit', 'ja': '提出'},
  'workbench.withdrawReport': {'zh': '撤回', 'tw': '撤回', 'en': 'Withdraw', 'ja': '取り下げ'},
  'workbench.approveReport': {'zh': '通过报告', 'tw': '通過報告', 'en': 'Approve report', 'ja': '報告を承認'},
  'workbench.rejectReport': {'zh': '驳回报告', 'tw': '駁回報告', 'en': 'Reject report', 'ja': '報告を差戻す'},
  'workbench.approve': {'zh': '通过', 'tw': '通過', 'en': 'Approve', 'ja': '承認'},
  'workbench.reject': {'zh': '驳回', 'tw': '駁回', 'en': 'Reject', 'ja': '差戻し'},
  'workbench.unreadOnly': {'zh': '仅未读', 'tw': '僅未讀', 'en': 'Unread only', 'ja': '未読のみ'},
  'workbench.markAllRead': {'zh': '全部已读', 'tw': '全部已讀', 'en': 'Mark all read', 'ja': 'すべて既読'},
  'workbench.markRead': {'zh': '已读', 'tw': '已讀', 'en': 'Read', 'ja': '既読'},
  'workbench.noNotifications': {'zh': '暂无通知', 'tw': '暫無通知', 'en': 'No notifications', 'ja': '通知はありません'},

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
