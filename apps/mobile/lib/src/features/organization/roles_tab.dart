import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../core/auth_controller.dart';
import '../../core/l10n.dart';
import '../../core/mobile_api.dart';
import '../../shared/async_list_view.dart';
import '../../shared/layout.dart';

const _dataScopes = ['SELF', 'DEPARTMENT', 'DEPARTMENT_TREE', 'PROJECT', 'CUSTOM', 'TENANT'];

class RolesTab extends ConsumerStatefulWidget {
  const RolesTab({super.key});

  @override
  ConsumerState<RolesTab> createState() => _RolesTabState();
}

class _RolesTabState extends ConsumerState<RolesTab> {
  List<Map<String, dynamic>> items = [];
  bool loading = true;
  String? error;

  @override
  void initState() {
    super.initState();
    _load();
  }

  Future<void> _load() async {
    try {
      final data = await ref.read(mobileApiProvider).roles();
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
    final canCreate = hasPermission(identity, 'role.create');

    return Column(
      children: [
        Padding(
          padding: EdgeInsets.fromLTRB(pagePadding(context), 0, pagePadding(context), 12),
          child: Row(
            children: [
              Expanded(
                  child: Text(context.tr('role.subtitle'),
                      style: const TextStyle(
                          color: Color(0xff737c8d), fontSize: 12))),
              if (canCreate)
                FilledButton.tonalIcon(
                    onPressed: _create,
                    icon: const Icon(Icons.add_rounded, size: 18),
                    label: Text(context.tr('role.create'))),
            ],
          ),
        ),
        Expanded(
          child: AsyncListView(
            loading: loading,
            error: error,
            emptyText: context.tr('role.empty'),
            onRefresh: _load,
            children: [
              for (final role in items) _roleCard(role),
            ],
          ),
        ),
      ],
    );
  }

  Widget _roleCard(Map<String, dynamic> role) {
    final name = role['name']?.toString() ?? '—';
    final code = role['code']?.toString() ?? '';
    final isSystem = role['isSystem'] == true;
    final memberCount = (role['memberCount'] as num?)?.toInt() ?? 0;
    final dataScope = role['dataScope']?.toString() ?? '';

    return Padding(
      padding: const EdgeInsets.only(bottom: 10),
      child: Material(
        color: Colors.white,
        borderRadius: BorderRadius.circular(17),
        clipBehavior: Clip.antiAlias,
        child: ListTile(
          contentPadding:
              const EdgeInsets.symmetric(horizontal: 14, vertical: 6),
          leading: Container(
            width: 40,
            height: 40,
            alignment: Alignment.center,
            decoration: BoxDecoration(
                color: const Color(0xff8b4dff).withValues(alpha: .1),
                borderRadius: BorderRadius.circular(11)),
            child: const Icon(Icons.badge_outlined, color: Color(0xff8b4dff)),
          ),
          title: Row(children: [
            Flexible(
                child: Text(name,
                    overflow: TextOverflow.ellipsis,
                    style: const TextStyle(fontWeight: FontWeight.w600))),
            if (isSystem) ...[
              const SizedBox(width: 8),
              Container(
                padding:
                    const EdgeInsets.symmetric(horizontal: 7, vertical: 2),
                decoration: BoxDecoration(
                    color: const Color(0xff3478ff).withValues(alpha: .12),
                    borderRadius: BorderRadius.circular(8)),
                child: Text(context.tr('role.system'),
                    style: const TextStyle(
                        color: Color(0xff3478ff),
                        fontSize: 10,
                        fontWeight: FontWeight.w600)),
              ),
            ],
          ]),
          subtitle: Text(
              '$code · $memberCount ${context.tr('dept.members')} · $dataScope',
              maxLines: 1,
              overflow: TextOverflow.ellipsis),
          trailing: const Icon(Icons.chevron_right_rounded,
              color: Color(0xff9ca4b4)),
          onTap: () => _showActions(role),
        ),
      ),
    );
  }

  Future<void> _showActions(Map<String, dynamic> role) async {
    final identity = ref.read(authControllerProvider).value;
    final canUpdate = hasPermission(identity, 'role.update');
    final canDelete = hasPermission(identity, 'role.delete');
    final isSystem = role['isSystem'] == true;
    final name = role['name']?.toString() ?? '';
    final action = await showModalBottomSheet<String>(
      context: context,
      shape: const RoundedRectangleBorder(
          borderRadius: BorderRadius.vertical(top: Radius.circular(24))),
      builder: (context) => SafeArea(
        child: Column(
          mainAxisSize: MainAxisSize.min,
          children: [
            Padding(
              padding: const EdgeInsets.fromLTRB(20, 18, 20, 8),
              child: Text(name,
                  style: const TextStyle(
                      fontSize: 18, fontWeight: FontWeight.w700)),
            ),
            if (canUpdate)
              ListTile(
                  leading: const Icon(Icons.edit_outlined),
                  title: Text(context.tr('common.edit')),
                  onTap: () => Navigator.pop(context, 'edit')),
            if (canUpdate)
              ListTile(
                  leading: const Icon(Icons.shield_outlined),
                  title: Text(context.tr('role.permissions')),
                  onTap: () => Navigator.pop(context, 'permissions')),
            if (canDelete && !isSystem)
              ListTile(
                  leading: const Icon(Icons.delete_outline,
                      color: Color(0xffff4555)),
                  title: Text(context.tr('common.delete'),
                      style: const TextStyle(color: Color(0xffff4555))),
                  onTap: () => Navigator.pop(context, 'delete')),
          ],
        ),
      ),
    );
    if (!mounted || action == null) return;
    switch (action) {
      case 'edit':
        await _edit(role);
      case 'permissions':
        await _editPermissions(role);
      case 'delete':
        await _delete(role);
    }
  }

  Future<void> _create() async {
    final controller = _RoleFormController();
    final result = await showDialog<_RoleFormResult>(
      context: context,
      builder: (context) => _RoleFormDialog(
          controller: controller, title: context.tr('role.create')),
    );
    if (result == null) return;
    try {
      await ref.read(mobileApiProvider).createRole({
        'code': result.code.trim().toLowerCase(),
        'name': result.name.trim(),
        'description': result.description?.trim().isEmpty == true
            ? null
            : result.description?.trim(),
        'dataScope': result.dataScope,
      });
      if (mounted) {
        ScaffoldMessenger.of(context)
            .showSnackBar(SnackBar(content: Text(context.tr('role.created'))));
      }
      await _load();
    } catch (e) {
      if (mounted) {
        ScaffoldMessenger.of(context)
            .showSnackBar(SnackBar(content: Text(apiErrorMessage(e))));
      }
    }
  }

  Future<void> _edit(Map<String, dynamic> role) async {
    final controller = _RoleFormController(
      code: role['code']?.toString() ?? '',
      name: role['name']?.toString() ?? '',
      description: role['description']?.toString(),
      dataScope: role['dataScope']?.toString() ?? 'SELF',
    );
    final result = await showDialog<_RoleFormResult>(
      context: context,
      builder: (context) => _RoleFormDialog(
          controller: controller,
          title: context.tr('common.edit'),
          editableCode: false),
    );
    if (result == null) return;
    final version = (role['version'] as num?)?.toInt() ?? 0;
    try {
      await ref.read(mobileApiProvider).updateRole(role['id'] as String, {
        'name': result.name.trim(),
        'description': result.description?.trim().isEmpty == true
            ? null
            : result.description?.trim(),
        'dataScope': result.dataScope,
        'version': version,
      });
      if (mounted) {
        ScaffoldMessenger.of(context)
            .showSnackBar(SnackBar(content: Text(context.tr('role.updated'))));
      }
      await _load();
    } catch (e) {
      if (mounted) {
        ScaffoldMessenger.of(context)
            .showSnackBar(SnackBar(content: Text(apiErrorMessage(e))));
      }
    }
  }

  Future<void> _editPermissions(Map<String, dynamic> role) async {
    try {
      final allPermissions = await ref.read(mobileApiProvider).permissions();
      if (!mounted) return;
      final current = (role['permissions'] as List<dynamic>? ?? const [])
          .map((p) => (p as Map)['id'] as String)
          .toSet();
      final selected = await showModalBottomSheet<Set<String>>(
        context: context,
        isScrollControlled: true,
        shape: const RoundedRectangleBorder(
            borderRadius: BorderRadius.vertical(top: Radius.circular(24))),
        builder: (context) => _PermissionSheet(
            permissions: allPermissions, initiallySelected: current),
      );
      if (selected == null) return;
      final version = (role['version'] as num?)?.toInt() ?? 0;
      await ref
          .read(mobileApiProvider)
          .replaceRolePermissions(role['id'] as String, selected.toList(), version);
      if (mounted) {
        ScaffoldMessenger.of(context).showSnackBar(
            SnackBar(content: Text(context.tr('role.permissionsUpdated'))));
      }
      await _load();
    } catch (e) {
      if (mounted) {
        ScaffoldMessenger.of(context)
            .showSnackBar(SnackBar(content: Text(apiErrorMessage(e))));
      }
    }
  }

  Future<void> _delete(Map<String, dynamic> role) async {
    final confirmed = await showDialog<bool>(
      context: context,
      builder: (context) => AlertDialog(
        title: Text(context.tr('common.delete')),
        content: Text('「${role['name']}」 ${context.tr('role.deleteConfirm')}'),
        actions: [
          TextButton(
              onPressed: () => Navigator.pop(context, false),
              child: Text(context.tr('common.cancel'))),
          FilledButton(
              onPressed: () => Navigator.pop(context, true),
              style:
                  FilledButton.styleFrom(backgroundColor: const Color(0xffff4555)),
              child: Text(context.tr('common.delete'))),
        ],
      ),
    );
    if (confirmed != true) return;
    final version = (role['version'] as num?)?.toInt() ?? 0;
    try {
      await ref
          .read(mobileApiProvider)
          .deleteRole(role['id'] as String, version);
      if (mounted) {
        ScaffoldMessenger.of(context)
            .showSnackBar(SnackBar(content: Text(context.tr('role.deleted'))));
      }
      await _load();
    } catch (e) {
      if (mounted) {
        ScaffoldMessenger.of(context)
            .showSnackBar(SnackBar(content: Text(apiErrorMessage(e))));
      }
    }
  }
}

class _RoleFormController {
  _RoleFormController({this.code = '', this.name = '', this.description, this.dataScope = 'SELF'});
  final String code;
  final String name;
  final String? description;
  final String dataScope;
}

class _RoleFormResult {
  const _RoleFormResult({required this.code, required this.name, required this.description, required this.dataScope});
  final String code;
  final String name;
  final String? description;
  final String dataScope;
}

class _RoleFormDialog extends StatefulWidget {
  const _RoleFormDialog({required this.controller, required this.title, this.editableCode = true});
  final _RoleFormController controller;
  final String title;
  final bool editableCode;

