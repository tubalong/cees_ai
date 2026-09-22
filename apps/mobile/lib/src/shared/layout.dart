import 'dart:math' as math;

import 'package:flutter/material.dart';

/// 跨页面共享的平台尺寸常量。
///
/// 移动端此前在各页面里散落了 `88 / 96 / 104 / 32 / 24` 五种互不相干的
/// 底部留白魔数，并且紧凑屏阈值在不同页面取值不一致。所有「底部导航占位」
/// 「内容底部留白」「紧凑屏判定」都必须从本文件推导，不允许再写死。

/// 紧凑屏判定阈值（iPhone SE / 12 mini / 13 mini 级宽度）。
const double kCompactWidth = 390;

/// 矮屏判定阈值（iPhone SE 横屏以外的可用高度、以及键盘弹起后的可视高度）。
///
/// 此前 `home_page.dart` 等页面直接写死 `height < 700`，与紧凑屏阈值一样属于
/// 散落魔数；统一收敛到本文件，保证所有页面用同一套判定。
const double kCompactHeight = 700;

/// 悬浮底部导航的容器高度（与 `mobile_shell.dart` 保持一致）。
const double kBottomNavHeight = 66;
const double kBottomNavCompactHeight = 62;

/// 底部导航 SafeArea 的最小下沉（无 Home Indicator 时使用的呼吸值）。
const double kBottomNavSafeFloor = 10;
const double kBottomNavSafeFloorNotched = 8;

/// 列表底部在导航之上的呼吸留白。
const double kListBottomGap = 12;

/// 顶部栏高度（紧凑屏略矮）。
const double kTopBarHeight = 68;
const double kCompactTopBarHeight = 60;

/// 底部悬浮工具条高度（紧凑屏/矮屏收紧）。
const double kToolStripHeight = 76;
const double kCompactToolStripHeight = 64;

/// 横向筛选条（ChoiceChip / FilterChip 一行）的高度。
///
/// Apple 要求最小触控目标 44pt；此前各页写死 38 / 40，在 iPhone 上偏小
/// 且容易误触，统一收敛到这里。
const double kFilterStripHeight = 44;

/// 输入区高度区间。
const double kComposerMinHeight = 60;
const double kComposerMaxHeight = 132;

/// 气泡最大宽度：按屏宽比例计算，避免在 320pt 设备上只剩几十像素余量。
const double kBubbleWidthFactor = 0.72;
const double kBubbleMaxWidth = 300;

/// 会话气泡的实际最大宽度（屏宽比例与绝对上限取较小值）。
double bubbleMaxWidth(BuildContext context) => math.min(
      MediaQuery.sizeOf(context).width * kBubbleWidthFactor,
      kBubbleMaxWidth,
    );

/// 紧凑屏左右边距（规范要求 12–18px）。
const double kCompactPagePadding = 14;
const double kPagePadding = 18;

/// 是否为紧凑屏。
bool isCompactWidth(BuildContext context) =>
    MediaQuery.sizeOf(context).width <= kCompactWidth;

/// 是否为矮屏（含键盘弹起后可视高度被压缩的情况）。
bool isCompactHeight(BuildContext context) =>
    MediaQuery.sizeOf(context).height <= kCompactHeight;

/// 需要收紧密度的情况：窄屏或矮屏（iPhone SE / 横屏 / 键盘弹起）。
bool isCompactViewport(BuildContext context) =>
    isCompactWidth(context) || isCompactHeight(context);

/// 页面左右边距：紧凑屏收紧，其余保持 18px。
double pagePadding(BuildContext context) =>
    isCompactWidth(context) ? kCompactPagePadding : kPagePadding;

/// 悬浮底部导航在 body 内实际占用的总高度（导航高度 + 底部安全区）。
///
/// `mobile_shell.dart` 使用 `extendBody: true`，内容会延伸到导航栏后面，
/// 因此页面必须自行让出这段高度，否则最后一个元素会被导航遮挡。
double bottomNavInset(BuildContext context) {
  final media = MediaQuery.of(context);
  final nav = isCompactWidth(context) ? kBottomNavCompactHeight : kBottomNavHeight;
  final floor = media.padding.bottom > 0 ? kBottomNavSafeFloorNotched : kBottomNavSafeFloor;
  final safe = media.padding.bottom > floor ? media.padding.bottom : floor;
  return nav + safe;
}

/// 列表/页面内容底部留白。
///
/// 键盘弹起时让位给键盘（`viewInsets.bottom`），否则让位给悬浮导航。
double contentBottomInset(BuildContext context, {double gap = kListBottomGap}) {
  final media = MediaQuery.of(context);
  final keyboard = media.viewInsets.bottom;
  final base = keyboard > 0 ? keyboard : bottomNavInset(context);
  return base + gap;
}

/// 键盘弹起时用于底部输入区/表单区的留白（不叠加导航，避免键盘+导航双重留白）。
double keyboardBottomInset(BuildContext context, {double gap = 16}) =>
    MediaQuery.viewInsetsOf(context).bottom + gap;

/// 底部弹窗（`showModalBottomSheet`）内容区的底部留白。
///
/// Material 的 `showModalBottomSheet` 只移除顶部 padding，弹窗主体会一直贴到
/// 屏幕底边，因此未包 `SafeArea` 的弹窗必须自行让出 Home Indicator（34pt）
/// 或键盘高度，否则最后一个按钮会被刘海屏底部横条压住。
double sheetBottomInset(BuildContext context, {double gap = 24}) {
  final media = MediaQuery.of(context);
  final keyboard = media.viewInsets.bottom;
  final safe = media.padding.bottom;
  return (keyboard > 0 ? keyboard : safe) + gap;
}
