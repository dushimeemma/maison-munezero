import 'dart:convert';
import 'package:flutter/material.dart';
import 'package:provider/provider.dart';
import 'api.dart';
import 'ui.dart';
import 'extras.dart';

class AuthPage extends StatefulWidget {
  const AuthPage({super.key});
  @override
  State<AuthPage> createState() => _AuthPageState();
}

class _AuthPageState extends State<AuthPage> {
  bool register = false, visible = false;
  String? error;
  final email = TextEditingController(),
      password = TextEditingController(),
      name = TextEditingController(),
      phone = TextEditingController();
  final form = GlobalKey<FormState>();
  @override
  void dispose() {
    for (final c in [email, password, name, phone]) {
      c.dispose();
    }
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    final api = context.watch<Api>();
    return Scaffold(
      appBar: AppBar(title: const Text('Maison Munezero')),
      body: Center(
        child: ConstrainedBox(
          constraints: const BoxConstraints(maxWidth: 480),
          child: SingleChildScrollView(
            padding: const EdgeInsets.all(28),
            child: Form(
              key: form,
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  Text(
                    register ? 'Make yourself at home.' : 'Welcome back.',
                    style: Theme.of(context).textTheme.headlineLarge,
                  ),
                  const SizedBox(height: 12),
                  const Text(
                    'Your pieces, your appointments, your atelier.',
                    style: TextStyle(color: Colors.black54),
                  ),
                  const SizedBox(height: 28),
                  if (register) ...[
                    TextFormField(
                      controller: name,
                      decoration: const InputDecoration(labelText: 'Full name'),
                      validator: (v) =>
                          v!.trim().isEmpty ? 'Enter your name' : null,
                    ),
                    const SizedBox(height: 16),
                    TextFormField(
                      controller: phone,
                      decoration: const InputDecoration(
                        labelText: 'Phone · 2507XXXXXXXX',
                      ),
                      keyboardType: TextInputType.phone,
                      validator: (v) =>
                          RegExp(r'^2507[2389]\d{7}$').hasMatch(v!.trim())
                          ? null
                          : 'Enter a Rwanda mobile number',
                    ),
                    const SizedBox(height: 16),
                  ],
                  TextFormField(
                    controller: email,
                    decoration: const InputDecoration(labelText: 'Email'),
                    keyboardType: TextInputType.emailAddress,
                    autofillHints: const [AutofillHints.email],
                    validator: (v) =>
                        v!.contains('@') ? null : 'Enter an email address',
                  ),
                  const SizedBox(height: 16),
                  TextFormField(
                    controller: password,
                    obscureText: !visible,
                    autofillHints: [
                      register
                          ? AutofillHints.newPassword
                          : AutofillHints.password,
                    ],
                    decoration: InputDecoration(
                      labelText: 'Password · at least 12 characters',
                      suffixIcon: IconButton(
                        icon: Icon(
                          visible ? Icons.visibility_off : Icons.visibility,
                        ),
                        onPressed: () => setState(() => visible = !visible),
                      ),
                    ),
                    validator: (v) =>
                        v!.length < 12 ? 'Use at least 12 characters' : null,
                  ),
                  const SizedBox(height: 14),
                  if (error != null)
                    Text(error!, style: const TextStyle(color: Colors.red)),
                  const SizedBox(height: 14),
                  SizedBox(
                    width: double.infinity,
                    child: FilledButton(
                      onPressed: api.busyAuth
                          ? null
                          : () async {
                              if (!form.currentState!.validate()) return;
                              setState(() => error = null);
                              try {
                                if (register) {
                                  await api.register({
                                    'email': email.text.trim(),
                                    'password': password.text,
                                    'name': name.text.trim(),
                                    'phone': phone.text.trim(),
                                  });
                                } else {
                                  await api.signIn(email.text, password.text);
                                }
                                if (context.mounted) Navigator.pop(context);
                              } catch (e) {
                                if (mounted) setState(() => error = '$e');
                              }
                            },
                      child: Text(
                        api.busyAuth
                            ? 'Please wait…'
                            : register
                            ? 'Create account'
                            : 'Sign in',
                      ),
                    ),
                  ),
                  TextButton(
                    onPressed: api.busyAuth
                        ? null
                        : () => setState(() {
                            register = !register;
                            error = null;
                          }),
                    child: Text(
                      register
                          ? 'Already have an account? Sign in'
                          : 'New to the maison? Create an account',
                    ),
                  ),
                  if (!register)
                    TextButton(
                      onPressed: () => resetPassword(context),
                      child: const Text('Forgot your password?'),
                    ),
                ],
              ),
            ),
          ),
        ),
      ),
    );
  }
}

Future<void> resetPassword(BuildContext context) async {
  final api = context.read<Api>();
  final sent = await editForm(
    context,
    'Request a reset code',
    const [FieldSpec('email', 'Your email')],
    (d) async {
      await api.post('/auth/forgot-password', {'email': d['email']!.trim()});
    },
    button: 'Send code',
    note: 'If your email is registered, you will receive a one-time code.',
  );
  if (sent != true || !context.mounted) return;
  await editForm(
    context,
    'Reset password',
    const [
      FieldSpec('token', 'Code from your email'),
      FieldSpec('password', 'New password · 12+ characters', secret: true),
    ],
    (d) async {
      await api.post('/auth/reset-password', d);
    },
    button: 'Change password',
  );
}

