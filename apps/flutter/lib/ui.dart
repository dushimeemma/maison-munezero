import 'package:flutter/material.dart';
import 'package:intl/intl.dart';

const ink = Color(0xFF253C30);
const paper = Color(0xFFFAF8F2);
const terracotta = Color(0xFFA35D45);
String rwf(dynamic n) =>
    '${NumberFormat('#,###').format(num.tryParse('$n') ?? 0)} RWF';
String label(dynamic value) => '$value'
    .replaceAll('_', ' ')
    .toLowerCase()
    .split(' ')
    .map((s) => s.isEmpty ? '' : s[0].toUpperCase() + s.substring(1))
    .join(' ');
void toast(BuildContext context, Object message) => ScaffoldMessenger.of(
  context,
).showSnackBar(SnackBar(content: Text('$message')));
String dateLabel(dynamic d) {
  try {
    return DateFormat(
      'dd MMM yyyy, HH:mm',
    ).format(DateTime.parse('$d').toLocal());
  } catch (_) {
    return '$d';
  }
}

class PageHeading extends StatelessWidget {
  final String title, subtitle;
  final Widget? action;
  const PageHeading(this.title, this.subtitle, {this.action, super.key});
  @override
  Widget build(BuildContext context) => Padding(
    padding: const EdgeInsets.only(bottom: 24),
    child: Wrap(
      alignment: WrapAlignment.spaceBetween,
      crossAxisAlignment: WrapCrossAlignment.center,
      spacing: 24,
      runSpacing: 16,
      children: [
        Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Text(title, style: Theme.of(context).textTheme.headlineMedium),
            const SizedBox(height: 8),
            SizedBox(
              width: MediaQuery.sizeOf(context).width < 600
                  ? MediaQuery.sizeOf(context).width - 48
                  : 650,
              child: Text(
                subtitle,
                style: const TextStyle(color: Colors.black54, height: 1.5),
              ),
            ),
          ],
        ),
        if (action != null) action!,
      ],
    ),
  );
}

class StatusChip extends StatelessWidget {
  final String status;
  const StatusChip(this.status, {super.key});
  @override
  Widget build(BuildContext context) => Chip(
    label: Text(
      label(status),
      style: const TextStyle(fontSize: 11, fontWeight: FontWeight.w600),
    ),
    side: BorderSide.none,
    backgroundColor: ['FAILED', 'CANCELLED', 'REJECTED'].contains(status)
        ? const Color(0xFFF5DFD7)
        : const Color(0xFFE6ECE4),
  );
}

class Panel extends StatelessWidget {
  final Widget child;
  const Panel({required this.child, super.key});
  @override
  Widget build(BuildContext context) => Container(
    margin: const EdgeInsets.only(bottom: 16),
    padding: const EdgeInsets.all(20),
    decoration: BoxDecoration(
      color: Colors.white,
      border: Border.all(color: const Color(0xFFE4E5DC)),
      borderRadius: BorderRadius.circular(12),
    ),
    child: child,
  );
}

class RemoteView extends StatefulWidget {
  final Future<dynamic> Function() load;
  final Widget Function(dynamic data, VoidCallback reload) builder;
  const RemoteView({required this.load, required this.builder, super.key});
  @override
  State<RemoteView> createState() => _RemoteViewState();
}

class _RemoteViewState extends State<RemoteView> {
  late Future<dynamic> future;
  @override
  void initState() {
    super.initState();
    future = widget.load();
  }

  void reload() {
    setState(() => future = widget.load());
  }

  @override
  Widget build(BuildContext context) => FutureBuilder<dynamic>(
    future: future,
    builder: (context, snapshot) {
      if (snapshot.connectionState != ConnectionState.done) {
        return const Padding(
          padding: EdgeInsets.all(60),
          child: Center(child: CircularProgressIndicator()),
        );
      }
      if (snapshot.hasError) {
        return Panel(
          child: Column(
            children: [
              Text('${snapshot.error}', textAlign: TextAlign.center),
              const SizedBox(height: 16),
              OutlinedButton.icon(
                onPressed: reload,
                icon: const Icon(Icons.refresh),
                label: const Text('Try again'),
              ),
            ],
          ),
        );
      }
      return widget.builder(snapshot.data, reload);
    },
  );
}

class FieldSpec {
  final String name, title;
  final String initial;
  final bool required, number, multiline, secret;
  final List<String>? options;
  final Map<String, String>? optionLabels;
  const FieldSpec(
    this.name,
    this.title, {
    this.initial = '',
    this.required = true,
    this.number = false,
    this.multiline = false,
    this.secret = false,
    this.options,
    this.optionLabels,
  });
}

