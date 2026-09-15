import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../core/auth_controller.dart';
import '../../core/l10n.dart';
import '../../core/mobile_api.dart';
import '../../shared/async_list_view.dart';

const _reportStatusLabels = {'DRAFT': '草稿', 'SUBMITTED': '已提交', 'APPROVED': '已通过', 'REJECTED': '已驳回'};
const _reportStatusColors = {'DRAFT': Color(0xffa5adbc), 'SUBMITTED': Color(0xff3478ff), 'APPROVED': Color(0xff1fbf75), 'REJECTED': Color(0xfff0564a)};

/// 日报与周报：列表 + 创建草稿 + 提交 / 撤回。
class ReportsTab extends ConsumerStatefulWidget {
  const ReportsTab({super.key});
  @override
  ConsumerState<ReportsTab> createState() => _ReportsTabState();
}

class _ReportsTabState extends ConsumerState<ReportsTab> {
  List<Map<String, dynamic>> items = const [];
  bool loading = true;
  String? error;
  String typeFilter = '';

  @override
  void initState() {
    super.initState();
    _load();
  }

  Future<void> _load() async {
    setState(() => error = null);
    try {
      final data = await ref.read(mobileApiProvider).workReports(type: typeFilter.isEmpty ? null : typeFilter);
      if (!mounted) return;
      setState(() { items = data; loading = false; });
    } catch (e) {
      if (mounted) setState(() { error = apiErrorMessage(e); loading = false; });
    }
  }

  void _toast(String text) => ScaffoldMessenger.of(context).showSnackBar(SnackBar(content: Text(text)));

  Future<void> _submit(Map<String, dynamic> report) async {
    final submittedText = context.tr('workbench.reportSubmitted');
    try {
      await ref.read(mobileApiProvider).submitWorkReport(report['id'].toString(), report['version'] as int);
      _toast(submittedText);
      await _load();
    } catch (e) {
      _toast(apiErrorMessage(e));
    }
  }

  Future<void> _withdraw(Map<String, dynamic> report) async {
    final withdrawnText = context.tr('workbench.reportWithdrawn');
    try {
      await ref.read(mobileApiProvider).withdrawWorkReport(report['id'].toString(), report['version'] as int);
      _toast(withdrawnText);
      await _load();
    } catch (e) {
      _toast(apiErrorMessage(e));
    }
  }

  Future<void> _delete(Map<String, dynamic> report) async {
    final deletedText = context.tr('workbench.reportDeleted');
    try {
      await ref.read(mobileApiProvider).deleteWorkReport(report['id'].toString(), report['version'] as int);
      _toast(deletedText);
      await _load();
    } catch (e) {
      _toast(apiErrorMessage(e));
    }
  }

  Future<void> _review(Map<String, dynamic> report, bool approve) async {
    final approveTitle = context.tr('workbench.approveReport');
    final rejectTitle = context.tr('workbench.rejectReport');
    final approvedText = context.tr('workbench.reportApproved');
    final rejectedText = context.tr('workbench.reportRejected');
    final comment = await _promptText(title: approve ? approveTitle : rejectTitle);
    if (comment == null) return;
    try {
      await ref.read(mobileApiProvider).reviewWorkReport(report['id'].toString(), approve, comment, report['version'] as int);
      _toast(approve ? approvedText : rejectedText);
      await _load();
    } catch (e) {
      _toast(apiErrorMessage(e));
    }
  }

  Future<String?> _promptText({required String title, String hint = ''}) {
    final controller = TextEditingController();
    return showDialog<String>(context: context, builder: (dialogContext) => AlertDialog(
      title: Text(title),
      content: TextField(controller: controller, maxLines: 3, decoration: InputDecoration(hintText: hint)),
      actions: [
        TextButton(onPressed: () => Navigator.pop(dialogContext), child: Text(context.tr('common.cancel'))),
        FilledButton(onPressed: () => Navigator.pop(dialogContext, controller.text), child: Text(context.tr('common.confirm'))),
      ],
    ));
  }

