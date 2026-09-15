import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../core/auth_controller.dart';
import '../../core/l10n.dart';
import '../../core/mobile_api.dart';
import '../../shared/async_list_view.dart';

const _projectStatusLabels = {'PLANNING': '规划中', 'ACTIVE': '进行中', 'PAUSED': '已暂停', 'COMPLETED': '已完成', 'CANCELLED': '已取消', 'ARCHIVED': '已归档'};
const _projectStatusColors = {'PLANNING': Color(0xffa5adbc), 'ACTIVE': Color(0xff3478ff), 'PAUSED': Color(0xfff5a623), 'COMPLETED': Color(0xff1fbf75), 'CANCELLED': Color(0xfff0564a), 'ARCHIVED': Color(0xff8f98a8)};
const _taskStatusLabels = {'TODO': '待处理', 'IN_PROGRESS': '进行中', 'BLOCKED': '已阻塞', 'DONE': '已完成', 'CANCELLED': '已取消'};
const _taskStatusColors = {'TODO': Color(0xffa5adbc), 'IN_PROGRESS': Color(0xff3478ff), 'BLOCKED': Color(0xfff5a623), 'DONE': Color(0xff1fbf75), 'CANCELLED': Color(0xfff0564a)};

/// 项目与任务：项目列表 → 项目详情（状态机/成员/任务）→ 任务详情（流转/评论）。
class ProjectsTab extends ConsumerStatefulWidget {
  const ProjectsTab({super.key});
  @override
  ConsumerState<ProjectsTab> createState() => _ProjectsTabState();
}

class _ProjectsTabState extends ConsumerState<ProjectsTab> {
  List<Map<String, dynamic>> items = const [];
  bool loading = true;
  String? error;
  String statusFilter = '';
  bool includeArchived = false;

  @override
  void initState() {
    super.initState();
    _load();
  }

  Future<void> _load() async {
    setState(() => error = null);
    try {
      final data = await ref.read(mobileApiProvider).projects(status: statusFilter.isEmpty ? null : statusFilter, includeArchived: includeArchived);
      if (!mounted) return;
      setState(() { items = data; loading = false; });
    } catch (e) {
      if (mounted) setState(() { error = apiErrorMessage(e); loading = false; });
    }
  }

  void _toast(String text) => ScaffoldMessenger.of(context).showSnackBar(SnackBar(content: Text(text)));

  Future<void> _create() async {
    final result = await _ProjectCreateSheet.show(context);
    if (result == null) return;
    if (!mounted) return;
    final createdText = context.tr('workbench.projectCreated');
    try {
      await ref.read(mobileApiProvider).createProject(result);
      _toast(createdText);
      await _load();
    } catch (e) {
      _toast(apiErrorMessage(e));
    }
  }

  @override
  Widget build(BuildContext context) {
    final identity = ref.watch(authControllerProvider).value;
    return Column(children: [
      Padding(
        padding: const EdgeInsets.fromLTRB(16, 0, 16, 10),
        child: Row(children: [
          Expanded(child: SizedBox(height: 38, child: ListView(scrollDirection: Axis.horizontal, children: [
            _statusChip(context.tr('workbench.all'), statusFilter.isEmpty && !includeArchived, () { setState(() { statusFilter = ''; includeArchived = false; }); _load(); }),
            for (final entry in _projectStatusLabels.entries) _statusChip(context.tr('workbench.status.${entry.key}'), statusFilter == entry.key, () { setState(() { statusFilter = entry.key; includeArchived = false; }); _load(); }),
            _statusChip(context.tr('workbench.archived'), includeArchived, () { setState(() { statusFilter = ''; includeArchived = true; }); _load(); }),
          ]))),
          if (hasPermission(identity, 'project.create')) ...[
            const SizedBox(width: 8),
            FilledButton.tonalIcon(onPressed: _create, icon: const Icon(Icons.add_rounded, size: 18), label: Text(context.tr('workbench.newProject'))),
          ],
        ]),
      ),
      Expanded(
        child: AsyncListView(
          loading: loading && error == null,
          error: error,
          emptyText: context.tr('workbench.noProjects'),
          onRefresh: _load,
          children: [for (final project in items) _ProjectCard(project: project, onTap: () => _openProject(project))],
        ),
      ),
    ]);
  }

