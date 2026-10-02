import 'dart:convert';
import 'package:flutter/material.dart';
import 'package:provider/provider.dart';
import 'api.dart';
import 'ui.dart';
import 'customer.dart';
import 'editors.dart';
import 'extras.dart';

class WorkspacePage extends StatefulWidget {
  const WorkspacePage({super.key});
  @override
  State<WorkspacePage> createState() => _WorkspacePageState();
}

class _WorkspacePageState extends State<WorkspacePage> {
  String selected = 'Orders';
  @override
  Widget build(BuildContext context) {
    final api = context.watch<Api>();
    final tabs = [
      if (api.sales || api.studio || api.role == 'DRIVER' || api.finance)
        'Orders',
      if (api.sales) 'Products',
      if (api.studio) ...['Atelier', 'Appointments'],
      if (api.sales || api.role == 'DRIVER') 'Deliveries',
      if (api.finance) ...['Payments', 'Returns', 'Reports'],
      if (api.manager) ...['Inventory', 'Users', 'Settings'],
      if (api.role == 'SUPER_ADMIN') 'Audit',
    ];
    if (!tabs.contains(selected)) selected = tabs.first;
    Widget body;
    switch (selected) {
      case 'Products':
        body = const ProductsWorkspace();
        break;
      case 'Inventory':
        body = const InventoryWorkspace();
        break;
      case 'Atelier':
        body = const Padding(
          padding: EdgeInsets.all(24),
          child: SingleChildScrollView(child: BespokeList()),
        );
        break;
      case 'Appointments':
        body = const AppointmentsPage();
        break;
      case 'Deliveries':
        body = const DeliveriesWorkspace();
        break;
      case 'Users':
        body = const UsersWorkspace();
        break;
      case 'Settings':
        body = const SettingsWorkspace();
        break;
      case 'Payments':
        body = const PaymentsWorkspace();
        break;
      case 'Returns':
        body = const ReturnsPage();
        break;
      case 'Reports':
        body = const ReportsWorkspace();
        break;
      case 'Audit':
        body = const AuditWorkspace();
        break;
      default:
        body = const OrdersWorkspace();
    }
    return Column(
      children: [
        Container(
          width: double.infinity,
          color: ink,
          padding: const EdgeInsets.symmetric(horizontal: 24, vertical: 18),
          child: Row(
            children: [
              const Icon(Icons.space_dashboard_outlined, color: Colors.white),
              const SizedBox(width: 12),
              const Expanded(
                child: Text(
                  'Maison workspace',
                  style: TextStyle(color: Colors.white, fontSize: 20),
                ),
              ),
              Text(
                label(api.role),
                style: const TextStyle(color: Colors.white70, fontSize: 12),
              ),
            ],
          ),
        ),
        SizedBox(
          height: 62,
          child: ListView(
            scrollDirection: Axis.horizontal,
            padding: const EdgeInsets.symmetric(horizontal: 18),
            children: [
              for (final tab in tabs)
                Padding(
                  padding: const EdgeInsets.all(8),
                  child: ChoiceChip(
                    label: Text(tab),
                    selected: selected == tab,
                    onSelected: (_) => setState(() => selected = tab),
                  ),
                ),
            ],
          ),
        ),
        Expanded(
          child: KeyedSubtree(key: ValueKey(selected), child: body),
        ),
      ],
    );
  }
}

class OrdersWorkspace extends StatelessWidget {
  const OrdersWorkspace({super.key});
  @override
  Widget build(BuildContext context) => ListView(
    padding: const EdgeInsets.all(24),
    children: [
      const PageHeading(
        'Orders',
        'Shop sales, online orders, and accepted custom quotations.',
      ),
      RemoteView(
        load: () => context.read<Api>().get('/orders'),
        builder: (data, reload) => Column(
          children: [
            if ((data as List).isEmpty) const EmptyState('No orders to show.'),
            for (final o in data)
              Panel(
                child: ListTile(
                  contentPadding: EdgeInsets.zero,
                  title: Text('MM-${o['number']} · ${o['customer_name']}'),
                  subtitle: Text(
                    '${label(o['channel'])} · ${label(o['fulfilment'])}\n${rwf(o['total'])} · Paid ${rwf(o['paid'])}',
                  ),
                  trailing: StatusChip(o['status']),
                  onTap: () async {
                    await Navigator.pushNamed(context, '/orders/${o['id']}');
                    reload();
                  },
                ),
              ),
          ],
        ),
      ),
    ],
  );
}

