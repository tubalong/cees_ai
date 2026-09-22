import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter/services.dart';
import 'package:flutter_markdown_plus/flutter_markdown_plus.dart';
import 'package:hive_flutter/hive_flutter.dart';
import 'package:dio/dio.dart';

import '../../core/auth_controller.dart';
import '../../core/l10n.dart';
import '../../core/mobile_api.dart';
import '../../shared/layout.dart';

enum AssistantMode { casual, work }

class _ChatMessage {
    const _ChatMessage({required this.id, required this.role, required this.content, this.resources = const [], this.sources = const []});
    final String id;
    final String role;
    final String content;
    final List<_ChatResource> resources;
    final List<_ChatSource> sources;
}

/// 待确认的写操作。客户端只持有 draftId 与展示用预览，
/// 参数快照保存在服务端，确认时不可能被前端篡改。
class _PendingActionConfirmation {
    _PendingActionConfirmation({required this.draftId, required this.title, required this.fields, required this.expiresAt});
    final String draftId;
    final String title;
    final List<({String label, String value})> fields;
    final DateTime expiresAt;
    /// 请求进行中：禁用按钮，避免重复提交。
    bool resolving = false;
    /// 终态：executed / cancelled / failed；null 表示仍待确认。
    String? resolved;
    String? resultSummary;

    bool get expired => resolved == null && expiresAt.isBefore(DateTime.now());
}

class _ChatResource {
    const _ChatResource({required this.id, required this.type, this.url, this.content});
    final String id;
    final String type;
    final String? url;
    final String? content;
}

class _ChatSource {
    const _ChatSource({required this.id, required this.title, required this.url, this.domain = '', this.snippet = ''});
    final String id;
    final String title;
    final String url;
    final String domain;
    final String snippet;
}

class HomePage extends ConsumerStatefulWidget {
  const HomePage({super.key});
  @override
    ConsumerState<HomePage> createState() => _HomePageState();
}

class _HomePageState extends ConsumerState<HomePage> {
  AssistantMode mode = AssistantMode.work;
  final composer = TextEditingController();
    final conversations = <AssistantMode, List<_ChatMessage>>{};
    /// 待确认的写操作（AI 提议的业务变更）。独立于消息列表保存：
    /// 流式回答会反复重建气泡，卡片放在消息里会被重建丢失；
    /// 体验上也更像一个待处理的动作条，紧贴输入区上方。
    final pendingConfirmations = <_PendingActionConfirmation>[];
    final pending = <AssistantMode, bool>{};
    final errors = <AssistantMode, String?>{};
        final conversationIds = <AssistantMode, String?>{};
        final turnIds = <AssistantMode, String?>{};
        final lastSeq = <AssistantMode, int>{};
        final cancelTokens = <AssistantMode, CancelToken>{};
        final selectedPrompt = <AssistantMode, String?>{};

    @override
    void initState() {
        super.initState();
        WidgetsBinding.instance.addPostFrameCallback((_) => _loadConversations());
    }

    List<_ChatMessage> _messagesOf(AssistantMode mode) => conversations.putIfAbsent(mode, () => [
        _ChatMessage(id: 'welcome', role: 'assistant', content: mode == AssistantMode.work
                ? context.tr('home.workWelcome')
                : context.tr('home.casualWelcome')),
    ]);

  @override
  void dispose() {
        for (final token in cancelTokens.values) {
            token.cancel('页面已关闭');
        }
    composer.dispose();
    super.dispose();
  }

    String _cachePrefix() {
        final identity = ref.read(authControllerProvider).value;
        final tenantId = identity?.tenant['id']?.toString() ?? 'unknown-tenant';
        final membershipId = identity?.membership['id']?.toString() ?? 'unknown-member';
        return 'chat.$tenantId.$membershipId';
    }

    String _cacheKey(AssistantMode chatMode) => '${_cachePrefix()}.${chatMode.name}';

    Future<void> _loadConversations() async {
        try {
            final items = await ref.read(mobileApiProvider).conversations();
            for (final item in items) {
                final id = item['id']?.toString();
                if (id == null) continue;
                final chatMode = item['mode']?.toString() == 'ultra' ? AssistantMode.casual : AssistantMode.work;
                conversationIds[chatMode] ??= id;
            }
            final box = Hive.box<dynamic>('settings');
            for (final chatMode in AssistantMode.values) {
                final raw = box.get(_cacheKey(chatMode));
                if (raw is List) conversations[chatMode] = raw.map((item) { final map = Map<String, dynamic>.from(item as Map); final rawResources = map['resources']; final rawSources = map['sources']; return _ChatMessage(id: map['id'].toString(), role: map['role'].toString(), content: map['content'].toString(), resources: rawResources is List ? rawResources.map((resource) { final value = Map<String, dynamic>.from(resource as Map); return _ChatResource(id: (value['id'] ?? value['resourceId'] ?? '').toString(), type: value['type']?.toString() ?? 'DOCUMENT', url: value['url']?.toString() ?? value['resourceUrl']?.toString(), content: value['content']?.toString()); }).toList() : const [], sources: rawSources is List ? rawSources.map((source) { final value = Map<String, dynamic>.from(source as Map); return _ChatSource(id: (value['id'] ?? '').toString(), title: (value['title'] ?? '').toString(), url: (value['url'] ?? '').toString(), domain: (value['domain'] ?? '').toString(), snippet: (value['snippet'] ?? '').toString()); }).toList() : const []); }).toList();
            }
            if (mounted) setState(() {});
        } catch (error) {
            if (mounted) setState(() => errors[mode] = apiErrorMessage(error));
        }
    }

