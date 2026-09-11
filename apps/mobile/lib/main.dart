import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:hive_flutter/hive_flutter.dart';

import 'src/app.dart';

Future<void> main() async {
  WidgetsFlutterBinding.ensureInitialized();
  await Hive.initFlutter();
  await Hive.openBox<Map<dynamic, dynamic>>('local_drafts');
  await Hive.openBox<Map<dynamic, dynamic>>('upload_queue');
  await Hive.openBox<String>('auth_session');
  await Hive.openBox<dynamic>('settings');
  runApp(const ProviderScope(child: CeesMobileApp()));
}