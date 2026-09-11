import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../core/auth_controller.dart';
import '../../core/l10n.dart';
import '../../core/mobile_api.dart';
import '../../shared/async_list_view.dart';

class DepartmentsTab extends ConsumerStatefulWidget {
  const DepartmentsTab({super.key});

  @override
  ConsumerState<DepartmentsTab> createState() => _DepartmentsTabState();
}

class _DepartmentsTabState extends ConsumerState<DepartmentsTab> {
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
      final data = await ref.read(mobileApiProvider).departments();
      if (mounted) setState(() => items = data);
    } catch (e) {
      if (mounted) setState(() => error = apiErrorMessage(e));
    } finally {
      if (mounted) setState(() => loading = false);
    }
  }

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
    final identity = ref.watch(authControllerProvider).value;
    final canCreate = hasPermission(identity, 'department.create');
    final flat = _flatten(items, 0);

    return Column(
      children: [
        Padding(
          padding: const EdgeInsets.fromLTRB(16, 0, 16, 12),
          child: Row(
            children: [
              Expanded(
                  child: Text(context.tr('dept.subtitle'),
                      style: const TextStyle(
                          color: Color(0xff737c8d), fontSize: 12))),
              if (canCreate)
                FilledButton.tonalIcon(
                    onPressed: _create,
                    icon: const Icon(Icons.add_rounded, size: 18),
                    label: Text(context.tr('dept.create'))),
            ],
          ),
        ),
        Expanded(
          child: AsyncListView(
            loading: loading,
            error: error,
            emptyText: context.tr('dept.empty'),
            onRefresh: _load,
            children: [
              for (final dept in flat) _departmentCard(dept),
            ],
          ),
        ),
      ],
    );
  }

  Widget _departmentCard(_FlatDept dept) {
    final node = dept.node;
    final name = node['name']?.toString() ?? '—';
    final memberCount = (node['memberCount'] as num?)?.toInt() ?? 0;
    final disabled = node['status'] == 'DISABLED';

    return Padding(
      padding: EdgeInsets.only(left: dept.depth * 20.0, bottom: 10),
      child: Material(
        color: Colors.white,
        borderRadius: BorderRadius.circular(17),
        clipBehavior: Clip.antiAlias,
        child: ListTile(
          contentPadding:
              const EdgeInsets.symmetric(horizontal: 14, vertical: 4),
          leading: Container(
            width: 40,
            height: 40,
            decoration: BoxDecoration(
                color: const Color(0xff3478ff).withValues(alpha: .1),
                borderRadius: BorderRadius.circular(11)),
            child: Icon(Icons.grid_view_outlined,
                color: disabled
                    ? const Color(0xff9ca4b4)
                    : const Color(0xff3478ff)),
          ),
          title: Row(children: [
            Flexible(
                child: Text(name,
                    overflow: TextOverflow.ellipsis,
                    style: TextStyle(
                        fontWeight: FontWeight.w600,
                        color: disabled ? const Color(0xff9ca4b4) : null))),
            if (disabled) ...[
              const SizedBox(width: 8),
              Container(
                padding:
                    const EdgeInsets.symmetric(horizontal: 7, vertical: 2),
                decoration: BoxDecoration(
                    color: const Color(0xff9ca4b4).withValues(alpha: .12),
                    borderRadius: BorderRadius.circular(8)),
                child: Text(context.tr('dept.disabled'),
                    style: const TextStyle(
                        color: Color(0xff9ca4b4),
                        fontSize: 10,
                        fontWeight: FontWeight.w600)),
              ),
            ],
          ]),
          subtitle: Text('$memberCount ${context.tr('dept.members')}'),
          trailing: const Icon(Icons.chevron_right_rounded,
              color: Color(0xff9ca4b4)),
          onTap: () => _showActions(node),
        ),
      ),
    );
  }

  Future<void> _showActions(Map<String, dynamic> node) async {
    final identity = ref.read(authControllerProvider).value;
    final canUpdate = hasPermission(identity, 'department.update');
    final canDelete = hasPermission(identity, 'department.delete');
    final name = node['name']?.toString() ?? '';
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
            ListTile(
                leading: const Icon(Icons.group_outlined),
                title: Text(context.tr('dept.viewMembers')),
                onTap: () => Navigator.pop(context, 'members')),
            if (canUpdate)
              ListTile(
                  leading: const Icon(Icons.edit_outlined),
                  title: Text(context.tr('dept.editName')),
                  onTap: () => Navigator.pop(context, 'edit')),
            if (canDelete)
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
      case 'members':
        await _showMembers(node);
      case 'edit':
        await _edit(node);
      case 'delete':
        await _delete(node);
    }
  }

  Future<void> _showMembers(Map<String, dynamic> node) async {
    try {
      final members =
          await ref.read(mobileApiProvider).departmentMembers(node['id'] as String);
      if (!mounted) return;
      await showModalBottomSheet<void>(
        context: context,
        isScrollControlled: true,
        shape: const RoundedRectangleBorder(
            borderRadius: BorderRadius.vertical(top: Radius.circular(24))),
        builder: (context) => DraggableScrollableSheet(
          expand: false,
          initialChildSize: .5,
          maxChildSize: .9,
          builder: (context, scrollController) => ListView(
            controller: scrollController,
            padding: const EdgeInsets.all(16),
            children: [
              Text('${node['name']} · ${context.tr('org.members')}',
                  style: const TextStyle(
                      fontSize: 18, fontWeight: FontWeight.w700)),
              const SizedBox(height: 8),
              if (members.isEmpty)
                Padding(
                    padding: const EdgeInsets.only(top: 40),
                    child: Center(
                        child: Text(context.tr('dept.membersEmpty'),
                            style: const TextStyle(color: Color(0xff8f98a8)))))
              else
                for (final m in members)
                  ListTile(
                    contentPadding: EdgeInsets.zero,
                    leading: CircleAvatar(
                        backgroundColor: const Color(0xff5a61ff),
                        child: Text(
                            ((m['user'] as Map?)?['displayName']
                                            ?.toString()
                                            .isNotEmpty ??
                                        false)
                                    ? (m['user'] as Map)['displayName']
                                        .toString()
                                        .characters
                                        .first
                                    : '?',
                            style: const TextStyle(color: Colors.white))),
                    title: Text(
                        (m['user'] as Map?)?['displayName']?.toString() ?? '—'),
                    subtitle: Text(m['account']?.toString() ?? ''),
                  ),
            ],
          ),
        ),
      );
    } catch (e) {
      if (mounted) {
        ScaffoldMessenger.of(context)
            .showSnackBar(SnackBar(content: Text(apiErrorMessage(e))));
      }
    }
  }

  Future<void> _create() async {
    final controller = TextEditingController();
    final created = await showDialog<Map<String, dynamic>>(
      context: context,
      builder: (context) => AlertDialog(
        title: Text(context.tr('dept.create')),
        content: TextField(
            controller: controller,
            autofocus: true,
            decoration:
                InputDecoration(labelText: context.tr('dept.name'))),
        actions: [
          TextButton(
              onPressed: () => Navigator.pop(context),
              child: Text(context.tr('common.cancel'))),
          FilledButton(
              onPressed: () => Navigator.pop(context, {'name': controller.text}),
              child: Text(context.tr('common.create'))),
        ],
      ),
    );
    controller.dispose();
    if (created == null || created['name']?.toString().trim().isEmpty == true) {
      return;
    }
    try {
      await ref
          .read(mobileApiProvider)
          .createDepartment({'name': created['name'].toString().trim()});
      if (mounted) {
        ScaffoldMessenger.of(context)
            .showSnackBar(SnackBar(content: Text(context.tr('dept.created'))));
      }
      await _load();
    } catch (e) {
      if (mounted) {
        ScaffoldMessenger.of(context)
            .showSnackBar(SnackBar(content: Text(apiErrorMessage(e))));
      }
    }
  }

  Future<void> _edit(Map<String, dynamic> node) async {
    final controller =
        TextEditingController(text: node['name']?.toString() ?? '');
    final name = await showDialog<String>(
      context: context,
      builder: (context) => AlertDialog(
        title: Text(context.tr('dept.editName')),
        content: TextField(
            controller: controller,
            autofocus: true,
            decoration:
                InputDecoration(labelText: context.tr('dept.name'))),
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
    final version = (node['version'] as num?)?.toInt() ?? 0;
    try {
      await ref.read(mobileApiProvider).updateDepartment(
          node['id'] as String, {'name': name.trim(), 'version': version});
      if (mounted) {
        ScaffoldMessenger.of(context)
            .showSnackBar(SnackBar(content: Text(context.tr('dept.updated'))));
      }
      await _load();
    } catch (e) {
      if (mounted) {
        ScaffoldMessenger.of(context)
            .showSnackBar(SnackBar(content: Text(apiErrorMessage(e))));
      }
    }
  }

  Future<void> _delete(Map<String, dynamic> node) async {
    final confirmed = await showDialog<bool>(
      context: context,
      builder: (context) => AlertDialog(
        title: Text(context.tr('common.delete')),
        content: Text('「${node['name']}」 ${context.tr('dept.deleteConfirm')}'),
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
    final version = (node['version'] as num?)?.toInt() ?? 0;
    try {
      await ref
          .read(mobileApiProvider)
          .deleteDepartment(node['id'] as String, version);
      if (mounted) {
        ScaffoldMessenger.of(context)
            .showSnackBar(SnackBar(content: Text(context.tr('dept.deleted'))));
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

class _FlatDept {
  const _FlatDept(this.node, this.depth);
  final Map<String, dynamic> node;
  final int depth;
}