  @override
  State<_RoleFormDialog> createState() => _RoleFormDialogState();
}

class _RoleFormDialogState extends State<_RoleFormDialog> {
  late final code = TextEditingController(text: widget.controller.code);
  late final name = TextEditingController(text: widget.controller.name);
  late final description =
      TextEditingController(text: widget.controller.description ?? '');
  late String dataScope = widget.controller.dataScope;

  @override
  void dispose() {
    code.dispose();
    name.dispose();
    description.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) => AlertDialog(
        title: Text(widget.title),
        content: SingleChildScrollView(
          child: Column(
            mainAxisSize: MainAxisSize.min,
            children: [
              TextField(
                  controller: code,
                  enabled: widget.editableCode,
                  decoration:
                      InputDecoration(labelText: context.tr('role.code'))),
              const SizedBox(height: 10),
              TextField(
                  controller: name,
                  decoration:
                      InputDecoration(labelText: context.tr('role.name'))),
              const SizedBox(height: 10),
              TextField(
                  controller: description,
                  decoration:
                      InputDecoration(labelText: context.tr('role.description'))),
              const SizedBox(height: 10),
              DropdownButtonFormField<String>(
                initialValue: dataScope,
                decoration:
                    InputDecoration(labelText: context.tr('role.dataScope')),
                items: [
                  for (final s in _dataScopes) DropdownMenuItem(value: s, child: Text(s))
                ],
                onChanged: (v) => setState(() => dataScope = v!),
              ),
            ],
          ),
        ),
        actions: [
          TextButton(
              onPressed: () => Navigator.pop(context),
              child: Text(context.tr('common.cancel'))),
          FilledButton(
            onPressed: () {
              if (name.text.trim().isEmpty ||
                  (widget.editableCode && code.text.trim().isEmpty)) {
                ScaffoldMessenger.of(context).showSnackBar(
                    SnackBar(content: Text(context.tr('role.fillRequired'))));
                return;
              }
              Navigator.pop(
                  context,
                  _RoleFormResult(
                      code: code.text,
                      name: name.text,
                      description: description.text,
                      dataScope: dataScope));
            },
            child: Text(context.tr('common.save')),
          ),
        ],
      );
}

class _PermissionSheet extends StatefulWidget {
  const _PermissionSheet({required this.permissions, required this.initiallySelected});
  final List<Map<String, dynamic>> permissions;
  final Set<String> initiallySelected;