  Widget _statusChip(String label, bool selected, VoidCallback onTap) => Padding(
    padding: const EdgeInsets.only(right: 8),
    child: ChoiceChip(label: Text(label), selected: selected, onSelected: (_) => onTap()),
  );

  Future<void> _openProject(Map<String, dynamic> project) async {
    await _ProjectDetailSheet.show(context, project: project);
    await _load();
  }
}

class _ProjectCard extends StatelessWidget {
  const _ProjectCard({required this.project, required this.onTap});
  final Map<String, dynamic> project;
  final VoidCallback onTap;

  @override
  Widget build(BuildContext context) {
    final status = project['status']?.toString() ?? 'PLANNING';
    final color = _projectStatusColors[status] ?? const Color(0xffa5adbc);
    return GestureDetector(
      onTap: onTap,
      child: Container(
        margin: const EdgeInsets.only(bottom: 10),
        padding: const EdgeInsets.all(14),
        decoration: BoxDecoration(color: Colors.white, borderRadius: BorderRadius.circular(14), border: Border.all(color: const Color(0xffe8ecf4))),
        child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
          Row(children: [
            Expanded(child: Text(project['name']?.toString() ?? '', style: const TextStyle(fontSize: 15, fontWeight: FontWeight.w600))),
            Container(padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 2), decoration: BoxDecoration(color: color.withValues(alpha: .12), borderRadius: BorderRadius.circular(6)), child: Text(_projectStatusLabels[status] ?? status, style: TextStyle(fontSize: 11, color: color))),
          ]),
          const SizedBox(height: 6),
          Text('${project['code'] ?? ''} · ${context.tr('workbench.members')}${project['memberCount'] ?? 0} · ${context.tr('workbench.tasks')}${project['taskCount'] ?? 0}', style: const TextStyle(fontSize: 12, color: Color(0xffa5adbc))),
        ]),
      ),
    );
  }
}

/// 项目状态机允许的流转（与文档 6.4 对齐）。
const _projectTransitions = <String, List<String>>{
  'PLANNING': ['start'],
  'ACTIVE': ['pause', 'complete', 'cancel'],
  'PAUSED': ['resume', 'cancel'],
  'COMPLETED': ['reopen', 'archive'],
  'ARCHIVED': ['restore'],
};

class _ProjectDetailSheet {
  static Future<void> show(BuildContext context, {required Map<String, dynamic> project}) {
    return showModalBottomSheet(
      context: context,
      isScrollControlled: true,
      builder: (sheetContext) => _ProjectDetailSheetBody(projectId: project['id'].toString()),
    );
  }
}

class _ProjectDetailSheetBody extends ConsumerStatefulWidget {
  const _ProjectDetailSheetBody({required this.projectId});
  final String projectId;

  @override
  ConsumerState<_ProjectDetailSheetBody> createState() => _ProjectDetailSheetBodyState();
}

class _ProjectDetailSheetBodyState extends ConsumerState<_ProjectDetailSheetBody> {
  Map<String, dynamic>? project;
  List<Map<String, dynamic>> members = const [];
  List<Map<String, dynamic>> tasks = const [];
  String? error;

  @override
  void initState() {
    super.initState();
    _load();
  }

  Future<void> _load() async {
    setState(() => error = null);
    try {
      final api = ref.read(mobileApiProvider);
      final detail = await api.getProject(widget.projectId);
      final memberList = await api.projectMembers(widget.projectId);
      final taskList = await api.tasks(widget.projectId);
      if (!mounted) return;
      setState(() { project = detail; members = memberList; tasks = taskList; });
    } catch (e) {
      if (mounted) setState(() => error = apiErrorMessage(e));
    }
  }

  void _toast(String text) => ScaffoldMessenger.of(context).showSnackBar(SnackBar(content: Text(text)));

  Future<void> _transition(String action) async {
    final updatedText = context.tr('workbench.statusUpdated');
    final reasonTitle = context.tr('workbench.reasonRequired');
    String? reason;
    if (action == 'cancel' || action == 'reopen') {
      reason = await _promptReason(reasonTitle);
      if (reason == null) return;
    }
    try {
      await ref.read(mobileApiProvider).transitionProject(widget.projectId, action, {'version': project!['version'] as int, if (reason != null && reason.trim().isNotEmpty) 'reason': reason});
      _toast(updatedText);
      await _load();
    } catch (e) {
      _toast(apiErrorMessage(e));
    }
  }