class AccountPage extends StatelessWidget {
  const AccountPage({super.key});
  @override
  Widget build(BuildContext context) {
    final api = context.watch<Api>();
    return ListView(
      padding: const EdgeInsets.all(24),
      children: [
        PageHeading(
          'Your account',
          '${api.user?['name']} · ${label(api.role)}',
        ),
        Panel(
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              Text('${api.user?['email']}'),
              const SizedBox(height: 8),
              Text('${api.user?['phone']}'),
              const SizedBox(height: 18),
              OutlinedButton(
                onPressed: () async {
                  await editForm(
                    context,
                    'Your profile',
                    [
                      FieldSpec(
                        'name',
                        'Full name',
                        initial: api.user?['name'] ?? '',
                      ),
                      FieldSpec(
                        'phone',
                        'Phone · 2507XXXXXXXX',
                        initial: api.user?['phone'] ?? '',
                      ),
                    ],
                    (d) async {
                      await api.patch('/auth/profile', d);
                      await api.reloadUser();
                    },
                  );
                },
                child: const Text('Edit profile'),
              ),
              const SizedBox(height: 12),

              if (api.user?['email_verified'] != true) ...[
                const Text(
                  'Verify your email before ordering in the live shop.',
                  style: TextStyle(color: terracotta),
                ),
                Wrap(
                  spacing: 12,
                  children: [
                    OutlinedButton(
                      onPressed: () async {
                        try {
                          await api.post('/auth/email/send-verification');
                          if (context.mounted) {
                            toast(context, 'Check your email for the code.');
                          }
                        } catch (e) {
                          if (context.mounted) {
                            toast(context, e);
                          }
                        }
                      },
                      child: const Text('Send verification code'),
                    ),
                    FilledButton(
                      onPressed: () async {
                        await editForm(
                          context,
                          'Verify email',
                          const [
                            FieldSpec('token', 'One-time code from your email'),
                          ],
                          (d) async {
                            await api.post('/auth/email/verify', d);
                            await api.reloadUser();
                          },
                          button: 'Verify',
                        );
                      },
                      child: const Text('Verify email'),
                    ),
                  ],
                ),
                const SizedBox(height: 12),
              ] else
                const Text('Email verified', style: TextStyle(color: ink)),

              OutlinedButton(
                onPressed: () => resetPassword(context),
                child: const Text('Change password'),
              ),
              const SizedBox(height: 12),
              FilledButton(
                onPressed: () async {
                  try {
                    await api.logout();
                  } catch (e) {
                    if (context.mounted) toast(context, e);
                  }
                },
                child: const Text('Sign out'),
              ),
            ],
          ),
        ),
        if (api.role == 'CUSTOMER')
          TextButton(
            onPressed: () async {
              await editForm(
                context,
                'Delete account',
                const [FieldSpec('confirm', 'Type DELETE to confirm')],
                (d) async {
                  if (d['confirm'] != 'DELETE') {
                    throw ApiException('Type DELETE to confirm');
                  }
                  await api.delete('/auth/account');
                  await api.clear();
                },
                button: 'Delete account',
                note:
                    'This removes your sign-in access and personal account profile. The shop retains purchase records. Contact the shop directly about any active orders.',
              );
            },
            child: const Text('Delete my account'),
          ),
        const Text(
          'Updates from the maison',
          style: TextStyle(fontSize: 22, color: ink),
        ),
        const SizedBox(height: 18),
        RemoteView(
          load: () => api.get('/notifications'),
          builder: (data, reload) => Column(
            children: [
              if ((data as List).isEmpty)
                const EmptyState('You are all caught up.'),
              for (final n in data)
                Panel(
                  child: ListTile(
                    contentPadding: EdgeInsets.zero,
                    leading: Icon(
                      n['read_at'] == null
                          ? Icons.mark_email_unread_outlined
                          : Icons.mark_email_read_outlined,
                    ),
                    title: Text(n['title']),
                    subtitle: Text(
                      '${n['body']}\n${dateLabel(n['created_at'])}',
                    ),
                    trailing: n['read_at'] == null
                        ? IconButton(
                            icon: const Icon(Icons.done),
                            tooltip: 'Mark read',
                            onPressed: () async {
                              await api.post('/notifications/${n['id']}/read');
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

class OrdersPage extends StatelessWidget {
  const OrdersPage({super.key});
  @override
  Widget build(BuildContext context) => ListView(
    padding: const EdgeInsets.all(24),
    children: [
      const PageHeading(
        'Your orders',
        'Follow your pieces from the maison to your wardrobe.',
      ),
      RemoteView(
        load: () => context.read<Api>().get('/orders'),
        builder: (data, reload) => Column(
          children: [
            if ((data as List).isEmpty)
              const EmptyState(
                'Your next favourite piece is waiting in the collection.',
              ),
            for (final o in data)
              Panel(
                child: ListTile(
                  contentPadding: EdgeInsets.zero,
                  title: Text('MM-${o['number']} · ${rwf(o['total'])}'),
                  subtitle: Text(
                    '${label(o['fulfilment'])} · ${dateLabel(o['created_at'])}\nPaid ${rwf(o['paid'])}',
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

class OrderDetail extends StatelessWidget {
  final String id;
  const OrderDetail({required this.id, super.key});
  @override
  Widget build(BuildContext context) => Scaffold(
    appBar: AppBar(title: const Text('Order details')),
    body: SingleChildScrollView(
      child: Center(
        child: ConstrainedBox(
          constraints: const BoxConstraints(maxWidth: 900),
          child: Padding(
            padding: const EdgeInsets.all(24),
            child: RemoteView(
              load: () => context.read<Api>().get('/orders/$id'),
              builder: (o, reload) {
                final api = context.read<Api>();
                final payments = o['payments'] as List;
                final pending = payments
                    .where((p) => p['status'] == 'PENDING')
                    .firstOrNull;
                final balance = (o['total'] as num) - (o['paid'] as num);
                return Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    PageHeading(
                      'Order MM-${o['number']}',
                      '${label(o['channel'])} · ${dateLabel(o['created_at'])}',
                      action: Wrap(
                        spacing: 12,
                        children: [
                          StatusChip(o['status']),
                          OutlinedButton.icon(
                            onPressed: () async {
                              try {
                                await printReceipt(
                                  Map<String, dynamic>.from(o),
                                );
                              } catch (e) {
                                if (context.mounted) toast(context, e);
                              }
                            },
                            icon: const Icon(Icons.receipt_long_outlined),
                            label: const Text('Receipt'),
                          ),
                        ],
                      ),
                    ),
                    Panel(
                      child: Column(
                        crossAxisAlignment: CrossAxisAlignment.start,
                        children: [
                          for (final i in o['items'])
                            Padding(
                              padding: const EdgeInsets.only(bottom: 14),
                              child: Text(
                                '${i['product_name']} · ${i['size'] ?? 'Made to measure'} ${i['color'] ?? ''}\n${i['quantity']} × ${rwf(i['unit_price'])}',
                              ),
                            ),
                          const Divider(),
                          detailLine('Pieces', rwf(o['subtotal'])),
                          detailLine('Tax', rwf(o['tax'])),
                          detailLine('Delivery', rwf(o['delivery_fee'])),
                          detailLine('Confirmed total', rwf(o['total'])),
                          detailLine('Paid', rwf(o['paid'])),
                          detailLine('Balance', rwf(balance)),
                          if (o['channel'] == 'BESPOKE')
                            detailLine(
                              'Initial deposit',
                              rwf(o['deposit_due']),
                            ),
                        ],
                      ),
                    ),
                    Panel(
                      child: Column(
                        crossAxisAlignment: CrossAxisAlignment.start,
                        children: [
                          Text(
                            label(o['fulfilment']),
                            style: const TextStyle(fontSize: 20, color: ink),
                          ),
                          const SizedBox(height: 12),
                          Text(
                            '${o['customer_name']} · ${o['customer_phone']}',
                          ),
                          if (o['address'] != null)
                            Padding(
                              padding: const EdgeInsets.only(top: 8),
                              child: Text('${o['address']}'),
                            ),
                          if (api.role == 'CUSTOMER' &&
                              o['pickup_code'] != null) ...[
                            const SizedBox(height: 12),
                            Text(
                              'Collection code: ${o['pickup_code']}',
                              style: const TextStyle(
                                fontWeight: FontWeight.w600,
                              ),
                            ),
                            const Text(
                              'Share this code when you receive your order.',
                              style: TextStyle(
                                fontSize: 12,
                                color: Colors.black54,
                              ),
                            ),
                          ],
                          if (o['delivery']?['driver_name'] != null)
                            Text('Driver: ${o['delivery']['driver_name']}'),
                        ],
                      ),
                    ),
                    if (balance > 0 &&
                        !['CANCELLED', 'COMPLETED'].contains(o['status']) &&
                        (api.role == 'CUSTOMER' || api.sales))
                      Panel(
                        child: Column(
                          crossAxisAlignment: CrossAxisAlignment.start,
                          children: [
                            const Text(
                              'Payment',
                              style: TextStyle(fontSize: 22, color: ink),
                            ),
                            const SizedBox(height: 14),
                            const Text(
                              'Approve the request on your phone. Enter your MoMo PIN only in the MTN prompt.',
                              style: TextStyle(
                                height: 1.5,
                                color: Colors.black54,
                              ),
                            ),
                            const SizedBox(height: 14),
                            if (pending != null) ...[
                              const Text(
                                'A payment is pending. Check it before starting another payment.',
                              ),
                              const SizedBox(height: 14),
                              FilledButton.icon(
                                onPressed: () async {
                                  try {
                                    final p = await api.post(
                                      '/payments/${pending['id']}/check',
                                    );
                                    if (context.mounted) {
                                      toast(
                                        context,
                                        'Payment: ${label(p['status'])}',
                                      );
                                    }
                                    reload();
                                  } catch (e) {
                                    if (context.mounted) toast(context, e);
                                  }
                                },
                                icon: const Icon(Icons.refresh),
                                label: const Text('Check payment'),
                              ),
                            ] else
                              Wrap(
                                spacing: 12,
                                runSpacing: 12,
                                children: [
                                  FilledButton(
                                    onPressed: () async {
                                      final key = api.newKey();
                                      await editForm(
                                        context,
                                        'Pay with MTN MoMo',
                                        [
                                          FieldSpec(
                                            'phone',
                                            'MoMo number · 2507XXXXXXXX',
                                            initial: '${o['customer_phone']}',
                                          ),
                                          const FieldSpec(
                                            'portion',
                                            'Payment amount',
                                            initial: 'DUE',
                                            options: ['DUE', 'BALANCE'],
                                          ),
                                        ],
                                        (d) async {
                                          final p = await api.post(
                                            '/payments/orders/$id/momo',
                                            d,
                                            key,
                                          );
                                          if (context.mounted) {
                                            toast(
                                              context,
                                              p['sandbox'] == true
                                                  ? 'SANDBOX TEST payment submitted. No live payment is being collected.'
                                                  : p['failure'] ??
                                                        'Approve the MoMo request on your phone.',
                                            );
                                          }
                                        },
                                        button: 'Request payment',
                                        note:
                                            'Due pays the initial deposit, then the remaining balance. Balance pays everything outstanding.',
                                      );
                                      reload();
                                    },
                                    child: const Text('Pay with MoMo'),
                                  ),
                                  if (api.sales)
                                    OutlinedButton(
                                      onPressed: () async {
                                        final key = api.newKey();
                                        await editForm(
                                          context,
                                          'Record received cash',
                                          [
                                            FieldSpec(
                                              'amount',
                                              'Amount received (RWF)',
                                              initial: '$balance',
                                              number: true,
                                            ),
                                            const FieldSpec(
                                              'receiptReference',
                                              'Cash receipt reference',
                                            ),
                                          ],
                                          (d) async {
                                            await api.post(
                                              '/payments/orders/$id/cash',
                                              {
                                                'amount': int.parse(
                                                  d['amount']!,
                                                ),
                                                'receiptReference':
                                                    d['receiptReference'],
                                              },
                                              key,
                                            );
                                          },
                                          note:
                                              'Confirm that the cash has been physically received before recording it.',
                                        );
                                        reload();
                                      },
                                      child: const Text('Record cash'),
                                    ),
                                ],
                              ),
                          ],
                        ),
                      ),
                    if (payments.isNotEmpty)
                      Panel(
                        child: Column(
                          crossAxisAlignment: CrossAxisAlignment.start,
                          children: [
                            const Text(
                              'Payment history',
                              style: TextStyle(fontSize: 20, color: ink),
                            ),
                            for (final p in payments)
                              ListTile(
                                contentPadding: EdgeInsets.zero,
                                title: Text(
                                  '${p['provider']} · ${rwf(p['amount'])}',
                                ),
                                subtitle: Text(
                                  '${dateLabel(p['created_at'])}${p['failure'] != null ? '\n${p['failure']}' : ''}',
                                ),
                                trailing: StatusChip(p['status']),
                              ),
                          ],
                        ),
                      ),
                    Wrap(
                      spacing: 12,
                      runSpacing: 12,
                      children: [
                        if (o['status'] == 'AWAITING_PAYMENT' &&
                            (api.sales || api.role == 'CUSTOMER'))
                          OutlinedButton(
                            onPressed: () => statusForm(
                              context,
                              api,
                              id,
                              'CANCELLED',
                              reload,
                            ),
                            child: const Text('Cancel order'),
                          ),
                        if (api.sales || api.studio) ...[
                          if (o['status'] == 'CONFIRMED' &&
                              o['channel'] == 'BESPOKE')
                            FilledButton(
                              onPressed: () => statusForm(
                                context,
                                api,
                                id,
                                'IN_PRODUCTION',
                                reload,
                              ),
                              child: const Text('Start production'),
                            ),
                          if ([
                            'CONFIRMED',
                            'IN_PRODUCTION',
                          ].contains(o['status']))
                            FilledButton(
                              onPressed: () =>
                                  statusForm(context, api, id, 'READY', reload),
                              child: const Text('Mark ready'),
                            ),
                          if (api.sales &&
                              o['status'] == 'READY' &&
                              o['fulfilment'] != 'DELIVERY')
                            FilledButton(
                              onPressed: () => statusForm(
                                context,
                                api,
                                id,
                                'COMPLETED',
                                reload,
                                code: o['fulfilment'] == 'PICKUP',
                              ),
                              child: const Text('Confirm collection'),
                            ),
                        ],
                      ],
                    ),
                    const SizedBox(height: 20),
                    const Text(
                      'Order journey',
                      style: TextStyle(fontSize: 22, color: ink),
                    ),
                    const SizedBox(height: 16),
                    Panel(
                      child: Column(
                        children: [
                          for (final h in o['history'])
                            ListTile(
                              contentPadding: EdgeInsets.zero,
                              leading: const Icon(
                                Icons.circle_outlined,
                                size: 16,
                              ),
                              title: Text(label(h['status'])),
                              subtitle: Text(
                                '${h['note']}\n${dateLabel(h['created_at'])}',
                              ),
                            ),
                        ],
                      ),
                    ),
                  ],
                );
              },
            ),
          ),
        ),
      ),
    ),
  );
  Widget detailLine(String name, String value) => Padding(
    padding: const EdgeInsets.symmetric(vertical: 6),
    child: Row(
      mainAxisAlignment: MainAxisAlignment.spaceBetween,
      children: [
        Text(name),
        Text(value, style: const TextStyle(fontWeight: FontWeight.w600)),
      ],
    ),
  );
}

Future<void> statusForm(
  BuildContext context,
  Api api,
  String id,
  String status,
  VoidCallback reload, {
  bool code = false,
}) async {
  await editForm(
    context,
    label(status),
    [
      const FieldSpec('note', 'Note for order history'),
      if (code) const FieldSpec('pickupCode', 'Collection code from customer'),
    ],
    (d) async {
      await api.post('/orders/$id/status', {'status': status, ...d});
    },
  );
  reload();
}

Future<bool?> requestDesign(BuildContext context) => editForm(
  context,
  'Your custom piece',
  const [
    FieldSpec('title', 'Project name'),
    FieldSpec('garment', 'Garment type'),
    FieldSpec('occasion', 'Occasion', required: false),
    FieldSpec('budget', 'Budget (RWF)', required: false, number: true),
    FieldSpec('dueDate', 'Preferred date · YYYY-MM-DD', required: false),
    FieldSpec(
      'description',
      'Your idea, fabric & design preferences',
      multiline: true,
    ),
    FieldSpec('referenceUrl', 'Reference image HTTPS link', required: false),
  ],
  (d) async {
    final body = <String, dynamic>{
      'title': d['title'],
      'garment': d['garment'],
      'description': d['description'],
      if (d['occasion']!.isNotEmpty) 'occasion': d['occasion'],
      if (d['budget']!.isNotEmpty) 'budget': int.parse(d['budget']!),
      if (d['dueDate']!.isNotEmpty) 'dueDate': d['dueDate'],
      if (d['referenceUrl']!.isNotEmpty) 'referenceUrl': d['referenceUrl'],
    };
    await context.read<Api>().post('/bespoke', body);
  },
  button: 'Send to the atelier',
  note:
      'Our team reviews your idea before quoting. Production starts after you accept the quotation and pay the deposit.',
);

class AtelierPage extends StatelessWidget {
  const AtelierPage({super.key});
  @override
  Widget build(BuildContext context) {
    final api = context.watch<Api>();
    return ListView(
      padding: const EdgeInsets.all(24),
      children: [
        PageHeading(
          'The atelier',
          'From your first idea to the final fitting. A piece made for you.',
          action: FilledButton(
            onPressed: () async {
              if (!api.signedIn) await Navigator.pushNamed(context, '/auth');
              if (api.signedIn && context.mounted) {
                await requestDesign(context);
              }
            },
            child: const Text('Start a design request'),
          ),
        ),
        const Panel(
          child: Text(
            '1. Share your idea   →   2. Review your quotation   →   3. Pay your deposit\n4. Measurements & production   →   5. Fitting   →   6. Balance & collection',
            style: TextStyle(height: 2, color: ink),
          ),
        ),
        if (api.signedIn && (api.role == 'CUSTOMER' || api.studio))
          BespokeList(key: ValueKey(api.role))
        else
          const EmptyState(
            'Sign in as a customer to follow your custom designs.',
          ),
      ],
    );
  }
}

class BespokeList extends StatelessWidget {
  const BespokeList({super.key});
  @override
  Widget build(BuildContext context) => RemoteView(
    load: () => context.read<Api>().get('/bespoke'),
    builder: (data, reload) => Column(
      children: [
        Align(
          alignment: Alignment.centerRight,
          child: TextButton.icon(
            onPressed: reload,
            icon: const Icon(Icons.refresh),
            label: const Text('Refresh'),
          ),
        ),
        if ((data as List).isEmpty)
          const EmptyState('Your design journey starts here.'),
        for (final b in data)
          Panel(
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Row(
                  children: [
                    Expanded(
                      child: Text(
                        '${b['title']}',
                        style: const TextStyle(fontSize: 21, color: ink),
                      ),
                    ),
                    StatusChip(b['status']),
                  ],
                ),
                const SizedBox(height: 8),
                Text('${b['garment']} · ${b['customer_name']}'),
                const SizedBox(height: 12),
                Text(
                  '${b['description']}',
                  style: const TextStyle(height: 1.5),
                ),
                if (b['quote'] != null)
                  Padding(
                    padding: const EdgeInsets.symmetric(vertical: 12),
                    child: Text(
                      'Quotation: ${rwf(b['quote'])}\n${b['quote_notes']}\nPromised date: ${b['due_date']}',
                      style: const TextStyle(height: 1.5),
                    ),
                  ),
                if ((b['measurements'] as Map).isNotEmpty)
                  Text(
                    'Measurements (cm): ${jsonEncode(b['measurements'])}',
                    style: const TextStyle(fontSize: 12, color: Colors.black54),
                  ),
                const SizedBox(height: 14),
                BespokeActions(
                  job: Map<String, dynamic>.from(b),
                  reload: reload,
                ),
              ],
            ),
          ),
      ],
    ),
  );
}

class BespokeActions extends StatelessWidget {
  final Map<String, dynamic> job;
  final VoidCallback reload;
  const BespokeActions({required this.job, required this.reload, super.key});
  @override
  Widget build(BuildContext context) {
    final api = context.read<Api>();
    final id = job['id'];
    return Wrap(
      spacing: 12,
      runSpacing: 12,
      children: [
        if (job['order_id'] != null)
          FilledButton(
            onPressed: () async {
              await Navigator.pushNamed(context, '/orders/${job['order_id']}');
              reload();
            },
            child: const Text('Open order & payment'),
          ),
        if (api.role == 'CUSTOMER' && job['status'] == 'QUOTED')
          FilledButton(
            onPressed: () async {
              final s = await api.get('/settings');
              if (!context.mounted) return;
              final zones = s['deliveryZones'] as List;
              await editForm(
                context,
                'Accept quotation',
                [
                  const FieldSpec(
                    'fulfilment',
                    'Receive your piece',
                    initial: 'PICKUP',
                    options: ['PICKUP', 'DELIVERY'],
                  ),
                  FieldSpec(
                    'zoneId',
                    'Delivery zone ID (if delivery)',
                    required: false,
                    options: zones.map((z) => '${z['id']}').toList(),
                    optionLabels: {
                      for (final x in zones) '${x['id']}': '${x['name']}',
                    },
                  ),
                  const FieldSpec(
                    'address',
                    'Delivery address (if delivery)',
                    required: false,
                    multiline: true,
                  ),
                ],
                (d) async {
                  final order = await api.post('/bespoke/$id/accept', {
                    'fulfilment': d['fulfilment'],
                    if (d['fulfilment'] == 'DELIVERY') 'zoneId': d['zoneId'],
                    if (d['fulfilment'] == 'DELIVERY') 'address': d['address'],
                  });
                  if (context.mounted) {
                    toast(
                      context,
                      'Accepted. Deposit due: ${rwf(order['deposit_due'])}',
                    );
                  }
                },
                button: 'Accept & create order',
                note:
                    'Quoted garment price: ${rwf(job['quote'])}. Tax and delivery are added using shop settings. Deposit is shown on your order before payment.',
              );
              reload();
            },
            child: const Text('Accept quotation'),
          ),
        if (api.manager)
          OutlinedButton(
            onPressed: () async {
              try {
                final users = await api.get('/users') as List;
                final designers = users
                    .where((u) => u['active'] && u['role'] == 'DESIGNER')
                    .toList();
                final tailors = users
                    .where((u) => u['active'] && u['role'] == 'TAILOR')
                    .toList();
                if (!context.mounted) return;
                if (designers.isEmpty) {
                  toast(context, 'Create a designer staff account first.');
                  return;
                }
                await editForm(
                  context,
                  'Assign atelier team',
                  [
                    FieldSpec(
                      'designerId',
                      'Designer',
                      options: designers.map((u) => '${u['id']}').toList(),
                      optionLabels: {
                        for (final x in designers) '${x['id']}': '${x['name']}',
                      },
                    ),
                    FieldSpec(
                      'tailorId',
                      'Tailor',
                      required: false,
                      options: tailors.map((u) => '${u['id']}').toList(),
                      optionLabels: {
                        for (final x in tailors) '${x['id']}': '${x['name']}',
                      },
                    ),
                  ],
                  (d) async {
                    await api.post('/bespoke/$id/assign', {
                      'designerId': d['designerId'],
                      if (d['tailorId']!.isNotEmpty) 'tailorId': d['tailorId'],
                    });
                  },
                );
                reload();
              } catch (e) {
                if (context.mounted) toast(context, e);
              }
            },
            child: const Text('Assign team'),
          ),
        if ((api.manager || api.role == 'DESIGNER') &&
            ['REQUESTED', 'QUOTED'].contains(job['status']))
          OutlinedButton(
            onPressed: () async {
              await editForm(
                context,
                'Prepare quotation',
                [
                  FieldSpec(
                    'amount',
                    'Garment price (RWF)',
                    number: true,
                    initial: '${job['quote'] ?? ''}',
                  ),
                  FieldSpec(
                    'notes',
                    'Fabric, scope, alterations & conditions',
                    multiline: true,
                    initial: '${job['quote_notes'] ?? ''}',
                  ),
                  const FieldSpec('dueDate', 'Promised date · YYYY-MM-DD'),
                ],
                (d) async {
                  await api.post('/bespoke/$id/quote', {
                    'amount': int.parse(d['amount']!),
                    'notes': d['notes'],
                    'dueDate': d['dueDate'],
                  });
                },
              );
              reload();
            },
            child: const Text('Prepare quote'),
          ),
        if (api.studio && !['COMPLETED', 'CANCELLED'].contains(job['status']))
          OutlinedButton(
            onPressed: () async {
              final measurements = Map<String, dynamic>.from(
                job['measurements'],
              );
              await editForm(
                context,
                'Measurements in centimetres',
                [
                  for (final f in [
                    'bust',
                    'waist',
                    'hip',
                    'shoulder',
                    'sleeve',
                    'length',
                    'inseam',
                    'neck',
                    'chest',
                  ])
                    FieldSpec(
                      f,
                      label(f),
                      required: false,
                      number: true,
                      initial: '${measurements[f] ?? ''}',
                    ),
                  FieldSpec(
                    'notes',
                    'Fitting notes',
                    multiline: true,
                    required: false,
                    initial: '${measurements['notes'] ?? ''}',
                  ),
                ],
                (d) async {
                  await api.patch('/bespoke/$id/measurements', {
                    'unit': 'cm',
                    for (final e in d.entries)
                      if (e.key != 'notes' && e.value.isNotEmpty)
                        e.key: double.parse(e.value),
                    'notes': d['notes'],
                  });
                },
              );
              reload();
            },
            child: const Text('Measurements'),
          ),
        if (api.studio && job['status'] == 'IN_PRODUCTION')
          OutlinedButton(
            onPressed: () async {
              try {
                await api.post('/bespoke/$id/fitting');
                reload();
              } catch (e) {
                if (context.mounted) toast(context, e);
              }
            },
            child: const Text('Request fitting'),
          ),
      ],
    );
  }
}

class AppointmentsPage extends StatelessWidget {
  const AppointmentsPage({super.key});
  @override
  Widget build(BuildContext context) {
    final api = context.read<Api>();
    return ListView(
      padding: const EdgeInsets.all(24),
      children: [
        PageHeading(
          'Appointments',
          'Consultations, measurements, fittings, and collections.',
        ),
        RemoteView(
          load: () => api.get('/appointments'),
          builder: (data, reload) => Column(
            children: [
              if (api.role == 'CUSTOMER')
                Align(
                  alignment: Alignment.centerLeft,
                  child: FilledButton.icon(
                    icon: const Icon(Icons.calendar_month_outlined),
                    label: const Text('Request an appointment'),
                    onPressed: () async {
                      final date = await showDatePicker(
                        context: context,
                        firstDate: DateTime.now(),
                        lastDate: DateTime.now().add(const Duration(days: 365)),
                        initialDate: DateTime.now().add(
                          const Duration(days: 1),
                        ),
                      );
                      if (date == null || !context.mounted) return;
                      final time = await showTimePicker(
                        context: context,
                        initialTime: const TimeOfDay(hour: 10, minute: 0),
                      );
                      if (time == null || !context.mounted) return;
                      final starts = DateTime(
                        date.year,
                        date.month,
                        date.day,
                        time.hour,
                        time.minute,
                      ).toUtc().toIso8601String();
                      await editForm(
                        context,
                        'Appointment details',
                        const [
                          FieldSpec(
                            'kind',
                            'Appointment type',
                            options: [
                              'CONSULTATION',
                              'MEASUREMENT',
                              'FITTING',
                              'COLLECTION',
                            ],
                          ),
                          FieldSpec(
                            'notes',
                            'Notes',
                            required: false,
                            multiline: true,
                          ),
                        ],
                        (d) async {
                          await api.post('/appointments', {
                            'kind': d['kind'],
                            'startsAt': starts,
                            'notes': d['notes'],
                          });
                        },
                        note:
                            'Requested time: ${dateLabel(starts)}. The atelier confirms availability.',
                      );
                      reload();
                    },
                  ),
                ),
              const SizedBox(height: 20),
              if ((data as List).isEmpty)
                const EmptyState('No appointments yet.'),
              for (final a in data)
                Panel(
                  child: Column(
                    crossAxisAlignment: CrossAxisAlignment.start,
                    children: [
                      ListTile(
                        contentPadding: EdgeInsets.zero,
                        title: Text(label(a['kind'])),
                        subtitle: Text(
                          '${dateLabel(a['starts_at'])}\n${a['notes'] ?? ''}',
                        ),
                        trailing: StatusChip(a['status']),
                      ),
                      Wrap(
                        spacing: 10,
                        children: [
                          if (api.manager && a['status'] == 'REQUESTED')
                            OutlinedButton(
                              onPressed: () async {
                                final users = (await api.get('/users') as List)
                                    .where(
                                      (u) =>
                                          u['active'] &&
                                          [
                                            'DESIGNER',
                                            'TAILOR',
                                          ].contains(u['role']),
                                    )
                                    .toList();
                                if (!context.mounted) return;
                                await editForm(
                                  context,
                                  'Confirm with a staff member',
                                  [
                                    FieldSpec(
                                      'staffId',
                                      'Staff member',
                                      options: users
                                          .map((u) => '${u['id']}')
                                          .toList(),
                                      optionLabels: {
                                        for (final x in users)
                                          '${x['id']}': '${x['name']}',
                                      },
                                    ),
                                  ],
                                  (d) async {
                                    await api.post(
                                      '/appointments/${a['id']}/status',
                                      {'status': 'CONFIRMED', ...d},
                                    );
                                  },
                                );
                                reload();
                              },
                              child: const Text('Confirm'),
                            ),
                          if (api.studio && a['status'] == 'CONFIRMED')
                            OutlinedButton(
                              onPressed: () async {
                                try {
                                  await api.post(
                                    '/appointments/${a['id']}/status',
                                    {'status': 'COMPLETED'},
                                  );
                                  reload();
                                } catch (e) {
                                  if (context.mounted) toast(context, e);
                                }
                              },
                              child: const Text('Complete'),
                            ),
                          if (['REQUESTED', 'CONFIRMED'].contains(a['status']))
                            TextButton(
                              onPressed: () async {
                                try {
                                  await api.post(
                                    '/appointments/${a['id']}/status',
                                    {'status': 'CANCELLED'},
                                  );
                                  reload();
                                } catch (e) {
                                  if (context.mounted) toast(context, e);
                                }
                              },
                              child: const Text('Cancel'),
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

class ReturnsPage extends StatelessWidget {
  const ReturnsPage({super.key});
  @override
  Widget build(BuildContext context) {
    final api = context.read<Api>();
    return ListView(
      padding: const EdgeInsets.all(24),
      children: [
        const PageHeading(
          'Returns & refunds',
          'Requests are reviewed by the shop. Custom garments follow the agreed quotation terms.',
        ),
        RemoteView(
          load: () => api.get('/returns'),
          builder: (data, reload) => Column(
            children: [
              if (api.role == 'CUSTOMER')
                Align(
                  alignment: Alignment.centerLeft,
                  child: FilledButton(
                    onPressed: () async {
                      final orders = (await api.get('/orders') as List)
                          .where(
                            (o) =>
                                o['paid'] > 0 &&
                                [
                                  'CONFIRMED',
                                  'READY',
                                  'COMPLETED',
                                ].contains(o['status']),
                          )
                          .toList();
                      if (!context.mounted) return;
                      await editForm(
                        context,
                        'Request a return review',
                        [
                          FieldSpec(
                            'orderId',
                            'Order',
                            options: orders.map((o) => '${o['id']}').toList(),
                            optionLabels: {
                              for (final x in orders)
                                '${x['id']}': 'MM-${x['number']}',
                            },
                          ),
                          const FieldSpec(
                            'reason',
                            'Tell us what happened',
                            multiline: true,
                          ),
                        ],
                        (d) async {
                          await api.post('/returns', d);
                        },
                      );
                      reload();
                    },
                    child: const Text('Request review'),
                  ),
                ),
              const SizedBox(height: 16),
              if ((data as List).isEmpty)
                const EmptyState('No return requests.'),
              for (final r in data)
                Panel(
                  child: Column(
                    crossAxisAlignment: CrossAxisAlignment.start,
                    children: [
                      Row(
                        children: [
                          Expanded(child: Text('MM-${r['order_number']}')),
                          StatusChip(r['status']),
                        ],
                      ),
                      Text('${r['reason']}'),
                      if (r['amount'] != null)
                        Text('Approved amount: ${rwf(r['amount'])}'),
                      if (r['refund_reference'] != null)
                        Text('Refund reference: ${r['refund_reference']}'),
                      if (api.finance)
                        Wrap(
                          spacing: 12,
                          children: [
                            for (final status
                                in r['status'] == 'REQUESTED'
                                    ? ['APPROVED', 'REJECTED']
                                    : r['status'] == 'APPROVED'
                                    ? ['RECEIVED', 'REFUNDED']
                                    : r['status'] == 'RECEIVED'
                                    ? ['REFUNDED']
                                    : <String>[])
                              TextButton(
                                onPressed: () async {
                                  await editForm(
                                    context,
                                    label(status),
                                    [
                                      if (status == 'APPROVED')
                                        const FieldSpec(
                                          'amount',
                                          'Approved refund (RWF)',
                                          number: true,
                                        ),
                                      if (status == 'REFUNDED')
                                        const FieldSpec(
                                          'refundReference',
                                          'Confirmed external refund reference',
                                        ),
                                    ],
                                    (d) async {
                                      await api
                                          .post('/returns/${r['id']}/status', {
                                            'status': status,
                                            if (d['amount'] != null)
                                              'amount': int.parse(d['amount']!),
                                            if (d['refundReference'] != null)
                                              'refundReference':
                                                  d['refundReference'],
                                          });
                                    },
                                    note: status == 'REFUNDED'
                                        ? 'This records a refund that finance has already verified externally. It does not transfer money. Inspect returned goods and adjust inventory separately.'
                                        : null,
                                  );
                                  reload();
                                },
                                child: Text(label(status)),
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

class WishlistPage extends StatelessWidget {
  const WishlistPage({super.key});
  @override
  Widget build(BuildContext context) => ListView(
    padding: const EdgeInsets.all(24),
    children: [
      const PageHeading('Saved pieces', 'A little inspiration for later.'),
      RemoteView(
        load: () => context.read<Api>().get('/wishlist'),
        builder: (data, reload) => Column(
          children: [
            if ((data as List).isEmpty)
              const EmptyState('Save a piece from its product page.'),
            for (final p in data)
              Panel(
                child: ListTile(
                  contentPadding: EdgeInsets.zero,
                  title: Text(p['name']),
                  subtitle: Text(rwf(p['price'])),
                  onTap: () =>
                      Navigator.pushNamed(context, '/products/${p['id']}'),
                  trailing: IconButton(
                    icon: const Icon(Icons.favorite),
                    onPressed: () async {
                      await context.read<Api>().delete('/wishlist/${p['id']}');
                      reload();
                    },
                  ),
                ),
              ),
          ],
        ),
      ),
    ],
  );
}