  @override
  State<_PermissionSheet> createState() => _PermissionSheetState();
}

class _PermissionSheetState extends State<_PermissionSheet> {
  late final Set<String> selected = {...widget.initiallySelected};

  @override
  Widget build(BuildContext context) {
    final grouped = <String, List<Map<String, dynamic>>>{};
    for (final p in widget.permissions) {
      final code = p['code']?.toString() ?? '';
      final group = code.contains('.') ? code.split('.').first : 'other';
      grouped.putIfAbsent(group, () => []).add(p);
    }
    return SafeArea(
      child: Column(
        mainAxisSize: MainAxisSize.min,
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Padding(
            padding: const EdgeInsets.fromLTRB(20, 18, 20, 4),
            child: Row(children: [
              Expanded(
                  child: Text(context.tr('role.permissions'),
                      style: const TextStyle(
                          fontSize: 18, fontWeight: FontWeight.w700))),
              Text('${selected.length}',
                  style: const TextStyle(color: Color(0xff737c8d))),
            ]),
          ),
          Flexible(
            child: ListView(
              shrinkWrap: true,
              children: [
                for (final entry in grouped.entries) ...[
                  Padding(
                    padding: const EdgeInsets.fromLTRB(20, 12, 20, 4),
                    child: Text(entry.key,
                        style: const TextStyle(
                            color: Color(0xff3478ff),
                            fontWeight: FontWeight.w700,
                            fontSize: 13)),
                  ),
                  for (final p in entry.value)
                    CheckboxListTile(
                      dense: true,
                      title: Text(p['name']?.toString() ?? ''),
                      subtitle: Text(p['code']?.toString() ?? ''),
                      value: selected.contains(p['id'] as String),
                      onChanged: (v) => setState(() {
                        if (v == true) {
                          selected.add(p['id'] as String);
                        } else {
                          selected.remove(p['id'] as String);
                        }
                      }),
                    ),
                ],
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