class ProductsWorkspace extends StatelessWidget {
  const ProductsWorkspace({super.key});
  @override
  Widget build(BuildContext context) {
    final api = context.read<Api>();
    return ListView(
      padding: const EdgeInsets.all(24),
      children: [
        const PageHeading(
          'Products',
          'Manage the catalogue, sizes, colours and prices.',
        ),
        RemoteView(
          load: () => api.get('/admin/products'),
          builder: (data, reload) => Column(
            children: [
              if (api.manager)
                Align(
                  alignment: Alignment.centerLeft,
                  child: FilledButton.icon(
                    onPressed: () async {
                      await productEditor(context);
                      reload();
                    },
                    icon: const Icon(Icons.add),
                    label: const Text('New product'),
                  ),
                ),
              const SizedBox(height: 20),
              for (final p in data)
                Panel(
                  child: ListTile(
                    contentPadding: EdgeInsets.zero,
                    title: Text('${p['name']} · ${rwf(p['price'])}'),
                    subtitle: Text(
                      '${p['category']} · ${p['active'] ? 'Published' : 'Hidden'}\n${(p['variants'] as List).map((v) => '${v['sku']}: ${v['stock']}').join(' · ')}',
                    ),
                    trailing: api.manager
                        ? IconButton(
                            icon: const Icon(Icons.edit_outlined),
                            onPressed: () async {
                              await productEditor(
                                context,
                                Map<String, dynamic>.from(p),
                              );
                              reload();
                            },
                          )
                        : null,
                  ),
                ),
            ],
          ),
        ),
      ],
    );
  }
}

Future<void> productEditor(
  BuildContext context, [
  Map<String, dynamic>? product,
]) async {
  final api = context.read<Api>();
  Map<String, dynamic>? metadata;
  String? imageUrl = product?['image_url'];
  final source = await showDialog<String>(
    context: context,
    builder: (_) => AlertDialog(
      title: const Text('Product image'),
      content: const Text(
        'Upload a photo from your device or use an existing image link.',
      ),
      actions: [
        TextButton(
          onPressed: () => Navigator.pop(context, 'link'),
          child: const Text('Use image link'),
        ),
        FilledButton(
          onPressed: () => Navigator.pop(context, 'upload'),
          child: const Text('Upload photo'),
        ),
      ],
    ),
  );
  if (source == null || !context.mounted) return;
  if (source == 'upload') {
    try {
      imageUrl = await uploadImage(context, api) ?? imageUrl;
    } catch (e) {
      if (context.mounted) toast(context, e);
      return;
    }
  }
  if (!context.mounted) return;
  final next = await editForm(
    context,
    product == null ? 'New product' : 'Edit product',
    [
      FieldSpec('name', 'Name', initial: product?['name'] ?? ''),
      FieldSpec(
        'description',
        'Description',
        multiline: true,
        initial: product?['description'] ?? '',
      ),
      FieldSpec(
        'category',
        'Category',
        initial: product?['category'] ?? 'Dresses',
      ),
      FieldSpec(
        'price',
        'Price (RWF)',
        number: true,
        initial: '${product?['price'] ?? ''}',
      ),
      FieldSpec(
        'imageUrl',
        'Product image HTTPS link',
        required: false,
        initial: imageUrl ?? '',
      ),
      FieldSpec(
        'active',
        'Publish in collection',
        options: const ['true', 'false'],
        initial: '${product?['active'] ?? true}',
      ),
      FieldSpec(
        'featured',
        'Featured piece',
        options: const ['true', 'false'],
        initial: '${product?['featured'] ?? false}',
      ),
    ],
    (d) async {
      metadata = {
        'name': d['name'],
        'description': d['description'],
        'category': d['category'],
        'price': int.parse(d['price']!),
        'imageUrl': d['imageUrl'],
        'active': d['active'] == 'true',
        'featured': d['featured'] == 'true',
      };
    },
    button: 'Next: sizes & colours',
  );
  if (next != true || !context.mounted) return;
  await showDialog(
    context: context,
    barrierDismissible: false,
    builder: (_) => RowEditor(
      title: 'Sizes & colours',
      note:
          'Add each available size and colour. Existing stock is adjusted separately in Inventory.',
      variants: true,
      initial: product == null
          ? [
              {'sku': '', 'size': 'M', 'color': '', 'stock': 0},
            ]
          : List<Map<String, dynamic>>.from(
              (product['variants'] as List).map(
                (v) => Map<String, dynamic>.from(v),
              ),
            ),
      fields: const [
        FieldSpec('sku', 'SKU'),
        FieldSpec('size', 'Size'),
        FieldSpec('color', 'Colour'),
        FieldSpec(
          'stock',
          'Opening available stock',
          number: true,
          initial: '0',
        ),
      ],
      save: (rows) async {
        final body = {
          ...metadata!,
          'variants': rows
              .map(
                (v) => {
                  if (v['id'] != null) 'id': v['id'],
                  'sku': v['sku'],
                  'size': v['size'],
                  'color': v['color'],
                  'stock': v['stock'],
                },
              )
              .toList(),
        };
        if (product == null) {
          await api.post('/products', body);
        } else {
          await api.put('/products/${product['id']}', body);
        }
      },
    ),
  );
}