    Future<void> _saveMessages(AssistantMode chatMode) async {
        final box = Hive.box<dynamic>('settings');
        await box.put(_cacheKey(chatMode), _messagesOf(chatMode).map((item) => {'id': item.id, 'role': item.role, 'content': item.content, 'resources': item.resources.map((resource) => {'id': resource.id, 'type': resource.type, 'url': resource.url, 'content': resource.content}).toList(), 'sources': item.sources.map((source) => {'id': source.id, 'title': source.title, 'url': source.url, 'domain': source.domain, 'snippet': source.snippet}).toList()}).toList());
    }

    /// 确认或取消写操作草稿。只提交 draftId：服务端重新鉴权并重新校验参数，
    /// 因此即使权限在确认前被回收也不会误写（会返回 403 并在这里提示）。
    Future<void> resolveActionDraft(_PendingActionConfirmation confirmation, bool confirm) async {
        if (confirmation.resolving) return;
        setState(() => confirmation.resolving = true);
        try {
            final api = ref.read(mobileApiProvider);
            final result = confirm
                ? await api.confirmActionDraft(confirmation.draftId)
                : await api.cancelActionDraft(confirmation.draftId);
            final status = (result['status'] ?? '').toString();
            if (!mounted) return;
            setState(() {
                confirmation.resolving = false;
                confirmation.resolved = status == 'EXECUTED' ? 'executed' : status == 'REJECTED' ? 'cancelled' : 'failed';
                confirmation.resultSummary = (result['summary'] ?? '').toString();
            });
        } catch (error) {
            if (mounted) setState(() => confirmation.resolving = false);
            final text = apiErrorMessage(error);
            if (mounted) ScaffoldMessenger.of(context).showSnackBar(SnackBar(content: Text(text)));
        }
    }

  @override
  Widget build(BuildContext context) {
    final casual = mode == AssistantMode.casual;
    // 键盘弹起时 Scaffold 已自动收缩 body，只需给一点呼吸留白；
    // 否则必须让出悬浮底部导航占用的真实高度（导航 + Home Indicator）。
    final keyboardOpen = MediaQuery.viewInsetsOf(context).bottom > 0;
    return Scaffold(
      backgroundColor:
          casual ? const Color(0xfffff7f3) : const Color(0xfff2f5ff),
      body: SafeArea(
          bottom: false,
          child: Column(children: [
            _TopBar(
                mode: mode,
                onModeChanged: (value) => setState(() => mode = value)),
            Expanded(
                child: casual
                    ? _CasualConversation(
                        messages: _messagesOf(AssistantMode.casual),
                        pending: pending[AssistantMode.casual] ?? false,
                        error: errors[AssistantMode.casual],
                        onSwitchToWork: () =>
                            setState(() => mode = AssistantMode.work))
                    : _WorkConversation(
                        messages: _messagesOf(AssistantMode.work),
                        pending: pending[AssistantMode.work] ?? false,
                        error: errors[AssistantMode.work])),
            // 待确认的写操作：紧贴输入区上方，确认前不会产生任何业务变更。
            for (final confirmation in pendingConfirmations)
                _ActionConfirmationCard(
                    confirmation: confirmation,
                    onResolve: (confirm) => resolveActionDraft(confirmation, confirm)),
            _Composer(
                controller: composer, casual: casual, onSend: sendMessage,
                pending: pending[mode] ?? false, onCancel: cancelMessage,
                prompt: selectedPrompt[mode],
                onPromptChanged: (value) => setState(() => selectedPrompt[mode] = value)),
            // 键盘弹出时收起工具条，避免输入区被挤出可视范围。
            if (!casual && !keyboardOpen) const _ToolStrip(),
            SizedBox(height: keyboardOpen ? 8 : bottomNavInset(context) + 12),
          ])),
    );
  }

