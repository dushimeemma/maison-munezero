import 'package:flutter/material.dart';
import 'package:provider/provider.dart';
import 'api.dart';
import 'ui.dart';
import 'theme.dart';
import 'customer.dart';

class CollectionPage extends StatefulWidget {
  const CollectionPage({super.key});
  @override
  State<CollectionPage> createState() => _CollectionPageState();
}

class _CollectionPageState extends State<CollectionPage> {
  String category = 'All pieces', query = '';
  final search = TextEditingController();
  final collectionAnchor = GlobalKey();
  @override
  void dispose() {
    search.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) => SingleChildScrollView(
    child: Center(
      child: ConstrainedBox(
        constraints: const BoxConstraints(maxWidth: 1440),
        child: Padding(
          padding: EdgeInsets.symmetric(
            horizontal: MediaQuery.sizeOf(context).width < 600 ? 20 : 44,
          ),
          child: RemoteView(
            key: ValueKey('$category:$query'),
            load: () async {
              final api = context.read<Api>();
              return {
                'settings': await api.get('/settings'),
                'categories': await api.get('/categories'),
                'products': await api.get(
                  '/products?q=${Uri.encodeComponent(query)}${category == 'All pieces' ? '' : '&category=${Uri.encodeComponent(category)}'}',
                ),
              };
            },
            builder: (data, reload) {
              final products = List<Map<String, dynamic>>.from(
                (data['products'] as List).map(
                  (p) => Map<String, dynamic>.from(p),
                ),
              );
              final s = data['settings'];
              final wide = MediaQuery.sizeOf(context).width > 850;
              final heroText = Padding(
                padding: EdgeInsets.all(wide ? 50 : 28),
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  mainAxisAlignment: MainAxisAlignment.center,
                  children: [
                    Text(
                      'THE MAISON EDIT',
                      style: TextStyle(
                        letterSpacing: 3,
                        fontSize: 11,
                        color: Theme.of(context).colorScheme.onSurface,
                      ),
                    ),
                    const SizedBox(height: 22),
                    Text(
                      'Made to be\nyour own.',
                      style: TextStyle(
                        fontFamily: 'MaisonSerif',
                        fontSize: wide ? 62 : 44,
                        height: 1.08,
                        color: Theme.of(context).colorScheme.onSurface,
                      ),
                    ),
                    const SizedBox(height: 24),
                    Text(
                      'Expressive pieces. Considered details.\nDiscover ready-to-wear or create something\nuniquely yours with our atelier.',
                      style: TextStyle(
                        fontSize: 15,
                        height: 1.8,
                        color: Theme.of(context).colorScheme.onSurfaceVariant,
                      ),
                    ),
                    const SizedBox(height: 26),
                    FilledButton.icon(
                      onPressed: () => Scrollable.ensureVisible(
                        collectionAnchor.currentContext!,
                        duration: const Duration(milliseconds: 400),
                      ),
                      icon: const Icon(Icons.arrow_forward, size: 18),
                      label: const Text('Explore the collection'),
                    ),
                    const SizedBox(height: 20),
                    Text(
                      'READY-TO-WEAR  /  BESPOKE  /  OCCASION',
                      style: TextStyle(
                        fontSize: 9,
                        letterSpacing: 1.5,
                        color: Theme.of(context).colorScheme.onSurfaceVariant,
                      ),
                    ),
                  ],
                ),
              );
              return Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  const SizedBox(height: 20),
                  Container(
                    clipBehavior: Clip.antiAlias,
                    decoration: BoxDecoration(
                      color: Theme.of(context).colorScheme.surfaceContainerLow,
                      borderRadius: BorderRadius.circular(8),
                    ),
                    child: wide
                        ? IntrinsicHeight(
                            child: Row(
                              crossAxisAlignment: CrossAxisAlignment.stretch,
                              children: [
                                Expanded(child: heroText),
                                const Expanded(
                                  child: SizedBox(
                                    height: 490,
                                    child: GarmentArt(color: Color(0xFF857960)),
                                  ),
                                ),
                              ],
                            ),
                          )
                        : Column(
                            children: [
                              heroText,
                              const SizedBox(
                                height: 280,
                                width: double.infinity,
                                child: GarmentArt(color: Color(0xFF857960)),
                              ),
                            ],
                          ),
                  ),
                  const SizedBox(height: 22),
                  Wrap(
                    spacing: 28,
                    runSpacing: 10,
                    children: [
                      Text(
                        '✦  Crafted with care',
                        style: TextStyle(
                          color: Theme.of(context).colorScheme.onSurface,
                          fontSize: 12,
                        ),
                      ),
                      Text(
                        '✦  Shop pickup & delivery',
                        style: TextStyle(
                          color: Theme.of(context).colorScheme.onSurface,
                          fontSize: 12,
                        ),
                      ),
                      Text(
                        '✦  Custom design consultations',
                        style: TextStyle(
                          color: Theme.of(context).colorScheme.onSurface,
                          fontSize: 12,
                        ),
                      ),
                    ],
                  ),
                  const SizedBox(height: 48),
                  if (s['sampleCatalogue'] == true)
                    Padding(
                      padding: EdgeInsets.only(bottom: 20),
                      child: Text(
                        'Preview collection · Sample products and illustrations',
                        style: TextStyle(
                          color: Theme.of(context).colorScheme.error,
                          fontSize: 12,
                        ),
                      ),
                    ),
                  PageHeading(
                    'The collection',
                    'Find a piece that feels like you.',
                    key: collectionAnchor,
                  ),
                  Wrap(
                    spacing: 12,
                    runSpacing: 12,
                    crossAxisAlignment: WrapCrossAlignment.center,
                    children: [
                      for (final c in [
                        'All pieces',
                        ...List<String>.from(data['categories']),
                      ])
                        ChoiceChip(
                          label: Text(c),
                          selected: category == c,
                          onSelected: (_) => setState(() => category = c),
                        ),
                      SizedBox(
                        width: 260,
                        child: TextField(
                          controller: search,
                          decoration: InputDecoration(
                            hintText: 'Search pieces',
                            suffixIcon: IconButton(
                              icon: const Icon(Icons.search),
                              onPressed: () =>
                                  setState(() => query = search.text.trim()),
                            ),
                          ),
                          onSubmitted: (v) => setState(() => query = v.trim()),
                        ),
                      ),
                    ],
                  ),
                  const SizedBox(height: 24),
                  if (products.isEmpty)
                    const EmptyState('No pieces found. Try another category.')
                  else
                    LayoutBuilder(
                      builder: (context, constraints) {
                        final cols = constraints.maxWidth < 650
                            ? 2
                            : constraints.maxWidth < 1000
                            ? 3
                            : 4;
                        return GridView.builder(
                          shrinkWrap: true,
                          physics: const NeverScrollableScrollPhysics(),
                          itemCount: products.length,
                          gridDelegate:
                              SliverGridDelegateWithFixedCrossAxisCount(
                                crossAxisCount: cols,
                                mainAxisExtent: constraints.maxWidth < 500
                                    ? 295
                                    : 385,
                                crossAxisSpacing: 18,
                                mainAxisSpacing: 26,
                              ),
                          itemBuilder: (context, i) =>
                              ProductCard(product: products[i], index: i),
                        );
                      },
                    ),
                  const SizedBox(height: 52),
                  Container(
                    width: double.infinity,
                    padding: EdgeInsets.all(wide ? 40 : 24),
                    decoration: BoxDecoration(
                      color: ink,
                      borderRadius: BorderRadius.circular(8),
                    ),
                    child: Wrap(
                      spacing: 60,
                      runSpacing: 22,
                      alignment: WrapAlignment.spaceBetween,
                      crossAxisAlignment: WrapCrossAlignment.center,
                      children: [
                        const Column(
                          crossAxisAlignment: CrossAxisAlignment.start,
                          children: [
                            Text(
                              'A vision. A conversation.\nA piece made for you.',
                              style: TextStyle(
                                fontFamily: 'MaisonSerif',
                                color: paper,
                                fontSize: 28,
                                height: 1.3,
                              ),
                            ),
                            SizedBox(height: 16),
                            Text(
                              'Visit Atelier in the menu to start your custom design.',
                              style: TextStyle(
                                color: Colors.white70,
                                fontSize: 13,
                              ),
                            ),
                          ],
                        ),
                        OutlinedButton(
                          onPressed: () async {
                            final api = context.read<Api>();
                            if (!api.signedIn) {
                              await Navigator.pushNamed(context, '/auth');
                            }
                            if (context.mounted && api.signedIn) {
                              await requestDesign(context);
                            }
                          },
                          style: OutlinedButton.styleFrom(
                            foregroundColor: paper,
                            side: const BorderSide(color: Colors.white54),
                            padding: const EdgeInsets.all(20),
                          ),
                          child: const Text('Start a design request  →'),
                        ),
                      ],
                    ),
                  ),
                  const SizedBox(height: 44),
                  Wrap(
                    spacing: 36,
                    runSpacing: 16,
                    children: [
                      Text(
                        'MAISON MUNEZERO',
                        style: TextStyle(
                          letterSpacing: 2,
                          color: Theme.of(context).colorScheme.onSurface,
                        ),
                      ),
                      SelectableText('${s['shopAddress']}'),
                      SelectableText('${s['shopPhone']}'),
                      const Text('Instagram: @maisonmunezero'),
                    ],
                  ),
                  const SizedBox(height: 28),
                  const Divider(),
                  Padding(
                    padding: EdgeInsets.symmetric(vertical: 20),
                    child: Text(
                      '© Maison Munezero · Fashion with a personal point of view.',
                      style: TextStyle(
                        fontSize: 11,
                        color: Theme.of(context).colorScheme.onSurfaceVariant,
                      ),
                    ),
                  ),
                ],
              );
            },
          ),
        ),
      ),
    ),
  );
}