class InventoryWorkspace extends StatelessWidget {
  const InventoryWorkspace({super.key});
  @override
  Widget build(BuildContext context) {
    final api = context.read<Api>();
    return ListView(
      padding: const EdgeInsets.all(24),
      children: [
        const PageHeading(
          'Inventory',
          'Stock is reserved at checkout. All manual adjustments require a reason.',
        ),
        RemoteView(
          load: () async => {
            'products': await api.get('/admin/products'),
            'movements': await api.get('/inventory/movements'),
          },
          builder: (data, reload) {
            final variants = [
              for (final p in data['products'])
                for (final v in p['variants'])
                  {...Map<String, dynamic>.from(v), 'name': p['name']},
            ];
            return Column(
              children: [
                for (final v in variants)
                  Panel(
                    child: ListTile(
                      contentPadding: EdgeInsets.zero,
                      title: Text(
                        '${v['name']} · ${v['size']} · ${v['color']}',
                      ),
                      subtitle: Text('${v['sku']} · Available ${v['stock']}'),
                      trailing: OutlinedButton(
                        onPressed: () async {
                          await editForm(
                            context,
                            'Adjust ${v['sku']}',
                            const [
                              FieldSpec(
                                'delta',
                                'Quantity change · positive or negative',
                                number: true,
                              ),
                              FieldSpec('reason', 'Reason', multiline: true),
                            ],
                            (d) async {
                              await api.post('/inventory/adjust', {
                                'variantId': v['id'],
                                'delta': int.parse(d['delta']!),
                                'reason': d['reason'],
                              });
                            },
                          );
                          reload();
                        },
                        child: const Text('Adjust'),
                      ),
                    ),
                  ),
                const Align(
                  alignment: Alignment.centerLeft,
                  child: Padding(
                    padding: EdgeInsets.symmetric(vertical: 20),
                    child: Text(
                      'Stock history',
                      style: TextStyle(fontSize: 22, color: ink),
                    ),
                  ),
                ),
                for (final m in data['movements'])
                  ListTile(
                    title: Text('${m['sku']} · ${m['delta']}'),
                    subtitle: Text(
                      '${m['reason']} · ${dateLabel(m['created_at'])}',
                    ),
                  ),
              ],
            );
          },
        ),
      ],
    );
  }
}

