import 'package:flutter/material.dart';

import '../../core/l10n.dart';
import '../home/home_page.dart';
import '../messages/messages_page.dart';
import '../organization/organization_page.dart';
import '../profile/profile_page.dart';

class MobileShell extends StatefulWidget {
  const MobileShell({super.key});
  @override
  State<MobileShell> createState() => _MobileShellState();
}

class _MobileShellState extends State<MobileShell> {
  int selectedIndex = 0;
  static const pages = [HomePage(), OrganizationPage(), MessagesPage(), ProfilePage()];

  @override
  Widget build(BuildContext context) => Scaffold(
    extendBody: true,
    body: IndexedStack(index: selectedIndex, children: pages),
    bottomNavigationBar: SafeArea(
      minimum: const EdgeInsets.fromLTRB(18, 0, 18, 10),
      child: Container(
        height: 66,
        padding: const EdgeInsets.all(4),
        decoration: BoxDecoration(color: Colors.white.withValues(alpha: .96), borderRadius: BorderRadius.circular(34), border: Border.all(color: const Color(0xffe0e4ef)), boxShadow: const [BoxShadow(color: Color(0x180f172a), blurRadius: 22, offset: Offset(0, 8))]),
        child: Row(children: [
          _TabItem(index: 0, selectedIndex: selectedIndex, icon: Icons.auto_awesome_outlined, label: context.tr('nav.ai'), onTap: selectTab),
          _TabItem(index: 1, selectedIndex: selectedIndex, icon: Icons.grid_view_outlined, label: context.tr('nav.org'), onTap: selectTab),
          _TabItem(index: 2, selectedIndex: selectedIndex, icon: Icons.chat_bubble_outline_rounded, label: context.tr('nav.messages'), onTap: selectTab),
          _TabItem(index: 3, selectedIndex: selectedIndex, icon: Icons.person_outline_rounded, label: context.tr('nav.profile'), onTap: selectTab),
        ]),
      ),
    ),
  );

  void selectTab(int index) => setState(() => selectedIndex = index);
}

class _TabItem extends StatelessWidget {
  const _TabItem({required this.index, required this.selectedIndex, required this.icon, required this.label, required this.onTap});
  final int index;
  final int selectedIndex;
  final IconData icon;
  final String label;
  final ValueChanged<int> onTap;

  @override
  Widget build(BuildContext context) {
    final selected = index == selectedIndex;
    return Expanded(child: InkWell(
      onTap: () => onTap(index),
      borderRadius: BorderRadius.circular(28),
      child: AnimatedContainer(
        duration: const Duration(milliseconds: 220),
        decoration: BoxDecoration(borderRadius: BorderRadius.circular(28), gradient: selected ? const LinearGradient(colors: [Color(0xff3478ff), Color(0xff8b4dff)]) : null),
        child: Column(mainAxisAlignment: MainAxisAlignment.center, children: [Icon(icon, size: 21, color: selected ? Colors.white : const Color(0xff98a1b3)), const SizedBox(height: 3), Text(label, style: TextStyle(fontSize: 10, fontWeight: selected ? FontWeight.w600 : FontWeight.w400, color: selected ? Colors.white : const Color(0xff98a1b3)))]),
      ),
    ));
  }
}