import 'dart:async';
import 'dart:convert';
import 'dart:io';

import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:webview_flutter/webview_flutter.dart';
import 'package:webview_flutter_wkwebview/webview_flutter_wkwebview.dart';

Future<void> main() async {
  WidgetsFlutterBinding.ensureInitialized();
  await SystemChrome.setEnabledSystemUIMode(SystemUiMode.immersiveSticky);
  runApp(const ArnoubaGameApp());
}

class ArnoubaGameApp extends StatelessWidget {
  const ArnoubaGameApp({super.key});

  @override
  Widget build(BuildContext context) {
    return MaterialApp(
      title: 'الأرنوبة الشقية',
      debugShowCheckedModeBanner: false,
      theme: ThemeData.dark().copyWith(
        scaffoldBackgroundColor: const Color(0xFF050814),
      ),
      home: const GameWebViewScreen(),
    );
  }
}

class LocalGameServer {
  LocalGameServer({this.remoteApiBase = 'https://rabit.megadeveloper.site/api.php'});

  final String remoteApiBase;
  HttpServer? _server;

  int get port => _server?.port ?? 0;

  Future<void> start() async {
    if (_server != null) return;
    _server = await HttpServer.bind(InternetAddress.loopbackIPv4, 0);
    unawaited(_serveRequests());
  }

  Future<void> _serveRequests() async {
    final server = _server;
    if (server == null) return;
    await for (final HttpRequest request in server) {
      try {
        await _handleRequest(request);
      } catch (_) {
        try {
          request.response.statusCode = HttpStatus.internalServerError;
          await request.response.close();
        } catch (_) {}
      }
    }
  }

  Future<void> _handleRequest(HttpRequest request) async {
    final path = request.uri.path;
    if (path == '/api.php') {
      await _proxyApiRequest(request);
      return;
    }

    final cleanPath = (path == '/' || path.isEmpty) ? 'index.html' : path.replaceFirst(RegExp(r'^/+'), '');
    final assetKey = 'assets/www/$cleanPath';
    try {
      final data = await rootBundle.load(assetKey);
      final bytes = data.buffer.asUint8List(data.offsetInBytes, data.lengthInBytes);
      request.response.statusCode = HttpStatus.ok;
      request.response.headers.set(HttpHeaders.contentTypeHeader, _mimeTypeFor(cleanPath));
      request.response.headers.set(HttpHeaders.cacheControlHeader, 'no-cache');
      request.response.add(bytes);
      await request.response.close();
    } catch (_) {
      request.response.statusCode = HttpStatus.notFound;
      await request.response.close();
    }
  }

  Future<void> _proxyApiRequest(HttpRequest request) async {
    final client = HttpClient()..connectionTimeout = const Duration(seconds: 6);
    try {
      final query = request.uri.hasQuery ? '?${request.uri.query}' : '';
      final targetUri = Uri.parse('$remoteApiBase$query');
      final proxyReq = await client.openUrl(request.method, targetUri);

      final bodyBytes = <int>[];
      await for (final chunk in request) {
        bodyBytes.addAll(chunk);
      }
      if (bodyBytes.isNotEmpty) {
        proxyReq.headers.set(HttpHeaders.contentTypeHeader, 'application/json; charset=utf-8');
        proxyReq.add(bodyBytes);
      } else {
        proxyReq.headers.set(HttpHeaders.acceptHeader, 'application/json');
      }

      final proxyRes = await proxyReq.close().timeout(const Duration(seconds: 8));
      final resBytes = <int>[];
      await for (final chunk in proxyRes) {
        resBytes.addAll(chunk);
      }
      request.response.statusCode = proxyRes.statusCode;
      request.response.headers.set(HttpHeaders.contentTypeHeader, 'application/json; charset=utf-8');
      request.response.add(resBytes);
      await request.response.close();
    } catch (_) {
      request.response.statusCode = HttpStatus.badGateway;
      request.response.headers.set(HttpHeaders.contentTypeHeader, 'application/json; charset=utf-8');
      request.response.write(jsonEncode({'ok': false, 'error': 'OFFLINE'}));
      await request.response.close();
    } finally {
      client.close(force: true);
    }
  }