class DeliveriesWorkspace extends StatelessWidget {
  const DeliveriesWorkspace({super.key});
  @override
  Widget build(BuildContext context) {
    final api = context.read<Api>();
    return ListView(
      padding: const EdgeInsets.all(24),
      children: [
        const PageHeading(
          'Deliveries',
          'Assign drivers, follow dispatch, and confirm receipt with the customer code.',
        ),
        RemoteView(
          load: () => api.get('/deliveries'),
          builder: (data, reload) => Column(
            children: [
              if ((data as List).isEmpty)
                const EmptyState('No delivery orders.'),
              for (final d in data)
                Panel(
                  child: Column(
                    crossAxisAlignment: CrossAxisAlignment.start,
                    children: [
                      Row(
                        children: [
                          Expanded(
                            child: Text(
                              'MM-${d['number']} · ${d['customer_name']}',
                              style: const TextStyle(fontSize: 18, color: ink),
                            ),
                          ),
                          StatusChip(d['status']),
                        ],
                      ),
                      const SizedBox(height: 12),
                      Text(
                        '${d['address']}\n${d['customer_phone']}\nDriver: ${d['driver_name'] ?? 'Unassigned'}',
                        style: const TextStyle(height: 1.7),
                      ),
                      Text(
                        'Order: ${label(d['order_status'])} · Paid ${rwf(d['paid'])} / ${rwf(d['total'])}',
                      ),
                      const SizedBox(height: 14),
                      Wrap(
                        spacing: 12,
                        runSpacing: 12,
                        children: [
                          if (api.manager &&
                              [
                                'READY',
                                'OUT_FOR_DELIVERY',
                              ].contains(d['order_status']) &&
                              d['status'] != 'DELIVERED')
                            OutlinedButton(
                              onPressed: () async {
                                try {
                                  final drivers =
                                      (await api.get('/users') as List)
                                          .where(
                                            (u) =>
                                                u['role'] == 'DRIVER' &&
                                                u['active'],
                                          )
                                          .toList();
                                  if (!context.mounted) return;
                                  if (drivers.isEmpty) {
                                    toast(
                                      context,
                                      'Create a driver account first.',
                                    );
                                    return;
                                  }
                                  await editForm(
                                    context,
                                    'Assign delivery driver',
                                    [
                                      FieldSpec(
                                        'driverId',
                                        'Driver',
                                        options: drivers
                                            .map((u) => '${u['id']}')
                                            .toList(),
                                        optionLabels: {
                                          for (final x in drivers)
                                            '${x['id']}': '${x['name']}',
                                        },
                                      ),
                                    ],
                                    (values) async {
                                      await api.post(
                                        '/deliveries/${d['id']}/assign',
                                        values,
                                      );
                                    },
                                  );
                                  reload();
                                } catch (e) {
                                  if (context.mounted) toast(context, e);
                                }
                              },
                              child: Text(
                                d['driver_id'] == null
                                    ? 'Assign driver'
                                    : 'Reassign driver',
                              ),
                            ),
                          if (api.role == 'DRIVER')
                            for (final status
                                in d['status'] == 'ASSIGNED'
                                    ? ['PICKED_UP']
                                    : d['status'] == 'PICKED_UP'
                                    ? ['DELIVERED', 'FAILED']
                                    : <String>[])
                              FilledButton(
                                onPressed: () async {
                                  await editForm(
                                    context,
                                    label(status),
                                    [
                                      const FieldSpec(
                                        'proof',
                                        'Delivery note / proof',
                                        multiline: true,
                                      ),
                                      if (status == 'DELIVERED')
                                        const FieldSpec(
                                          'collectionCode',
                                          'Code from customer',
                                        ),
                                    ],
                                    (values) async {
                                      await api.post(
                                        '/deliveries/${d['id']}/status',
                                        {'status': status, ...values},
                                      );
                                    },
                                  );
                                  reload();
                                },
                                child: Text(label(status)),
                              ),
                          TextButton(
                            onPressed: () async {
                              await Navigator.pushNamed(
                                context,
                                '/orders/${d['order_id']}',
                              );
                              reload();
                            },
                            child: const Text('Open order'),
                          ),
                        ],
                      ),
                    ],
                  ),
                ),
            ],
          ),
        ),
      ],
    );
  }
}

