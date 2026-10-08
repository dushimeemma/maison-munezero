import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:provider/provider.dart';
import 'package:maison_munezero/main.dart';
import 'package:maison_munezero/theme.dart';
import 'app_test.dart' show app, FixtureApi, capture;

void main() {
  setUpAll(() async {
    for (final entry in {
      'MaisonSans': 'DejaVuSans.ttf',
      'MaisonSerif': 'DejaVuSerif.ttf',
      'MaterialIcons': 'MaterialIcons-Regular.otf',
    }.entries) {
      final loader = FontLoader(entry.key)
        ..addFont(
          rootBundle.load(
            entry.key == 'MaterialIcons'
                ? 'fonts/${entry.value}'
                : 'assets/fonts/${entry.value}',
          ),
        );
      await loader.load();
    }
  });
  test('text and status chips retain readable contrast in both themes', () {
    for (final brightness in Brightness.values) {
      final scheme = maisonTheme(brightness).colorScheme;
      for (final pair in [
        (scheme.onSurface, scheme.surface),
        (scheme.onSurfaceVariant, scheme.surfaceContainerLow),
        (scheme.onErrorContainer, scheme.errorContainer),
        (scheme.onSecondaryContainer, scheme.secondaryContainer),
      ]) {
        final values = [pair.$1.computeLuminance(), pair.$2.computeLuminance()]
          ..sort();
        expect(
          (values.last + .05) / (values.first + .05),
          greaterThanOrEqualTo(4.5),
        );
      }
    }
  });
  test(
    'appearance restores across sessions and falls back to device default',
    () async {
      String? saved;
      final first = ThemePreference(
        read: () async => saved,
        write: (value) async => saved = value,
      );
      await first.load();
      expect(first.mode, ThemeMode.system);
      await first.select(ThemeMode.dark);
      final restarted = ThemePreference(
        read: () async => saved,
        write: (_) async {},
      );
      await restarted.load();
      expect(restarted.mode, ThemeMode.dark);
      saved = 'invalid';
      await restarted.load();
      expect(restarted.mode, ThemeMode.system);
      final unavailable = ThemePreference(
        read: () async => throw Exception(),
        write: (_) async => throw Exception(),
      );
      await unavailable.load();
      await expectLater(unavailable.select(ThemeMode.light), throwsException);
      expect(unavailable.mode, ThemeMode.system);
      expect(unavailable.saving, isFalse);
    },
  );

  testWidgets(
    'appearance menu switches immediately, follows device changes and preserves navigation',
    (tester) async {
      tester.view.physicalSize = const Size(390, 844);
      tester.view.devicePixelRatio = 1;
      addTearDown(tester.view.resetPhysicalSize);
      addTearDown(tester.view.resetDevicePixelRatio);
      tester.platformDispatcher.platformBrightnessTestValue = Brightness.light;
      addTearDown(tester.platformDispatcher.clearPlatformBrightnessTestValue);
      await tester.pumpWidget(app(FixtureApi()));
      await tester.pumpAndSettle();
      BuildContext shellContext() => tester.element(find.byType(Shell));
      expect(Theme.of(shellContext()).brightness, Brightness.light);
      await tester.tap(find.byTooltip('Appearance: Device default'));
      await tester.pumpAndSettle();
      await tester.tap(
        find.byWidgetPredicate(
          (widget) =>
              widget is CheckedPopupMenuItem<ThemeMode> &&
              widget.value == ThemeMode.dark,
        ),
      );
      await tester.pumpAndSettle();
      expect(Theme.of(shellContext()).brightness, Brightness.dark);
      await tester.runAsync(
        () => capture(
          tester,
          '/workspace/scratch/189464044535/maison-theme-dark.png',
        ),
      );
      await tester.tap(find.byIcon(Icons.menu));
      await tester.pumpAndSettle();
      await tester.tap(find.text('Atelier'));
      await tester.pumpAndSettle();
      await tester.tap(find.byTooltip('Appearance: Dark'));
      await tester.pumpAndSettle();
      await tester.tap(
        find.byWidgetPredicate(
          (widget) =>
              widget is CheckedPopupMenuItem<ThemeMode> &&
              widget.value == ThemeMode.light,
        ),
      );
      await tester.pumpAndSettle();
      expect(Theme.of(shellContext()).brightness, Brightness.light);
      expect(find.text('Collection'), findsNothing); // Still on Atelier.
      await tester.tap(find.byTooltip('Appearance: Light'));
      await tester.pumpAndSettle();
      await tester.tap(
        find.byWidgetPredicate(
          (widget) =>
              widget is CheckedPopupMenuItem<ThemeMode> &&
              widget.value == ThemeMode.system,
        ),
      );
      await tester.pumpAndSettle();
      tester.platformDispatcher.platformBrightnessTestValue = Brightness.dark;
      await tester.pumpAndSettle();
      expect(Theme.of(shellContext()).brightness, Brightness.dark);
      expect(tester.takeException(), isNull);
      final preference = shellContext().read<ThemePreference>();
      await preference.select(ThemeMode.light);
      await tester.pumpAndSettle();
      expect(Theme.of(shellContext()).brightness, Brightness.light);
    },
  );
}