    Future<void> sendMessage() async {
    // 新消息提交时清掉已处理的卡片，避免历史动作堆在输入区上方。
    pendingConfirmations.removeWhere((item) => item.resolved != null);
    final prompt = selectedPrompt[mode];
    final text = composer.text.trim();
        final content = [prompt, text].where((e) => e != null && e.isNotEmpty).join('\n');
        if (content.isEmpty || (pending[mode] ?? false)) return;
        final activeMode = mode;
        final emptyAnswerMessage = context.tr('home.emptyAnswer');
        final answerTooLongMessage = context.tr('home.answerTooLong');
        final connectionInterruptedMessage = context.tr('home.connectionInterrupted');
        final now = DateTime.now().millisecondsSinceEpoch;
                final userMessage = _ChatMessage(id: 'm$now', role: 'user', content: content);
                setState(() {
                    _messagesOf(activeMode).add(userMessage);
                    pending[activeMode] = true;
                    errors[activeMode] = null;
                });
                composer.clear();
                selectedPrompt[activeMode] = null;
                final api = ref.read(mobileApiProvider);
                final createdConversation = conversationIds[activeMode] == null ? await api.createConversation(title: content) : null;
                final conversationId = conversationIds[activeMode] ?? createdConversation?['id']?.toString();
                if (conversationId == null) throw StateError('创建会话失败');
                conversationIds[activeMode] = conversationId;
                final cancelToken = CancelToken();
                cancelTokens[activeMode] = cancelToken;
                final idempotencyKey = 'mobile-$conversationId-$now';
                var answer = '';
                final resources = <_ChatResource>[];
                final sources = <_ChatSource>[];
                final toolTypes = <String, String>{};
                var terminal = false;
                Future<void> consume(Stream<Map<String, dynamic>> stream) async {
                    await for (final event in stream) {
                        final seq = (event['seq'] as num?)?.toInt() ?? 0;
                        if (seq <= (lastSeq[activeMode] ?? 0)) continue;
                        lastSeq[activeMode] = seq;
                        final type = event['type']?.toString();
                        if (type == 'started') turnIds[activeMode] = event['turnId']?.toString();
                        if (type == 'content_delta') {
                            answer += event['text']?.toString() ?? '';
                            if (mounted) setState(() { _messagesOf(activeMode).removeWhere((item) => item.id == 'streaming'); _messagesOf(activeMode).add(_ChatMessage(id: 'streaming', role: 'assistant', content: answer, resources: List.of(resources), sources: List.of(sources))); });
                        }
                        if (type == 'tool_call') { final name = event['name']?.toString() ?? ''; final toolCallId = event['toolCallId']?.toString() ?? ''; if (name == 'generate_document') { toolTypes[toolCallId] = 'DOCUMENT'; } else if (name == 'generate_image') { toolTypes[toolCallId] = 'IMAGE'; } }
                        if (type == 'tool_result' && event['status'] == 'awaiting_confirmation') {
                            // 写操作：服务端已落待确认草稿，副作用尚未发生。
                            // 用户点击确认后本页只提交 draftId，参数快照留在服务端。
                            final raw = event['confirmation'];
                            if (raw is Map) {
                                final draft = Map<String, dynamic>.from(raw);
                                final rawFields = draft['fields'];
                                final fields = <({String label, String value})>[];
                                if (rawFields is List) {
                                    for (final item in rawFields) {
                                        if (item is Map) {
                                            fields.add((label: (item['label'] ?? '').toString(), value: (item['value'] ?? '').toString()));
                                        }
                                    }
                                }
                                final confirmation = _PendingActionConfirmation(
                                    draftId: (draft['draftId'] ?? '').toString(),
                                    title: (draft['title'] ?? '待确认操作').toString(),
                                    fields: fields,
                                    expiresAt: DateTime.tryParse((draft['expiresAt'] ?? '').toString()) ?? DateTime.now(),
                                );
                                if (mounted) setState(() => pendingConfirmations.add(confirmation));
                            }
                        }
                        if (type == 'tool_result' && event['status'] == 'completed') {
                            final rawSources = event['sources'];
                            if (rawSources is List) { for (final raw in rawSources) { if (raw is Map) { final map = Map<String, dynamic>.from(raw); sources.add(_ChatSource(id: (map['id'] ?? '').toString(), title: (map['title'] ?? '').toString(), url: (map['url'] ?? '').toString(), domain: (map['domain'] ?? '').toString(), snippet: (map['snippet'] ?? '').toString())); } } if (sources.isNotEmpty && mounted) setState(() { _messagesOf(activeMode).removeWhere((item) => item.id == 'streaming'); _messagesOf(activeMode).add(_ChatMessage(id: 'streaming', role: 'assistant', content: answer, resources: List.of(resources), sources: List.of(sources))); }); }
                            final resource = event['resource'] is Map ? Map<String, dynamic>.from(event['resource'] as Map) : <String, dynamic>{};
                            final resourceId = (resource['id'] ?? event['resourceId'])?.toString();
                            final resourceType = (resource['type'] ?? toolTypes[event['toolCallId']?.toString() ?? ''])?.toString() ?? 'IMAGE';
                            final resourceUrl = (event['resourceUrl'] ?? resource['url'])?.toString();
                            if (resourceId != null && resourceId.isNotEmpty) { resources.add(_ChatResource(id: resourceId, type: resourceType, url: resourceUrl)); if (mounted) setState(() { _messagesOf(activeMode).removeWhere((item) => item.id == 'streaming'); _messagesOf(activeMode).add(_ChatMessage(id: 'streaming', role: 'assistant', content: answer, resources: List.of(resources), sources: List.of(sources))); }); }
                        }
                        if (type == 'error') { terminal = true; throw StateError((event['error'] as Map?)?['message']?.toString() ?? emptyAnswerMessage); }
                        if (type == 'completed') { terminal = true; if (event['finishReason'] == 'length' && mounted) setState(() => errors[activeMode] = answerTooLongMessage); }
                    }
                }
                try {
                    await consume(api.createTurnStream(conversationId, content, idempotencyKey, activeMode == AssistantMode.casual ? 'standard' : 'ultra', cancelToken: cancelToken));
                    for (var attempt = 0; attempt < 3 && !terminal && turnIds[activeMode] != null; attempt += 1) {
                        await consume(api.replayTurnStream(conversationId, turnIds[activeMode]!, lastSeq[activeMode] ?? 0, cancelToken: cancelToken));
                    }
                    if (!terminal) throw StateError(connectionInterruptedMessage);
                    _messagesOf(activeMode).removeWhere((item) => item.id == 'streaming');
                    if (answer.isNotEmpty) _messagesOf(activeMode).add(_ChatMessage(id: 'a$now', role: 'assistant', content: answer, resources: List.of(resources), sources: List.of(sources)));
                    await _saveMessages(activeMode);
                } catch (e) {
                                        if (!cancelToken.isCancelled && !terminal && turnIds[activeMode] != null) {
                                            try {
                                                for (var attempt = 0; attempt < 3 && !terminal; attempt += 1) {
                                                    await consume(api.replayTurnStream(conversationId, turnIds[activeMode]!, lastSeq[activeMode] ?? 0, cancelToken: cancelToken));
                                                }
                                                if (!terminal) throw StateError(connectionInterruptedMessage);
                                                _messagesOf(activeMode).removeWhere((item) => item.id == 'streaming');
                                                if (answer.isNotEmpty) _messagesOf(activeMode).add(_ChatMessage(id: 'a$now', role: 'assistant', content: answer, resources: List.of(resources), sources: List.of(sources)));
                                                await _saveMessages(activeMode);
                                            } catch (replayError) {
                                                if (mounted) setState(() => errors[activeMode] = apiErrorMessage(replayError));
                                            }
                                        } else if (mounted && !cancelToken.isCancelled) {
                                            setState(() => errors[activeMode] = apiErrorMessage(e));
                                        }
                } finally {
                    cancelTokens.remove(activeMode);
                    if (mounted) setState(() { pending[activeMode] = false; turnIds[activeMode] = null; });
                }
  }

