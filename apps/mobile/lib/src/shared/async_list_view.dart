import 'package:flutter/material.dart';

import 'layout.dart';

/// 通用的「加载 / 错误 / 空 / 列表」四态列表容器。
class AsyncListView extends StatelessWidget {
  const AsyncListView({
    super.key,
    required this.loading,
    this.error,
    required this.emptyText,
    required this.onRefresh,
    required this.children,
    this.padding,
  });

  final bool loading;
  final String? error;
  final String emptyText;
  final Future<void> Function() onRefresh;
  final List<Widget> children;

  /// 不传时按平台尺寸与导航安全区动态计算底部留白。
  final EdgeInsetsGeometry? padding;

  @override
  Widget build(BuildContext context) {
    if (loading) return const Center(child: CircularProgressIndicator());
    if (error != null) {
      return _Centered(
        child: Column(
          mainAxisSize: MainAxisSize.min,
          children: [
            Text(error!, textAlign: TextAlign.center, style: const TextStyle(color: Color(0xff8f98a8))),
            const SizedBox(height: 12),
            FilledButton.tonal(onPressed: onRefresh, child: const Text('重试')),
          ],
        ),
      );
    }
    if (children.isEmpty) {
      return _Centered(child: Text(emptyText, style: const TextStyle(color: Color(0xff8f98a8))));
    }
    return RefreshIndicator(
      onRefresh: onRefresh,
      child: ListView(
        padding: padding ??
            EdgeInsets.fromLTRB(pagePadding(context), 0, pagePadding(context), contentBottomInset(context)),
        children: children,
      ),
    );
  }
}

class _Centered extends StatelessWidget {
  const _Centered({required this.child});
  final Widget child;

  @override
  Widget build(BuildContext context) => Center(
        child: Padding(
          padding: EdgeInsets.only(bottom: contentBottomInset(context)),
          child: child,
        ),
      );
}