class ProductCard extends StatelessWidget {
  final Map<String, dynamic> product;
  final int index;
  const ProductCard({required this.product, this.index = 0, super.key});
  @override
  Widget build(BuildContext context) {
    const colors = [
      Color(0xFFAD7057),
      Color(0xFF6A755A),
      Color(0xFFB4A98B),
      Color(0xFFAE9577),
    ];
    return InkWell(
      onTap: () => Navigator.pushNamed(context, '/products/${product['id']}'),
      borderRadius: BorderRadius.circular(6),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Expanded(
            child: ClipRRect(
              borderRadius: BorderRadius.circular(6),
              child: SizedBox.expand(
                child:
                    product['image_url'] != null &&
                        '${product['image_url']}'.isNotEmpty
                    ? Image.network(
                        product['image_url'],
                        fit: BoxFit.cover,
                        errorBuilder: (_, _, _) => GarmentArt(
                          category: product['category'],
                          color: colors[index % 4],
                        ),
                      )
                    : GarmentArt(
                        category: product['category'],
                        color: colors[index % 4],
                      ),
              ),
            ),
          ),
          const SizedBox(height: 14),
          Text(
            '${product['category']}'.toUpperCase(),
            style: TextStyle(
              fontSize: 9,
              letterSpacing: 1.8,
              color: Theme.of(context).colorScheme.onSurfaceVariant,
            ),
          ),
          const SizedBox(height: 6),
          Text(
            '${product['name']}',
            maxLines: 1,
            overflow: TextOverflow.ellipsis,
            style: TextStyle(
              fontSize: 15,
              color: Theme.of(context).colorScheme.onSurface,
            ),
          ),
          const SizedBox(height: 6),
          Text(
            rwf(product['price']),
            style: TextStyle(
              fontSize: 12,
              color: Theme.of(context).colorScheme.onSurfaceVariant,
            ),
          ),
        ],
      ),
    );
  }
}

