import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../core/auth_controller.dart';
import '../../core/l10n.dart';
import '../../core/mobile_api.dart';
import '../../shared/async_list_view.dart';

class InvitationsTab extends ConsumerStatefulWidget {
  const InvitationsTab({super.key});

  @override
  ConsumerState<InvitationsTab> createState() => _InvitationsTabState();
}

class _InvitationsTabState extends ConsumerState<InvitationsTab> {
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
      final data = await ref.read(mobileApiProvider).invitations();
      if (mounted) setState(() => items = data);
    } catch (e) {
      if (mounted) setState(() => error = apiErrorMessage(e));
    } finally {
      if (mounted) setState(() => loading = false);
    }
  }

  @override
  Widget build(BuildContext context) {
    return Column(
      children: [
        Padding(
          padding: const EdgeInsets.fromLTRB(16, 0, 16, 12),
          child: Row(
            children: [
              Expanded(
                  child: Text(context.tr('inv.subtitle'),
                      style: const TextStyle(
                          color: Color(0xff737c8d), fontSize: 12))),
              FilledButton.tonalIcon(
                  onPressed: _create,
                  icon: const Icon(Icons.person_add_alt, size: 18),
                  label: Text(context.tr('inv.create'))),
            ],
          ),
        ),
        Expanded(
          child: AsyncListView(
            loading: loading,
            error: error,
            emptyText: context.tr('inv.empty'),
            onRefresh: _load,
            children: [
              for (final invitation in items) _invitationCard(invitation),
            ],
          ),
        ),
      ],
    );
  }

  Widget _invitationCard(Map<String, dynamic> invitation) {
    final displayName = invitation['displayName']?.toString() ?? '—';
    final account = invitation['account']?.toString() ?? '';
    final status = invitation['status']?.toString() ?? '';
    final roles = roleNames(invitation['roles']);

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
            backgroundColor: const Color(0xff6c57ff),
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
            const SizedBox(width: 8),
            _InvitationStatusBadge(status: status),
          ]),
          subtitle: Text(
              '${account.isEmpty ? context.tr('inv.accountPending') : account}${roles.isEmpty ? '' : ' · ${roles.join('、')}'}',
              maxLines: 1,
              overflow: TextOverflow.ellipsis),
          trailing: status == 'PENDING'
              ? IconButton(
                  icon: const Icon(Icons.close_rounded, color: Color(0xffff4555)),
                  onPressed: () => _revoke(invitation))
              : null,
        ),
      ),
    );
  }

  Future<void> _revoke(Map<String, dynamic> invitation) async {
    final confirmed = await showDialog<bool>(
      context: context,
      builder: (context) => AlertDialog(
        title: Text(context.tr('inv.revoke')),
        content: Text(context.tr('inv.revokeConfirm')),
        actions: [
          TextButton(
              onPressed: () => Navigator.pop(context, false),
              child: Text(context.tr('common.cancel'))),
          FilledButton(
              onPressed: () => Navigator.pop(context, true),
              style:
                  FilledButton.styleFrom(backgroundColor: const Color(0xffff4555)),
              child: Text(context.tr('inv.revoke'))),
        ],
      ),
    );
    if (confirmed != true) return;
    try {
      await ref
          .read(mobileApiProvider)
          .revokeInvitation(invitation['id'] as String);
      if (mounted) {
        ScaffoldMessenger.of(context)
            .showSnackBar(SnackBar(content: Text(context.tr('inv.revoked'))));
      }
      await _load();
    } catch (e) {
      if (mounted) {
        ScaffoldMessenger.of(context)
            .showSnackBar(SnackBar(content: Text(apiErrorMessage(e))));
      }
    }
  }

  Future<void> _create() async {
    try {
      final roles = await ref.read(mobileApiProvider).roles();
      if (!mounted) return;
      final result = await showDialog<_CreateInvitationResult>(
        context: context,
        builder: (context) => _CreateInvitationDialog(
            roles: roles, api: ref.read(mobileApiProvider)),
      );
      if (result == null) return;
      final created = await ref.read(mobileApiProvider).createInvitation({
        if (result.account.trim().isNotEmpty)
          'account': result.account.trim().toLowerCase(),
        'displayName': result.displayName.trim(),
        'roleIds': result.roleIds,
      });
      await _load();
      if (!mounted) return;
      final token = created['invitationToken']?.toString();
      if (token != null && token.isNotEmpty) {
        await _showToken(created['account']?.toString() ?? '', token);
      }
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
        title: Text(context.tr('inv.createdTitle')),
        content: Column(
          mainAxisSize: MainAxisSize.min,
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Text(context.tr('inv.createdDesc')),
            const SizedBox(height: 12),
            SelectableText('账号：$account\n激活令牌：$token',
                style: const TextStyle(fontWeight: FontWeight.w600)),
            const SizedBox(height: 8),
            OutlinedButton.icon(
              icon: const Icon(Icons.copy_rounded, size: 16),
              label: Text(context.tr('inv.copy')),
              onPressed: () async {
                await Clipboard.setData(ClipboardData(text: token));
                if (context.mounted) {
                  ScaffoldMessenger.of(context).showSnackBar(
                      SnackBar(content: Text(context.tr('inv.copied'))));
                }
              },
            ),
          ],
        ),
        actions: [
          FilledButton(
              onPressed: () => Navigator.pop(context),
              child: Text(context.tr('inv.gotIt'))),
        ],
      ),
    );
  }
}