class UsersWorkspace extends StatelessWidget {
  const UsersWorkspace({super.key});
  @override
  Widget build(BuildContext context) {
    final api = context.read<Api>();
    const roles = [
      'CUSTOMER',
      'MANAGER',
      'SALES',
      'DESIGNER',
      'TAILOR',
      'DRIVER',
      'ACCOUNTANT',
      'SUPER_ADMIN',
    ];
    return ListView(
      padding: const EdgeInsets.all(24),
      children: [
        const PageHeading(
          'People & access',
          'Staff accounts are created by the super admin. Customers can register themselves.',
        ),
        RemoteView(
          load: () => api.get('/users'),
          builder: (data, reload) => Column(
            children: [
              if (api.role == 'SUPER_ADMIN')
                Align(
                  alignment: Alignment.centerLeft,
                  child: FilledButton.icon(
                    onPressed: () async {
                      await editForm(
                        context,
                        'Create user',
                        const [
                          FieldSpec('name', 'Full name'),
                          FieldSpec('email', 'Email'),
                          FieldSpec('phone', 'Phone · 2507XXXXXXXX'),
                          FieldSpec('role', 'Role', options: roles),
                          FieldSpec(
                            'password',
                            'Temporary password · 12+ characters',
                            secret: true,
                          ),
                        ],
                        (d) async {
                          await api.post('/users', d);
                        },
                      );
                      reload();
                    },
                    icon: const Icon(Icons.person_add_outlined),
                    label: const Text('New user'),
                  ),
                ),
              const SizedBox(height: 20),
              for (final u in data)
                Panel(
                  child: ListTile(
                    contentPadding: EdgeInsets.zero,
                    title: Text('${u['name']} · ${label(u['role'])}'),
                    subtitle: Text(
                      '${u['email']} · ${u['active'] ? 'Active' : 'Disabled'}',
                    ),
                    trailing:
                        api.role == 'SUPER_ADMIN' && u['id'] != api.user?['id']
                        ? IconButton(
                            icon: const Icon(Icons.manage_accounts_outlined),
                            onPressed: () async {
                              await editForm(
                                context,
                                'Update access',
                                [
                                  FieldSpec(
                                    'role',
                                    'Role',
                                    options: roles,
                                    initial: u['role'],
                                  ),
                                  FieldSpec(
                                    'active',
                                    'Active',
                                    options: const ['true', 'false'],
                                    initial: '${u['active']}',
                                  ),
                                ],
                                (d) async {
                                  await api.patch('/users/${u['id']}', {
                                    'role': d['role'],
                                    'active': d['active'] == 'true',
                                  });
                                },
                                note:
                                    'Changing access signs this user out of every device.',
                              );
                              reload();
                            },
                          )
                        : null,
                  ),
                ),
            ],
          ),
        ),
      ],
    );
  }
}

