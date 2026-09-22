import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../core/auth_controller.dart';
import '../../core/l10n.dart';
import '../../core/mobile_api.dart';
import '../../shared/async_list_view.dart';
import '../../shared/layout.dart';
import '../../shared/search_field.dart';

class MembersTab extends ConsumerStatefulWidget {
  const MembersTab({super.key});

  @override
  ConsumerState<MembersTab> createState() => _MembersTabState();
}

class _MembersTabState extends ConsumerState<MembersTab> {
  List<Map<String, dynamic>> items = [];
  bool loading = true;
  String? error;
  String keyword = '';

  @override
  void initState() {
    super.initState();
    _load();
  }

  Future<void> _load() async {
    try {
      final data = await ref.read(mobileApiProvider).members();
      if (mounted) setState(() => items = data);
    } catch (e) {
      if (mounted) setState(() => error = apiErrorMessage(e));
    } finally {
      if (mounted) setState(() => loading = false);
    }
  }

  @override
  Widget build(BuildContext context) {
    final identity = ref.watch(authControllerProvider).value;
    final canManage = hasPermission(identity, 'member.update') ||
        hasPermission(identity, 'department.member.assign') ||
        hasPermission(identity, 'role.assign') ||
        hasPermission(identity, 'member.account.update') ||
        hasPermission(identity, 'member.credential.reset') ||
        hasPermission(identity, 'member.remove');
    final visible = keyword.trim().isEmpty
        ? items
        : items.where((m) {
            final account = m['account']?.toString() ?? '';
            final display =
                (m['user'] as Map?)?['displayName']?.toString() ?? '';
            return '$account$display'.contains(keyword.trim());
          }).toList();

    return Column(
      children: [
        Padding(
          padding: EdgeInsets.fromLTRB(pagePadding(context), 0, pagePadding(context), 12),
          child: SearchField(
            onChanged: (value) => setState(() => keyword = value),
            hintText: context.tr('member.search'),
          ),
        ),
        Expanded(
          child: AsyncListView(
            loading: loading,
            error: error,
            emptyText: context.tr('member.empty'),
            onRefresh: _load,
            children: [
              for (final member in visible) _memberCard(member, canManage),
            ],
          ),
        ),
      ],
    );
  }

  Widget _memberCard(Map<String, dynamic> member, bool canManage) {
    final user = member['user'] as Map? ?? const {};
    final displayName = user['displayName']?.toString() ?? '—';
    final account = member['account']?.toString() ?? '—';
    final status = member['status']?.toString() ?? '';
    final roles = roleNames(member['roles']);

    return Padding(
      padding: const EdgeInsets.only(bottom: 10),
      child: Material(
        color: Colors.white,
        borderRadius: BorderRadius.circular(17),
        clipBehavior: Clip.antiAlias,
        child: ListTile(
          contentPadding:
              const EdgeInsets.symmetric(horizontal: 14, vertical: 6),
          leading: CircleAvatar(
            backgroundColor: const Color(0xff5a61ff),
            child: Text(
                displayName.isNotEmpty ? displayName.characters.first : '?',
                style: const TextStyle(
                    color: Colors.white, fontWeight: FontWeight.w600)),
          ),
          title: Row(children: [
            Flexible(
                child: Text(displayName,
                    overflow: TextOverflow.ellipsis,
                    style: const TextStyle(fontWeight: FontWeight.w600))),
            if (status != 'ACTIVE') ...[
              const SizedBox(width: 8),
              _StatusBadge(status: status),
            ],
          ]),
          subtitle: Text(
              '$account${roles.isEmpty ? '' : ' · ${roles.join('、')}'}',
              maxLines: 1,
              overflow: TextOverflow.ellipsis),
          trailing: canManage
              ? const Icon(Icons.chevron_right_rounded,
                  color: Color(0xff9ca4b4))
              : null,
          onTap: canManage ? () => _showMemberDetail(member) : null,
        ),
      ),
    );
  }