  Future<String?> _promptReason(String title) {
    final controller = TextEditingController();
    return showDialog<String>(context: context, builder: (dialogContext) => AlertDialog(
      title: Text(title),
      content: TextField(controller: controller, maxLines: 2),
      actions: [
        TextButton(onPressed: () => Navigator.pop(dialogContext), child: Text(context.tr('common.cancel'))),
        FilledButton(onPressed: () => Navigator.pop(dialogContext, controller.text), child: Text(context.tr('common.confirm'))),
      ],
    ));
  }

  @override
  Widget build(BuildContext context) {
    final identity = ref.watch(authControllerProvider).value;
    final detail = project;
    if (error != null && detail == null) return SizedBox(height: 260, child: Center(child: Text(error!)));
    if (detail == null) return const SizedBox(height: 260, child: Center(child: CircularProgressIndicator()));
    final status = detail['status']?.toString() ?? 'PLANNING';
    final readOnly = status == 'COMPLETED' || status == 'CANCELLED' || status == 'ARCHIVED';
    final transitions = _projectTransitions[status] ?? const <String>[];

    return DraggableScrollableSheet(
      expand: false,
      initialChildSize: .78,
      maxChildSize: .94,
      builder: (sheetContext, scrollController) => ListView(
        controller: scrollController,
        padding: const EdgeInsets.fromLTRB(18, 12, 18, 32),
        children: [
          Center(child: Container(width: 40, height: 4, decoration: BoxDecoration(color: const Color(0xffd7dce7), borderRadius: BorderRadius.circular(2)))),
          const SizedBox(height: 14),
          Row(children: [
            Expanded(child: Text(detail['name']?.toString() ?? '', style: const TextStyle(fontSize: 18, fontWeight: FontWeight.w700))),
            Container(padding: const EdgeInsets.symmetric(horizontal: 10, vertical: 4), decoration: BoxDecoration(color: (_projectStatusColors[status] ?? const Color(0xffa5adbc)).withValues(alpha: .12), borderRadius: BorderRadius.circular(8)), child: Text(_projectStatusLabels[status] ?? status, style: TextStyle(fontSize: 12, color: _projectStatusColors[status]))),
          ]),
          const SizedBox(height: 8),
          Text('${detail['code'] ?? ''}${detail['description'] != null ? ' · ${detail['description']}' : ''}', style: const TextStyle(fontSize: 12, color: Color(0xffa5adbc))),
          const SizedBox(height: 14),
          if (!readOnly && hasPermission(identity, 'project.update') && transitions.isNotEmpty)
            Wrap(spacing: 8, runSpacing: 8, children: [for (final action in transitions) FilledButton.tonal(onPressed: () => _transition(action), child: Text(context.tr('workbench.transition.$action')))]),
          const SizedBox(height: 14),
          _InfoGrid(project: detail),
          const SizedBox(height: 16),
          Text(context.tr('workbench.projectMembers'), style: const TextStyle(fontSize: 15, fontWeight: FontWeight.w600)),
          const SizedBox(height: 8),
          for (final member in members) Padding(
            padding: const EdgeInsets.only(bottom: 6),
            child: Row(children: [
              const Icon(Icons.person_outline_rounded, size: 16, color: Color(0xff8f98a8)),
              const SizedBox(width: 8),
              Expanded(child: Text(member['displayName']?.toString() ?? member['account']?.toString() ?? '')),
              Text(member['role']?.toString() ?? '', style: const TextStyle(fontSize: 12, color: Color(0xff8f98a8))),
            ]),
          ),
          const SizedBox(height: 16),
          Text(context.tr('workbench.tasks'), style: const TextStyle(fontSize: 15, fontWeight: FontWeight.w600)),
          const SizedBox(height: 8),
          if (tasks.isEmpty)
            Text(context.tr('workbench.noTasks'), style: const TextStyle(fontSize: 13, color: Color(0xffa5adbc)))
          else
            for (final task in tasks) Padding(
              padding: const EdgeInsets.only(bottom: 8),
              child: _TaskRow(task: task, onTap: () => _openTask(task)),
            ),
        ],
      ),
    );
  }