class SettingsWorkspace extends StatelessWidget {
  const SettingsWorkspace({super.key});
  @override
  Widget build(BuildContext context) {
    final api = context.read<Api>();
    return ListView(
      padding: const EdgeInsets.all(24),
      children: [
        const PageHeading(
          'Shop settings',
          'Contact details, delivery areas, custom order deposits, terms and tax configuration.',
        ),
        RemoteView(
          load: () => api.get('/settings'),
          builder: (s, reload) => Panel(
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Text(
                  '${s['brandName']}\n${s['shopAddress']}\n${s['shopPhone']}\n${s['shopEmail']}',
                  style: const TextStyle(height: 1.8),
                ),
                const SizedBox(height: 16),
                Text(
                  'Custom order deposit: ${s['depositPercent']}%\nConfigured tax: ${(s['taxBasisPoints'] as num) / 100}%\nReturn request period: ${s['returnsDays']} days',
                  style: const TextStyle(height: 1.8),
                ),
                const SizedBox(height: 16),
                for (final z in s['deliveryZones'])
                  Text('${z['name']} · ${rwf(z['fee'])}'),
                const SizedBox(height: 20),
                FilledButton(
                  onPressed: () async {
                    await editForm(
                      context,
                      'Shop configuration',
                      [
                        FieldSpec(
                          'brandName',
                          'Brand name',
                          initial: s['brandName'],
                        ),
                        FieldSpec(
                          'shopAddress',
                          'Shop address',
                          initial: s['shopAddress'],
                        ),
                        FieldSpec(
                          'shopPhone',
                          'Shop phone',
                          initial: s['shopPhone'],
                          required: false,
                        ),
                        FieldSpec(
                          'shopEmail',
                          'Shop email',
                          initial: s['shopEmail'],
                          required: false,
                        ),
                        FieldSpec(
                          'depositPercent',
                          'Custom order deposit %',
                          number: true,
                          initial: '${s['depositPercent']}',
                        ),
                        FieldSpec(
                          'taxBasisPoints',
                          'Tax in basis points · 100 = 1%',
                          number: true,
                          initial: '${s['taxBasisPoints']}',
                        ),
                        FieldSpec(
                          'returnsDays',
                          'Return request days',
                          number: true,
                          initial: '${s['returnsDays']}',
                        ),
                        FieldSpec(
                          'appointmentMinutes',
                          'Appointment length in minutes',
                          number: true,
                          initial: '${s['appointmentMinutes']}',
                        ),
                        FieldSpec(
                          'terms',
                          'Shop terms',
                          multiline: true,
                          initial: s['terms'],
                        ),
                        FieldSpec(
                          'sampleCatalogue',
                          'Show preview catalogue notice',
                          options: const ['true', 'false'],
                          initial: '${s['sampleCatalogue']}',
                        ),
                      ],
                      (d) async {
                        await api.put('/settings', {
                          ...Map<String, dynamic>.from(s),
                          'brandName': d['brandName'],
                          'shopAddress': d['shopAddress'],
                          'shopPhone': d['shopPhone'],
                          'shopEmail': d['shopEmail'],
                          'depositPercent': int.parse(d['depositPercent']!),
                          'taxBasisPoints': int.parse(d['taxBasisPoints']!),
                          'returnsDays': int.parse(d['returnsDays']!),
                          'appointmentMinutes': int.parse(
                            d['appointmentMinutes']!,
                          ),

                          'terms': d['terms'],
                          'sampleCatalogue': d['sampleCatalogue'] == 'true',
                        });
                      },
                      note:
                          'Confirm tax settings with the business accountant. Tax starts at 0 until configured.',
                    );
                    reload();
                  },
                  child: const Text('Edit settings'),
                ),
                const SizedBox(height: 12),
                OutlinedButton(
                  onPressed: () async {
                    await showDialog(
                      context: context,
                      barrierDismissible: false,
                      builder: (_) => RowEditor(
                        title: 'Delivery areas',
                        note:
                            'Set the delivery fee customers see before payment.',
                        initial: List<Map<String, dynamic>>.from(
                          s['deliveryZones'],
                        ),
                        fields: const [
                          FieldSpec('name', 'Area name'),
                          FieldSpec(
                            'fee',
                            'Delivery fee (RWF)',
                            number: true,
                            initial: '0',
                          ),
                        ],
                        save: (rows) async {
                          await api.put('/settings', {
                            ...Map<String, dynamic>.from(s),
                            'deliveryZones': rows,
                          });
                        },
                      ),
                    );
                    reload();
                  },
                  child: const Text('Manage delivery areas'),
                ),
              ],
            ),
          ),
        ),
      ],
    );
  }
}

