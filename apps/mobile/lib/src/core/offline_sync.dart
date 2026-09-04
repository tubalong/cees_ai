import 'package:connectivity_plus/connectivity_plus.dart';
import 'package:hive_flutter/hive_flutter.dart';

abstract interface class UploadExecutor {
  Future<void> execute(Map<dynamic, dynamic> item);
}

class OfflineSyncCoordinator {
  OfflineSyncCoordinator(this.executor);
  final UploadExecutor executor;

  Future<void> retryPendingUploads() async {
    final connectivity = await Connectivity().checkConnectivity();
    if (connectivity.contains(ConnectivityResult.none)) return;
    final queue = Hive.box<Map<dynamic, dynamic>>('upload_queue');
    for (final key in queue.keys) {
      final item = queue.get(key);
      if (item == null || item['status'] == 'DONE') continue;
      try {
        await executor.execute(item);
        await queue.put(key, {...item, 'status': 'DONE'});
      } catch (_) {
        await queue.put(key, {...item, 'status': 'RETRY', 'retryCount': (item['retryCount'] as int? ?? 0) + 1});
      }
    }
  }
}