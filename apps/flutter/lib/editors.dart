import 'package:flutter/material.dart';
import 'api.dart';
import 'ui.dart';

class RowEditor extends StatefulWidget {
  final String title, note;
  final List<Map<String, dynamic>> initial;
  final List<FieldSpec> fields;
  final Future<void> Function(List<Map<String, dynamic>>) save;
  final bool variants;
  const RowEditor({
    required this.title,
    required this.note,
    required this.initial,
    required this.fields,
    required this.save,
    this.variants = false,
    super.key,
  });
  @override
  State<RowEditor> createState() => _RowEditorState();
}

class _RowEditorState extends State<RowEditor> {
  final form = GlobalKey<FormState>();
  final List<Map<String, TextEditingController>> controls = [];
  final List<String?> ids = [];
  bool busy = false;
  String? error;
  @override
  void initState() {
    super.initState();
    for (final row in widget.initial) {
      add(row);
    }
  }

  void add([Map<String, dynamic>? row]) {
    controls.add({
      for (final f in widget.fields)
        f.name: TextEditingController(text: '${row?[f.name] ?? f.initial}'),
    });
    ids.add(row?['id']);
  }

  @override
  void dispose() {
    for (final row in controls) {
      for (final c in row.values) {
        c.dispose();
      }
    }
    super.dispose();
  }

  @override
  Widget build(BuildContext context) => AlertDialog(
    title: Text(widget.title),
    content: SizedBox(
      width: 620,
      child: SingleChildScrollView(
        child: Form(
          key: form,
          child: Column(
            mainAxisSize: MainAxisSize.min,
            children: [
              Text(widget.note, style: const TextStyle(height: 1.6)),
              const SizedBox(height: 18),
              for (int i = 0; i < controls.length; i++)
                Panel(
                  child: Column(
                    children: [
                      Row(
                        children: [
                          Expanded(
                            child: Text(
                              widget.variants
                                  ? 'Size & colour ${i + 1}'
                                  : 'Delivery area ${i + 1}',
                              style: const TextStyle(
                                fontWeight: FontWeight.w600,
                              ),
                            ),
                          ),
                          if (!widget.variants || ids[i] == null)
                            IconButton(
                              onPressed: busy
                                  ? null
                                  : () => setState(() {
                                      for (final c in controls[i].values) {
                                        c.dispose();
                                      }
                                      controls.removeAt(i);
                                      ids.removeAt(i);
                                    }),
                              icon: const Icon(Icons.delete_outline),
                            ),
                        ],
                      ),
                      for (final f in widget.fields)
                        Padding(
                          padding: const EdgeInsets.only(top: 12),
                          child: TextFormField(
                            controller: controls[i][f.name],
                            enabled:
                                !busy &&
                                !(widget.variants &&
                                    ids[i] != null &&
                                    f.name == 'stock'),
                            decoration: InputDecoration(labelText: f.title),
                            keyboardType: f.number
                                ? TextInputType.number
                                : TextInputType.text,
                            validator: (v) {
                              if (v == null || v.trim().isEmpty) {
                                return 'Required';
                              }
                              if (f.number &&
                                  (int.tryParse(v) == null ||
                                      int.parse(v) < 0)) {
                                return 'Use a whole number, zero or more';
                              }
                              return null;
                            },
                          ),
                        ),
                    ],
                  ),
                ),
              OutlinedButton.icon(
                onPressed: busy ? null : () => setState(() => add()),
                icon: const Icon(Icons.add),
                label: Text(
                  widget.variants ? 'Add size & colour' : 'Add delivery area',
                ),
              ),
              if (error != null)
                Padding(
                  padding: const EdgeInsets.only(top: 12),
                  child: Text(
                    error!,
                    style: const TextStyle(color: Colors.red),
                  ),
                ),
            ],
          ),
        ),
      ),
    ),
    actions: [
      TextButton(
        onPressed: busy ? null : () => Navigator.pop(context),
        child: const Text('Cancel'),
      ),
      FilledButton(
        onPressed: busy
            ? null
            : () async {
                if (!form.currentState!.validate() ||
                    (widget.variants && controls.isEmpty)) {
                  return;
                }
                setState(() {
                  busy = true;
                  error = null;
                });
                try {
                  final rows = <Map<String, dynamic>>[];
                  for (int i = 0; i < controls.length; i++) {
                    rows.add({
                      if (ids[i] != null) 'id': ids[i],
                      if (!widget.variants && ids[i] == null)
                        'id':
                            'area-${DateTime.now().millisecondsSinceEpoch}-$i',
                      for (final f in widget.fields)
                        f.name: f.number
                            ? int.parse(controls[i][f.name]!.text)
                            : controls[i][f.name]!.text.trim(),
                    });
                  }
                  await widget.save(rows);
                  if (context.mounted) Navigator.pop(context);
                } catch (e) {
                  if (mounted) {
                    setState(
                      () => error = e is ApiException ? e.message : '$e',
                    );
                  }
                } finally {
                  if (mounted) setState(() => busy = false);
                }
              },
        child: Text(busy ? 'Saving…' : 'Save'),
      ),
    ],
  );
}