class PaymentsWorkspace extends StatelessWidget {
  const PaymentsWorkspace({super.key});
  @override
  Widget build(BuildContext context) {
    final api = context.read<Api>();
    return ListView(
      padding: const EdgeInsets.all(24),
      children: [
        const PageHeading(
          'Payments',
          'Received cash and MoMo requests, with pending payment reconciliation.',
        ),
        RemoteView(
          load: () => api.get('/payments'),
          builder: (data, reload) => Column(
            children: [
              if ((data as List).isEmpty) const EmptyState('No payments yet.'),
              for (final p in data)
                Panel(
                  child: Column(
                    crossAxisAlignment: CrossAxisAlignment.start,
                    children: [
                      ListTile(
                        contentPadding: EdgeInsets.zero,
                        title: Text(
                          'MM-${p['order_number']} · ${rwf(p['amount'])}',
                        ),
                        subtitle: Text(
                          '${p['provider']} · ${dateLabel(p['created_at'])}\n${p['failure'] ?? ''}',
                        ),
                        trailing: StatusChip(p['status']),
                      ),
                      if (p['status'] == 'PENDING')
                        OutlinedButton.icon(
                          onPressed: () async {
                            try {
                              await api.post('/payments/${p['id']}/check');
                              reload();
                            } catch (e) {
                              if (context.mounted) toast(context, e);
                            }
                          },
                          icon: const Icon(Icons.refresh),
                          label: const Text('Check with provider'),
                        ),
                    ],
                  ),
                ),
            ],
          ),
        ),
      ],
    );
  }
}

class ReportsWorkspace extends StatelessWidget {
  const ReportsWorkspace({super.key});
  @override
  Widget build(BuildContext context) => ListView(
    padding: const EdgeInsets.all(24),
    children: [
      const PageHeading(
        'Reports',
        'Payment totals, order workload, and stock needing attention.',
      ),
      RemoteView(
        load: () => context.read<Api>().get('/reports'),
        builder: (data, reload) => Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Wrap(
              spacing: 18,
              runSpacing: 18,
              children: [
                for (final entry in {
                  'Received': data['gross'],
                  'Refunds recorded': data['refunds'],
                  'Net receipts': data['net'],
                }.entries)
                  SizedBox(
                    width: 260,
                    child: Panel(
                      child: Column(
                        crossAxisAlignment: CrossAxisAlignment.start,
                        children: [
                          Text(
                            entry.key,
                            style: const TextStyle(color: Colors.black54),
                          ),
                          const SizedBox(height: 14),
                          Text(
                            rwf(entry.value),
                            style: const TextStyle(fontSize: 25, color: ink),
                          ),
                        ],
                      ),
                    ),
                  ),
              ],
            ),
            const Text(
              'Orders by status',
              style: TextStyle(fontSize: 22, color: ink),
            ),
            for (final o in data['orders'])
              ListTile(
                title: Text(label(o['status'])),
                trailing: Text('${o['count']}'),
              ),
            const SizedBox(height: 16),
            const Text('Low stock', style: TextStyle(fontSize: 22, color: ink)),
            for (final v in data['lowStock'])
              ListTile(
                title: Text('${v['name']} · ${v['size']} · ${v['color']}'),
                subtitle: Text(v['sku']),
                trailing: Text('${v['stock']}'),
              ),
            const SizedBox(height: 16),
            const Text(
              'Daily receipts · last 30 days',
              style: TextStyle(fontSize: 22, color: ink),
            ),
            for (final day in data['daily'])
              ListTile(
                title: Text('${day['day']}'),
                trailing: Text(rwf(day['amount'])),
              ),
          ],
        ),
      ),
    ],
  );
}

class AuditWorkspace extends StatelessWidget {
  const AuditWorkspace({super.key});
  @override
  Widget build(BuildContext context) => ListView(
    padding: const EdgeInsets.all(24),
    children: [
      const PageHeading(
        'Audit history',
        'Who changed access, money records, stock and order status.',
      ),
      RemoteView(
        load: () => context.read<Api>().get('/audit'),
        builder: (data, reload) => Column(
          children: [
            for (final a in data)
              Panel(
                child: ListTile(
                  contentPadding: EdgeInsets.zero,
                  title: Text(label(a['action'])),
                  subtitle: SelectableText(
                    '${a['actor_name'] ?? 'System'} · ${dateLabel(a['created_at'])}\n${a['entity_id'] ?? ''}\n${jsonEncode(a['details'])}',
                  ),
                ),
              ),
          ],
        ),
      ),
    ],
  );
}
