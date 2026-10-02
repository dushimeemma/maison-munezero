import 'dart:async';
import 'dart:convert';
import 'package:flutter/foundation.dart';
import 'package:flutter_secure_storage/flutter_secure_storage.dart';
import 'package:http/http.dart' as http;
import 'package:uuid/uuid.dart';

class ApiException implements Exception {
  final String message;
  final int status;
  ApiException(this.message, [this.status = 0]);
  @override
  String toString() => message;
}

class Api extends ChangeNotifier {
  static const configuredBase = String.fromEnvironment(
    'API_BASE_URL',
    defaultValue: 'http://localhost:3000/api/v1',
  );
  static String get base => Uri.base
      .resolve(configuredBase)
      .toString()
      .replaceFirst(RegExp(r'/$'), '');
  final http.Client client;
  final FlutterSecureStorage storage;
  String? access;
  String? refresh;
  Map<String, dynamic>? user;
  bool initialized = false;
  bool busyAuth = false;
  Future<bool>? _refreshing;
  Api({http.Client? client, FlutterSecureStorage? storage})
    : client = client ?? http.Client(),
      storage =
          storage ??
          const FlutterSecureStorage(
            aOptions: AndroidOptions(encryptedSharedPreferences: true),
          );
  String get role => user?['role'] ?? 'GUEST';
  bool get signedIn => user != null;
  bool get manager => ['SUPER_ADMIN', 'MANAGER'].contains(role);
  bool get sales => manager || role == 'SALES';
  bool get studio => manager || ['DESIGNER', 'TAILOR'].contains(role);
  bool get finance => manager || role == 'ACCOUNTANT';
  bool get staff => signedIn && role != 'CUSTOMER';
  String newKey() => const Uuid().v4();

  Future<void> init() async {
    try {
      refresh = await storage.read(key: 'maison.refresh');
      if (refresh != null && await _rotate()) {
        user = Map<String, dynamic>.from(await get('/auth/me'));
      }
    } catch (_) {
      await clear();
    }
    initialized = true;
    notifyListeners();
  }

  Future<dynamic> get(String path) => request('GET', path);
  Future<dynamic> post(
    String path, [
    Map<String, dynamic>? data,
    String? key,
  ]) => request('POST', path, data: data, key: key);
  Future<dynamic> put(String path, Map<String, dynamic> data) =>
      request('PUT', path, data: data);
  Future<dynamic> patch(String path, Map<String, dynamic> data) =>
      request('PATCH', path, data: data);
  Future<dynamic> delete(String path) => request('DELETE', path);
  Future<dynamic> request(
    String method,
    String path, {
    Map<String, dynamic>? data,
    String? key,
    bool retry = true,
  }) async {
    try {
      final req = http.Request(method, Uri.parse('$base$path'));
      req.headers['Content-Type'] = 'application/json';
      if (access != null) req.headers['Authorization'] = 'Bearer $access';
      if (key != null) req.headers['Idempotency-Key'] = key;
      if (data != null) req.body = jsonEncode(data);
      final streamed = await client
          .send(req)
          .timeout(const Duration(seconds: 25));
      final response = await http.Response.fromStream(
        streamed,
      ).timeout(const Duration(seconds: 25));
      if (response.statusCode == 401 &&
          retry &&
          refresh != null &&
          !path.startsWith('/auth/')) {
        _refreshing ??= _rotate();
        final ok = await _refreshing!;
        _refreshing = null;
        if (ok) {
          return request(method, path, data: data, key: key, retry: false);
        }
        await clear();
      }
      dynamic result;
      try {
        result = response.body.isEmpty ? null : jsonDecode(response.body);
      } catch (_) {
        throw ApiException(
          'The server returned an unexpected response.',
          response.statusCode,
        );
      }
      if (response.statusCode >= 400) {
        throw ApiException(
          result is Map
              ? '${result['message'] ?? 'Request failed'}'
              : 'Request failed',
          response.statusCode,
        );
      }
      return result;
    } on TimeoutException {
      throw ApiException(
        'The request timed out. Check Orders or Payment status before retrying a purchase.',
      );
    } on http.ClientException {
      throw ApiException(
        'Cannot reach Maison Munezero. Check your connection and try again.',
      );
    }
  }

  Future<bool> _rotate() async {
    try {
      final result = await request(
        'POST',
        '/auth/refresh',
        data: {'refreshToken': refresh},
        retry: false,
      );
      await _save(result);
      return true;
    } catch (_) {
      return false;
    }
  }

  Future<void> _save(dynamic result) async {
    access = result['accessToken'];
    refresh = result['refreshToken'];
    user = Map<String, dynamic>.from(result['user']);
    // Access tokens stay in memory. The refresh token is protected by platform storage.
    await storage.write(key: 'maison.refresh', value: refresh);
    notifyListeners();
  }

  Future<void> signIn(String email, String password) async {
    busyAuth = true;
    notifyListeners();
    try {
      await _save(
        await post('/auth/login', {
          'email': email.trim(),
          'password': password,
        }),
      );
    } finally {
      busyAuth = false;
      notifyListeners();
    }
  }

  Future<void> register(Map<String, dynamic> data) async {
    busyAuth = true;
    notifyListeners();
    try {
      await _save(await post('/auth/register', data));
    } finally {
      busyAuth = false;
      notifyListeners();
    }
  }

  Future<void> reloadUser() async {
    user = Map<String, dynamic>.from(await get('/auth/me'));
    notifyListeners();
  }

  Future<void> logout() async {
    try {
      await post('/auth/logout');
    } finally {
      await clear();
    }
  }

  Future<void> clear() async {
    access = null;
    refresh = null;
    user = null;
    await storage.delete(key: 'maison.refresh');
    notifyListeners();
  }

  @override
  void dispose() {
    client.close();
    super.dispose();
  }
}

class Cart extends ChangeNotifier {
  final Map<String, Map<String, dynamic>> lines = {};
  String key = const Uuid().v4();
  void add(Map<String, dynamic> product, Map<String, dynamic> variant) {
    final id = variant['id'] as String;
    final qty = (lines[id]?['quantity'] as int? ?? 0) + 1;
    if (qty > (variant['stock'] as num).toInt() || qty > 50) {
      throw ApiException('No more stock is available in this size.');
    }
    lines[id] = {'product': product, 'variant': variant, 'quantity': qty};
    key = const Uuid().v4();
    notifyListeners();
  }

  void quantity(String id, int qty) {
    if (qty <= 0) {
      lines.remove(id);
    } else {
      lines[id]!['quantity'] = qty;
    }
    key = const Uuid().v4();
    notifyListeners();
  }

  int get count =>
      lines.values.fold(0, (sum, line) => sum + (line['quantity'] as int));
  int get subtotal => lines.values.fold(
    0,
    (sum, line) =>
        sum +
        (line['product']['price'] as num).toInt() * (line['quantity'] as int),
  );
  void clear() {
    lines.clear();
    key = const Uuid().v4();
    notifyListeners();
  }
}
