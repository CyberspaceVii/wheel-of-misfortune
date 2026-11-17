<?php
// Local dev server: cd tools && php -S 127.0.0.1:8473 -t ../public dev-router.php
// Serves public/ at /wheelofmisfortune/ (like the live path), the API at api/ (WOM_DEV=1: no
// rate limits, any Origin) and media from $WOM_DATA (default tools/.devdata).
$uri = (string)parse_url($_SERVER['REQUEST_URI'], PHP_URL_PATH);
if (!str_starts_with($uri, '/wheelofmisfortune/')) return false; // the built-in server sends it
$uri = substr($uri, strlen('/wheelofmisfortune'));
$data = getenv('WOM_DATA') ?: __DIR__ . '/.devdata';
putenv("WOM_DATA=$data");
putenv('WOM_DEV=1');
if (str_starts_with($uri, '/api/')) { require __DIR__ . '/../server/api.php'; return true; }
$types = ['html' => 'text/html', 'js' => 'text/javascript', 'css' => 'text/css', 'woff2' => 'font/woff2', 'webp' => 'image/webp', 'png' => 'image/png', 'json' => 'application/json', 'mp3' => 'audio/mpeg'];
if (preg_match('#^/media/((?:tts/)?[0-9a-f]+\.(?:webp|mp3))$#', $uri, $m) && is_file("$data/media/{$m[1]}")) {
    header('Content-Type: ' . $types[pathinfo($m[1], PATHINFO_EXTENSION)]);
    readfile("$data/media/{$m[1]}");
    return true;
}
$pub = realpath(__DIR__ . '/../public');
$f = realpath($pub . ($uri === '/' ? '/index.html' : $uri));
if ($f && str_starts_with($f, $pub . '/') && is_file($f)) {
    header('Content-Type: ' . ($types[pathinfo($f, PATHINFO_EXTENSION)] ?? 'application/octet-stream'));
    readfile($f);
    return true;
}
http_response_code(404);
echo 'not found';
return true;
