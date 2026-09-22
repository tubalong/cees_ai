import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../core/auth_controller.dart';
import '../../core/l10n.dart';
import '../../core/mobile_api.dart';
import '../../shared/layout.dart';

/// 工作台概览：实时统计 + 待办聚合 + 近期会议。
class OverviewTab extends ConsumerStatefulWidget {
  const OverviewTab({super.key});
  @override
  ConsumerState<OverviewTab> createState() => _OverviewTabState();
}

class _OverviewTabState extends ConsumerState<OverviewTab> {
  Map<String, dynamic>? overview;
  Map<String, dynamic>? todos;
  List<Map<String, dynamic>>? upcomingMeetings;
  String? error;

  @override
  void initState() {
    super.initState();
    _load();
  }

  Future<void> _load() async {
    setState(() { error = null; });
    try {
      final api = ref.read(mobileApiProvider);
      final results = await Future.wait<Map<String, dynamic>?>([
        api.dashboardOverview(),
        api.dashboardTodos(),
      ]);
      final upcoming = await api.dashboardUpcomingMeetings();
      if (!mounted) return;
      setState(() {
        overview = results[0];
        todos = results[1];
        upcomingMeetings = upcoming;
      });
    } catch (e) {
      if (mounted) setState(() => error = apiErrorMessage(e));
    }
  }

  int _num(String key, Map<String, dynamic>? section) => ((section?[key] as num?)?.toInt()) ?? 0;

  @override
  Widget build(BuildContext context) {
    final projects = overview?['projects'] as Map<String, dynamic>? ?? const {};
    final tasks = overview?['tasks'] as Map<String, dynamic>? ?? const {};
    final reports = overview?['reports'] as Map<String, dynamic>? ?? const {};
    final meetings = overview?['meetings'] as Map<String, dynamic>? ?? const {};
    final notifications = overview?['notifications'] as Map<String, dynamic>? ?? const {};

    if (overview == null && error == null) return const Center(child: CircularProgressIndicator());
    if (error != null && overview == null) {
      return Center(child: Column(mainAxisAlignment: MainAxisAlignment.center, children: [
        Text(error!, textAlign: TextAlign.center, style: const TextStyle(color: Color(0xff8f98a8))),
        const SizedBox(height: 12),
        FilledButton.tonal(onPressed: _load, child: Text(context.tr('common.retry'))),
      ]));
    }
    return RefreshIndicator(
      onRefresh: _load,
      child: ListView(
        // 紧凑屏（iPhone SE / mini）收紧左右边距，底部让出悬浮导航 +
        // Home Indicator，否则最后一张卡片会被导航遮住。
        padding: EdgeInsets.fromLTRB(
          pagePadding(context),
          4,
          pagePadding(context),
          contentBottomInset(context),
        ),
        children: [
          Wrap(
            spacing: 10,
            runSpacing: 10,
            children: [
              _MetricCard(label: context.tr('workbench.activeProjects'), value: '${_num('active', projects)}', total: '${_num('total', projects)}', color: const Color(0xff3478ff)),
              _MetricCard(label: context.tr('workbench.myTasks'), value: '${_num('total', tasks)}', total: '${_num('overdue', tasks)}', totalLabel: context.tr('workbench.overdue'), color: const Color(0xff8b4dff)),
              _MetricCard(label: context.tr('workbench.pendingReports'), value: '${_num('submitted', reports)}', total: '${_num('total', reports)}', color: const Color(0xff1fbf75)),
              _MetricCard(label: context.tr('workbench.upcomingMeetings'), value: '${_num('upcoming', meetings)}', total: '${_num('unread', notifications)}', totalLabel: context.tr('workbench.unread'), color: const Color(0xfff5a623)),
            ],
          ),
          const SizedBox(height: 18),
          _SectionCard(
            title: context.tr('workbench.todos'),
            emptyText: context.tr('workbench.noTodos'),
            isEmpty: _todoItems().isEmpty,
            children: [for (final item in _todoItems().take(8)) _TodoRow(item: item)],
          ),
          const SizedBox(height: 14),
          _SectionCard(
            title: context.tr('workbench.upcomingMeetingList'),
            emptyText: context.tr('workbench.noMeetings'),
            isEmpty: (upcomingMeetings ?? const []).isEmpty,
            children: [for (final meeting in (upcomingMeetings ?? const []).take(6)) _MeetingRow(meeting: meeting)],
          ),
        ],
      ),
    );
  }