  String _mimeTypeFor(String path) {
    final lower = path.toLowerCase();
    if (lower.endsWith('.html')) return 'text/html; charset=utf-8';
    if (lower.endsWith('.css')) return 'text/css; charset=utf-8';
    if (lower.endsWith('.js')) return 'application/javascript; charset=utf-8';
    if (lower.endsWith('.json')) return 'application/json; charset=utf-8';
    if (lower.endsWith('.png')) return 'image/png';
    if (lower.endsWith('.jpg') || lower.endsWith('.jpeg')) return 'image/jpeg';
    if (lower.endsWith('.mp3')) return 'audio/mpeg';
    if (lower.endsWith('.svg')) return 'image/svg+xml';
    return 'application/octet-stream';
  }

  Future<void> dispose() async {
    await _server?.close(force: true);
    _server = null;
  }
}

class GameWebViewScreen extends StatefulWidget {
  const GameWebViewScreen({super.key});

  @override
  State<GameWebViewScreen> createState() => _GameWebViewScreenState();
}

class _GameWebViewScreenState extends State<GameWebViewScreen> with WidgetsBindingObserver {
  final LocalGameServer _localServer = LocalGameServer();
  WebViewController? _controller;
  bool _ready = false;

  @override
  void initState() {
    super.initState();
    WidgetsBinding.instance.addObserver(this);
    unawaited(_initGame());
  }

  @override
  void didChangeAppLifecycleState(AppLifecycleState state) {
    if (state == AppLifecycleState.resumed) {
      unawaited(SystemChrome.setEnabledSystemUIMode(SystemUiMode.immersiveSticky));
    }
  }

  Future<void> _initGame() async {
    await _localServer.start();

    late final PlatformWebViewControllerCreationParams params;
    if (WebViewPlatform.instance is WebKitWebViewPlatform) {
      params = WebKitWebViewControllerCreationParams(
        allowsInlineMediaPlayback: true,
        mediaTypesRequiringUserAction: const <PlaybackMediaTypes>{},
      );
    } else {
      params = const PlatformWebViewControllerCreationParams();
    }

    final controller = WebViewController.fromPlatformCreationParams(params)
      ..setJavaScriptMode(JavaScriptMode.unrestricted)
      ..setBackgroundColor(const Color(0xFF050814))
      ..enableZoom(false)
      ..setNavigationDelegate(
        NavigationDelegate(
          onNavigationRequest: (NavigationRequest request) {
            final uri = Uri.tryParse(request.url);
            if (uri != null && (uri.host == '127.0.0.1' || uri.host == 'localhost' || uri.host == 'rabit.megadeveloper.site')) {
              return NavigationDecision.navigate;
            }
            return NavigationDecision.navigate;
          },
        ),
      );

    if (controller.platform is WebKitWebViewController) {
      unawaited(
        (controller.platform as WebKitWebViewController).setAllowsBackForwardNavigationGestures(false),
      );
    }

    await controller.loadRequest(Uri.parse('http://127.0.0.1:${_localServer.port}/index.html'));
    if (!mounted) return;
    setState(() {
      _controller = controller;
      _ready = true;
    });
  }

  @override
  void dispose() {
    WidgetsBinding.instance.removeObserver(this);
    unawaited(_localServer.dispose());
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    final controller = _controller;
    return Scaffold(
      backgroundColor: const Color(0xFF050814),
      resizeToAvoidBottomInset: true,
      body: _ready && controller != null
          ? WebViewWidget(controller: controller)
          : const Center(
              child: Column(
                mainAxisSize: MainAxisSize.min,
                children: [
                  CircularProgressIndicator(color: Color(0xFFFB923C)),
                  SizedBox(height: 14),
                  Text(
                    'جاري تشغيل الأرنوبة الشقية 🐰...',
                    style: TextStyle(fontSize: 16, fontWeight: FontWeight.bold, color: Colors.white),
                  ),
                ],
              ),
            ),
    );
  }
}