  Future<void> _openTask(Map<String, dynamic> task) async {
    await _TaskDetailSheet.show(context, projectId: widget.projectId, taskId: task['id'].toString());
    await _load();
  }
}

class _InfoGrid extends StatelessWidget {
  const _InfoGrid({required this.project});
  final Map<String, dynamic> project;

  @override
  Widget build(BuildContext context) => Container(
    padding: const EdgeInsets.all(12),
    decoration: BoxDecoration(color: const Color(0xfff6f8fc), borderRadius: BorderRadius.circular(12)),
    child: Column(children: [
      _row(context.tr('workbench.owner'), _ownerName()),
      _row(context.tr('workbench.myRole'), project['myRole']?.toString() ?? '-'),
      _row(context.tr('workbench.startsAt'), _date('startsAt')),
      _row(context.tr('workbench.endsAt'), _date('endsAt')),
    ]),
  );

  String _ownerName() {
    final owner = project['owner'];
    if (owner is Map) return owner['displayName']?.toString() ?? owner['account']?.toString() ?? '-';
    return project['ownerMembershipId']?.toString().substring(0, 8) ?? '-';
  }

  String _date(String key) {
    final value = project[key]?.toString();
    if (value == null) return '-';
    return value.length > 10 ? value.substring(0, 10) : value;
  }

  Widget _row(String label, String value) => Padding(
    padding: const EdgeInsets.symmetric(vertical: 3),
    child: Row(children: [SizedBox(width: 84, child: Text(label, style: const TextStyle(fontSize: 12, color: Color(0xff8f98a8)))), Expanded(child: Text(value, style: const TextStyle(fontSize: 13)))],),
  );
}

class _TaskRow extends StatelessWidget {
  const _TaskRow({required this.task, required this.onTap});
  final Map<String, dynamic> task;
  final VoidCallback onTap;

  @override
  Widget build(BuildContext context) {
    final status = task['status']?.toString() ?? 'TODO';
    final color = _taskStatusColors[status] ?? const Color(0xffa5adbc);
    return GestureDetector(
      onTap: onTap,
      child: Container(
        padding: const EdgeInsets.all(12),
        decoration: BoxDecoration(color: Colors.white, borderRadius: BorderRadius.circular(12), border: Border.all(color: const Color(0xffe8ecf4))),
        child: Row(children: [
          Container(padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 2), decoration: BoxDecoration(color: color.withValues(alpha: .12), borderRadius: BorderRadius.circular(6)), child: Text(_taskStatusLabels[status] ?? status, style: TextStyle(fontSize: 11, color: color))),
          const SizedBox(width: 10),
          Expanded(child: Text(task['title']?.toString() ?? '', maxLines: 1, overflow: TextOverflow.ellipsis, style: const TextStyle(fontSize: 13))),
          Text('${context.tr('workbench.comments')}${task['commentCount'] ?? 0}', style: const TextStyle(fontSize: 11, color: Color(0xffa5adbc))),
        ]),
      ),
    );
  }
}

const _taskTransitions = <String, List<String>>{
  'TODO': ['IN_PROGRESS', 'CANCELLED'],
  'IN_PROGRESS': ['BLOCKED', 'DONE', 'CANCELLED'],
  'BLOCKED': ['IN_PROGRESS', 'DONE', 'CANCELLED'],
};

class _TaskDetailSheet {
  static Future<void> show(BuildContext context, {required String projectId, required String taskId}) {
    return showModalBottomSheet(
      context: context,
      isScrollControlled: true,
      builder: (sheetContext) => _TaskDetailSheetBody(projectId: projectId, taskId: taskId),
    );
  }
}

class _TaskDetailSheetBody extends ConsumerStatefulWidget {
  const _TaskDetailSheetBody({required this.projectId, required this.taskId});
  final String projectId;
  final String taskId;

  @override
  ConsumerState<_TaskDetailSheetBody> createState() => _TaskDetailSheetBodyState();
}

class _TaskDetailSheetBodyState extends ConsumerState<_TaskDetailSheetBody> {
  Map<String, dynamic>? task;
  List<Map<String, dynamic>> comments = const [];
  String? error;
  final commentInput = TextEditingController();