    Future<void> cancelMessage() async {
        final chatMode = mode;
        cancelTokens[chatMode]?.cancel('用户取消');
        final conversationId = conversationIds[chatMode];
        final turnId = turnIds[chatMode];
        if (conversationId != null && turnId != null) await ref.read(mobileApiProvider).cancelTurn(conversationId, turnId);
        if (mounted) setState(() => pending[chatMode] = false);
  }
}

class _TopBar extends StatelessWidget {
  const _TopBar({required this.mode, required this.onModeChanged});
  final AssistantMode mode;
  final ValueChanged<AssistantMode> onModeChanged;

  @override
  Widget build(BuildContext context) => Container(
        height: isCompactWidth(context) ? kCompactTopBarHeight : kTopBarHeight,
        padding: EdgeInsets.symmetric(horizontal: pagePadding(context) + 2),
        color: Colors.white.withValues(alpha: .72),
        child:
            Row(mainAxisAlignment: MainAxisAlignment.spaceBetween, children: [
          const _CircleButton(icon: Icons.menu_rounded),
          Container(
              height: 44,
              padding: const EdgeInsets.all(3),
              decoration: BoxDecoration(
                  color: Colors.white, borderRadius: BorderRadius.circular(22)),
              child: Row(children: [
                _ModeButton(
                    label: context.tr('home.casual'),
                    selected: mode == AssistantMode.casual,
                    casual: true,
                    onTap: () => onModeChanged(AssistantMode.casual)),
                _ModeButton(
                    label: context.tr('home.work'),
                    selected: mode == AssistantMode.work,
                    casual: false,
                    onTap: () => onModeChanged(AssistantMode.work)),
              ])),
          const _CircleButton(icon: Icons.add_rounded),
        ]),
      );
}

class _ModeButton extends StatelessWidget {
  const _ModeButton(
      {required this.label,
      required this.selected,
      required this.casual,
      required this.onTap});
  final String label;
  final bool selected;
  final bool casual;
  final VoidCallback onTap;
  @override
  Widget build(BuildContext context) => InkWell(
      onTap: onTap,
      borderRadius: BorderRadius.circular(18),
      child: AnimatedContainer(
          duration: const Duration(milliseconds: 200),
          width: 64,
          constraints: const BoxConstraints(minHeight: 44),
          alignment: Alignment.center,
          decoration: BoxDecoration(
              borderRadius: BorderRadius.circular(18),
              gradient: selected
                  ? LinearGradient(
                      colors: casual
                          ? const [Color(0xffff6a50), Color(0xffff4f91)]
                          : const [Color(0xff3478ff), Color(0xff8b4dff)])
                  : null),
          child: Text(label,
              style: TextStyle(
                  color: selected ? Colors.white : const Color(0xff747d8e),
                  fontWeight: selected ? FontWeight.w600 : FontWeight.w400))));
}

