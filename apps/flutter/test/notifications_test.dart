import 'dart:async';
import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:provider/provider.dart';
import 'package:maison_munezero/api.dart';
import 'package:maison_munezero/notifications.dart';

class InboxApi extends Api {
  InboxApi() {
    user = {'id': 'customer', 'role': 'CUSTOMER'};
  }
  bool read = false;
  final posts = <String>[];
  Completer<dynamic>? pending;
  @override
  Future<dynamic> get(String path) async {
    if (path == '/notifications/unread-count') return {'count': read ? 0 : 1};
    if (pending != null) return pending!.future;
    return [
      {
        'id': 'notification',
        'title': 'Order MM-2 is ready',
        'body': 'Your order is ready for collection.',
        'order_id': 'order',
        'created_at': '2026-10-09T10:00:00Z',
        'read_at': read ? 'now' : null,
      },
    ];
  }

  @override
  Future<dynamic> post(
    String path, [
    Map<String, dynamic>? data,
    String? key,
  ]) async {
    posts.add(path);
    read = true;
    return {'ok': true};
  }
}

void main() {
  test(
    'inbox ignores a response after the signed-in account changes',
    () async {
      final api = InboxApi()..pending = Completer<dynamic>();
      final inbox = NotificationInbox(api, 'customer');
      final refresh = inbox.refresh();
      api.user = {'id': 'another-user', 'role': 'CUSTOMER'};
      api.pending!.complete([]);
      await refresh;
      expect(inbox.items, isEmpty);
      expect(inbox.unread, 0);
      inbox.dispose();
    },
  );

  testWidgets(
    'bell shows unread count, inbox opens an order and updates read state',
    (tester) async {
      final api = InboxApi();
      await tester.pumpWidget(
        ChangeNotifierProvider<Api>.value(
          value: api,
          child: MaterialApp(
            routes: {
              '/orders/order': (_) =>
                  const Scaffold(body: Text('Order detail')),
            },
            home: const Scaffold(body: NotificationBell()),
          ),
        ),
      );
      await tester.pumpAndSettle();
      expect(find.byTooltip('Notifications (1 unread)'), findsOneWidget);
      await tester.tap(find.byType(IconButton));
      await tester.pumpAndSettle();
      expect(find.text('Order MM-2 is ready'), findsOneWidget);
      await tester.tap(find.text('Order MM-2 is ready'));
      await tester.pumpAndSettle();
      expect(find.text('Order detail'), findsOneWidget);
      expect(api.posts, ['/notifications/notification/read']);
      await tester.pumpWidget(const SizedBox.shrink());
    },
  );

  testWidgets('mark all read clears the badge', (tester) async {
    final api = InboxApi();
    final inbox = NotificationInbox(api, 'customer');
    await inbox.refresh();
    await tester.pumpWidget(MaterialApp(home: NotificationsPage(inbox: inbox)));
    await tester.tap(find.text('Mark all read'));
    await tester.pumpAndSettle();
    expect(api.posts, ['/notifications/read-all']);
    expect(inbox.unread, 0);
    expect(inbox.items.single['read_at'], isNotNull);
    await tester.pumpWidget(const SizedBox.shrink());
    inbox.dispose();
  });
  testWidgets('inbox hides previous account notifications after sign out', (
    tester,
  ) async {
    final api = InboxApi();
    final inbox = NotificationInbox(api, 'customer');
    await inbox.refresh();
    await tester.pumpWidget(MaterialApp(home: NotificationsPage(inbox: inbox)));
    expect(find.text('Order MM-2 is ready'), findsOneWidget);
    api.user = null;
    inbox.dispose();
    api.notifyListeners();
    await tester.pumpAndSettle();
    expect(find.text('Order MM-2 is ready'), findsNothing);
    expect(find.text('Sign in to view your notifications.'), findsOneWidget);
    await tester.pumpWidget(const SizedBox.shrink());
  });
}
