import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'dart:io';
import 'dart:ui' as ui;
import 'package:flutter_test/flutter_test.dart';
import 'package:provider/provider.dart';
import 'package:maison_munezero/api.dart';
import 'package:maison_munezero/main.dart';
import 'package:maison_munezero/customer.dart';
import 'package:maison_munezero/theme.dart';

class FixtureApi extends Api {
  FixtureApi([String? fixtureRole]) {
    initialized = true;
    if (fixtureRole != null) {
      user = {
        'role': fixtureRole,
        'name': 'Test',
        'id': 'test-user',
        'email': 'test@example.com',
      };
    }
  }
  @override
  Future<dynamic> get(String path) async {
    if (path == '/settings') {
      return {
        'sampleCatalogue': true,
        'shopAddress': 'Kigali',
        'shopPhone': '',
        'deliveryZones': [],
        'taxBasisPoints': 0,
        'terms': 'Test terms',
      };
    }
    if (path.startsWith('/products')) {
      return [
        for (final row in [
          {'name': 'The Imigongo Dress', 'category': 'Dresses', 'price': 85000},
          {'name': 'Atelier Tailored Set', 'category': 'Sets', 'price': 120000},
          {
            'name': 'Signature Occasion Dress',
            'category': 'Occasion',
            'price': 160000,
          },
          {
            'name': 'Everyday Linen Shirt',
            'category': 'Essentials',
            'price': 45000,
          },
        ])
          {...row, 'id': 'test-id', 'image_url': null},
      ];
    }
    if (path == '/categories') {
      return ['Dresses', 'Sets', 'Occasion', 'Essentials'];
    }
    return [];
  }
}

class PaymentFixtureApi extends FixtureApi {
  PaymentFixtureApi({this.confirmationAvailable = true}) : super('CUSTOMER');
  final bool confirmationAvailable;
  final posts = <String>[];
  bool paid = false;
  int orderLoads = 0;
  @override
  Future<dynamic> get(String path) async {
    if (path == '/orders/test-order') {
      orderLoads++;
      return {
        'id': 'test-order', 'number': 1, 'channel': 'ONLINE',
        'status': paid ? 'CONFIRMED' : 'AWAITING_PAYMENT',
        'created_at': '2026-10-06T10:00:00Z', 'fulfilment': 'PICKUP',
        'customer_name': 'Test Customer', 'customer_phone': '250780000001',
        'subtotal': 1500, 'tax': 0, 'delivery_fee': 0, 'total': 1500,
        'paid': paid ? 1500 : 0, 'deposit_due': 1500,
        'items': [], 'history': [],
        'payments': [{
          'id': 'test-payment', 'provider': 'FLUTTERWAVE', 'amount': 1500,
          'status': paid ? 'SUCCESSFUL' : 'PENDING', 'sandbox': true,
          'created_at': '2026-10-06T10:00:00Z',
          'authorization_url': confirmationAvailable
              ? 'https://checkout.flutterwave.com/captcha/verify/test'
              : null,
        }],
      };
    }
    return super.get(path);
  }
  @override
  Future<dynamic> post(String path, [Map<String, dynamic>? data, String? key]) async {
    posts.add(path);
    if (path == '/payments/test-payment/check') {
      paid = true;
      return {'status': 'SUCCESSFUL'};
    }
    throw StateError('Unexpected new payment request');
  }
}

final captureKey = GlobalKey();
Widget app(Api api, [Widget? child]) => RepaintBoundary(
  key: captureKey,
  child: MultiProvider(
    providers: [
      ChangeNotifierProvider(create: (_) => ThemePreference(read: () async => null, write: (_) async {})),
      ChangeNotifierProvider<Api>.value(value: api),
      ChangeNotifierProvider(create: (_) => Cart()),
    ],
    child: child ?? const MaisonApp(),
  ),
);

Future<void> capture(WidgetTester tester, String path) async {
  if (!const bool.fromEnvironment('CAPTURE_PREVIEWS')) return;
  final boundary = tester.renderObject(find.byKey(captureKey)) as dynamic;
  final image = await boundary.toImage(pixelRatio: 1.0);
  final bytes = await image.toByteData(format: ui.ImageByteFormat.png);
  await File(path).writeAsBytes(bytes!.buffer.asUint8List());
  image.dispose();
}