class _CircleButton extends StatelessWidget {
  const _CircleButton({required this.icon});
  final IconData icon;
  @override
  Widget build(BuildContext context) => IconButton(
      onPressed: () {},
      icon: Icon(icon),
      style: IconButton.styleFrom(
          backgroundColor: Colors.white, fixedSize: const Size(44, 44)));
}

class _WorkConversation extends StatelessWidget {
    const _WorkConversation({required this.messages, required this.pending, this.error});
    final List<_ChatMessage> messages;
    final bool pending;
    final String? error;
    @override
    Widget build(BuildContext context) => ListView(
            // 紧凑屏（iPhone SE / mini）必须收紧到 14pt，且不得再出现左右不等
            // 的 18 / 16 组合；统一从共享 layout.dart 推导。
            padding: EdgeInsets.fromLTRB(
                pagePadding(context), 12, pagePadding(context), 12),
            children: [
                for (final message in messages)
                    message.role == 'user'
                            ? _Bubble(text: message.content, mine: true, work: true)
                            : _AssistantBubble(text: message.content, resources: message.resources, sources: message.sources, child: MarkdownBody(data: message.content, selectable: true)),
                if (pending) _AssistantBubble(child: Text(context.tr('home.thinking'))),
                if (error != null)
                    Padding(
                        padding: const EdgeInsets.only(top: 10),
                        child: Text(error!, style: const TextStyle(color: Color(0xfff0564a), fontSize: 12)),
                    ),
            ]);
}

class _CasualConversation extends StatelessWidget {
    const _CasualConversation({required this.messages, required this.pending, this.error, required this.onSwitchToWork});
    final List<_ChatMessage> messages;
    final bool pending;
    final String? error;
  final VoidCallback onSwitchToWork;
  @override
    Widget build(BuildContext context) =>
            ListView(padding: EdgeInsets.fromLTRB(pagePadding(context), 14, pagePadding(context), 12), children: [
        const Center(
            child: Chip(
                avatar: Icon(Icons.sentiment_satisfied_alt_outlined,
                    size: 16, color: Color(0xffff8a18)),
                label: Text('闲聊模式',
                    style: TextStyle(color: Color(0xffff8a18), fontSize: 11)),
                side: BorderSide.none,
                backgroundColor: Colors.white)),
                for (final message in messages)
                    message.role == 'user'
                            ? _Bubble(text: message.content, mine: true, work: false)
                            : _AssistantBubble(casual: true, text: message.content, resources: message.resources, sources: message.sources, child: MarkdownBody(data: message.content, selectable: true)),
                if (pending) _AssistantBubble(casual: true, child: Text(context.tr('home.thinking'))),
                if (error != null)
                    Padding(
                        padding: const EdgeInsets.only(top: 10),
                        child: Text(error!, style: const TextStyle(color: Color(0xfff0564a), fontSize: 12)),
                    ),
      ]);
}

class _CopyAction extends StatelessWidget {
    const _CopyAction({required this.text, this.indent = 0});
    final String text;
    final double indent;

    Future<void> _copy(BuildContext context) async {
        await Clipboard.setData(ClipboardData(text: text));
        if (context.mounted) {
            ScaffoldMessenger.of(context)
                ..hideCurrentSnackBar()
                ..showSnackBar(const SnackBar(
                        content: Text('已复制'), duration: Duration(seconds: 1)));
        }
    }

    @override
    Widget build(BuildContext context) => Padding(
                padding: EdgeInsets.only(top: 6, left: indent),
                child: InkWell(
                    onTap: () => _copy(context),
                    borderRadius: BorderRadius.circular(8),
                    // 图标 14 + 文字 11 的实际高度很小，用垂直内边距把
                    // 可点击区域补到 iOS 要求的 44pt。
                    child: const Padding(
                        padding: EdgeInsets.symmetric(vertical: 13, horizontal: 2),
                        child: Row(
                            mainAxisSize: MainAxisSize.min,
                            children: [
                                Icon(Icons.content_copy_rounded,
                                        size: 14, color: Color(0xff9ca4b4)),
                                SizedBox(width: 4),
                                Text('复制',
                                        style: TextStyle(fontSize: 11, color: Color(0xff9ca4b4))),
                            ],
                        ),
                    ),
                ),
            );
}

/// 写操作待确认卡片。
///
/// 展示服务端返回的参数快照预览，并把用户的决策还原为一次「只带 draftId」的请求——
/// 参数不在客户端流转，因此不可能被篡改。确认后立刻转为终态文案，避免重复点击。
class _ActionConfirmationCard extends StatelessWidget {
    const _ActionConfirmationCard({required this.confirmation, required this.onResolve});
    final _PendingActionConfirmation confirmation;
    final ValueChanged<bool> onResolve;