Future<bool?> editForm(
  BuildContext context,
  String title,
  List<FieldSpec> fields,
  Future<void> Function(Map<String, String>) save, {
  String button = 'Save',
  String? note,
}) => showDialog<bool>(
  context: context,
  barrierDismissible: false,
  builder: (_) => _EditDialog(
    title: title,
    fields: fields,
    save: save,
    button: button,
    note: note,
  ),
);

class _EditDialog extends StatefulWidget {
  final String title, button;
  final String? note;
  final List<FieldSpec> fields;
  final Future<void> Function(Map<String, String>) save;
  const _EditDialog({
    required this.title,
    required this.fields,
    required this.save,
    required this.button,
    this.note,
  });
  @override
  State<_EditDialog> createState() => _EditDialogState();
}

class _EditDialogState extends State<_EditDialog> {
  final form = GlobalKey<FormState>();
  late Map<String, TextEditingController> controls;
  final Set<String> revealed = {};
  bool busy = false;
  String? error;
  @override
  void initState() {
    super.initState();
    controls = {
      for (final f in widget.fields)
        f.name: TextEditingController(text: f.initial),
    };
  }

  @override
  void dispose() {
    for (final c in controls.values) {
      c.dispose();
    }
    super.dispose();
  }

  @override
  Widget build(BuildContext context) => AlertDialog(
    title: Text(widget.title),
    content: SizedBox(
      width: 520,
      child: SingleChildScrollView(
        child: Form(
          key: form,
          child: Column(
            mainAxisSize: MainAxisSize.min,
            children: [
              if (widget.note != null)
                Padding(
                  padding: const EdgeInsets.only(bottom: 16),
                  child: Text(
                    widget.note!,
                    style: const TextStyle(height: 1.5),
                  ),
                ),
              for (final f in widget.fields)
                Padding(
                  padding: const EdgeInsets.only(bottom: 14),
                  child: f.options != null
                      ? DropdownButtonFormField<String>(
                          isExpanded: true,
                          initialValue:
                              f.options!.contains(controls[f.name]!.text)
                              ? controls[f.name]!.text
                              : null,
                          decoration: InputDecoration(labelText: f.title),
                          items: f.options!
                              .toSet()
                              .map(
                                (o) => DropdownMenuItem(
                                  value: o,
                                  child: Text(f.optionLabels?[o] ?? label(o)),
                                ),
                              )
                              .toList(),
                          onChanged: busy
                              ? null
                              : (v) => controls[f.name]!.text = v ?? '',
                          validator: (v) =>
                              f.required && (v == null || v.isEmpty)
                              ? 'Choose an option'
                              : null,
                        )
                      : TextFormField(
                          controller: controls[f.name],
                          enabled: !busy,
                          obscureText: f.secret && !revealed.contains(f.name),
                          minLines: f.multiline ? 3 : 1,
                          maxLines: f.multiline ? 5 : 1,
                          keyboardType: f.number
                              ? const TextInputType.numberWithOptions(
                                  decimal: true,
                                )
                              : TextInputType.text,
                          decoration: InputDecoration(
                            labelText: f.title,
                            suffixIcon: f.secret
                                ? IconButton(
                                    icon: Icon(
                                      revealed.contains(f.name)
                                          ? Icons.visibility_off
                                          : Icons.visibility,
                                    ),
                                    onPressed: () => setState(
                                      () => revealed.contains(f.name)
                                          ? revealed.remove(f.name)
                                          : revealed.add(f.name),
                                    ),
                                  )
                                : null,
                          ),
                          validator: (v) {
                            if (f.required && (v == null || v.trim().isEmpty)) {
                              return 'Required';
                            }
                            if (f.number &&
                                v!.isNotEmpty &&
                                num.tryParse(v) == null) {
                              return 'Enter a number';
                            }
                            return null;
                          },
                        ),
                ),
              if (error != null)
                Text(error!, style: const TextStyle(color: Colors.red)),
            ],
          ),
        ),
      ),
    ),
    actions: [
      TextButton(
        onPressed: busy ? null : () => Navigator.pop(context, false),
        child: const Text('Cancel'),
      ),
      FilledButton(
        onPressed: busy
            ? null
            : () async {
                if (!form.currentState!.validate()) return;
                setState(() {
                  busy = true;
                  error = null;
                });
                try {
                  await widget.save({
                    for (final e in controls.entries) e.key: e.value.text,
                  });
                  if (context.mounted) Navigator.pop(context, true);
                } catch (e) {
                  if (mounted) setState(() => error = '$e');
                } finally {
                  if (mounted) setState(() => busy = false);
                }
              },
        child: Text(busy ? 'Please wait…' : widget.button),
      ),
    ],
  );
}