void main() {
  TestWidgetsFlutterBinding.ensureInitialized();
  setUpAll(() async {
    for (final entry in {
      'MaisonSans': 'DejaVuSans.ttf',
      'MaisonSerif': 'DejaVuSerif.ttf',
    }.entries) {
      final loader = FontLoader(entry.key)
        ..addFont(rootBundle.load('assets/fonts/${entry.value}'));
      await loader.load();
    }
    final icons = FontLoader('MaterialIcons')
      ..addFont(rootBundle.load('fonts/MaterialIcons-Regular.otf'));
    await icons.load();
  });
  testWidgets('collection renders on a phone without overflow', (tester) async {
    tester.view.physicalSize = const Size(390, 844);
    tester.view.devicePixelRatio = 1;
    addTearDown(tester.view.resetPhysicalSize);
    addTearDown(tester.view.resetDevicePixelRatio);
    await tester.pumpWidget(app(FixtureApi()));
    await tester.pumpAndSettle();
    expect(find.text('Made to be\nyour own.'), findsOneWidget);
    expect(find.byIcon(Icons.shopping_bag_outlined), findsOneWidget);
    expect(tester.takeException(), isNull);
    await tester.runAsync(
      () => capture(tester, '../../docs/preview-mobile.png'),
    );
  });
  testWidgets(
    'desktop collection has navigation and visible preview catalogue label',
    (tester) async {
      tester.view.physicalSize = const Size(1440, 1100);
      tester.view.devicePixelRatio = 1;
      addTearDown(tester.view.resetPhysicalSize);
      addTearDown(tester.view.resetDevicePixelRatio);
      await tester.pumpWidget(app(FixtureApi()));
      await tester.pumpAndSettle();
      expect(find.text('Atelier'), findsOneWidget);
      expect(
        find.text('Preview collection · Sample products and illustrations'),
        findsOneWidget,
      );
      expect(tester.takeException(), isNull);
      await tester.runAsync(
        () => capture(tester, '../../docs/preview-desktop.png'),
      );
    },
  );
  testWidgets(
    'driver workspace exposes assigned delivery work without inventory or finance screens',
    (tester) async {
      tester.view.physicalSize = const Size(1440, 1100);
      tester.view.devicePixelRatio = 1;
      addTearDown(tester.view.resetPhysicalSize);
      addTearDown(tester.view.resetDevicePixelRatio);
      await tester.pumpWidget(app(FixtureApi('DRIVER')));
      await tester.pumpAndSettle();
      await tester.tap(find.text('Workspace'));
      await tester.pumpAndSettle();
      expect(find.text('Deliveries'), findsOneWidget);
      expect(find.text('Inventory'), findsNothing);
      expect(find.text('Payments'), findsNothing);
      expect(find.text('Users'), findsNothing);
      expect(tester.takeException(), isNull);
    },
  );
  testWidgets('password eye toggles visibility', (tester) async {
    await tester.pumpWidget(
      app(FixtureApi(), const MaterialApp(home: AuthPage())),
    );
    await tester.pumpAndSettle();
    TextField password() =>
        tester.widgetList<TextField>(find.byType(TextField)).last;
    expect(password().obscureText, isTrue);
    await tester.tap(find.byIcon(Icons.visibility));
    await tester.pump();
    expect(password().obscureText, isFalse);
  });
  testWidgets('pending test payment opens its existing confirmation and checks without a new charge', (tester) async {
    tester.view.physicalSize = const Size(1440, 1800);
    tester.view.devicePixelRatio = 1;
    addTearDown(tester.view.resetPhysicalSize);
    addTearDown(tester.view.resetDevicePixelRatio);
    const launcher = MethodChannel('plugins.flutter.io/url_launcher');
    final launched = <MethodCall>[];
    TestDefaultBinaryMessengerBinding.instance.defaultBinaryMessenger
        .setMockMethodCallHandler(launcher, (call) async {
          launched.add(call);
          return true;
        });
    addTearDown(() => TestDefaultBinaryMessengerBinding.instance.defaultBinaryMessenger
        .setMockMethodCallHandler(launcher, null));
    final api = PaymentFixtureApi();
    await tester.pumpWidget(app(api, const MaterialApp(home: OrderDetail(id: 'test-order'))));
    await tester.pumpAndSettle();
    expect(find.text('TEST PAYMENT · No real money is collected.'), findsOneWidget);
    expect(find.text('Pay with mobile money'), findsNothing);
    await tester.tap(find.text('Continue payment'));
    await tester.pumpAndSettle();
    expect(launched.single.arguments['url'], 'https://checkout.flutterwave.com/captcha/verify/test');
    expect(api.posts, isEmpty);
    await tester.tap(find.text('Check payment'));
    await tester.pump();
    await tester.pumpAndSettle();
    expect(api.posts, ['/payments/test-payment/check']);
    expect(api.paid, isTrue);
    expect(api.orderLoads, 2);
    expect(find.text('Continue payment'), findsNothing);
    expect(tester.takeException(), isNull);
  });
  testWidgets('pending payment without a confirmation link offers a status check without another charge', (tester) async {
    tester.view.physicalSize = const Size(1440, 1800);
    tester.view.devicePixelRatio = 1;
    addTearDown(tester.view.resetPhysicalSize);
    addTearDown(tester.view.resetDevicePixelRatio);
    final api = PaymentFixtureApi(confirmationAvailable: false);
    await tester.pumpWidget(app(api, const MaterialApp(home: OrderDetail(id: 'test-order'))));
    await tester.pumpAndSettle();
    expect(find.text('Continue payment'), findsNothing);
    expect(find.text('Pay with mobile money'), findsNothing);
    expect(find.text('The payment confirmation link is unavailable. Use Check payment or contact the shop. Do not pay again.'), findsOneWidget);
    await tester.tap(find.text('Check payment'));
    await tester.pumpAndSettle();
    expect(api.posts, ['/payments/test-payment/check']);
    expect(tester.takeException(), isNull);
  });
}