    @override
    Widget build(BuildContext context) {
        final resolved = confirmation.resolved;
        String statusText;
        Color statusColor;
        if (resolved == 'executed') {
            statusText = '已执行';
            statusColor = const Color(0xff12b76a);
        } else if (resolved == 'cancelled') {
            statusText = '已取消';
            statusColor = const Color(0xff8f98a8);
        } else if (resolved == 'failed') {
            statusText = '执行失败';
            statusColor = const Color(0xfff0564a);
        } else if (confirmation.expired) {
            statusText = '已过期';
            statusColor = const Color(0xff8f98a8);
        } else {
            statusText = '待确认';
            statusColor = const Color(0xff5964ff);
        }

        return Container(
            key: ValueKey('action-confirmation-${confirmation.draftId}'),
            margin: EdgeInsets.fromLTRB(pagePadding(context), 0, pagePadding(context), 10),
            padding: const EdgeInsets.all(14),
            decoration: BoxDecoration(
                color: const Color(0xfff7f8ff),
                borderRadius: BorderRadius.circular(16),
                border: Border.all(color: const Color(0xffe3e5ff))),
            child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
                Row(children: [
                    Icon(Icons.fact_check_outlined, size: 18, color: statusColor),
                    const SizedBox(width: 6),
                    Expanded(
                        child: Text(confirmation.title,
                            maxLines: 1,
                            overflow: TextOverflow.ellipsis,
                            style: const TextStyle(fontSize: 14, fontWeight: FontWeight.w700, color: Color(0xff273142)))),
                    Text(statusText, style: TextStyle(fontSize: 11, fontWeight: FontWeight.w600, color: statusColor)),
                ]),
                const SizedBox(height: 10),
                for (final field in confirmation.fields)
                    Padding(
                        padding: const EdgeInsets.only(bottom: 6),
                        child: Row(crossAxisAlignment: CrossAxisAlignment.start, children: [
                            SizedBox(
                                width: 76,
                                child: Text(field.label, style: const TextStyle(fontSize: 12, color: Color(0xff8f98a8)))),
                            Expanded(
                                child: Text(field.value, style: const TextStyle(fontSize: 12, height: 1.4, color: Color(0xff273142)))),
                        ])),
                if (resolved != null)
                    Padding(
                        padding: const EdgeInsets.only(top: 4),
                        child: Text(confirmation.resultSummary ?? '', style: const TextStyle(fontSize: 12, color: Color(0xff4b5563))))
                else if (confirmation.expired)
                    const Padding(
                        padding: EdgeInsets.only(top: 4),
                        child: Text('该操作已过期，请重新发起对话生成新的待确认操作。',
                            style: TextStyle(fontSize: 12, color: Color(0xff8f98a8))))
                else ...[
                    const SizedBox(height: 8),
                    Row(children: [
                        // Apple 建议最小触控目标 44pt，两个按钮都按 44 高实现。
                        SizedBox(
                            height: 44,
                            child: FilledButton(
                                onPressed: confirmation.resolving ? null : () => onResolve(true),
                                style: FilledButton.styleFrom(
                                    backgroundColor: const Color(0xff5964ff),
                                    padding: const EdgeInsets.symmetric(horizontal: 20)),
                                child: confirmation.resolving
                                    ? const SizedBox(
                                        width: 16, height: 16,
                                        child: CircularProgressIndicator(strokeWidth: 2, color: Colors.white))
                                    : const Text('确认执行'))),
                        const SizedBox(width: 10),
                        SizedBox(
                            height: 44,
                            child: OutlinedButton(
                                onPressed: confirmation.resolving ? null : () => onResolve(false),
                                child: const Text('取消'))),
                    ]),
                    const SizedBox(height: 6),
                    const Text('确认前不会产生任何变更', style: TextStyle(fontSize: 11, color: Color(0xff8f98a8))),
                ],
            ]),
        );
    }
}

class _Bubble extends StatelessWidget {
    const _Bubble({required this.text, required this.mine, required this.work});
    final String text;
    final bool mine;
    final bool work;
    @override
    Widget build(BuildContext context) => Column(
                crossAxisAlignment:
                        mine ? CrossAxisAlignment.end : CrossAxisAlignment.start,
                children: [
                    Align(
                            alignment: mine ? Alignment.centerRight : Alignment.centerLeft,
                            child: Container(
                                    constraints: BoxConstraints(
                                            maxWidth: bubbleMaxWidth(context)),
                                    margin: const EdgeInsets.only(top: 12),
                                    padding:
                                            const EdgeInsets.symmetric(horizontal: 14, vertical: 12),
                                    decoration: BoxDecoration(
                                            gradient: mine
                                                    ? LinearGradient(
                                                            colors: work
                                                                    ? const [Color(0xff3478ff), Color(0xff8b4dff)]
                                                                    : const [Color(0xffff6a50), Color(0xffff4f91)])
                                                    : null,
                                            color: mine ? null : Colors.white,
                                            borderRadius: BorderRadius.circular(18)),
                                    child: Text(text,
                                            style: TextStyle(
                                                    color: mine ? Colors.white : const Color(0xff273142),
                                                    height: 1.45)))),
                    _CopyAction(text: text),
                ],
            );
}