  Future<void> _create() async {
    final result = await _ReportCreateDialog.show(context);
    if (result == null) return;
    if (!mounted) return;
    final createdText = context.tr('workbench.reportCreated');
    try {
      await ref.read(mobileApiProvider).createWorkReport(result['type'] as String, result['periodStart'] as String, result['content'] as String);
      _toast(createdText);
      await _load();
    } catch (e) {
      _toast(apiErrorMessage(e));
    }
  }

  @override
  Widget build(BuildContext context) => Column(children: [
    Padding(
      padding: const EdgeInsets.fromLTRB(16, 0, 16, 10),
      child: Row(children: [
        ChoiceChip(label: Text(context.tr('workbench.all')), selected: typeFilter.isEmpty, onSelected: (_) { setState(() => typeFilter = ''); _load(); }),
        const SizedBox(width: 8),
        ChoiceChip(label: Text(context.tr('workbench.daily')), selected: typeFilter == 'DAILY', onSelected: (_) { setState(() => typeFilter = 'DAILY'); _load(); }),
        const SizedBox(width: 8),
        ChoiceChip(label: Text(context.tr('workbench.weekly')), selected: typeFilter == 'WEEKLY', onSelected: (_) { setState(() => typeFilter = 'WEEKLY'); _load(); }),
        const Spacer(),
        FilledButton.tonalIcon(onPressed: _create, icon: const Icon(Icons.edit_note, size: 18), label: Text(context.tr('workbench.newReport'))),
      ]),
    ),
    Expanded(
      child: AsyncListView(
        loading: loading && error == null,
        error: error,
        emptyText: context.tr('workbench.noReports'),
        onRefresh: _load,
        children: [for (final report in items) _ReportCard(report: report, onSubmit: () => _submit(report), onWithdraw: () => _withdraw(report), onDelete: () => _delete(report), onReview: (approve) => _review(report, approve))],
      ),
    ),
  ]);
}

class _ReportCard extends StatelessWidget {
  const _ReportCard({required this.report, required this.onSubmit, required this.onWithdraw, required this.onDelete, required this.onReview});
  final Map<String, dynamic> report;
  final VoidCallback onSubmit;
  final VoidCallback onWithdraw;
  final VoidCallback onDelete;
  final void Function(bool approve) onReview;

  String get status => report['status']?.toString() ?? 'DRAFT';

  @override
  Widget build(BuildContext context) {
    final type = report['type']?.toString() == 'WEEKLY' ? context.tr('workbench.weekly') : context.tr('workbench.daily');
    final period = report['periodStart']?.toString() ?? '';
    final color = _reportStatusColors[status] ?? const Color(0xffa5adbc);
    return Container(
      margin: const EdgeInsets.only(bottom: 10),
      padding: const EdgeInsets.all(14),
      decoration: BoxDecoration(color: Colors.white, borderRadius: BorderRadius.circular(14), border: Border.all(color: const Color(0xffe8ecf4))),
      child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
        Row(children: [
          Container(padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 2), decoration: BoxDecoration(color: color.withValues(alpha: .12), borderRadius: BorderRadius.circular(6)), child: Text(type, style: TextStyle(fontSize: 11, color: color))),
          const SizedBox(width: 8),
          Expanded(child: Text(period.substring(0, period.length > 10 ? 10 : period.length), style: const TextStyle(fontSize: 14, fontWeight: FontWeight.w600))),
          Text(_reportStatusLabels[status] ?? status, style: TextStyle(fontSize: 12, color: color)),
        ]),
        if (report['content'] != null) ...[
          const SizedBox(height: 8),
          Text(report['content'].toString(), maxLines: 2, overflow: TextOverflow.ellipsis, style: const TextStyle(fontSize: 12, color: Color(0xff737c8d))),
        ],
        const SizedBox(height: 10),
        Row(mainAxisAlignment: MainAxisAlignment.end, children: [
          if (status == 'DRAFT' || status == 'REJECTED') ...[
            TextButton(onPressed: onSubmit, child: Text(context.tr('workbench.submitReport'))),
            TextButton(onPressed: onDelete, child: Text(context.tr('common.delete'), style: const TextStyle(color: Color(0xfff0564a)))),
          ],
          if (status == 'SUBMITTED') ...[
            TextButton(onPressed: onWithdraw, child: Text(context.tr('workbench.withdrawReport'))),
            FilledButton.tonal(onPressed: () => onReview(true), child: Text(context.tr('workbench.approve'))),
            TextButton(onPressed: () => onReview(false), child: Text(context.tr('workbench.reject'), style: const TextStyle(color: Color(0xfff0564a)))),
          ],
        ]),
      ]),
    );
  }
}

