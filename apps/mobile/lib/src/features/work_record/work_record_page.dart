import 'package:flutter/material.dart';
import 'package:hive_flutter/hive_flutter.dart';

import '../../shared/layout.dart';

class WorkRecordPage extends StatefulWidget {
  const WorkRecordPage({super.key});
  @override
  State<WorkRecordPage> createState() => _WorkRecordPageState();
}

class _WorkRecordPageState extends State<WorkRecordPage> {
  final controller = TextEditingController();
  bool generated = false;

  Future<void> saveLocalDraft() async {
    await Hive.box<Map<dynamic, dynamic>>('local_drafts').put('work-record-latest', {'text': controller.text, 'updatedAt': DateTime.now().toIso8601String(), 'syncStatus': 'LOCAL'});
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      appBar: AppBar(title: const Text('工作记录'), actions: [IconButton(onPressed: saveLocalDraft, icon: const Icon(Icons.save_outlined), tooltip: '保存草稿')]),
      // 独立路由页没有悬浮底部导航，底部留白只需让位给键盘与 Home Indicator。
      body: SafeArea(
        child: ListView(
          padding: EdgeInsets.fromLTRB(
            pagePadding(context),
            16,
            pagePadding(context),
            keyboardBottomInset(context, gap: MediaQuery.paddingOf(context).bottom + 20),
          ),
          children: [
        const Text('记录工作内容', style: TextStyle(fontSize: 18, fontWeight: FontWeight.w600)),
        const SizedBox(height: 8),
        TextField(controller: controller, minLines: 4, maxLines: 12, decoration: const InputDecoration(hintText: '例如：今天拜访了客户，确认了项目进度和下一步回款安排...', border: OutlineInputBorder())),
        const SizedBox(height: 12),
        OutlinedButton.icon(onPressed: () async { await Hive.box<Map<dynamic, dynamic>>('upload_queue').add({'type': 'VOICE', 'status': 'PENDING', 'retryCount': 0}); }, icon: const Icon(Icons.mic_none), label: const Text('上传语音（占位）')),
        const SizedBox(height: 8),
        FilledButton.icon(onPressed: () async { await saveLocalDraft(); setState(() => generated = true); }, icon: const Icon(Icons.auto_awesome), label: const Text('生成 AI 草稿')),
        if (generated) ...[
          const SizedBox(height: 20),
          Card(child: Padding(padding: const EdgeInsets.all(16), child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
            const Text('待确认草稿', style: TextStyle(fontSize: 17, fontWeight: FontWeight.w600)),
            const SizedBox(height: 8), Text(controller.text.isEmpty ? '尚未输入工作内容' : controller.text),
            const Divider(height: 28), const Text('确认后才会由 NestJS 创建正式日报和任务。', style: TextStyle(color: Colors.orange)),
            const SizedBox(height: 12), Row(children: [Expanded(child: OutlinedButton(onPressed: () => setState(() => generated = false), child: const Text('继续修改'))), const SizedBox(width: 10), Expanded(child: FilledButton(onPressed: () {}, child: const Text('确认提交')))]),
          ]))),
        ],
          ],
        ),
      ),
    );
  }
}