  Future<void> _showMemberDetail(Map<String, dynamic> member) async {
    Map<String, dynamic> detail = member;
    try {
      detail = await ref.read(mobileApiProvider).getMember(member['id'] as String);
    } catch (_) {
      // 详情接口失败时回退到列表数据
    }
    if (!mounted) return;

    final identity = ref.read(authControllerProvider).value;
    final action = await showModalBottomSheet<String>(
      context: context,
      isScrollControlled: true,
      shape: const RoundedRectangleBorder(
          borderRadius: BorderRadius.vertical(top: Radius.circular(24))),
      builder: (context) => _MemberDetailSheet(member: detail, identity: identity),
    );
    if (!mounted || action == null) return;

    switch (action) {
      case 'department':
        await _assignDepartment(detail);
      case 'editName':
        await _editMemberName(detail);
      case 'toggleStatus':
        await _toggleMemberStatus(detail);
      case 'roles':
        await _assignMemberRoles(detail);
      case 'account':
        await _changeMemberAccount(detail);
      case 'credential':
        await _resetMemberCredential(detail);
      case 'remove':
        await _removeMember(detail);
    }
  }

  Future<void> _assignDepartment(Map<String, dynamic> member) async {
    final departments = await ref.read(mobileApiProvider).departments();
    if (!mounted) return;
    final selectedDepartment = await showModalBottomSheet<String>(
      context: context,
      isScrollControlled: true,
      shape: const RoundedRectangleBorder(
          borderRadius: BorderRadius.vertical(top: Radius.circular(24))),
      builder: (context) =>
          _AssignDepartmentSheet(member: member, departments: departments),
    );
    if (selectedDepartment == null) return;
    final version = (member['version'] as num?)?.toInt() ?? 0;
    try {
      await ref.read(mobileApiProvider).assignMemberDepartment(
          member['id'] as String,
          selectedDepartment.isEmpty ? null : selectedDepartment,
          version);
      if (mounted) {
        ScaffoldMessenger.of(context).showSnackBar(
            SnackBar(content: Text(context.tr('member.departmentUpdated'))));
      }
      await _load();
    } catch (e) {
      if (mounted) {
        ScaffoldMessenger.of(context)
            .showSnackBar(SnackBar(content: Text(apiErrorMessage(e))));
      }
    }
  }

