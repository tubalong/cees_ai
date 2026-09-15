import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../core/auth_controller.dart';
import '../../core/l10n.dart';
import '../../core/mobile_api.dart';
import '../../shared/async_list_view.dart';

const _meetingStatusLabels = {'DRAFT': '草稿', 'SCHEDULED': '已安排', 'IN_PROGRESS': '进行中', 'COMPLETED': '已完成', 'CANCELLED': '已取消'};
const _meetingStatusColors = {'DRAFT': Color(0xffa5adbc), 'SCHEDULED': Color(0xff3478ff), 'IN_PROGRESS': Color(0xfff5a623), 'COMPLETED': Color(0xff1fbf75), 'CANCELLED': Color(0xfff0564a)};
const _responseLabels = {'INVITED': '待回应', 'ACCEPTED': '已接受', 'DECLINED': '已拒绝', 'TENTATIVE': '待定'};
const _roleLabels = {'HOST': '主持人', 'RECORDER': '记录人', 'PARTICIPANT': '参会人'};

/// 会议管理：列表 + 详情（状态流转 / 邀请应答 / 参会人 / 纪要）。
class MeetingsTab extends ConsumerStatefulWidget {
  const MeetingsTab({super.key});
  @override
  ConsumerState<MeetingsTab> createState() => _MeetingsTabState();
}

class _MeetingsTabState extends ConsumerState<MeetingsTab> {
  List<Map<String, dynamic>> items = const [];
  bool loading = true;
  String? error;
  String statusFilter = '';

  @override
  void initState() {
    super.initState();
    _load();
  }

  Future<void> _load() async {
    setState(() => error = null);
    try {
      final data = await ref.read(mobileApiProvider).meetings(status: statusFilter.isEmpty ? null : statusFilter);
      if (!mounted) return;
      setState(() { items = data; loading = false; });
    } catch (e) {
      if (mounted) setState(() { error = apiErrorMessage(e); loading = false; });
    }
  }

  void _toast(String text) => ScaffoldMessenger.of(context).showSnackBar(SnackBar(content: Text(text)));

  Future<void> _create() async {
    final result = await _MeetingCreateSheet.show(context);
    if (result == null) return;
    if (!mounted) return;
    final createdText = context.tr('workbench.meetingCreated');
    try {
      await ref.read(mobileApiProvider).createMeeting(result);
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
            Padding(padding: const EdgeInsets.only(right: 8), child: ChoiceChip(label: Text(context.tr('workbench.all')), selected: statusFilter.isEmpty, onSelected: (_) { setState(() => statusFilter = ''); _load(); })),
            for (final entry in _meetingStatusLabels.entries) Padding(padding: const EdgeInsets.only(right: 8), child: ChoiceChip(label: Text(entry.value), selected: statusFilter == entry.key, onSelected: (_) { setState(() => statusFilter = entry.key); _load(); })),
          ]))),
          if (hasPermission(identity, 'meeting.create')) ...[
            FilledButton.tonalIcon(onPressed: _create, icon: const Icon(Icons.add_rounded, size: 18), label: Text(context.tr('workbench.newMeeting'))),
          ],
        ]),
      ),
      Expanded(
        child: AsyncListView(
          loading: loading && error == null,
          error: error,
          emptyText: context.tr('workbench.noMeetings'),
          onRefresh: _load,
          children: [for (final meeting in items) _MeetingCard(meeting: meeting, onTap: () => _open(meeting))],
        ),
      ),
    ]);
  }

  Future<void> _open(Map<String, dynamic> meeting) async {
    await showModalBottomSheet(context: context, isScrollControlled: true, builder: (sheetContext) => _MeetingDetailSheetBody(meetingId: meeting['id'].toString(), myMembershipId: ref.read(authControllerProvider).value?.membership['id']?.toString()));
    await _load();
  }
}

class _MeetingCard extends StatelessWidget {
  const _MeetingCard({required this.meeting, required this.onTap});
  final Map<String, dynamic> meeting;
  final VoidCallback onTap;

