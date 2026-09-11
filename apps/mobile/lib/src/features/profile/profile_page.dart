import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../core/auth_controller.dart';
import '../../core/l10n.dart';
import '../../core/mobile_api.dart';

class ProfilePage extends ConsumerStatefulWidget {
  const ProfilePage({super.key});

  @override
  ConsumerState<ProfilePage> createState() => _ProfilePageState();
}

class _ProfilePageState extends ConsumerState<ProfilePage> {
  Map<String, dynamic>? profile;
  bool loading = true;

  @override
  void initState() {
    super.initState();
    _load();
  }

  Future<void> _load() async {
    try {
      final data = await ref.read(mobileApiProvider).profile();
      if (mounted) setState(() => profile = data);
    } catch (e) {
      if (mounted) {
        ScaffoldMessenger.of(context)
            .showSnackBar(SnackBar(content: Text(apiErrorMessage(e))));
      }
    } finally {
      if (mounted) setState(() => loading = false);
    }
  }

  @override
  Widget build(BuildContext context) {
    final identity = ref.watch(authControllerProvider).value;
    final displayName = identity?.user['displayName']?.toString() ?? '—';
    final account = identity?.membership['account']?.toString() ?? '—';
    final tenantName = identity?.tenant['name']?.toString() ?? '—';
    final roles = roleNames(identity?.membership['roles']).join('、');
    final department = profile?['department'] as Map<dynamic, dynamic>?;
    final departmentName = department?['name']?.toString();

    return Scaffold(
      body: SafeArea(
        bottom: false,
        child: RefreshIndicator(
          onRefresh: _load,
          child: ListView(
            padding: const EdgeInsets.fromLTRB(18, 14, 18, 104),
            children: [
              Row(
                mainAxisAlignment: MainAxisAlignment.spaceBetween,
                children: [
                  Text(context.tr('profile.title'),
                      style: const TextStyle(
                          fontSize: 20, fontWeight: FontWeight.w700)),
                  IconButton(
                      onPressed: _confirmLogout,
                      icon: const Icon(Icons.logout_rounded)),
                ],
              ),
              const SizedBox(height: 18),
              Container(
                padding: const EdgeInsets.all(20),
                decoration: BoxDecoration(
                    color: Colors.white,
                    borderRadius: BorderRadius.circular(20)),
                child: Row(
                  children: [
                    CircleAvatar(
                      radius: 30,
                      backgroundColor: const Color(0xff5964ff),
                      child: Text(
                          displayName.isNotEmpty
                              ? displayName.characters.first
                              : '?',
                          style: const TextStyle(
                              color: Colors.white,
                              fontSize: 27,
                              fontWeight: FontWeight.w600)),
                    ),
                    const SizedBox(width: 15),
                    Expanded(
                      child: Column(
                        crossAxisAlignment: CrossAxisAlignment.start,
                        children: [
                          Text(displayName,
                              style: const TextStyle(
                                  fontSize: 19, fontWeight: FontWeight.w700)),
                          const SizedBox(height: 3),
                          Text(account,
                              style: const TextStyle(
                                  color: Color(0xff7f8898), fontSize: 12)),
                        ],
                      ),
                    ),
                  ],
                ),
              ),
              const SizedBox(height: 16),
              Container(
                padding: const EdgeInsets.all(16),
                decoration: BoxDecoration(
                    color: Colors.white,
                    borderRadius: BorderRadius.circular(20)),
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    Text(context.tr('profile.enterprise'),
                        style: const TextStyle(
                            fontSize: 16, fontWeight: FontWeight.w700)),
                    const SizedBox(height: 12),
                    _EnterpriseTile(
                        mark: tenantName.isNotEmpty
                            ? tenantName.characters.first
                            : '企',
                        name: tenantName,
                        detail: context.tr('profile.verified'),
                        verified: true),
                  ],
                ),
              ),
              const SizedBox(height: 16),
              Material(
                color: Colors.white,
                borderRadius: BorderRadius.circular(20),
                clipBehavior: Clip.antiAlias,
                child: Column(
                  children: [
                    _InfoTile(
                        label: context.tr('profile.account'), value: account),
                    const Divider(height: 1),
                    _InfoTile(
                        label: context.tr('profile.department'),
                        value: departmentName ?? context.tr('profile.unassigned')),
                    const Divider(height: 1),
                    _InfoTile(
                        label: context.tr('profile.roles'),
                        value: roles.isEmpty ? context.tr('profile.none') : roles),
                  ],
                ),
              ),
              const SizedBox(height: 16),
              Material(
                color: Colors.white,
                borderRadius: BorderRadius.circular(20),
                clipBehavior: Clip.antiAlias,
                child: Column(
                  children: [
                    _ActionTile(
                        icon: Icons.badge_outlined,
                        label: context.tr('profile.editName'),
                        onTap: loading ? null : _editDisplayName),
                    const Divider(height: 1),
                    _ActionTile(
                        icon: Icons.lock_outline,
                        label: context.tr('profile.changePassword'),
                        onTap: _changePassword),
                    const Divider(height: 1),
                    _ActionTile(
                        icon: Icons.language_rounded,
                        label: context.tr('profile.language'),
                        onTap: _chooseLanguage),
                  ],
                ),
              ),
            ],
          ),
        ),
      ),
    );
  }

  Future<void> _chooseLanguage() async {
    final current = ref.read(languageProvider);
    final selected = await showModalBottomSheet<AppLanguage>(
      context: context,
      shape: const RoundedRectangleBorder(
          borderRadius: BorderRadius.vertical(top: Radius.circular(24))),
      builder: (context) => SafeArea(
        child: Column(
          mainAxisSize: MainAxisSize.min,
          children: [
            Padding(
              padding: const EdgeInsets.fromLTRB(20, 18, 20, 8),
              child: Text(context.tr('profile.language'),
                  style: const TextStyle(
                      fontSize: 18, fontWeight: FontWeight.w700)),
            ),
            for (final lang in AppLanguage.values)
              ListTile(
                title: Text(lang.label),
                trailing: lang == current
                    ? const Icon(Icons.check_rounded, color: Color(0xff3478ff))
                    : null,
                onTap: () => Navigator.pop(context, lang),
              ),
          ],
        ),
      ),
    );
    if (selected != null) {
      await ref.read(languageProvider.notifier).set(selected);
    }
  }

  Future<void> _editDisplayName() async {
    final identity = ref.read(authControllerProvider).value;
    final version = (profile?['version'] as num?)?.toInt() ?? 0;
    final controller = TextEditingController(
        text: identity?.user['displayName']?.toString() ?? '');
    final saved = await showDialog<String>(
      context: context,
      builder: (context) => AlertDialog(
        title: Text(context.tr('profile.editName')),
        content: TextField(
            controller: controller,
            autofocus: true,
            decoration:
                InputDecoration(labelText: context.tr('profile.displayName'))),
        actions: [
          TextButton(
              onPressed: () => Navigator.pop(context),
              child: Text(context.tr('common.cancel'))),
          FilledButton(
              onPressed: () => Navigator.pop(context, controller.text),
              child: Text(context.tr('common.save'))),
        ],
      ),
    );
    if (saved == null || saved.trim().isEmpty) {
      controller.dispose();
      return;
    }
    try {
      await ref.read(mobileApiProvider).updateProfile(saved, version);
      await ref.read(authControllerProvider.notifier).refreshIdentity();
      await _load();
      if (mounted) {
        ScaffoldMessenger.of(context)
            .showSnackBar(SnackBar(content: Text(context.tr('profile.nameUpdated'))));
      }
    } catch (e) {
      if (mounted) {
        ScaffoldMessenger.of(context)
            .showSnackBar(SnackBar(content: Text(apiErrorMessage(e))));
      }
    } finally {
      controller.dispose();
    }
  }

  Future<void> _changePassword() async {
    final currentController = TextEditingController();
    final newController = TextEditingController();
    final result = await showDialog<bool>(
      context: context,
      builder: (context) => AlertDialog(
        title: Text(context.tr('profile.changePassword')),
        content: Column(
          mainAxisSize: MainAxisSize.min,
          children: [
            TextField(
                controller: currentController,
                obscureText: true,
                decoration: InputDecoration(
                    labelText: context.tr('profile.currentPassword'))),
            const SizedBox(height: 10),
            TextField(
                controller: newController,
                obscureText: true,
                decoration: InputDecoration(
                    labelText: context.tr('profile.newPassword'))),
          ],
        ),
        actions: [
          TextButton(
              onPressed: () => Navigator.pop(context, false),
              child: Text(context.tr('common.cancel'))),
          FilledButton(
            onPressed: () {
              if (newController.text.length < 8) {
                ScaffoldMessenger.of(context).showSnackBar(
                    SnackBar(content: Text(context.tr('profile.passwordMin'))));
                return;
              }
              Navigator.pop(context, true);
            },
            child: Text(context.tr('profile.confirmChange')),
          ),
        ],
      ),
    );
    final newPassword = newController.text;
    final currentPassword = currentController.text;
    currentController.dispose();
    newController.dispose();
    if (result != true) return;
    try {
      await ref
          .read(mobileApiProvider)
          .changePassword(currentPassword, newPassword);
      if (mounted) {
        ScaffoldMessenger.of(context).showSnackBar(
            SnackBar(content: Text(context.tr('profile.passwordUpdated'))));
      }
    } catch (e) {
      if (mounted) {
        ScaffoldMessenger.of(context)
            .showSnackBar(SnackBar(content: Text(apiErrorMessage(e))));
      }
    }
  }

  Future<void> _confirmLogout() async {
    final confirmed = await showDialog<bool>(
      context: context,
      builder: (context) => AlertDialog(
        title: Text(context.tr('profile.logout')),
        content: Text(context.tr('profile.logoutConfirm')),
        actions: [
          TextButton(
              onPressed: () => Navigator.pop(context, false),
              child: Text(context.tr('common.cancel'))),
          FilledButton(
              onPressed: () => Navigator.pop(context, true),
              child: Text(context.tr('profile.logoutAction'))),
        ],
      ),
    );
    if (confirmed != true) return;
    await ref.read(authControllerProvider.notifier).logout();
  }
}

