import 'package:flutter/material.dart';

import '../../core/l10n.dart';

enum AssistantMode { casual, work }

class HomePage extends StatefulWidget {
  const HomePage({super.key});
  @override
  State<HomePage> createState() => _HomePageState();
}

class _HomePageState extends State<HomePage> {
  AssistantMode mode = AssistantMode.work;
  final composer = TextEditingController();
  final extraMessages = <String>[];

  @override
  void dispose() {
    composer.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    final casual = mode == AssistantMode.casual;
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
                        onSwitchToWork: () =>
                            setState(() => mode = AssistantMode.work))
                    : _WorkConversation(extraMessages: extraMessages)),
            _Composer(
                controller: composer, casual: casual, onSend: sendMessage),
            if (!casual) const _ToolStrip(),
            const SizedBox(height: 88),
          ])),
    );
  }

  void sendMessage() {
    final text = composer.text.trim();
    if (text.isEmpty) return;
    setState(() => extraMessages.add(text));
    composer.clear();
  }
}

class _TopBar extends StatelessWidget {
  const _TopBar({required this.mode, required this.onModeChanged});
  final AssistantMode mode;
  final ValueChanged<AssistantMode> onModeChanged;

  @override
  Widget build(BuildContext context) => Container(
        height: 68,
        padding: const EdgeInsets.symmetric(horizontal: 18),
        color: Colors.white.withValues(alpha: .72),
        child:
            Row(mainAxisAlignment: MainAxisAlignment.spaceBetween, children: [
          const _CircleButton(icon: Icons.menu_rounded),
          Container(
              height: 38,
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
  Widget build(BuildContext context) => GestureDetector(
      onTap: onTap,
      child: AnimatedContainer(
          duration: const Duration(milliseconds: 200),
          width: 64,
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
          backgroundColor: Colors.white, fixedSize: const Size(40, 40)));
}

class _WorkConversation extends StatelessWidget {
  const _WorkConversation({required this.extraMessages});
  final List<String> extraMessages;
  @override
  Widget build(BuildContext context) =>
      ListView(padding: const EdgeInsets.fromLTRB(18, 12, 16, 12), children: [
        const _TimeLabel('今天 14:20'),
        const _Bubble(text: '这个消费128是需要报销的，发票后面再发', mine: true, work: true),
        const _AssistantBubble(
            child:
                Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
          Text('好的，已为您新增一条报销明细，正在等待上传发票。'),
          SizedBox(height: 14),
          _ExpenseCard(
              title: '报销明细 #001', status: '¥128.00 · 待上传发票', done: false)
        ])),
        const _TimeLabel('2 天后 09:35'),
        const _Bubble(text: '这是上次128消费的发票', mine: true, work: true),
        const _FileBubble(),
        const _AssistantBubble(
            child:
                Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
          Text('已识别发票并关联到报销明细 #001，状态已更新为「已补发票」，可随时提交报销。'),
          SizedBox(height: 14),
          _ExpenseCard(title: '报销明细 #001', status: '已补发票', done: true)
        ])),
        ...extraMessages
            .map((text) => _Bubble(text: text, mine: true, work: true)),
      ]);
}

class _CasualConversation extends StatelessWidget {
  const _CasualConversation({required this.onSwitchToWork});
  final VoidCallback onSwitchToWork;
  @override
  Widget build(BuildContext context) =>
      ListView(padding: const EdgeInsets.fromLTRB(18, 14, 16, 12), children: [
        const Center(
            child: Chip(
                avatar: Icon(Icons.sentiment_satisfied_alt_outlined,
                    size: 16, color: Color(0xffff8a18)),
                label: Text('闲聊模式',
                    style: TextStyle(color: Color(0xffff8a18), fontSize: 11)),
                side: BorderSide.none,
                backgroundColor: Colors.white)),
        const _Bubble(text: '今天心情不错，下班想去吃火锅', mine: true, work: false),
        const _AssistantBubble(
            casual: true, child: Text('哈哈听起来不错！火锅最治愈啦，记得叫上同事一起热闹～')),
        const _Bubble(text: '对了，帮我看看销售部今天的考勤', mine: true, work: false),
        _AssistantBubble(
            casual: true,
            child:
                Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
              const Text('这个问题涉及工作数据，我在闲聊模式下不会直接处理哦～需要切换到工作模式吗？'),
              const SizedBox(height: 14),
              Row(children: [
                Expanded(
                    child: FilledButton(
                        onPressed: onSwitchToWork,
                        child: const Text('切换到工作模式'))),
                const SizedBox(width: 10),
                Expanded(
                    child:
                        TextButton(onPressed: () {}, child: const Text('先不了')))
              ])
            ])),
      ]);
}

class _Bubble extends StatelessWidget {
  const _Bubble({required this.text, required this.mine, required this.work});
  final String text;
  final bool mine;
  final bool work;
  @override
  Widget build(BuildContext context) => Align(
      alignment: mine ? Alignment.centerRight : Alignment.centerLeft,
      child: Container(
          constraints: const BoxConstraints(maxWidth: 265),
          margin: const EdgeInsets.only(top: 12),
          padding: const EdgeInsets.symmetric(horizontal: 14, vertical: 12),
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
                  height: 1.45))));
}

