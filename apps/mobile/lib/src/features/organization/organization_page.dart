import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../core/auth_controller.dart';
import '../../core/l10n.dart';
import '../../shared/layout.dart';
import 'departments_tab.dart';
import 'invitations_tab.dart';
import 'members_tab.dart';
import 'roles_tab.dart';

class OrganizationPage extends ConsumerStatefulWidget {
  const OrganizationPage({super.key});

  @override
  ConsumerState<OrganizationPage> createState() => _OrganizationPageState();
}

class _OrganizationPageState extends ConsumerState<OrganizationPage> {
  int selectedIndex = 0;

  @override
  Widget build(BuildContext context) {
    final identity = ref.watch(authControllerProvider).value;
    final tabs = <_TabDef>[
      if (hasPermission(identity, 'member.read')) _TabDef(context.tr('org.members'), const MembersTab()),
      if (hasPermission(identity, 'department.read')) _TabDef(context.tr('org.departments'), const DepartmentsTab()),
      if (hasPermission(identity, 'role.read')) _TabDef(context.tr('org.roles'), const RolesTab()),
      if (hasPermission(identity, 'member.invite')) _TabDef(context.tr('org.invitations'), const InvitationsTab()),
    ];

    if (selectedIndex >= tabs.length) selectedIndex = 0;

    // 四个等宽标签在 iPhone SE / mini 上每格仅约 85pt，英文/日文标签
    // （Members / Departments…）会超出容器；同时 42pt 高低于 Apple 建议的
    // 44pt 最小触控目标。这里抬高到 44pt，紧凑屏再缩字号并允许省略号。
    final compact = isCompactWidth(context);
    final tabFontSize = compact ? 13.0 : 14.0;

    return Scaffold(
      body: SafeArea(
        bottom: false,
        child: Column(
          children: [
            Padding(
              padding: EdgeInsets.fromLTRB(pagePadding(context), 14, pagePadding(context), 12),
              child: Row(
                children: [
                  Text(context.tr('org.title'), style: const TextStyle(fontSize: 20, fontWeight: FontWeight.w700)),
                  const Spacer(),
                ],
              ),
            ),
            if (tabs.isEmpty)
              Expanded(child: Center(child: Text(context.tr('org.noPermission'), style: const TextStyle(color: Color(0xff8f98a8)))))
            else ...[
              Padding(
                padding: EdgeInsets.symmetric(horizontal: pagePadding(context)),
                child: Row(
                  children: List.generate(tabs.length, (index) {
                    final selected = index == selectedIndex;
                    return Expanded(
                      child: GestureDetector(
                        onTap: () => setState(() => selectedIndex = index),
                        child: AnimatedContainer(
                          duration: const Duration(milliseconds: 180),
                          height: kFilterStripHeight,
                          margin: const EdgeInsets.symmetric(horizontal: 3),
                          alignment: Alignment.center,
                          decoration: BoxDecoration(
                            gradient: selected ? const LinearGradient(colors: [Color(0xff3478ff), Color(0xff8b4dff)]) : null,
                            borderRadius: BorderRadius.circular(9),
                          ),
                          child: Text(
                            tabs[index].label,
                            maxLines: 1,
                            overflow: TextOverflow.ellipsis,
                            style: TextStyle(
                              fontSize: tabFontSize,
                              color: selected ? Colors.white : const Color(0xff737c8d),
                              fontWeight: selected ? FontWeight.w600 : FontWeight.w400,
                            ),
                          ),
                        ),
                      ),
                    );
                  }),
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