class _AssistantBubble extends StatelessWidget {
        const _AssistantBubble({required this.child, this.casual = false, this.text, this.resources = const [], this.sources = const []});
  final Widget child;
  final bool casual;
  final String? text;
    final List<_ChatResource> resources;
        final List<_ChatSource> sources;
  @override
  Widget build(BuildContext context) => Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Padding(
              padding: const EdgeInsets.only(top: 14),
              child: Row(crossAxisAlignment: CrossAxisAlignment.start, children: [
                Container(
                    width: 34,
                    height: 34,
                    decoration: BoxDecoration(
                        shape: BoxShape.circle,
                        gradient: LinearGradient(
                            colors: casual
                                ? const [Color(0xffff6a68), Color(0xffff4f91)]
                                : const [Color(0xff3478ff), Color(0xff8b4dff)])),
                    child: const Icon(Icons.auto_awesome,
                        color: Colors.white, size: 17)),
                const SizedBox(width: 8),
                Expanded(
                    child: Container(
                        padding: const EdgeInsets.all(14),
                        decoration: BoxDecoration(
                            color: Colors.white,
                            borderRadius: BorderRadius.circular(18)),
                        child: DefaultTextStyle(
                            style: const TextStyle(
                                color: Color(0xff273142),
                                height: 1.5,
                                fontSize: 14),
                            child: Column(
                                crossAxisAlignment: CrossAxisAlignment.start,
                                children: [child, ...resources.map((resource) => _ResourcePreview(resource: resource)), ...sources.map((source) => _SourcePreview(source: source))]))))
              ])),
          if (text != null) _CopyAction(text: text!, indent: 42),
        ],
      );
}

class _ResourcePreview extends StatelessWidget {
    const _ResourcePreview({required this.resource});
    final _ChatResource resource;

    @override
    Widget build(BuildContext context) {
        if (resource.type == 'IMAGE' && resource.url != null && resource.url!.isNotEmpty) {
            return Padding(padding: const EdgeInsets.only(top: 10), child: ClipRRect(borderRadius: BorderRadius.circular(10), child: Image.network(resource.url!, fit: BoxFit.contain, errorBuilder: (_, __, ___) => const Text('图片加载失败'))));
        }
        if (resource.content != null && resource.content!.isNotEmpty) {
            return Padding(padding: const EdgeInsets.only(top: 10), child: SelectableText(resource.content!, style: const TextStyle(fontSize: 12, height: 1.45)));
        }
        return const SizedBox.shrink();
    }
}

class _SourcePreview extends StatelessWidget {
    const _SourcePreview({required this.source});
    final _ChatSource source;

    @override
    Widget build(BuildContext context) {
        return Padding(
            padding: const EdgeInsets.only(top: 10),
            child: Container(
                width: double.infinity,
                padding: const EdgeInsets.all(10),
                decoration: BoxDecoration(
                    color: const Color(0xfff4f6f9),
                    borderRadius: BorderRadius.circular(10),
                    border: Border.all(color: const Color(0xffe8ebf1)),
                ),
                child: Column(
                    crossAxisAlignment: CrossAxisAlignment.start,
                    children: [
                        Row(children: [
                            const Icon(Icons.public, size: 15, color: Color(0xff565cf6)),
                            const SizedBox(width: 6),
                            Expanded(child: Text(source.title.isEmpty ? source.domain : source.title, maxLines: 1, overflow: TextOverflow.ellipsis, style: const TextStyle(fontSize: 12, fontWeight: FontWeight.w600, color: Color(0xff565cf6)))),
                        ]),
                        if (source.domain.isNotEmpty) Padding(padding: const EdgeInsets.only(top: 3), child: Text(source.domain, style: const TextStyle(fontSize: 11, color: Color(0xff858c9b)))),
                        if (source.snippet.isNotEmpty) Padding(padding: const EdgeInsets.only(top: 3), child: Text(source.snippet, maxLines: 2, overflow: TextOverflow.ellipsis, style: const TextStyle(fontSize: 12, height: 1.45, color: Color(0xff858c9b)))),
                    ],
                ),
            ),
        );
    }
}


class _Composer extends StatelessWidget {
  const _Composer(
            {required this.controller,
            required this.casual,
            required this.onSend,
            required this.pending,
            required this.onCancel,
            required this.prompt,
            required this.onPromptChanged});
  final TextEditingController controller;
  final bool casual;
  final VoidCallback onSend;
    final bool pending;
    final VoidCallback onCancel;
    final String? prompt;
    final ValueChanged<String?> onPromptChanged;

    static const _prompts = ['总结文档要点', '翻译内容', '生成代码'];