  @override
  void initState() {
    super.initState();
    _load();
  }

  @override
  void dispose() {
    commentInput.dispose();
    super.dispose();
  }

  Future<void> _load() async {
    setState(() => error = null);
    try {
      final api = ref.read(mobileApiProvider);
      final detail = await api.getTask(widget.projectId, widget.taskId);
      final commentList = await api.taskComments(widget.projectId, widget.taskId);
      if (!mounted) return;
      setState(() { task = detail; comments = commentList; });
    } catch (e) {
      if (mounted) setState(() => error = apiErrorMessage(e));
    }
  }

  void _toast(String text) => ScaffoldMessenger.of(context).showSnackBar(SnackBar(content: Text(text)));

  Future<void> _transition(String status) async {
    final updatedText = context.tr('workbench.statusUpdated');
    final reasonTitle = context.tr('workbench.reasonRequired');
    String? reason;
    if (status == 'BLOCKED' || status == 'CANCELLED') {
      reason = await _prompt(reasonTitle);
      if (reason == null) return;
    }
    try {
      await ref.read(mobileApiProvider).transitionTask(widget.projectId, widget.taskId, status, task!['version'] as int, reason: reason);
      _toast(updatedText);
      await _load();
    } catch (e) {
      _toast(apiErrorMessage(e));
    }
  }

  Future<String?> _prompt(String title) {
    final controller = TextEditingController();
    return showDialog<String>(context: context, builder: (dialogContext) => AlertDialog(
      title: Text(title),
      content: TextField(controller: controller, maxLines: 2),
      actions: [
        TextButton(onPressed: () => Navigator.pop(dialogContext), child: Text(context.tr('common.cancel'))),
        FilledButton(onPressed: () => Navigator.pop(dialogContext, controller.text), child: Text(context.tr('common.confirm'))),
      ],
    ));
  }

  Future<void> _sendComment() async {
    final text = commentInput.text.trim();
    if (text.isEmpty) return;
    try {
      await ref.read(mobileApiProvider).createTaskComment(widget.projectId, widget.taskId, text);
      commentInput.clear();
      await _load();
    } catch (e) {
      _toast(apiErrorMessage(e));
    }
  }

  @override
  Widget build(BuildContext context) {
    final identity = ref.watch(authControllerProvider).value;
    final detail = task;
    if (error != null && detail == null) return SizedBox(height: 240, child: Center(child: Text(error!)));
    if (detail == null) return const SizedBox(height: 240, child: Center(child: CircularProgressIndicator()));
    final status = detail['status']?.toString() ?? 'TODO';
    final terminal = status == 'DONE' || status == 'CANCELLED';
    final transitions = _taskTransitions[status] ?? const <String>[];

    return DraggableScrollableSheet(
      expand: false,
      initialChildSize: .75,
      maxChildSize: .94,
      builder: (sheetContext, scrollController) => ListView(
        controller: scrollController,
        padding: const EdgeInsets.fromLTRB(18, 12, 18, 24),
        children: [
          Center(child: Container(width: 40, height: 4, decoration: BoxDecoration(color: const Color(0xffd7dce7), borderRadius: BorderRadius.circular(2)))),
          const SizedBox(height: 14),
          Row(crossAxisAlignment: CrossAxisAlignment.start, children: [
            Expanded(child: Text(detail['title']?.toString() ?? '', style: const TextStyle(fontSize: 17, fontWeight: FontWeight.w700))),
            Container(padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 3), decoration: BoxDecoration(color: (_taskStatusColors[status] ?? const Color(0xffa5adbc)).withValues(alpha: .12), borderRadius: BorderRadius.circular(6)), child: Text(_taskStatusLabels[status] ?? status, style: TextStyle(fontSize: 11, color: _taskStatusColors[status]))),
          ]),
          if (detail['description'] != null) ...[
            const SizedBox(height: 8),
            Text(detail['description'].toString(), style: const TextStyle(fontSize: 13, color: Color(0xff737c8d))),
          ],
          const SizedBox(height: 12),
          if (!terminal && hasPermission(identity, 'task.status.update') && transitions.isNotEmpty)
            Wrap(spacing: 8, runSpacing: 8, children: [for (final target in transitions) FilledButton.tonal(onPressed: () => _transition(target), child: Text(context.tr('workbench.taskTransition.$target')))]),
          const SizedBox(height: 12),
          Text(context.tr('workbench.comments'), style: const TextStyle(fontSize: 14, fontWeight: FontWeight.w600)),
          const SizedBox(height: 8),
          if (comments.isEmpty)
            Text(context.tr('workbench.noComments'), style: const TextStyle(fontSize: 12, color: Color(0xffa5adbc)))
          else
            for (final comment in comments) Container(
              margin: const EdgeInsets.only(bottom: 8),
              padding: const EdgeInsets.all(10),
              decoration: BoxDecoration(color: const Color(0xfff6f8fc), borderRadius: BorderRadius.circular(10)),
              child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
                Text(_commentAuthor(comment), style: const TextStyle(fontSize: 12, color: Color(0xff8f98a8))),
                const SizedBox(height: 4),
                Text(comment['content']?.toString() ?? '', style: const TextStyle(fontSize: 13)),
              ]),
            ),
          if (!terminal && hasPermission(identity, 'task.comment.create'))
            Row(children: [
              Expanded(child: TextField(controller: commentInput, decoration: InputDecoration(hintText: context.tr('workbench.commentHint'), isDense: true, contentPadding: const EdgeInsets.symmetric(horizontal: 12, vertical: 10), border: OutlineInputBorder(borderRadius: BorderRadius.circular(10))))),
              const SizedBox(width: 8),
              IconButton.filled(onPressed: _sendComment, icon: const Icon(Icons.send_rounded, size: 18)),
            ]),
        ],
      ),
    );
  }

  String _commentAuthor(Map<String, dynamic> comment) {
    final author = comment['author'];
    if (author is Map) return author['displayName']?.toString() ?? author['account']?.toString() ?? '';
    return '';
  }
}