class _AssistantBubble extends StatelessWidget {
  const _AssistantBubble({required this.child, this.casual = false});
  final Widget child;
  final bool casual;
  @override
  Widget build(BuildContext context) => Padding(
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
            child:
                const Icon(Icons.auto_awesome, color: Colors.white, size: 17)),
        const SizedBox(width: 8),
        Expanded(
            child: Container(
                padding: const EdgeInsets.all(14),
                decoration: BoxDecoration(
                    color: Colors.white,
                    borderRadius: BorderRadius.circular(18)),
                child: DefaultTextStyle(
                    style: const TextStyle(
                        color: Color(0xff273142), height: 1.5, fontSize: 14),
                    child: child)))
      ]));
}

class _ExpenseCard extends StatelessWidget {
  const _ExpenseCard(
      {required this.title, required this.status, required this.done});
  final String title;
  final String status;
  final bool done;
  @override
  Widget build(BuildContext context) => Container(
      padding: const EdgeInsets.all(10),
      decoration: BoxDecoration(
          color: const Color(0xfff8f9fb),
          borderRadius: BorderRadius.circular(12)),
      child: Row(children: [
        Container(
            width: 34,
            height: 34,
            decoration: BoxDecoration(
                color: done ? const Color(0xffe5faef) : const Color(0xfffff3da),
                borderRadius: BorderRadius.circular(9)),
            child: Icon(
                done ? Icons.check_rounded : Icons.receipt_long_outlined,
                color: done ? const Color(0xff20bd6b) : const Color(0xffffa000),
                size: 19)),
        const SizedBox(width: 10),
        Expanded(
            child:
                Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
          Text(title, style: const TextStyle(fontWeight: FontWeight.w600)),
          Text(status,
              style: TextStyle(
                  color:
                      done ? const Color(0xff20bd6b) : const Color(0xffff9700),
                  fontSize: 11))
        ]))
      ]));
}

class _FileBubble extends StatelessWidget {
  const _FileBubble();
  @override
  Widget build(BuildContext context) => Align(
      alignment: Alignment.centerRight,
      child: Container(
          margin: const EdgeInsets.only(top: 12),
          padding: const EdgeInsets.all(12),
          decoration: BoxDecoration(
              gradient: const LinearGradient(
                  colors: [Color(0xff3478ff), Color(0xff8b4dff)]),
              borderRadius: BorderRadius.circular(16)),
          child: const Row(mainAxisSize: MainAxisSize.min, children: [
            Icon(Icons.insert_drive_file, color: Colors.white),
            SizedBox(width: 8),
            Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
              Text('消费128发票.pdf', style: TextStyle(color: Colors.white)),
              Text('1.2 MB',
                  style: TextStyle(color: Colors.white70, fontSize: 10))
            ])
          ])));
}

class _TimeLabel extends StatelessWidget {
  const _TimeLabel(this.text);
  final String text;
  @override
  Widget build(BuildContext context) => Center(
      child: Padding(
          padding: const EdgeInsets.symmetric(vertical: 5),
          child: Text(text,
              style: const TextStyle(color: Color(0xffa0a8b8), fontSize: 11))));
}

class _Composer extends StatelessWidget {
  const _Composer(
      {required this.controller, required this.casual, required this.onSend});
  final TextEditingController controller;
  final bool casual;
  final VoidCallback onSend;
  @override
  Widget build(BuildContext context) => Padding(
        padding: const EdgeInsets.fromLTRB(18, 4, 18, 8),
        child: SizedBox(
          height: 52,
          child: TextField(
            controller: controller,
            onSubmitted: (_) => onSend(),
            textAlignVertical: TextAlignVertical.center,
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
                  onPressed: onSend,
                  icon: const Icon(Icons.arrow_upward_rounded)),
              contentPadding: const EdgeInsets.symmetric(horizontal: 14),
              filled: true,
              fillColor: Colors.white,
              border: OutlineInputBorder(
                  borderRadius: BorderRadius.circular(17),
                  borderSide: BorderSide.none),
              focusedBorder: OutlineInputBorder(
                  borderRadius: BorderRadius.circular(17),
                  borderSide:
                      const BorderSide(color: Color(0xff5964ff), width: 1.2)),
            ),
          ),
        ),
      );
}

class _ToolStrip extends StatelessWidget {
  const _ToolStrip();
  @override
  Widget build(BuildContext context) => Container(
      height: 76,
      margin: const EdgeInsets.symmetric(horizontal: 18),
      padding: const EdgeInsets.symmetric(horizontal: 8),
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
          ]));
}

class _Tool extends StatelessWidget {
  const _Tool({required this.icon, required this.label, required this.color});
  final IconData icon;
  final String label;
  final Color color;
  @override
  Widget build(BuildContext context) =>
      Column(mainAxisAlignment: MainAxisAlignment.center, children: [
        Icon(icon, color: color, size: 23),
        const SizedBox(height: 5),
        Text(label,
            style: const TextStyle(fontSize: 11, color: Color(0xff4e5969)))
      ]);
}
