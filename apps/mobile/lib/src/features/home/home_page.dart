import 'package:flutter/material.dart';
import 'package:go_router/go_router.dart';

class HomePage extends StatelessWidget {
  const HomePage({super.key});

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      appBar: AppBar(title: const Column(crossAxisAlignment: CrossAxisAlignment.start, children: [Text('今日待办'), Text('华东销售中心', style: TextStyle(fontSize: 12, fontWeight: FontWeight.normal))]), actions: [IconButton(onPressed: () => context.push('/notifications'), icon: const Icon(Icons.notifications_outlined), tooltip: '通知')]),
      body: ListView(padding: const EdgeInsets.all(16), children: [
        Row(children: [
          Expanded(child: _Metric(label: '待完成', value: '8', color: Colors.blue)),
          const SizedBox(width: 10),
          Expanded(child: _Metric(label: '已超期', value: '2', color: Colors.red)),
          const SizedBox(width: 10),
          Expanded(child: _Metric(label: '今日完成', value: '5', color: Colors.green)),
        ]),
        const SizedBox(height: 20),
        Row(mainAxisAlignment: MainAxisAlignment.spaceBetween, children: [const Text('重点任务', style: TextStyle(fontSize: 18, fontWeight: FontWeight.w600)), TextButton(onPressed: () => context.push('/tasks'), child: const Text('全部'))]),
        ...const [
          ('确认华东渠道本周回款计划', '今天 18:00', '高'),
          ('提交建材项目报价复核', '已超期 1 天', '紧急'),
          ('整理重点客户拜访纪要', '明天 12:00', '中'),
        ].map((task) => Card(child: ListTile(onTap: () => context.push('/task-detail'), title: Text(task.$1), subtitle: Text(task.$2), trailing: Chip(label: Text(task.$3))))),
        const SizedBox(height: 20),
        FilledButton.icon(onPressed: () => context.push('/work-record'), icon: const Icon(Icons.mic_none), label: const Text('记录今天的工作')),
      ]),
      bottomNavigationBar: NavigationBar(selectedIndex: 0, onDestinationSelected: (index) { if (index == 1) context.go('/tasks'); if (index == 2) context.go('/knowledge'); if (index == 3) context.go('/profile'); }, destinations: const [
        NavigationDestination(icon: Icon(Icons.today_outlined), label: '今日'),
        NavigationDestination(icon: Icon(Icons.task_alt), label: '任务'),
        NavigationDestination(icon: Icon(Icons.auto_awesome_outlined), label: 'AI问答'),
        NavigationDestination(icon: Icon(Icons.person_outline), label: '我的'),
      ]),
    );
  }
}

class _Metric extends StatelessWidget {
  const _Metric({required this.label, required this.value, required this.color});
  final String label;
  final String value;
  final Color color;
  @override
  Widget build(BuildContext context) => Card(child: Padding(padding: const EdgeInsets.all(14), child: Column(children: [Text(value, style: TextStyle(fontSize: 24, fontWeight: FontWeight.w700, color: color)), Text(label, style: const TextStyle(fontSize: 12))])));
}