class ProductDetail extends StatefulWidget {
  final String id;
  const ProductDetail({required this.id, super.key});
  @override
  State<ProductDetail> createState() => _ProductDetailState();
}

class _ProductDetailState extends State<ProductDetail> {
  String? variantId;
  @override
  Widget build(BuildContext context) => Scaffold(
    appBar: AppBar(
      title: const Text('The collection'),
      actions: [
        const ThemePicker(),
        IconButton(
          icon: const Icon(Icons.shopping_bag_outlined),
          onPressed: () => Navigator.pushNamed(context, '/checkout'),
        ),
      ],
    ),
    body: SingleChildScrollView(
      child: Padding(
        padding: const EdgeInsets.all(24),
        child: RemoteView(
          load: () => context.read<Api>().get('/products/${widget.id}'),
          builder: (data, reload) {
            final product = Map<String, dynamic>.from(data);
            final variants = List<Map<String, dynamic>>.from(
              (data['variants'] as List).map(
                (v) => Map<String, dynamic>.from(v),
              ),
            );
            variantId ??= variants
                .where((v) => v['stock'] > 0)
                .firstOrNull?['id'];
            final selected = variants
                .where((v) => v['id'] == variantId)
                .firstOrNull;
            final art = SizedBox(
              height: 520,
              width: 480,
              child: product['image_url'] != null
                  ? Image.network(
                      product['image_url'],
                      fit: BoxFit.cover,
                      errorBuilder: (_, _, _) =>
                          GarmentArt(category: product['category']),
                    )
                  : GarmentArt(category: product['category']),
            );
            final detail = SizedBox(
              width: 460,
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  Text(
                    '${product['category']}'.toUpperCase(),
                    style: TextStyle(
                      letterSpacing: 2,
                      color: Theme.of(context).colorScheme.onSurfaceVariant,
                      fontSize: 11,
                    ),
                  ),
                  const SizedBox(height: 14),
                  Text(
                    product['name'],
                    style: Theme.of(context).textTheme.headlineLarge,
                  ),
                  const SizedBox(height: 20),
                  Text(
                    rwf(product['price']),
                    style: TextStyle(
                      fontSize: 20,
                      color: Theme.of(context).colorScheme.onSurface,
                    ),
                  ),
                  const SizedBox(height: 20),
                  Text(
                    product['description'],
                    style: TextStyle(
                      height: 1.7,
                      color: Theme.of(context).colorScheme.onSurfaceVariant,
                    ),
                  ),
                  const SizedBox(height: 28),
                  DropdownButtonFormField<String>(
                    initialValue: variantId,
                    isExpanded: true,
                    decoration: const InputDecoration(
                      labelText: 'Size & colour',
                    ),
                    items: variants
                        .map(
                          (v) => DropdownMenuItem(
                            value: '${v['id']}',
                            child: Text(
                              '${v['size']} · ${v['color']} · ${v['stock'] > 0 ? '${v['stock']} available' : 'Sold out'}',
                            ),
                          ),
                        )
                        .toList(),
                    onChanged: (v) => setState(() => variantId = v),
                  ),
                  const SizedBox(height: 22),
                  SizedBox(
                    width: double.infinity,
                    child: FilledButton.icon(
                      onPressed: selected == null || selected['stock'] <= 0
                          ? null
                          : () {
                              try {
                                context.read<Cart>().add(product, selected);
                                toast(context, 'Added to your bag');
                              } catch (e) {
                                toast(context, e);
                              }
                            },
                      icon: const Icon(Icons.shopping_bag_outlined),
                      label: const Text('Add to bag'),
                    ),
                  ),
                  const SizedBox(height: 14),
                  OutlinedButton.icon(
                    onPressed: () async {
                      final api = context.read<Api>();
                      if (!api.signedIn) {
                        await Navigator.pushNamed(context, '/auth');
                      }
                      if (!api.signedIn) return;
                      try {
                        await api.post('/wishlist/${widget.id}');
                        if (context.mounted) {
                          toast(context, 'Saved to your wishlist');
                        }
                      } catch (e) {
                        if (context.mounted) toast(context, e);
                      }
                    },
                    icon: const Icon(Icons.favorite_border),
                    label: const Text('Save for later'),
                  ),
                  const SizedBox(height: 26),
                  const Divider(),
                  Text(
                    'Collect at the shop or choose delivery at checkout. Your total, including delivery, is confirmed before payment.',
                    style: TextStyle(
                      fontSize: 12,
                      height: 1.6,
                      color: Theme.of(context).colorScheme.onSurfaceVariant,
                    ),
                  ),
                ],
              ),
            );
            return Center(
              child: Wrap(spacing: 56, runSpacing: 32, children: [art, detail]),
            );
          },
        ),
      ),
    ),
  );
}