  @override
    Widget build(BuildContext context) {
        final accent =
                casual ? const Color(0xffff4f91) : const Color(0xff5964ff);
        return Padding(
        padding: EdgeInsets.fromLTRB(pagePadding(context), 4, pagePadding(context), 8),
                child: Column(
                    mainAxisSize: MainAxisSize.min,
                    crossAxisAlignment: CrossAxisAlignment.start,
                    children: [
                        if (prompt != null && prompt!.isNotEmpty)
                            Padding(
                                padding: const EdgeInsets.only(bottom: 8),
                                child: InputChip(
                                    label: Text(prompt!),
                                    onDeleted: () => onPromptChanged(null),
                                    backgroundColor: accent.withValues(alpha: .1),
                                    side: BorderSide(color: accent.withValues(alpha: .35)),
                                    labelStyle: TextStyle(color: accent, fontSize: 12),
                                    deleteIconColor: accent,
                                    visualDensity: VisualDensity.compact,
                                ),
                            ),
                        ConstrainedBox(
                            constraints: const BoxConstraints(
                                minHeight: kComposerMinHeight,
                                maxHeight: kComposerMaxHeight),
                            child: TextField(
                                controller: controller,
                                onSubmitted: (_) => onSend(),
                                minLines: 2,
                                maxLines: 4,
                                keyboardType: TextInputType.multiline,
                                textAlignVertical: TextAlignVertical.top,
                                style: const TextStyle(fontSize: 14, color: Color(0xff273142)),
                                decoration: InputDecoration(
                                    hintText: casual ? '聊点轻松的…' : '告诉 AI 你要处理的工作…',
                                    hintStyle:
                                            const TextStyle(fontSize: 14, color: Color(0xff9ca4b4)),
                                    prefixIcon: const Icon(Icons.add_circle_outline,
                                            size: 21, color: Color(0xff7f8898)),
                                    prefixIconConstraints:
                                            const BoxConstraints(minWidth: 46, minHeight: 52),
                                    suffixIcon: IconButton(
                                            onPressed: pending ? onCancel : onSend,
                                            icon: Icon(pending
                                                    ? Icons.stop_rounded
                                                    : Icons.arrow_upward_rounded)),
                                    contentPadding: const EdgeInsets.symmetric(
                                            horizontal: 14, vertical: 14),
                                    filled: true,
                                    fillColor: Colors.white,
                                    border: OutlineInputBorder(
                                            borderRadius: BorderRadius.circular(17),
                                            borderSide: BorderSide.none),
                                    focusedBorder: OutlineInputBorder(
                                            borderRadius: BorderRadius.circular(17),
                                            borderSide: const BorderSide(
                                                    color: Color(0xff5964ff), width: 1.2)),
                                ),
                            ),
            ),
                        const SizedBox(height: 8),
                        Wrap(
                            spacing: 8,
                            runSpacing: 8,
                            children: [
                                for (final item in _prompts)
                                    ActionChip(
                                        label: Text(item),
                                        labelStyle: TextStyle(
                                                fontSize: 12,
                                                color: prompt == item
                                                        ? Colors.white
                                                        : const Color(0xff747d8e)),
                                        backgroundColor: prompt == item
                                                ? accent
                                                : const Color(0xfff2f4f8),
                                        side: BorderSide.none,
                                        visualDensity: VisualDensity.compact,
                                        onPressed: () =>
                                                onPromptChanged(prompt == item ? null : item),
                                    ),
                            ],
                        ),
                    ],
        ),
      );
    }
}

class _ToolStrip extends StatelessWidget {
  const _ToolStrip();
  @override
  Widget build(BuildContext context) {
    final compact = isCompactViewport(context);
    return Container(
      height: compact ? kCompactToolStripHeight : kToolStripHeight,
      margin: EdgeInsets.symmetric(horizontal: pagePadding(context)),
      padding: const EdgeInsets.symmetric(horizontal: 4),
      decoration: BoxDecoration(
          color: Colors.white.withValues(alpha: .95),
          borderRadius: BorderRadius.circular(18),
          boxShadow: const [
            BoxShadow(color: Color(0x0d111827), blurRadius: 16)
          ]),
      child: const Row(
          mainAxisAlignment: MainAxisAlignment.spaceAround,
          children: [
            _Tool(
                icon: Icons.table_chart_outlined,
                label: 'Excel',
                color: Color(0xff12b76a)),
            _Tool(
                icon: Icons.slideshow_outlined,
                label: 'PPT',
                color: Color(0xffff6b20)),
            _Tool(
                icon: Icons.article_outlined,
                label: 'Word',
                color: Color(0xff246bdf)),
            _Tool(
                icon: Icons.credit_card_outlined,
                label: '报销',
                color: Color(0xff8b4dff))
          ]),
    );
  }
}

class _Tool extends StatelessWidget {
  const _Tool({required this.icon, required this.label, required this.color});
  final IconData icon;
  final String label;
  final Color color;
  @override
  Widget build(BuildContext context) => InkWell(
      onTap: () {},
      borderRadius: BorderRadius.circular(14),
      child: SizedBox(
        width: 68,
        height: 44,
        child: Column(mainAxisAlignment: MainAxisAlignment.center, children: [
          Icon(icon, color: color, size: 23),
          const SizedBox(height: 5),
          Text(label,
              style: const TextStyle(fontSize: 11, color: Color(0xff4e5969)))
        ]),
      ),
    );
}