class EmptyState extends StatelessWidget {
  final String text;
  const EmptyState(this.text, {super.key});
  @override
  Widget build(BuildContext context) => Panel(
    child: SizedBox(
      width: double.infinity,
      child: Padding(
        padding: const EdgeInsets.symmetric(vertical: 32),
        child: Column(
          children: [
            const Icon(
              Icons.checkroom_outlined,
              size: 40,
              color: Colors.black38,
            ),
            const SizedBox(height: 16),
            Text(text, textAlign: TextAlign.center),
          ],
        ),
      ),
    ),
  );
}

class GarmentArt extends StatelessWidget {
  final String category;
  final Color color;
  const GarmentArt({
    this.category = 'Dresses',
    this.color = terracotta,
    super.key,
  });
  @override
  Widget build(BuildContext context) => Semantics(
    label: 'Sample fashion illustration',
    child: CustomPaint(
      painter: _GarmentPainter(category, color),
      size: const Size(500, 650),
    ),
  );
}

class _GarmentPainter extends CustomPainter {
  final String category;
  final Color color;
  _GarmentPainter(this.category, this.color);
  @override
  void paint(Canvas canvas, Size size) {
    final w = size.width, h = size.height;
    canvas.drawRect(
      Offset.zero & size,
      Paint()..color = Color.lerp(color, paper, .87)!,
    );
    canvas.drawOval(
      Rect.fromCenter(
        center: Offset(w * .5, h * .88),
        width: w * .45,
        height: h * .04,
      ),
      Paint()..color = ink.withValues(alpha: .08),
    );
    final dress = Path()
      ..moveTo(w * .42, h * .17)
      ..lineTo(w * .58, h * .17)
      ..lineTo(w * .66, h * .24)
      ..lineTo(w * .6, h * .43)
      ..lineTo(w * .78, h * .83)
      ..quadraticBezierTo(w * .5, h * .9, w * .22, h * .83)
      ..lineTo(w * .4, h * .43)
      ..lineTo(w * .34, h * .24)
      ..close();
    final shirt = Path()
      ..moveTo(w * .39, h * .22)
      ..lineTo(w * .3, h * .26)
      ..lineTo(w * .18, h * .5)
      ..lineTo(w * .29, h * .55)
      ..lineTo(w * .35, h * .42)
      ..lineTo(w * .33, h * .8)
      ..lineTo(w * .67, h * .8)
      ..lineTo(w * .65, h * .42)
      ..lineTo(w * .71, h * .55)
      ..lineTo(w * .82, h * .5)
      ..lineTo(w * .7, h * .26)
      ..lineTo(w * .61, h * .22)
      ..lineTo(w * .5, h * .3)
      ..close();
    final p = category == 'Essentials' || category == 'Sets' ? shirt : dress;
    canvas.drawShadow(p, ink, 8, true);
    canvas.drawPath(p, Paint()..color = color);
    canvas.drawPath(
      p,
      Paint()
        ..style = PaintingStyle.stroke
        ..strokeWidth = 1
        ..color = ink.withValues(alpha: .15),
    );
    final seam = Paint()
      ..color = paper.withValues(alpha: .3)
      ..strokeWidth = 1.3;
    for (int i = 0; i < 7; i++) {
      final x = w * (.37 + i * .045);
      canvas.drawLine(
        Offset(x, h * .48),
        Offset(w * .5 + (x - w * .5) * 1.9, h * .82),
        seam,
      );
    }
    canvas.drawArc(
      Rect.fromLTWH(w * .425, h * .125, w * .15, h * .1),
      0,
      3.14,
      false,
      Paint()
        ..color = paper
        ..style = PaintingStyle.stroke
        ..strokeWidth = 9,
    );
    if (category != 'Essentials') {
      canvas.drawLine(
        Offset(w * .4, h * .43),
        Offset(w * .6, h * .43),
        Paint()
          ..color = ink.withValues(alpha: .35)
          ..strokeWidth = 5,
      );
    }
  }

  @override
  bool shouldRepaint(_GarmentPainter old) =>
      old.color != color || old.category != category;
}