class _ProjectCreateSheet {
  static Future<Map<String, dynamic>?> show(BuildContext context) {
    return showModalBottomSheet<Map<String, dynamic>>(context: context, isScrollControlled: true, builder: (sheetContext) => const _ProjectCreateSheetBody());
  }
}

class _ProjectCreateSheetBody extends StatefulWidget {
  const _ProjectCreateSheetBody();
  @override
  State<_ProjectCreateSheetBody> createState() => _ProjectCreateSheetBodyState();
}

class _ProjectCreateSheetBodyState extends State<_ProjectCreateSheetBody> {
  final code = TextEditingController();
  final name = TextEditingController();
  final description = TextEditingController();

  @override
  void dispose() {
    code.dispose();
    name.dispose();
    description.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) => Padding(
    padding: EdgeInsets.fromLTRB(18, 12, 18, MediaQuery.of(context).viewInsets.bottom + 24),
    child: Column(mainAxisSize: MainAxisSize.min, crossAxisAlignment: CrossAxisAlignment.start, children: [
      Center(child: Container(width: 40, height: 4, decoration: BoxDecoration(color: const Color(0xffd7dce7), borderRadius: BorderRadius.circular(2)))),
      const SizedBox(height: 16),
      Text(context.tr('workbench.newProject'), style: const TextStyle(fontSize: 17, fontWeight: FontWeight.w700)),
      const SizedBox(height: 14),
      TextField(controller: code, decoration: InputDecoration(labelText: context.tr('workbench.projectCode'), hintText: 'PRJ-2026-001')),
      const SizedBox(height: 10),
      TextField(controller: name, decoration: InputDecoration(labelText: context.tr('workbench.projectName'))),
      const SizedBox(height: 10),
      TextField(controller: description, maxLines: 3, decoration: InputDecoration(labelText: context.tr('workbench.projectDescription'))),
      const SizedBox(height: 16),
      Row(mainAxisAlignment: MainAxisAlignment.end, children: [
        TextButton(onPressed: () => Navigator.pop(context), child: Text(context.tr('common.cancel'))),
        const SizedBox(width: 8),
        FilledButton(
          onPressed: code.text.trim().isEmpty || name.text.trim().isEmpty ? null : () => Navigator.pop(context, {
            'code': code.text.trim(),
            'name': name.text.trim(),
            if (description.text.trim().isNotEmpty) 'description': description.text.trim(),
          }),
          child: Text(context.tr('common.create')),
        ),
      ]),
    ]),
  );
}