  @override
  Widget build(BuildContext context) {
    final status = meeting['status']?.toString() ?? 'DRAFT';
    final color = _meetingStatusColors[status] ?? const Color(0xffa5adbc);
    final startsAt = meeting['startsAt']?.toString() ?? '';
    return GestureDetector(
      onTap: onTap,
      child: Container(
        margin: const EdgeInsets.only(bottom: 10),
        padding: const EdgeInsets.all(14),
        decoration: BoxDecoration(color: Colors.white, borderRadius: BorderRadius.circular(14), border: Border.all(color: const Color(0xffe8ecf4))),
        child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
          Row(children: [
            Expanded(child: Text(meeting['title']?.toString() ?? '', style: const TextStyle(fontSize: 15, fontWeight: FontWeight.w600))),
            Container(padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 2), decoration: BoxDecoration(color: color.withValues(alpha: .12), borderRadius: BorderRadius.circular(6)), child: Text(_meetingStatusLabels[status] ?? status, style: TextStyle(fontSize: 11, color: color))),
          ]),
          const SizedBox(height: 6),
          Row(children: [
            const Icon(Icons.schedule_outlined, size: 13, color: Color(0xffa5adbc)),
            const SizedBox(width: 4),
            Text(startsAt.length > 16 ? startsAt.substring(0, 16) : startsAt, style: const TextStyle(fontSize: 12, color: Color(0xffa5adbc))),
            const SizedBox(width: 10),
            const Icon(Icons.groups_2_outlined, size: 13, color: Color(0xffa5adbc)),
            const SizedBox(width: 4),
            Text('${meeting['participantCount'] ?? 0}', style: const TextStyle(fontSize: 12, color: Color(0xffa5adbc))),
            const Spacer(),
            if (meeting['myResponseStatus'] != null)
              Text(_responseLabels[meeting['myResponseStatus']] ?? meeting['myResponseStatus'].toString(), style: const TextStyle(fontSize: 11, color: Color(0xff8f98a8))),
          ]),
        ]),
      ),
    );
  }
}

class _MeetingDetailSheetBody extends ConsumerStatefulWidget {
  const _MeetingDetailSheetBody({required this.meetingId, this.myMembershipId});
  final String meetingId;
  final String? myMembershipId;

  @override
  ConsumerState<_MeetingDetailSheetBody> createState() => _MeetingDetailSheetBodyState();
}