  List<Map<String, dynamic>> _todoItems() {
    final list = <Map<String, dynamic>>[];
    for (final key in const ['tasks', 'reports', 'meetings']) {
      final section = todos?[key];
      if (section is List) list.addAll(section.cast<Map<String, dynamic>>());
    }
    return list;
  }
}

class _MetricCard extends StatelessWidget {
  const _MetricCard({required this.label, required this.value, required this.total, this.totalLabel, required this.color});
  final String label;
  final String value;
  final String total;
  final String? totalLabel;
  final Color color;

  @override
  Widget build(BuildContext context) => Container(
        // 卡片宽度由页边距与 Wrap 间距推导，不再写死「屏宽 - 52」魔法值，
        // 紧凑屏收紧边距后仍保持两列不溢出。
        width: (MediaQuery.sizeOf(context).width - pagePadding(context) * 2 - 10) / 2,
        padding: const EdgeInsets.all(14),
        decoration: BoxDecoration(color: Colors.white, borderRadius: BorderRadius.circular(14), border: Border.all(color: const Color(0xffe8ecf4))),
        child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
          Text(label, style: const TextStyle(fontSize: 12, color: Color(0xff8f98a8))),
          const SizedBox(height: 6),
          Row(crossAxisAlignment: CrossAxisAlignment.end, children: [
            Text(value, style: TextStyle(fontSize: 26, fontWeight: FontWeight.w700, color: color)),
            const SizedBox(width: 6),
            Padding(padding: const EdgeInsets.only(bottom: 3), child: Text(totalLabel != null ? '$total $totalLabel' : '/ $total', style: const TextStyle(fontSize: 12, color: Color(0xffa5adbc)))),
          ]),
        ]),
      );
}

class _SectionCard extends StatelessWidget {
  const _SectionCard({required this.title, required this.emptyText, required this.isEmpty, required this.children});
  final String title;
  final String emptyText;
  final bool isEmpty;
  final List<Widget> children;

  @override
  Widget build(BuildContext context) => Container(
        width: double.infinity,
        padding: const EdgeInsets.all(14),
        decoration: BoxDecoration(color: Colors.white, borderRadius: BorderRadius.circular(14), border: Border.all(color: const Color(0xffe8ecf4))),
        child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
          Text(title, style: const TextStyle(fontSize: 15, fontWeight: FontWeight.w600)),
          const SizedBox(height: 10),
          if (isEmpty)
            Text(emptyText, style: const TextStyle(fontSize: 13, color: Color(0xffa5adbc)))
          else
            ...children,
        ]),
      );
}

class _TodoRow extends StatelessWidget {
  const _TodoRow({required this.item});
  final Map<String, dynamic> item;

  @override
  Widget build(BuildContext context) {
    final title = item['title']?.toString() ?? '';
    final due = item['dueDate']?.toString();
    return Padding(
      padding: const EdgeInsets.only(bottom: 8),
      child: Row(children: [
        Container(width: 6, height: 6, decoration: const BoxDecoration(color: Color(0xff3478ff), shape: BoxShape.circle)),
        const SizedBox(width: 8),
        Expanded(child: Text(title, maxLines: 1, overflow: TextOverflow.ellipsis, style: const TextStyle(fontSize: 13))),
        if (due != null) Text(due.substring(0, due.length > 10 ? 10 : due.length), style: const TextStyle(fontSize: 11, color: Color(0xffa5adbc))),
      ]),
    );
  }
}

class _MeetingRow extends StatelessWidget {
  const _MeetingRow({required this.meeting});
  final Map<String, dynamic> meeting;

  @override
  Widget build(BuildContext context) {
    final title = meeting['title']?.toString() ?? '';
    final startsAt = meeting['startsAt']?.toString() ?? '';
    return Padding(
      padding: const EdgeInsets.only(bottom: 8),
      child: Row(children: [
        const Icon(Icons.calendar_today_outlined, size: 14, color: Color(0xff8b4dff)),
        const SizedBox(width: 8),
        Expanded(child: Text(title, maxLines: 1, overflow: TextOverflow.ellipsis, style: const TextStyle(fontSize: 13))),
        if (startsAt.isNotEmpty) Text(startsAt.substring(0, startsAt.length > 16 ? 16 : startsAt.length), style: const TextStyle(fontSize: 11, color: Color(0xffa5adbc))),
      ]),
    );
  }
}