class _EnterpriseTile extends StatelessWidget {
  const _EnterpriseTile(
      {required this.mark,
      required this.name,
      required this.detail,
      required this.verified});
  final String mark;
  final String name;
  final String detail;
  final bool verified;

  @override
  Widget build(BuildContext context) => Container(
        padding: const EdgeInsets.all(12),
        decoration: BoxDecoration(
            color: const Color(0xfff8f9fb),
            borderRadius: BorderRadius.circular(14)),
        child: Row(
          children: [
            Container(
              width: 46,
              height: 46,
              alignment: Alignment.center,
              decoration: BoxDecoration(
                  gradient: const LinearGradient(
                      colors: [Color(0xff3478ff), Color(0xff8b4dff)]),
                  borderRadius: BorderRadius.circular(12)),
              child: Text(mark,
                  style: const TextStyle(
                      color: Colors.white,
                      fontSize: 20,
                      fontWeight: FontWeight.w600)),
            ),
            const SizedBox(width: 12),
            Expanded(
              child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    Text(name, style: const TextStyle(fontWeight: FontWeight.w600)),
                    Text(detail,
                        style: const TextStyle(
                            color: Color(0xff7f8898), fontSize: 11)),
                  ]),
            ),
            Container(
              padding:
                  const EdgeInsets.symmetric(horizontal: 10, vertical: 5),
              decoration: BoxDecoration(
                  color: verified
                      ? const Color(0xff20bd6b)
                      : const Color(0xffffa000),
                  borderRadius: BorderRadius.circular(14)),
              child: Text(verified ? '✓ $detail' : detail,
                  style: const TextStyle(color: Colors.white, fontSize: 10)),
            ),
          ],
        ),
      );
}

class _InfoTile extends StatelessWidget {
  const _InfoTile({required this.label, required this.value});
  final String label;
  final String value;

  @override
  Widget build(BuildContext context) => ListTile(
        title: Text(label, style: const TextStyle(color: Color(0xff4e5969))),
        trailing: ConstrainedBox(
          constraints: const BoxConstraints(maxWidth: 220),
          child: Text(value,
              maxLines: 1,
              overflow: TextOverflow.ellipsis,
              style: const TextStyle(fontWeight: FontWeight.w600)),
        ),
      );
}

class _ActionTile extends StatelessWidget {
  const _ActionTile(
      {required this.icon, required this.label, required this.onTap});
  final IconData icon;
  final String label;
  final VoidCallback? onTap;

  @override
  Widget build(BuildContext context) => ListTile(
        leading: Icon(icon, color: const Color(0xff4e5969)),
        title: Text(label),
        trailing: const Icon(Icons.chevron_right_rounded,
            color: Color(0xff9ca4b4)),
        onTap: onTap,
      );
}
