import 'dart:async';
import 'package:flutter/material.dart';
import 'package:provider/provider.dart';
import 'api.dart';
import 'ui.dart';

class NotificationInbox extends ChangeNotifier {
  final Api api;
  final String userId;
  NotificationInbox(this.api, this.userId);
  List<Map<String, dynamic>> items = [];
  int unread = 0;
  String? error;
  bool loading = false;
  bool _closed = false;
  Future<void>? _pending;

  bool get current => !_closed && api.user?['id'] == userId;
  Future<void> refresh() {
    if (!current) return Future.value();
    return _pending ??= _load().whenComplete(() => _pending = null);
  }

  Future<void> _load() async {
    loading = true;
    notifyListeners();
    try {
      final results = await Future.wait([
        api.get('/notifications'),
        api.get('/notifications/unread-count'),
      ]);
      if (!current) return;
      items = (results[0] as List)
          .map((n) => Map<String, dynamic>.from(n))
          .toList();
      unread = (results[1] as Map)['count'] as int;
      error = null;
    } catch (e) {
      if (current) error = '$e';
    } finally {
      loading = false;
      if (current) notifyListeners();
    }
  }

  Future<void> markRead(Map<String, dynamic> item) async {
    if (!current || item['read_at'] != null) return;
    await api.post('/notifications/${item['id']}/read');
    if (_pending != null) await _pending;
    await refresh();
  }

  Future<void> markAllRead() async {
    if (!current) return;
    await api.post('/notifications/read-all');
    if (_pending != null) await _pending;
    await refresh();
  }

  @override
  void dispose() {
    _closed = true;
    super.dispose();
  }
}

class NotificationBell extends StatefulWidget {
  const NotificationBell({super.key});
  @override
  State<NotificationBell> createState() => _NotificationBellState();
}

class _NotificationBellState extends State<NotificationBell>
    with WidgetsBindingObserver {
  NotificationInbox? inbox;
  Timer? timer;
  bool foreground = true;

  @override
  void initState() {
    super.initState();
    WidgetsBinding.instance.addObserver(this);
    timer = Timer.periodic(const Duration(seconds: 30), (_) {
      if (foreground) inbox?.refresh();
    });
  }

  @override
  void didChangeDependencies() {
    super.didChangeDependencies();
    final api = context.watch<Api>();
    final id = api.user?['id'] as String?;
    if (id == inbox?.userId) return;
    inbox?.dispose();
    inbox = id == null ? null : NotificationInbox(api, id);
    // Defer notifier updates until after this build.
    WidgetsBinding.instance.addPostFrameCallback((_) {
      if (mounted) inbox?.refresh();
    });
  }

  @override
  void didChangeAppLifecycleState(AppLifecycleState state) {
    foreground = state == AppLifecycleState.resumed;
    if (foreground) inbox?.refresh();
  }

  @override
  void dispose() {
    timer?.cancel();
    WidgetsBinding.instance.removeObserver(this);
    inbox?.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    final model = inbox;
    if (model == null) return const SizedBox.shrink();
    return AnimatedBuilder(
      animation: model,
      builder: (context, _) => IconButton(
        tooltip:
            'Notifications${model.unread > 0 ? ' (${model.unread} unread)' : ''}',
        onPressed: () async {
          await Navigator.of(context).push(
            MaterialPageRoute<void>(
              builder: (_) => NotificationsPage(inbox: model),
            ),
          );
          if (mounted) inbox?.refresh();
        },
        icon: Badge(
          isLabelVisible: model.unread > 0,
          label: Text(model.unread > 99 ? '99+' : '${model.unread}'),
          child: const Icon(Icons.notifications_outlined),
        ),
      ),
    );
  }
}

class NotificationsPage extends StatelessWidget {
  final NotificationInbox inbox;
  const NotificationsPage({required this.inbox, super.key});

  Future<void> act(BuildContext context, Future<void> Function() action) async {
    try {
      await action();
    } catch (e) {
      if (context.mounted) toast(context, e);
    }
  }

  @override
  Widget build(BuildContext context) => AnimatedBuilder(
    animation: Listenable.merge([if (inbox.current) inbox, inbox.api]),
    builder: (context, _) => Scaffold(
      appBar: AppBar(
        title: const Text('Notifications'),
        actions: [
          IconButton(
            tooltip: 'Refresh notifications',
            onPressed: !inbox.current || inbox.loading ? null : inbox.refresh,
            icon: const Icon(Icons.refresh),
          ),
          TextButton(
            onPressed: !inbox.current || inbox.unread == 0
                ? null
                : () => act(context, inbox.markAllRead),
            child: const Text('Mark all read'),
          ),
        ],
      ),
      body: !inbox.current
          ? const Center(child: Text('Sign in to view your notifications.'))
          : RefreshIndicator(
              onRefresh: inbox.refresh,
              child: ListView(
                physics: const AlwaysScrollableScrollPhysics(),
                padding: const EdgeInsets.all(24),
                children: [
                  if (inbox.loading) const LinearProgressIndicator(),
                  if (inbox.error != null)
                    Panel(
                      child: Text(
                        'Could not refresh notifications. ${inbox.error}',
                      ),
                    ),
                  if (inbox.items.isEmpty &&
                      !inbox.loading &&
                      inbox.error == null)
                    const EmptyState(
                      'You are all caught up. Order updates will appear here.',
                    ),
                  for (final item in inbox.items)
                    Panel(
                      child: ListTile(
                        contentPadding: EdgeInsets.zero,
                        leading: Icon(
                          item['read_at'] == null
                              ? Icons.notifications_active_outlined
                              : Icons.notifications_none_outlined,
                        ),
                        title: Text(
                          '${item['title']}',
                          style: TextStyle(
                            fontWeight: item['read_at'] == null
                                ? FontWeight.w700
                                : FontWeight.normal,
                          ),
                        ),
                        subtitle: Text(
                          '${item['body']}\n${dateLabel(item['created_at'])}${item['order_id'] != null ? '\nView order' : ''}',
                        ),
                        isThreeLine: true,
                        onTap: () => act(context, () async {
                          await inbox.markRead(item);
                          if (context.mounted &&
                              inbox.current &&
                              item['order_id'] != null) {
                            await Navigator.pushNamed(
                              context,
                              '/orders/${item['order_id']}',
                            );
                            await inbox.refresh();
                          }
                        }),
                        trailing: item['read_at'] == null
                            ? IconButton(
                                tooltip: 'Mark read',
                                icon: const Icon(Icons.done),
                                onPressed: () =>
                                    act(context, () => inbox.markRead(item)),
                              )
                            : null,
                      ),
                    ),
                ],
              ),
            ),
    ),
  );
}