  Future<void> _editMemberName(Map<String, dynamic> member) async {
    final user = member['user'] as Map? ?? const {};
    final controller = TextEditingController(
        text: user['displayName']?.toString() ?? '');
    final name = await showDialog<String>(
      context: context,
      builder: (context) => AlertDialog(
        title: Text(context.tr('member.editName')),
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
    controller.dispose();
    if (name == null || name.trim().isEmpty) return;
    await _updateMember(member, {'displayName': name.trim()});
  }

  Future<void> _toggleMemberStatus(Map<String, dynamic> member) async {
    final isActive = member['status'] == 'ACTIVE';
    final confirmed = await showDialog<bool>(
      context: context,
      builder: (context) => AlertDialog(
        title: Text(isActive
            ? context.tr('member.disable')
            : context.tr('member.enable')),
        content: Text(isActive
            ? '${context.tr('member.disable')} ${(member['user'] as Map?)?['displayName'] ?? ''}?'
            : '${context.tr('member.enable')} ${(member['user'] as Map?)?['displayName'] ?? ''}?'),
        actions: [
          TextButton(
              onPressed: () => Navigator.pop(context, false),
              child: Text(context.tr('common.cancel'))),
          FilledButton(
              onPressed: () => Navigator.pop(context, true),
              child: Text(context.tr('common.confirm'))),
        ],
      ),
    );
    if (confirmed != true) return;
    await _updateMember(member, {'status': isActive ? 'DISABLED' : 'ACTIVE'});
  }

  Future<void> _updateMember(
      Map<String, dynamic> member, Map<String, dynamic> input) async {
    final version = (member['version'] as num?)?.toInt() ?? 0;
    try {
      await ref.read(mobileApiProvider).updateMember(
          member['id'] as String, {...input, 'version': version});
      if (mounted) {
        ScaffoldMessenger.of(context)
            .showSnackBar(SnackBar(content: Text(context.tr('member.updated'))));
      }
      await _load();
    } catch (e) {
      if (mounted) {
        ScaffoldMessenger.of(context)
            .showSnackBar(SnackBar(content: Text(apiErrorMessage(e))));
      }
    }
  }

  Future<void> _assignMemberRoles(Map<String, dynamic> member) async {
    try {
      final roles = await ref.read(mobileApiProvider).roles();
      if (!mounted) return;
      final current = (member['roles'] as List<dynamic>? ?? const [])
          .map((r) => r is Map ? r['id']?.toString() : null)
          .whereType<String>()
          .toSet();
      final selected = await showModalBottomSheet<Set<String>>(
        context: context,
        isScrollControlled: true,
        shape: const RoundedRectangleBorder(
            borderRadius: BorderRadius.vertical(top: Radius.circular(24))),
        builder: (context) => _RoleSelectSheet(roles: roles, initiallySelected: current),
      );
      if (selected == null) return;
      final version = (member['version'] as num?)?.toInt() ?? 0;
      await ref
          .read(mobileApiProvider)
          .replaceMemberRoles(member['id'] as String, selected.toList(), version);
      if (mounted) {
        ScaffoldMessenger.of(context).showSnackBar(
            SnackBar(content: Text(context.tr('member.rolesUpdated'))));
      }
      await _load();
    } catch (e) {
      if (mounted) {
        ScaffoldMessenger.of(context)
            .showSnackBar(SnackBar(content: Text(apiErrorMessage(e))));
      }
    }
  }

  Future<void> _changeMemberAccount(Map<String, dynamic> member) async {
    final controller =
        TextEditingController(text: member['account']?.toString() ?? '');
    final account = await showDialog<String>(
      context: context,
      builder: (context) => AlertDialog(
        title: Text(context.tr('member.changeAccount')),
        content: TextField(
            controller: controller,
            autofocus: true,
            decoration:
                InputDecoration(labelText: context.tr('member.newAccount'))),
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
    controller.dispose();
    if (account == null || account.trim().isEmpty) return;
    final version = (member['version'] as num?)?.toInt() ?? 0;
    try {
      await ref.read(mobileApiProvider).updateMemberAccount(
          member['id'] as String, account, version);
      if (mounted) {
        ScaffoldMessenger.of(context).showSnackBar(
            SnackBar(content: Text(context.tr('member.accountUpdated'))));
      }
      await _load();
    } catch (e) {
      if (mounted) {
        ScaffoldMessenger.of(context)
            .showSnackBar(SnackBar(content: Text(apiErrorMessage(e))));
      }
    }
  }

  Future<void> _resetMemberCredential(Map<String, dynamic> member) async {
    final confirmed = await showDialog<bool>(
      context: context,
      builder: (context) => AlertDialog(
        title: Text(context.tr('member.resetCredential')),
        content: Text(
            '${context.tr('member.resetCredential')} ${(member['user'] as Map?)?['displayName'] ?? ''}?'),
        actions: [
          TextButton(
              onPressed: () => Navigator.pop(context, false),
              child: Text(context.tr('common.cancel'))),
          FilledButton(
              onPressed: () => Navigator.pop(context, true),
              child: Text(context.tr('common.confirm'))),
        ],
      ),
    );
    if (confirmed != true) return;
    try {
      final created = await ref
          .read(mobileApiProvider)
          .resetMemberCredential(member['id'] as String);
      if (!mounted) return;
      final token = created['invitationToken']?.toString();
      if (token != null && token.isNotEmpty) {
        await _showToken(created['account']?.toString() ?? '', token);
      }
      await _load();
    } catch (e) {
      if (mounted) {
        ScaffoldMessenger.of(context)
            .showSnackBar(SnackBar(content: Text(apiErrorMessage(e))));
      }
    }
  }

  Future<void> _removeMember(Map<String, dynamic> member) async {
    final confirmed = await showDialog<bool>(
      context: context,
      builder: (context) => AlertDialog(
        title: Text(context.tr('member.remove')),
        content: Text(context.tr('member.removeConfirm')),
        actions: [
          TextButton(
              onPressed: () => Navigator.pop(context, false),
              child: Text(context.tr('common.cancel'))),
          FilledButton(
              onPressed: () => Navigator.pop(context, true),
              style: FilledButton.styleFrom(backgroundColor: const Color(0xffff4555)),
              child: Text(context.tr('member.remove'))),
        ],
      ),
    );
    if (confirmed != true) return;
    try {
      await ref
          .read(mobileApiProvider)
          .removeMember(member['id'] as String);
      if (mounted) {
        ScaffoldMessenger.of(context)
            .showSnackBar(SnackBar(content: Text(context.tr('member.removed'))));
      }
      await _load();
    } catch (e) {
      if (mounted) {
        ScaffoldMessenger.of(context)
            .showSnackBar(SnackBar(content: Text(apiErrorMessage(e))));
      }
    }
  }

  Future<void> _showToken(String account, String token) async {
    await showDialog<void>(
      context: context,
      builder: (context) => AlertDialog(
        title: Text(context.tr('member.resetCredential')),
        content: Column(
          mainAxisSize: MainAxisSize.min,
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Text(context.tr('member.resetDesc')),
            const SizedBox(height: 12),
            SelectableText('账号：$account\n激活令牌：$token',
                style: const TextStyle(fontWeight: FontWeight.w600)),
            const SizedBox(height: 8),
            OutlinedButton.icon(
              icon: const Icon(Icons.copy_rounded, size: 16),
              label: Text(context.tr('member.copy')),
              onPressed: () async {
                await Clipboard.setData(ClipboardData(text: token));
                if (context.mounted) {
                  ScaffoldMessenger.of(context).showSnackBar(
                      SnackBar(content: Text(context.tr('member.copied'))));
                }
              },
            ),
          ],
        ),
        actions: [
          FilledButton(
              onPressed: () => Navigator.pop(context),
              child: Text(context.tr('member.gotIt'))),
        ],
      ),
    );
  }
}

class _MemberDetailSheet extends StatelessWidget {
  const _MemberDetailSheet({required this.member, required this.identity});
  final Map<String, dynamic> member;
  final AuthIdentity? identity;

  @override
  Widget build(BuildContext context) {
    final user = member['user'] as Map? ?? const {};
    final displayName = user['displayName']?.toString() ?? '—';
    final account = member['account']?.toString() ?? '—';
    final status = member['status']?.toString() ?? '';
    final roles = roleNames(member['roles']);

    final canUpdate = hasPermission(identity, 'member.update');
    final canAssignDept = hasPermission(identity, 'department.member.assign');
    final canAssignRole = hasPermission(identity, 'role.assign');
    final canAccountUpdate = hasPermission(identity, 'member.account.update');
    final canCredentialReset = hasPermission(identity, 'member.credential.reset');
    final canRemove = hasPermission(identity, 'member.remove');

    return SafeArea(
      child: Column(
        mainAxisSize: MainAxisSize.min,
        children: [
          Padding(
            padding: const EdgeInsets.fromLTRB(20, 18, 20, 12),
            child: Row(
              children: [
                CircleAvatar(
                  backgroundColor: const Color(0xff5a61ff),
                  child: Text(
                      displayName.isNotEmpty ? displayName.characters.first : '?',
                      style: const TextStyle(
                          color: Colors.white, fontWeight: FontWeight.w600)),
                ),
                const SizedBox(width: 12),
                Expanded(
                  child: Column(
                    crossAxisAlignment: CrossAxisAlignment.start,
                    children: [
                      Row(children: [
                        Flexible(
                            child: Text(displayName,
                                overflow: TextOverflow.ellipsis,
                                style: const TextStyle(
                                    fontSize: 18, fontWeight: FontWeight.w700))),
                        if (status != 'ACTIVE') ...[
                          const SizedBox(width: 8),
                          _StatusBadge(status: status),
                        ],
                      ]),
                      Text(account,
                          style: const TextStyle(
                              color: Color(0xff7f8898), fontSize: 12)),
                    ],
                  ),
                ),
              ],
            ),
          ),
          if (roles.isNotEmpty)
            Padding(
              padding: const EdgeInsets.fromLTRB(20, 0, 20, 8),
              child: Align(
                alignment: Alignment.centerLeft,
                child: Text(context.tr('profile.roles'),
                    style: const TextStyle(
                        color: Color(0xff737c8d), fontSize: 12)),
              ),
            ),
          if (canAssignDept)
            _sheetAction(context, 'department', Icons.apartment_outlined, context.tr('member.adjustDepartment')),
          if (canUpdate)
            _sheetAction(context, 'editName', Icons.badge_outlined, context.tr('member.editName')),
          if (canUpdate)
            _sheetAction(context, 'toggleStatus', Icons.block_outlined,
                status == 'ACTIVE' ? context.tr('member.disable') : context.tr('member.enable')),
          if (canAssignRole)
            _sheetAction(context, 'roles', Icons.shield_outlined, context.tr('member.assignRoles')),
          if (canAccountUpdate)
            _sheetAction(context, 'account', Icons.alternate_email, context.tr('member.changeAccount')),
          if (canCredentialReset)
            _sheetAction(context, 'credential', Icons.key_outlined, context.tr('member.resetCredential')),
          if (canRemove)
            _sheetAction(context, 'remove', Icons.delete_outline, context.tr('member.remove'), destructive: true),
        ],
      ),
    );
  }

  Widget _sheetAction(
      BuildContext context, String value, IconData icon, String label,
      {bool destructive = false}) {
    final color = destructive ? const Color(0xffff4555) : const Color(0xff4e5969);
    return ListTile(
      leading: Icon(icon, color: color),
      title: Text(label, style: TextStyle(color: destructive ? color : null)),
      onTap: () => Navigator.pop(context, value),
    );
  }
}

class _AssignDepartmentSheet extends StatefulWidget {
  const _AssignDepartmentSheet(
      {required this.member, required this.departments});
  final Map<String, dynamic> member;
  final List<Map<String, dynamic>> departments;

  @override
  State<_AssignDepartmentSheet> createState() => _AssignDepartmentSheetState();
}

class _AssignDepartmentSheetState extends State<_AssignDepartmentSheet> {
  late String selected = widget.member['departmentId']?.toString() ?? '';

  List<_FlatDept> _flatten(List<Map<String, dynamic>> nodes, int depth) {
    final result = <_FlatDept>[];
    for (final node in nodes) {
      result.add(_FlatDept(node, depth));
      final children = (node['children'] as List<dynamic>? ?? const [])
          .cast<Map<String, dynamic>>();
      result.addAll(_flatten(children, depth + 1));
    }
    return result;
  }

  @override
  Widget build(BuildContext context) {
    final flat = _flatten(widget.departments, 0);
    return SafeArea(
      child: Padding(
        // 底部弹窗未包 `SafeArea` 主体，必须让出键盘高度或 Home Indicator。
        padding: EdgeInsets.only(bottom: keyboardBottomInset(context)),
        child: Column(
          mainAxisSize: MainAxisSize.min,
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Padding(
              padding: const EdgeInsets.fromLTRB(20, 18, 20, 8),
              child: Text(context.tr('member.adjustDepartment'),
                  style: const TextStyle(
                      fontSize: 18, fontWeight: FontWeight.w700)),
            ),
            Flexible(
              child: ListView(
                shrinkWrap: true,
                children: [
                  _selectableTile(context, label: context.tr('profile.unassigned'), value: ''),
                  for (final dept in flat)
                    _selectableTile(context,
                        label:
                            '${'　' * dept.depth}${dept.node['name']}',
                        value: dept.node['id'] as String),
                ],
              ),
            ),
            Padding(
              padding: const EdgeInsets.fromLTRB(20, 8, 20, 16),
              child: SizedBox(
                width: double.infinity,
                child: FilledButton(
                    onPressed: () => Navigator.pop(context, selected),
                    child: Text(context.tr('common.confirm'))),
              ),
            ),
          ],
        ),
      ),
    );
  }

  Widget _selectableTile(BuildContext context,
      {required String label, required String value}) {
    final isSelected = selected == value;
    return ListTile(
      title: Text(label),
      trailing: Icon(
          isSelected ? Icons.radio_button_checked : Icons.radio_button_off,
          color: isSelected ? const Color(0xff3478ff) : const Color(0xff9ca4b4)),
      onTap: () => setState(() => selected = value),
    );
  }
}

class _RoleSelectSheet extends StatefulWidget {
  const _RoleSelectSheet(
      {required this.roles, required this.initiallySelected});
  final List<Map<String, dynamic>> roles;
  final Set<String> initiallySelected;

  @override
  State<_RoleSelectSheet> createState() => _RoleSelectSheetState();
}

class _RoleSelectSheetState extends State<_RoleSelectSheet> {
  late final Set<String> selected = {...widget.initiallySelected};

  @override
  Widget build(BuildContext context) {
    return SafeArea(
      child: Column(
        mainAxisSize: MainAxisSize.min,
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Padding(
            padding: const EdgeInsets.fromLTRB(20, 18, 20, 4),
            child: Text(context.tr('member.assignRoles'),
                style: const TextStyle(
                    fontSize: 18, fontWeight: FontWeight.w700)),
          ),
          Flexible(
            child: ListView(
              shrinkWrap: true,
              children: [
                for (final role in widget.roles)
                  CheckboxListTile(
                    dense: true,
                    title: Text(role['name']?.toString() ?? ''),
                    subtitle: Text(role['code']?.toString() ?? ''),
                    value: selected.contains(role['id'] as String),
                    onChanged: (v) => setState(() {
                      if (v == true) {
                        selected.add(role['id'] as String);
                      } else {
                        selected.remove(role['id'] as String);
                      }
                    }),
                  ),
              ],
            ),
          ),
          Padding(
            padding: const EdgeInsets.fromLTRB(20, 8, 20, 16),
            child: SizedBox(
              width: double.infinity,
              child: FilledButton(
                  onPressed: () => Navigator.pop(context, selected),
                  child: Text(context.tr('common.confirm'))),
            ),
          ),
        ],
      ),
    );
  }
}

class _FlatDept {
  const _FlatDept(this.node, this.depth);
  final Map<String, dynamic> node;
  final int depth;
}

class _StatusBadge extends StatelessWidget {
  const _StatusBadge({required this.status});
  final String status;

  @override
  Widget build(BuildContext context) {
    final (key, color) = switch (status) {
      'ACTIVE' => ('status.active', const Color(0xff20bd6b)),
      'PENDING_ACTIVATION' => ('status.pending', const Color(0xffffa000)),
      'DISABLED' => ('status.disabled', const Color(0xff9ca4b4)),
      _ => ('status.disabled', const Color(0xff9ca4b4)),
    };
    return Container(
      padding: const EdgeInsets.symmetric(horizontal: 7, vertical: 2),
      decoration: BoxDecoration(
          color: color.withValues(alpha: .12),
          borderRadius: BorderRadius.circular(8)),
      child: Text(context.tr(key),
          style: TextStyle(color: color, fontSize: 10, fontWeight: FontWeight.w600)),
    );
  }
}