class _MeetingDetailSheetBodyState extends ConsumerState<_MeetingDetailSheetBody> {
  Map<String, dynamic>? meeting;
  List<Map<String, dynamic>> participants = const [];
  Map<String, dynamic>? minutes;
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
      final detail = await api.getMeeting(widget.meetingId);
      final participantList = await api.meetingParticipants(widget.meetingId);
      final minutesResult = await api.meetingMinutes(widget.meetingId);
      if (!mounted) return;
      setState(() { meeting = detail; participants = participantList; minutes = minutesResult; });
    } catch (e) {
      if (mounted) setState(() => error = apiErrorMessage(e));
    }
  }

  void _toast(String text) => ScaffoldMessenger.of(context).showSnackBar(SnackBar(content: Text(text)));

  Future<void> _respond(String responseStatus) async {
    final submittedText = context.tr('workbench.responseSubmitted');
    final mine = participants.cast<Map<String, dynamic>?>().firstWhere(
      (participant) => (participant!['member'] as Map)['membershipId']?.toString() == widget.myMembershipId,
      orElse: () => null,
    );
    if (mine == null) return;
    try {
      await ref.read(mobileApiProvider).respondMeeting(widget.meetingId, responseStatus, mine['version'] as int);
      _toast(submittedText);
      await _load();
    } catch (e) {
      _toast(apiErrorMessage(e));
    }
  }

  Future<void> _transition(String status) async {
    final updatedText = context.tr('workbench.statusUpdated');
    final cancelReasonTitle = context.tr('workbench.cancelReason');
    String? reason;
    if (status == 'CANCELLED') {
      reason = await _promptText(cancelReasonTitle);
      if (reason == null) return;
    }
    try {
      await ref.read(mobileApiProvider).transitionMeeting(widget.meetingId, status, meeting!['version'] as int, reason: reason);
      _toast(updatedText);
      await _load();
    } catch (e) {
      _toast(apiErrorMessage(e));
    }
  }

  Future<String?> _promptText(String title) {
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
    final detail = meeting;
    if (error != null && detail == null) return SizedBox(height: 260, child: Center(child: Text(error!)));
    if (detail == null) return const SizedBox(height: 260, child: Center(child: CircularProgressIndicator()));
    final status = detail['status']?.toString() ?? 'DRAFT';
    final mine = participants.cast<Map<String, dynamic>?>().firstWhere(
      (participant) => (participant!['member'] as Map)['membershipId']?.toString() == widget.myMembershipId,
      orElse: () => null,
    );
    final content = minutes?['content'];

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
            Expanded(child: Text(detail['title']?.toString() ?? '', style: const TextStyle(fontSize: 18, fontWeight: FontWeight.w700))),
            Container(padding: const EdgeInsets.symmetric(horizontal: 10, vertical: 4), decoration: BoxDecoration(color: (_meetingStatusColors[status] ?? const Color(0xffa5adbc)).withValues(alpha: .12), borderRadius: BorderRadius.circular(8)), child: Text(_meetingStatusLabels[status] ?? status, style: TextStyle(fontSize: 12, color: _meetingStatusColors[status]))),
          ]),
          const SizedBox(height: 8),
          Text('${detail['startsAt']?.toString() ?? ''} · ${detail['durationMinutes'] ?? 0}${context.tr('workbench.minutes')}', style: const TextStyle(fontSize: 13, color: Color(0xff737c8d))),
          if (detail['location'] != null) Text('${context.tr('workbench.location')}：${detail['location']}', style: const TextStyle(fontSize: 13, color: Color(0xff737c8d))),
          if (detail['meetingUrl'] != null) Text('${context.tr('workbench.meetingUrl')}：${detail['meetingUrl']}', style: const TextStyle(fontSize: 13, color: Color(0xff3478ff))),
          const SizedBox(height: 14),
          // 邀请应答（仅本人是参会人且会议已安排时）
          if (mine != null && status == 'SCHEDULED') ...[
            Text(context.tr('workbench.respondInvitation'), style: const TextStyle(fontSize: 14, fontWeight: FontWeight.w600)),
            const SizedBox(height: 8),
            Wrap(spacing: 8, children: [
              for (final entry in const <({String status, String labelKey})>[
                (status: 'ACCEPTED', labelKey: 'accept'),
                (status: 'TENTATIVE', labelKey: 'tentative'),
                (status: 'DECLINED', labelKey: 'decline'),
              ])
                FilledButton.tonal(
                  onPressed: mine['responseStatus'] == entry.status ? null : () => _respond(entry.status),
                  child: Text(context.tr('workbench.response.${entry.labelKey}')),
                ),
            ]),
            const SizedBox(height: 14),
          ],
          // 状态流转（会议管理者）
          if (hasPermission(identity, 'meeting.status.update')) ...[
            Wrap(spacing: 8, runSpacing: 8, children: [
              if (status == 'DRAFT') ...[
                FilledButton(onPressed: () => _transition('SCHEDULED'), child: Text(context.tr('workbench.scheduleMeeting'))),
                FilledButton.tonal(onPressed: () => _transition('CANCELLED'), child: Text(context.tr('workbench.cancelMeeting'))),
              ],
              if (status == 'SCHEDULED') ...[
                FilledButton(onPressed: () => _transition('IN_PROGRESS'), child: Text(context.tr('workbench.startMeeting'))),
                FilledButton.tonal(onPressed: () => _transition('CANCELLED'), child: Text(context.tr('workbench.cancelMeeting'))),
              ],
              if (status == 'IN_PROGRESS') FilledButton(onPressed: () => _transition('COMPLETED'), child: Text(context.tr('workbench.completeMeeting'))),
            ]),
            const SizedBox(height: 14),
          ],
          Text(context.tr('workbench.participants'), style: const TextStyle(fontSize: 15, fontWeight: FontWeight.w600)),
          const SizedBox(height: 8),
          if (participants.isEmpty)
            Text(context.tr('workbench.noParticipants'), style: const TextStyle(fontSize: 13, color: Color(0xffa5adbc)))
          else
            for (final participant in participants) Padding(
              padding: const EdgeInsets.only(bottom: 6),
              child: Row(children: [
                const Icon(Icons.person_outline_rounded, size: 16, color: Color(0xff8f98a8)),
                const SizedBox(width: 8),
                Expanded(child: Text((participant['member'] as Map)['displayName']?.toString() ?? (participant['member'] as Map)['account']?.toString() ?? '')),
                Text(_roleLabels[participant['role']?.toString()] ?? participant['role']?.toString() ?? '', style: const TextStyle(fontSize: 12, color: Color(0xff8f98a8))),
                const SizedBox(width: 8),
                Text(_responseLabels[participant['responseStatus']?.toString()] ?? '', style: const TextStyle(fontSize: 12, color: Color(0xffa5adbc))),
              ]),
            ),
          const SizedBox(height: 16),
          Text(context.tr('workbench.minutesSection'), style: const TextStyle(fontSize: 15, fontWeight: FontWeight.w600)),
          const SizedBox(height: 8),
          if (minutes == null)
            Text(context.tr('workbench.noMinutes'), style: const TextStyle(fontSize: 13, color: Color(0xffa5adbc)))
          else ...[
            Builder(builder: (rowContext) {
              final published = minutes!['status'] == 'PUBLISHED';
              final statusLabel = published ? context.tr('workbench.published') : context.tr('workbench.draft');
              return Row(children: [
                Text(statusLabel, style: TextStyle(fontSize: 12, color: published ? const Color(0xff1fbf75) : const Color(0xffa5adbc))),
              ]);
            }),
            if (content is Map && content['summary'] != null) ...[
              const SizedBox(height: 6),
              Text(content['summary'].toString(), style: const TextStyle(fontSize: 13)),
            ],
            if (content is Map && content['decisions'] is List && (content['decisions'] as List).isNotEmpty) ...[
              const SizedBox(height: 8),
              Text(context.tr('workbench.decisions'), style: const TextStyle(fontSize: 13, fontWeight: FontWeight.w600)),
              for (final decision in (content['decisions'] as List)) Text('• $decision', style: const TextStyle(fontSize: 12, color: Color(0xff737c8d))),
            ],
          ],
        ],
      ),
    );
  }
}

