import 'package:flutter/material.dart';
import 'package:flutter_secure_storage/flutter_secure_storage.dart';
import 'package:provider/provider.dart';
import 'ui.dart';

class ThemePreference extends ChangeNotifier {
  static const storage = FlutterSecureStorage(
    aOptions: AndroidOptions(encryptedSharedPreferences: true),
  );
  ThemePreference({
    Future<String?> Function()? read,
    Future<void> Function(String)? write,
  }) : _read = read ?? (() => storage.read(key: 'maison.theme')),
       _write =
           write ??
           ((value) => storage.write(key: 'maison.theme', value: value));
  final Future<String?> Function() _read;
  final Future<void> Function(String) _write;
  ThemeMode mode = ThemeMode.system;
  bool saving = false;

  Future<void> load() async {
    try {
      final saved = await _read();
      mode =
          ThemeMode.values.where((value) => value.name == saved).firstOrNull ??
          ThemeMode.system;
    } catch (_) {
      mode = ThemeMode.system;
    }
    notifyListeners();
  }

  Future<void> select(ThemeMode value) async {
    if (saving || mode == value) return;
    final previous = mode;
    mode = value;
    saving = true;
    notifyListeners();
    try {
      await _write(value.name);
    } catch (_) {
      mode = previous;
      rethrow;
    } finally {
      saving = false;
      notifyListeners();
    }
  }
}

ThemeData maisonTheme(Brightness brightness) {
  final dark = brightness == Brightness.dark;
  final scheme = ColorScheme.fromSeed(
    seedColor: ink,
    brightness: brightness,
    surface: dark ? const Color(0xFF151D18) : paper,
  );
  return ThemeData(
    useMaterial3: true,
    brightness: brightness,
    fontFamily: 'MaisonSans',
    colorScheme: scheme,
    scaffoldBackgroundColor: scheme.surface,
    appBarTheme: AppBarTheme(
      backgroundColor: scheme.surface,
      foregroundColor: scheme.onSurface,
      surfaceTintColor: Colors.transparent,
    ),
    textTheme: TextTheme(
      headlineLarge: TextStyle(
        fontFamily: 'MaisonSerif',
        fontWeight: FontWeight.w400,
        color: scheme.onSurface,
      ),
      headlineMedium: TextStyle(
        fontFamily: 'MaisonSerif',
        fontWeight: FontWeight.w400,
        color: scheme.onSurface,
      ),
      titleLarge: TextStyle(
        color: scheme.onSurface,
        fontWeight: FontWeight.w500,
      ),
    ),
    inputDecorationTheme: InputDecorationTheme(
      border: OutlineInputBorder(borderRadius: BorderRadius.circular(8)),
      contentPadding: const EdgeInsets.symmetric(horizontal: 16, vertical: 16),
    ),
    filledButtonTheme: FilledButtonThemeData(
      style: FilledButton.styleFrom(
        backgroundColor: dark ? scheme.primary : ink,
        foregroundColor: dark ? scheme.onPrimary : Colors.white,
        padding: const EdgeInsets.symmetric(horizontal: 24, vertical: 18),
        shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(6)),
      ),
    ),
  );
}

String themeLabel(ThemeMode mode) => switch (mode) {
  ThemeMode.system => 'Device default',
  ThemeMode.light => 'Light',
  ThemeMode.dark => 'Dark',
};

class ThemePicker extends StatelessWidget {
  const ThemePicker({super.key});
  @override
  Widget build(BuildContext context) {
    final preference = context.watch<ThemePreference>();
    return PopupMenuButton<ThemeMode>(
      tooltip: 'Appearance: ${themeLabel(preference.mode)}',
      enabled: !preference.saving,
      initialValue: preference.mode,
      icon: Icon(switch (preference.mode) {
        ThemeMode.system => Icons.brightness_auto_outlined,
        ThemeMode.light => Icons.light_mode_outlined,
        ThemeMode.dark => Icons.dark_mode_outlined,
      }),
      onSelected: (mode) async {
        try {
          await preference.select(mode);
        } catch (_) {
          if (context.mounted) {
            toast(
              context,
              'Could not save your appearance preference. Please try again.',
            );
          }
        }
      },
      itemBuilder: (_) => [
        for (final mode in [ThemeMode.system, ThemeMode.light, ThemeMode.dark])
          CheckedPopupMenuItem(
            value: mode,
            checked: preference.mode == mode,
            child: Text(themeLabel(mode)),
          ),
      ],
    );
  }
}
