import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../core/auth_controller.dart';
import '../../core/l10n.dart';
import '../../core/mobile_api.dart';
import '../../shared/async_list_view.dart';
import '../../shared/layout.dart';

/// 通知中心：当前成员可见通知与已读操作。
class NotificationsTab extends ConsumerStatefulWidget {
  const NotificationsTab({super.key});
  @override
  ConsumerState<NotificationsTab> createState() => _NotificationsTabState();
}

class _NotificationsTabState extends ConsumerState<NotificationsTab> {
  List<Map<String, dynamic>> items = const [];
  bool loading = true;
  String? error;
  bool unreadOnly = false;
  int unreadCount = 0;

  @override
  void initState() {
    super.initState();
    _load();
  }

  Future<void> _load() async {
    setState(() => error = null);
    try {
      final api = ref.read(mobileApiProvider);
      final data = await api.notificationList(unreadOnly: unreadOnly);
      final count = await api.unreadNotificationCount();
      if (!mounted) return;
      setState(() { items = data; loading = false; unreadCount = count; });
    } catch (e) {
      if (mounted) setState(() { error = apiErrorMessage(e); loading = false; });
    }
  }

  Future<void> _markRead(Map<String, dynamic> notification) async {
    try {
      await ref.read(mobileApiProvider).markNotificationRead(notification['id'].toString());
      await _load();
    } catch (e) {
      if (mounted) _toast(apiErrorMessage(e));
    }
  }

  Future<void> _markAll() async {
    try {
      await ref.read(mobileApiProvider).markAllNotificationsRead();
      await _load();
    } catch (e) {
      if (mounted) _toast(apiErrorMessage(e));
    }
  }

  void _toast(String text) => ScaffoldMessenger.of(context).showSnackBar(SnackBar(content: Text(text)));

  @override
  Widget build(BuildContext context) => Column(children: [
    Padding(
      padding: EdgeInsets.fromLTRB(pagePadding(context), 0, pagePadding(context), 10),
      // 紧凑屏下「未读过滤 + 全部已读 + 未读计数」四个元素容易溢出，
      // 计数文字改为可收缩并省略，保证不出现 RenderFlex overflow。
      child: Row(children: [
        FilterChip(
          label: Text(context.tr('workbench.unreadOnly')),
          selected: unreadOnly,
          onSelected: (value) { setState(() => unreadOnly = value); _load(); },
        ),
        const Spacer(),
        TextButton(onPressed: unreadCount > 0 ? _markAll : null, child: Text(context.tr('workbench.markAllRead'), maxLines: 1, overflow: TextOverflow.ellipsis)),
        Flexible(child: Text('${context.tr('workbench.unread')} $unreadCount', maxLines: 1, overflow: TextOverflow.ellipsis, style: const TextStyle(fontSize: 12, color: Color(0xffa5adbc)))),
      ]),
    ),
    Expanded(
      child: AsyncListView(
        loading: loading && error == null,
        error: error,
        emptyText: context.tr('workbench.noNotifications'),
        onRefresh: _load,
        children: [for (final notification in items) _NotificationCard(notification: notification, onRead: () => _markRead(notification))],
      ),
    ),
  ]);
}

class _NotificationCard extends StatelessWidget {
  const _NotificationCard({required this.notification, required this.onRead});
  final Map<String, dynamic> notification;
  final VoidCallback onRead;

  bool get unread => notification['readAt'] == null;

  @override
  Widget build(BuildContext context) => Container(
    margin: const EdgeInsets.only(bottom: 10),
    padding: const EdgeInsets.all(14),
    decoration: BoxDecoration(
      color: unread ? const Color(0xfff4f7ff) : Colors.white,
      borderRadius: BorderRadius.circular(14),
      border: Border.all(color: unread ? const Color(0xffc9d8ff) : const Color(0xffe8ecf4)),
    ),
    child: Row(crossAxisAlignment: CrossAxisAlignment.start, children: [
      Icon(unread ? Icons.notifications_active_outlined : Icons.notifications_none_outlined, size: 20, color: unread ? const Color(0xff3478ff) : const Color(0xffa5adbc)),
      const SizedBox(width: 10),
      Expanded(child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
        Text(notification['title']?.toString() ?? '', style: TextStyle(fontSize: 14, fontWeight: FontWeight.w600)),
        if (notification['content'] != null) ...[
          const SizedBox(height: 4),
          Text(notification['content'].toString(), style: const TextStyle(fontSize: 12, color: Color(0xff737c8d))),
        ],
        if (notification['createdAt'] != null) ...[
          const SizedBox(height: 6),
          Text(notification['createdAt'].toString(), style: const TextStyle(fontSize: 11, color: Color(0xffa5adbc))),
        ],
      ])),
      if (unread) TextButton(onPressed: onRead, child: Text(context.tr('workbench.markRead'))),
    ]),
  );
}