class CheckoutPage extends StatefulWidget {
  const CheckoutPage({super.key});
  @override
  State<CheckoutPage> createState() => _CheckoutPageState();
}

class _CheckoutPageState extends State<CheckoutPage> {
  String fulfilment = 'PICKUP';
  String? zone;
  bool busy = false;
  bool shopSale = false;
  bool agreed = false;
  final name = TextEditingController(),
      phone = TextEditingController(),
      address = TextEditingController();
  late Future<dynamic> settings;
  String? requestKey;
  Map<String, dynamic>? submittedBody;
  @override
  void initState() {
    super.initState();
    final api = context.read<Api>();
    settings = api.get('/settings');
    name.text = api.user?['name'] ?? '';
    phone.text = api.user?['phone'] ?? '';
  }

  @override
  void dispose() {
    name.dispose();
    phone.dispose();
    address.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    final api = context.watch<Api>();
    final cart = context.watch<Cart>();
    return Scaffold(
      appBar: AppBar(
        title: const Text('Your shopping bag'),
        actions: const [ThemePicker()],
      ),
      body: cart.lines.isEmpty
          ? const Padding(
              padding: EdgeInsets.all(24),
              child: EmptyState(
                'Your bag is empty. Explore the collection to add a piece.',
              ),
            )
          : SingleChildScrollView(
              child: Center(
                child: ConstrainedBox(
                  constraints: const BoxConstraints(maxWidth: 920),
                  child: Padding(
                    padding: const EdgeInsets.all(24),
                    child: FutureBuilder<dynamic>(
                      future: settings,
                      builder: (context, snapshot) {
                        if (!snapshot.hasData) {
                          return snapshot.hasError
                              ? Text('${snapshot.error}')
                              : const Center(
                                  child: CircularProgressIndicator(),
                                );
                        }
                        final s = snapshot.data;
                        final zones = List<Map<String, dynamic>>.from(
                          s['deliveryZones'],
                        );
                        zone ??= zones.firstOrNull?['id'];
                        final fee = fulfilment == 'DELIVERY'
                            ? (zones
                                              .where((z) => z['id'] == zone)
                                              .firstOrNull?['fee']
                                          as num? ??
                                      0)
                                  .toInt()
                            : 0;
                        final tax =
                            (cart.subtotal *
                                    (s['taxBasisPoints'] as num) /
                                    10000)
                                .round();
                        return Column(
                          crossAxisAlignment: CrossAxisAlignment.start,
                          children: [
                            const PageHeading(
                              'Your pieces',
                              'A few details, then your order is on its way.',
                            ),
                            for (final entry in cart.lines.entries)
                              Panel(
                                child: Row(
                                  children: [
                                    Expanded(
                                      child: Column(
                                        crossAxisAlignment:
                                            CrossAxisAlignment.start,
                                        children: [
                                          Text(
                                            '${entry.value['product']['name']}',
                                          ),
                                          Text(
                                            '${entry.value['variant']['size']} · ${entry.value['variant']['color']}',
                                            style: TextStyle(
                                              color: Theme.of(
                                                context,
                                              ).colorScheme.onSurfaceVariant,
                                            ),
                                          ),
                                          Text(
                                            rwf(
                                              entry.value['product']['price'],
                                            ),
                                          ),
                                        ],
                                      ),
                                    ),
                                    IconButton(
                                      onPressed: busy
                                          ? null
                                          : () => cart.quantity(
                                              entry.key,
                                              entry.value['quantity'] - 1,
                                            ),
                                      icon: const Icon(
                                        Icons.remove_circle_outline,
                                      ),
                                    ),
                                    Text('${entry.value['quantity']}'),
                                    IconButton(
                                      onPressed: busy
                                          ? null
                                          : () {
                                              try {
                                                cart.add(
                                                  entry.value['product'],
                                                  entry.value['variant'],
                                                );
                                              } catch (e) {
                                                toast(context, e);
                                              }
                                            },
                                      icon: const Icon(
                                        Icons.add_circle_outline,
                                      ),
                                    ),
                                  ],
                                ),
                              ),
                            if (api.sales)
                              SwitchListTile(
                                contentPadding: EdgeInsets.zero,
                                title: const Text('Record a shop sale'),
                                subtitle: const Text(
                                  'Walk-in purchase through your staff account',
                                ),
                                value: shopSale,
                                onChanged: busy
                                    ? null
                                    : (v) => setState(() {
                                        shopSale = v;
                                        fulfilment = v ? 'IN_SHOP' : 'PICKUP';
                                      }),
                              ),
                            Panel(
                              child: Column(
                                children: [
                                  TextField(
                                    controller: name,
                                    enabled: !busy,
                                    decoration: const InputDecoration(
                                      labelText: 'Customer name',
                                    ),
                                  ),
                                  const SizedBox(height: 14),
                                  TextField(
                                    controller: phone,
                                    enabled: !busy,
                                    keyboardType: TextInputType.phone,
                                    decoration: const InputDecoration(
                                      labelText: 'Phone · 2507XXXXXXXX',
                                    ),
                                  ),
                                  const SizedBox(height: 14),
                                  DropdownButtonFormField<String>(
                                    initialValue: fulfilment,
                                    decoration: const InputDecoration(
                                      labelText:
                                          'How would you like your order?',
                                    ),
                                    items: [
                                      const DropdownMenuItem(
                                        value: 'PICKUP',
                                        child: Text('Collect at the shop'),
                                      ),
                                      const DropdownMenuItem(
                                        value: 'DELIVERY',
                                        child: Text('Delivery'),
                                      ),
                                      if (shopSale)
                                        const DropdownMenuItem(
                                          value: 'IN_SHOP',
                                          child: Text('Bought in the shop'),
                                        ),
                                    ],
                                    onChanged: busy
                                        ? null
                                        : (v) =>
                                              setState(() => fulfilment = v!),
                                    isExpanded: true,
                                  ),
                                  if (fulfilment == 'DELIVERY') ...[
                                    const SizedBox(height: 14),
                                    DropdownButtonFormField<String>(
                                      initialValue: zone,
                                      decoration: const InputDecoration(
                                        labelText: 'Delivery area',
                                      ),
                                      items: zones
                                          .map(
                                            (z) => DropdownMenuItem(
                                              value: '${z['id']}',
                                              child: Text(
                                                '${z['name']} · ${rwf(z['fee'])}',
                                              ),
                                            ),
                                          )
                                          .toList(),
                                      onChanged: busy
                                          ? null
                                          : (v) => setState(() => zone = v),
                                      isExpanded: true,
                                    ),
                                    const SizedBox(height: 14),
                                    TextField(
                                      controller: address,
                                      enabled: !busy,
                                      maxLines: 3,
                                      decoration: const InputDecoration(
                                        labelText:
                                            'Address, landmark & delivery instructions',
                                      ),
                                    ),
                                  ],
                                ],
                              ),
                            ),
                            Panel(
                              child: Column(
                                children: [
                                  summary('Pieces', rwf(cart.subtotal)),
                                  summary('Tax', rwf(tax)),
                                  summary('Delivery', rwf(fee)),
                                  const Divider(),
                                  summary(
                                    'Total estimate',
                                    rwf(cart.subtotal + fee + tax),
                                  ),
                                  const SizedBox(height: 10),
                                  Text(
                                    'The server checks current prices and stock when you place your order. Review the confirmed total before paying.',
                                    style: TextStyle(
                                      color: Theme.of(
                                        context,
                                      ).colorScheme.onSurfaceVariant,
                                      fontSize: 12,
                                      height: 1.5,
                                    ),
                                  ),
                                  ExpansionTile(
                                    title: const Text('Shop terms'),
                                    children: [
                                      Padding(
                                        padding: const EdgeInsets.all(16),
                                        child: Text('${s['terms']}'),
                                      ),
                                    ],
                                  ),
                                  CheckboxListTile(
                                    contentPadding: EdgeInsets.zero,
                                    controlAffinity:
                                        ListTileControlAffinity.leading,
                                    title: const Text(
                                      'I have reviewed the shop terms.',
                                    ),
                                    value: agreed,
                                    onChanged: busy
                                        ? null
                                        : (v) => setState(
                                            () => agreed = v ?? false,
                                          ),
                                  ),
                                ],
                              ),
                            ),
                            SizedBox(
                              width: double.infinity,
                              child: FilledButton(
                                onPressed: busy || !agreed
                                    ? null
                                    : () async {
                                        if (!api.signedIn) {
                                          await Navigator.pushNamed(
                                            context,
                                            '/auth',
                                          );
                                          if (!api.signedIn ||
                                              !context.mounted) {
                                            return;
                                          }
                                        }
                                        if (name.text.trim().isEmpty ||
                                            !RegExp(
                                              r'^2507[2389]\d{7}$',
                                            ).hasMatch(phone.text.trim())) {
                                          toast(
                                            context,
                                            'Enter a name and Rwanda phone number.',
                                          );
                                          return;
                                        }
                                        if (fulfilment == 'DELIVERY' &&
                                            (address.text.trim().isEmpty ||
                                                zone == null)) {
                                          toast(
                                            context,
                                            'Enter a delivery address and area.',
                                          );
                                          return;
                                        }
                                        final body = <String, dynamic>{
                                          'items': cart.lines.entries
                                              .map(
                                                (e) => {
                                                  'variantId': e.key,
                                                  'quantity':
                                                      e.value['quantity'],
                                                },
                                              )
                                              .toList(),
                                          'customerName': name.text.trim(),
                                          'customerPhone': phone.text.trim(),
                                          'fulfilment': fulfilment,
                                          'channel': shopSale
                                              ? 'SHOP'
                                              : 'ONLINE',
                                          if (fulfilment == 'DELIVERY')
                                            'zoneId': zone,
                                          if (fulfilment == 'DELIVERY')
                                            'address': address.text.trim(),
                                        };
                                        // Keep the same key and payload after a timeout. The server returns the original order.
                                        if (submittedBody == null) {
                                          submittedBody = body;
                                          requestKey = api.newKey();
                                        }
                                        setState(() => busy = true);
                                        try {
                                          final order = await api.post(
                                            '/orders',
                                            submittedBody,
                                            requestKey,
                                          );
                                          cart.clear();
                                          if (context.mounted) {
                                            Navigator.pushReplacementNamed(
                                              context,
                                              '/orders/${order['id']}',
                                            );
                                          }
                                        } catch (e) {
                                          if (e is ApiException &&
                                              e.status >= 400 &&
                                              e.status < 500) {
                                            submittedBody = null;
                                            requestKey = null;
                                          }
                                          if (context.mounted) {
                                            toast(context, e);
                                          }
                                        } finally {
                                          if (mounted) {
                                            setState(() => busy = false);
                                          }
                                        }
                                      },
                                child: Text(
                                  busy
                                      ? 'Placing your order…'
                                      : submittedBody != null
                                      ? 'Check / retry submitted order'
                                      : 'Place order & review payment',
                                ),
                              ),
                            ),
                            const SizedBox(height: 30),
                          ],
                        );
                      },
                    ),
                  ),
                ),
              ),
            ),
    );
  }

  Widget summary(String title, String value) => Padding(
    padding: const EdgeInsets.symmetric(vertical: 8),
    child: Row(
      mainAxisAlignment: MainAxisAlignment.spaceBetween,
      children: [
        Text(title),
        Text(value, style: const TextStyle(fontWeight: FontWeight.w600)),
      ],
    ),
  );
}
