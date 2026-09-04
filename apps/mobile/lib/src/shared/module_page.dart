import 'package:flutter/material.dart';

class ModulePage extends StatelessWidget {
  const ModulePage({required this.title, super.key});
  final String title;

  @override
  Widget build(BuildContext context) => Scaffold(appBar: AppBar(title: Text(title)), body: Center(child: Padding(padding: const EdgeInsets.all(24), child: Text('$title模块已建立路由，下一阶段接入分页 API、权限范围和离线同步。', textAlign: TextAlign.center))));
}