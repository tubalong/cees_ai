import 'package:flutter/material.dart';

import '../../core/l10n.dart';
import '../../shared/layout.dart';
import '../../shared/search_field.dart';

class MessagesPage extends StatefulWidget {
  const MessagesPage({super.key});
  @override
  State<MessagesPage> createState() => _MessagesPageState();
}

class _MessagesPageState extends State<MessagesPage> {
  String keyword = '';
  final conversations = const [
    ('星辰科技全员群', '李娜：明天上午10点产品评审会', '10:24', 3, Color(0xff6c57ff), '群'),
    ('赵敏', '报销单已经帮你审核通过了', '09:58', 0, Color(0xff25b879), '赵'),
    ('陈涛', '收到，我下午提交一份方案', '昨天', 1, Color(0xffff9f0a), '陈'),
    ('刘畅', '这个月的运营数据我整理好了', '昨天', 0, Color(0xff8b4dff), '刘'),
    ('孙丽', '发票已收到，金额核对无误', '周一', 0, Color(0xffff4f86), '孙'),
  ];

  @override
  Widget build(BuildContext context) {
    final visible = conversations
        .where((item) => '${item.$1}${item.$2}'.contains(keyword))
        .toList();
    return Scaffold(
      body: SafeArea(
        bottom: false,
        child: ListView(
          padding: EdgeInsets.fromLTRB(pagePadding(context), 14, pagePadding(context), contentBottomInset(context)),
          children: [
            Row(mainAxisAlignment: MainAxisAlignment.spaceBetween, children: [
              Text(context.tr('messages.title'),
                  style: TextStyle(fontSize: 20, fontWeight: FontWeight.w700)),
              IconButton(
                  onPressed: () {},
                  icon: const Icon(Icons.add_rounded, size: 28))
            ]),
            const SizedBox(height: 16),
            SearchField(
              hintText: context.tr('messages.search'),
                onChanged: (value) => setState(() => keyword = value)),
            const SizedBox(height: 16),
            Text(context.tr('messages.recent'),
              style: const TextStyle(color: Color(0xff737c8d), fontSize: 12)),
            const SizedBox(height: 8),
            ...visible.map((item) => Padding(
                  padding: const EdgeInsets.only(bottom: 10),
                  child: Material(
                    color: Colors.white,
                    borderRadius: BorderRadius.circular(17),
                    clipBehavior: Clip.antiAlias,
                    child: ListTile(
                      contentPadding: const EdgeInsets.symmetric(
                          horizontal: 13, vertical: 6),
                      leading: CircleAvatar(
                          radius: 24,
                          backgroundColor: item.$5,
                          child: Text(item.$6,
                              style: const TextStyle(
                                  color: Colors.white,
                                  fontWeight: FontWeight.w600))),
                      title: Text(item.$1,
                          style: const TextStyle(fontWeight: FontWeight.w600)),
                      subtitle: Text(item.$2,
                          maxLines: 1, overflow: TextOverflow.ellipsis),
                      trailing: Column(
                          mainAxisAlignment: MainAxisAlignment.center,
                          children: [
                            Text(item.$3,
                                style: const TextStyle(
                                    color: Color(0xff9ca4b4), fontSize: 10)),
                            if (item.$4 > 0)
                              Container(
                                  margin: const EdgeInsets.only(top: 5),
                                  width: 20,
                                  height: 20,
                                  alignment: Alignment.center,
                                  decoration: const BoxDecoration(
                                      color: Color(0xffff4555),
                                      shape: BoxShape.circle),
                                  child: Text('${item.$4}',
                                      style: const TextStyle(
                                          color: Colors.white, fontSize: 10))),
                          ]),
                    ),
                  ),
                )),
          ],
        ),
      ),
    );
  }
}