class _MeetingCreateSheet {
  static Future<Map<String, dynamic>?> show(BuildContext context) {
    return showModalBottomSheet<Map<String, dynamic>>(context: context, isScrollControlled: true, builder: (sheetContext) => const _MeetingCreateSheetBody());
  }
}

class _MeetingCreateSheetBody extends StatefulWidget {
  const _MeetingCreateSheetBody();
  @override
  State<_MeetingCreateSheetBody> createState() => _MeetingCreateSheetBodyState();
}

class _MeetingCreateSheetBodyState extends State<_MeetingCreateSheetBody> {
  final title = TextEditingController();
  final description = TextEditingController();
  DateTime date = DateTime.now().add(const Duration(days: 1));
  TimeOfDay time = const TimeOfDay(hour: 9, minute: 0);
  int duration = 60;

  @override
  void dispose() {
    title.dispose();
    description.dispose();
    super.dispose();
  }

  String get startsAtIso {
    final utc = DateTime.utc(date.year, date.month, date.day, time.hour, time.minute);
    return utc.toIso8601String();
  }

  @override
  Widget build(BuildContext context) => Padding(
    padding: EdgeInsets.fromLTRB(18, 12, 18, MediaQuery.of(context).viewInsets.bottom + 24),
    child: Column(mainAxisSize: MainAxisSize.min, crossAxisAlignment: CrossAxisAlignment.start, children: [
      Center(child: Container(width: 40, height: 4, decoration: BoxDecoration(color: const Color(0xffd7dce7), borderRadius: BorderRadius.circular(2)))),
      const SizedBox(height: 16),
      Text(context.tr('workbench.newMeeting'), style: const TextStyle(fontSize: 17, fontWeight: FontWeight.w700)),
      const SizedBox(height: 14),
      TextField(controller: title, decoration: InputDecoration(labelText: context.tr('workbench.meetingTitle'))),
      const SizedBox(height: 10),
      Row(children: [
        Expanded(child: OutlinedButton(onPressed: () async {
          final picked = await showDatePicker(context: context, initialDate: date, firstDate: DateTime(2024), lastDate: DateTime(2100));
          if (picked != null) setState(() => date = picked);
        }, child: Text('${date.year}-${date.month.toString().padLeft(2, '0')}-${date.day.toString().padLeft(2, '0')}'))),
        const SizedBox(width: 8),
        Expanded(child: OutlinedButton(onPressed: () async {
          final picked = await showTimePicker(context: context, initialTime: time);
          if (picked != null) setState(() => time = picked);
        }, child: Text('${time.hour.toString().padLeft(2, '0')}:${time.minute.toString().padLeft(2, '0')}'))),
        const SizedBox(width: 8),
        Expanded(child: DropdownButtonFormField<int>(
          initialValue: duration,
          decoration: InputDecoration(labelText: context.tr('workbench.minutes')),
          items: const [30, 60, 90, 120].map((value) => DropdownMenuItem(value: value, child: Text('$value'))).toList(),
          onChanged: (value) => setState(() => duration = value ?? 60),
        )),
      ]),
      const SizedBox(height: 10),
      TextField(controller: description, maxLines: 3, decoration: InputDecoration(labelText: context.tr('workbench.meetingDescription'))),
      const SizedBox(height: 16),
      Row(mainAxisAlignment: MainAxisAlignment.end, children: [
        TextButton(onPressed: () => Navigator.pop(context), child: Text(context.tr('common.cancel'))),
        const SizedBox(width: 8),
        FilledButton(
          onPressed: title.text.trim().isEmpty ? null : () => Navigator.pop(context, {
            'title': title.text.trim(),
            'startsAt': startsAtIso,
            'durationMinutes': duration,
            if (description.text.trim().isNotEmpty) 'description': description.text.trim(),
          }),
          child: Text(context.tr('common.create')),
        ),
      ]),
    ]),
  );
}