class _ReportCreateDialog {
  static Future<Map<String, dynamic>?> show(BuildContext context) {
    return showDialog<Map<String, dynamic>>(context: context, builder: (dialogContext) => const _ReportCreateDialogWidget());
  }
}

class _ReportCreateDialogWidget extends StatefulWidget {
  const _ReportCreateDialogWidget();
  @override
  State<_ReportCreateDialogWidget> createState() => _ReportCreateDialogWidgetState();
}

class _ReportCreateDialogWidgetState extends State<_ReportCreateDialogWidget> {
  String type = 'DAILY';
  DateTime date = DateTime.now();
  final content = TextEditingController();

  @override
  void dispose() {
    content.dispose();
    super.dispose();
  }

  bool get isMonday => date.weekday == DateTime.monday;

  @override
  Widget build(BuildContext context) => AlertDialog(
    title: Text(context.tr('workbench.newReport')),
    content: SingleChildScrollView(child: Column(mainAxisSize: MainAxisSize.min, crossAxisAlignment: CrossAxisAlignment.start, children: [
      Row(children: [
        ChoiceChip(label: Text(context.tr('workbench.daily')), selected: type == 'DAILY', onSelected: (_) => setState(() => type = 'DAILY')),
        const SizedBox(width: 8),
        ChoiceChip(label: Text(context.tr('workbench.weekly')), selected: type == 'WEEKLY', onSelected: (_) => setState(() => type = 'WEEKLY')),
      ]),
      const SizedBox(height: 12),
      Row(children: [
        Text(context.tr('workbench.periodStart'), style: const TextStyle(fontSize: 13)),
        TextButton(onPressed: () async {
          final picked = await showDatePicker(context: context, initialDate: date, firstDate: DateTime(2024), lastDate: DateTime(2100));
          if (picked != null) setState(() => date = picked);
        }, child: Text(date.toIso8601String().substring(0, 10))),
      ]),
      if (type == 'WEEKLY' && !isMonday)
        Padding(padding: const EdgeInsets.only(bottom: 8), child: Text(context.tr('workbench.weeklyMustStartMonday'), style: const TextStyle(fontSize: 12, color: Color(0xfff0564a)))),
      TextField(controller: content, maxLines: 6, decoration: InputDecoration(hintText: context.tr('workbench.reportContentHint'), border: const OutlineInputBorder())),
    ])),
    actions: [
      TextButton(onPressed: () => Navigator.pop(context), child: Text(context.tr('common.cancel'))),
      FilledButton(
        onPressed: content.text.trim().isEmpty || (type == 'WEEKLY' && !isMonday) ? null : () => Navigator.pop(context, {
          'type': type,
          'periodStart': '${date.year.toString().padLeft(4, '0')}-${date.month.toString().padLeft(2, '0')}-${date.day.toString().padLeft(2, '0')}',
          'content': content.text.trim(),
        }),
        child: Text(context.tr('common.create')),
      ),
    ],
  );
}
