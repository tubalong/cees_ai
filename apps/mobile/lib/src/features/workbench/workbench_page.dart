import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../core/auth_controller.dart';
import '../../core/l10n.dart';
import 'meetings_tab.dart';
import 'notifications_tab.dart';
import 'overview_tab.dart';
import 'projects_tab.dart';
import 'reports_tab.dart';

/// 工作台：概览、项目、会议、报告、通知五域聚合页。
class WorkbenchPage extends ConsumerStatefulWidget {
  const WorkbenchPage({super.key});
  @override
  ConsumerState<WorkbenchPage> createState() => _WorkbenchPageState();
}

class _WorkbenchPageState extends ConsumerState<WorkbenchPage> {
  int selectedIndex = 0;

  @override
  Widget build(BuildContext context) {
    final identity = ref.watch(authControllerProvider).value;
    final tabs = <_TabDef>[
      if (hasPermission(identity, 'dashboard.read')) _TabDef(context.tr('workbench.overview'), const OverviewTab()),
      if (hasPermission(identity, 'project.read')) _TabDef(context.tr('workbench.projects'), const ProjectsTab()),
      if (hasPermission(identity, 'meeting.read')) _TabDef(context.tr('workbench.meetings'), const MeetingsTab()),
      if (hasPermission(identity, 'work_report.read')) _TabDef(context.tr('workbench.reports'), const ReportsTab()),
      if (hasPermission(identity, 'notification.read')) _TabDef(context.tr('workbench.notifications'), const NotificationsTab()),
    ];

    if (selectedIndex >= tabs.length) selectedIndex = 0;

    return Scaffold(
      body: SafeArea(
        bottom: false,
        child: Column(
          children: [
            Padding(
              padding: const EdgeInsets.fromLTRB(16, 14, 16, 12),
              child: Row(children: [
                Text(context.tr('workbench.title'), style: const TextStyle(fontSize: 20, fontWeight: FontWeight.w700)),
                const Spacer(),
              ]),
            ),
            if (tabs.isEmpty)
              Expanded(child: Center(child: Text(context.tr('workbench.noPermission'), style: const TextStyle(color: Color(0xff8f98a8)))))
            else ...[
              Padding(
                padding: const EdgeInsets.symmetric(horizontal: 16),
                child: SizedBox(
                  height: 42,
                  child: ListView(
                    scrollDirection: Axis.horizontal,
                    children: List.generate(tabs.length, (index) {
                      final selected = index == selectedIndex;
                      return GestureDetector(
                        onTap: () => setState(() => selectedIndex = index),
                        child: AnimatedContainer(
                          duration: const Duration(milliseconds: 180),
                          padding: const EdgeInsets.symmetric(horizontal: 16),
                          margin: const EdgeInsets.symmetric(horizontal: 3),
                          alignment: Alignment.center,
                          decoration: BoxDecoration(
                            gradient: selected ? const LinearGradient(colors: [Color(0xff3478ff), Color(0xff8b4dff)]) : null,
                            color: selected ? null : const Color(0xfff1f4f9),
                            borderRadius: BorderRadius.circular(9),
                          ),
                          child: Text(
                            tabs[index].label,
                            style: TextStyle(color: selected ? Colors.white : const Color(0xff737c8d), fontWeight: selected ? FontWeight.w600 : FontWeight.w400),
                          ),
                        ),
                      );
                    }),
                  ),
                ),
              ),
              const SizedBox(height: 12),
              Expanded(child: IndexedStack(index: selectedIndex, children: [for (final tab in tabs) tab.child])),
            ],
          ],
        ),
      ),
    );
  }
}

class _TabDef {
  const _TabDef(this.label, this.child);
  final String label;
  final Widget child;
}
