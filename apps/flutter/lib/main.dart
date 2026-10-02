import 'package:flutter/material.dart';
import 'package:provider/provider.dart';
import 'api.dart';
import 'ui.dart';
import 'shop.dart';
import 'customer.dart';
import 'workspace.dart';

void main() {
  WidgetsFlutterBinding.ensureInitialized();
  runApp(
    MultiProvider(
      providers: [
        ChangeNotifierProvider(create: (_) => Api()..init()),
        ChangeNotifierProvider(create: (_) => Cart()),
      ],
      child: const MaisonApp(),
    ),
  );
}

class MaisonApp extends StatelessWidget {
  const MaisonApp({super.key});
  @override
  Widget build(BuildContext context) => MaterialApp(
    title: 'Maison Munezero',
    debugShowCheckedModeBanner: false,
    theme: ThemeData(
      useMaterial3: true,
      fontFamily: 'MaisonSans',
      colorScheme: ColorScheme.fromSeed(seedColor: ink, surface: paper),
      scaffoldBackgroundColor: paper,
      textTheme: const TextTheme(
        headlineLarge: TextStyle(
          fontFamily: 'MaisonSerif',
          fontWeight: FontWeight.w400,
          color: ink,
        ),
        headlineMedium: TextStyle(
          fontFamily: 'MaisonSerif',
          fontWeight: FontWeight.w400,
          color: ink,
        ),
        titleLarge: TextStyle(color: ink, fontWeight: FontWeight.w500),
      ),
      inputDecorationTheme: InputDecorationTheme(
        border: OutlineInputBorder(borderRadius: BorderRadius.circular(8)),
        contentPadding: const EdgeInsets.symmetric(
          horizontal: 16,
          vertical: 16,
        ),
      ),
      filledButtonTheme: FilledButtonThemeData(
        style: FilledButton.styleFrom(
          backgroundColor: ink,
          foregroundColor: Colors.white,
          padding: const EdgeInsets.symmetric(horizontal: 24, vertical: 18),
          shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(6)),
        ),
      ),
    ),
    onGenerateRoute: (settings) {
      final path = Uri.parse(settings.name ?? '/').path;
      Widget screen;
      if (path.startsWith('/products/')) {
        screen = ProductDetail(id: path.split('/').last);
      } else if (path.startsWith('/orders/')) {
        screen = OrderDetail(id: path.split('/').last);
      } else if (path == '/checkout') {
        screen = const CheckoutPage();
      } else if (path == '/auth') {
        screen = const AuthPage();
      } else {
        screen = const Shell();
      }
      return MaterialPageRoute(builder: (_) => screen, settings: settings);
    },
  );
}

class Shell extends StatefulWidget {
  const Shell({super.key});
  @override
  State<Shell> createState() => _ShellState();
}

class _ShellState extends State<Shell> {
  String page = 'Collection';
  final GlobalKey<ScaffoldState> scaffold = GlobalKey<ScaffoldState>();
  @override
  Widget build(BuildContext context) {
    final api = context.watch<Api>();
    final cart = context.watch<Cart>();
    final pages = [
      'Collection',
      'Atelier',
      if (api.signedIn && api.role == 'CUSTOMER') ...[
        'Orders',
        'Appointments',
        'Returns',
        'Wishlist',
      ],
      if (api.staff) 'Workspace',
      if (api.signedIn) 'Account',
    ];
    if (!pages.contains(page)) page = 'Collection';
    Widget content;
    switch (page) {
      case 'Atelier':
        content = const AtelierPage();
        break;
      case 'Orders':
        content = const OrdersPage();
        break;
      case 'Appointments':
        content = const AppointmentsPage();
        break;
      case 'Returns':
        content = const ReturnsPage();
        break;
      case 'Wishlist':
        content = const WishlistPage();
        break;
      case 'Workspace':
        content = const WorkspacePage();
        break;
      case 'Account':
        content = const AccountPage();
        break;
      default:
        content = const CollectionPage();
    }
    final wide = MediaQuery.sizeOf(context).width >= 1000;
    return Scaffold(
      key: scaffold,
      appBar: AppBar(
        backgroundColor: paper,
        surfaceTintColor: paper,
        toolbarHeight: 86,
        automaticallyImplyLeading: !wide,
        leading: wide
            ? null
            : IconButton(
                icon: const Icon(Icons.menu),
                onPressed: () => scaffold.currentState?.openDrawer(),
              ),
        titleSpacing: wide ? 36 : 0,
        title: GestureDetector(
          onTap: () => setState(() => page = 'Collection'),
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              Text(
                'MAISON MUNEZERO',
                style: TextStyle(
                  fontSize: wide ? 18 : 13,
                  letterSpacing: wide ? 3 : 1.2,
                  fontWeight: FontWeight.w600,
                  color: ink,
                ),
              ),
              SizedBox(height: 4),
              Text(
                'FASHION HOUSE & ATELIER',
                style: TextStyle(
                  fontSize: wide ? 9 : 7,
                  letterSpacing: wide ? 2.7 : 1.2,
                  color: Colors.black54,
                ),
              ),
            ],
          ),
        ),
        actions: [
          if (wide)
            for (final p in pages)
              TextButton(
                onPressed: () => setState(() => page = p),
                child: Text(
                  p,
                  style: TextStyle(
                    color: page == p ? ink : Colors.black54,
                    fontWeight: page == p ? FontWeight.w700 : FontWeight.normal,
                  ),
                ),
              ),
          if (!api.signedIn)
            TextButton(
              onPressed: () => Navigator.pushNamed(context, '/auth'),
              child: const Text('Sign in'),
            ),
          IconButton(
            tooltip: 'Shopping bag',
            onPressed: () => Navigator.pushNamed(context, '/checkout'),
            icon: Badge(
              label: Text('${cart.count}'),
              isLabelVisible: cart.count > 0,
              child: const Icon(Icons.shopping_bag_outlined),
            ),
          ),
          const SizedBox(width: 20),
        ],
      ),
      drawer: Drawer(
        child: SafeArea(
          child: ListView(
            children: [
              const Padding(
                padding: EdgeInsets.all(24),
                child: Text(
                  'Maison Munezero',
                  style: TextStyle(fontSize: 24, color: ink),
                ),
              ),
              for (final p in pages)
                ListTile(
                  selected: page == p,
                  title: Text(p),
                  onTap: () {
                    Navigator.pop(context);
                    setState(() => page = p);
                  },
                ),
              if (api.signedIn)
                ListTile(
                  title: const Text('Sign out'),
                  onTap: () async {
                    Navigator.pop(context);
                    await api.logout();
                  },
                ),
            ],
          ),
        ),
      ),
      body: api.initialized
          ? content
          : const Center(child: CircularProgressIndicator()),
    );
  }
}