class _CreateInvitationResult {
  const _CreateInvitationResult(
      {required this.displayName, required this.account, required this.roleIds});
  final String displayName;
  final String account;
  final List<String> roleIds;
}

class _CreateInvitationDialog extends StatefulWidget {
  const _CreateInvitationDialog({required this.roles, required this.api});
  final List<Map<String, dynamic>> roles;
  final MobileApi api;

  @override
  State<_CreateInvitationDialog> createState() => _CreateInvitationDialogState();
}

class _CreateInvitationDialogState extends State<_CreateInvitationDialog> {
  final displayName = TextEditingController();
  final account = TextEditingController();
  final Set<String> roleIds = {};
  String? suggestion;
  bool suggesting = false;

  @override
  void dispose() {
    displayName.dispose();
    account.dispose();
    super.dispose();
  }

  Future<void> _suggest() async {
    if (displayName.text.trim().isEmpty) return;
    setState(() => suggesting = true);
    try {
      final data = await widget.api.suggestAccount(displayName.text);
      final suggestions = data['suggestions'];
      final fromList = suggestions is List && suggestions.isNotEmpty
          ? suggestions.first.toString()
          : null;
      final suggested = data['suggestedAccount']?.toString() ??
          data['account']?.toString() ??
          fromList;
      if (mounted) setState(() => suggestion = suggested);
    } catch (e) {
      if (mounted) {
        ScaffoldMessenger.of(context)
            .showSnackBar(SnackBar(content: Text(apiErrorMessage(e))));
      }
    } finally {
      if (mounted) setState(() => suggesting = false);
    }
  }

  @override
  Widget build(BuildContext context) => AlertDialog(
        title: Text(context.tr('inv.create')),
        content: SingleChildScrollView(
          child: Column(
            mainAxisSize: MainAxisSize.min,
            children: [
              TextField(
                  controller: displayName,
                  decoration:
                      InputDecoration(labelText: context.tr('inv.displayName'))),
              const SizedBox(height: 10),
              TextField(
                controller: account,
                decoration: InputDecoration(
                  labelText: context.tr('inv.account'),
                  suffixIcon: IconButton(
                      icon: const Icon(Icons.auto_awesome_outlined),
                      onPressed: suggesting ? null : _suggest),
                ),
              ),
              if (suggestion != null) ...[
                const SizedBox(height: 6),
                Align(
                  alignment: Alignment.centerLeft,
                  child: ActionChip(
                      label: Text(
                          '${context.tr('inv.suggestedAccount')}：$suggestion'),
                      onPressed: () => account.text = suggestion!),
                ),
              ],
              const SizedBox(height: 10),
              Align(
                alignment: Alignment.centerLeft,
                child: Text(context.tr('inv.roles'),
                    style: const TextStyle(fontWeight: FontWeight.w600)),
              ),
              const SizedBox(height: 4),
              for (final role in widget.roles)
                CheckboxListTile(
                  dense: true,
                  contentPadding: EdgeInsets.zero,
                  title: Text(role['name']?.toString() ?? ''),
                  value: roleIds.contains(role['id'] as String),
                  onChanged: (v) => setState(() {
                    if (v == true) {
                      roleIds.add(role['id'] as String);
                    } else {
                      roleIds.remove(role['id'] as String);
                    }
                  }),
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
              if (displayName.text.trim().isEmpty) {
                ScaffoldMessenger.of(context).showSnackBar(
                    SnackBar(content: Text(context.tr('inv.fillDisplayName'))));
                return;
              }
              Navigator.pop(
                  context,
                  _CreateInvitationResult(
                      displayName: displayName.text,
                      account: account.text,
                      roleIds: roleIds.toList()));
            },
            child: Text(context.tr('inv.createSubmit')),
          ),
        ],
      );
}

class _InvitationStatusBadge extends StatelessWidget {
  const _InvitationStatusBadge({required this.status});
  final String status;

  @override
  Widget build(BuildContext context) {
    final (key, color) = switch (status) {
      'PENDING' => ('inv.status.pending', const Color(0xffffa000)),
      'ACCEPTED' => ('inv.status.accepted', const Color(0xff20bd6b)),
      'REVOKED' => ('inv.status.revoked', const Color(0xff9ca4b4)),
      'EXPIRED' => ('inv.status.expired', const Color(0xff9ca4b4)),
      _ => ('inv.status.expired', const Color(0xff9ca4b4)),
    };
    return Container(
      padding: const EdgeInsets.symmetric(horizontal: 7, vertical: 2),
      decoration: BoxDecoration(
          color: color.withValues(alpha: .12),
          borderRadius: BorderRadius.circular(8)),
      child: Text(context.tr(key),
          style:
              TextStyle(color: color, fontSize: 10, fontWeight: FontWeight.w600)),
    );
  }
}
