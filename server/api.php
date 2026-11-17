<?php
// Wheel of Misfortune API, served at <app>/api/... (relative to the game's page).
//
// Open to anyone, no login: one shared set of wheels that every visitor
// can play and edit. Nothing about visitors is kept except per-IP
// rate-limit counters, stored as keyed hashes and pruned after a day.
// Runs in its own php-fpm pool (user wom, ops/wom-fpm.conf), writes only $WOM_DATA.
// Exec is disabled in the pool: sound transcodes and Piper voice lines are queued as
// jobs for the sandboxed worker (ops/worker.py, run by wom-worker.path).
//
//   GET  wheels                  list
//   GET  wheels/<id>             one wheel (+ item.voice once rendered)
//   POST wheels                  create        body: wheel JSON
//   POST wheels/<id>             replace       body: wheel JSON
//   POST wheels/<id>/copy        duplicate
//   POST wheels/<id>/delete      delete (+ media no wheel uses any more)
//   POST upload                  multipart: kind=image|sound, file
//   GET  status?u=media/<x>      {ready, failed} for a queued sound
//
// Limits per IP: 60 wheel changes and 30 uploads an hour (429 past that); 200 wheels;
// 1 GB of uploads in all; voice lines aren't queued while 300 jobs are waiting.
//
// Writes need the header X-WoM: 1 (a cross-site form can't send it) and, when the
// browser sends one, an Origin on this same host.

declare(strict_types=1);

const VOICE = 'en_GB-cori-high';
const MAX_ITEMS = 48;
const MAX_IMAGE = 12 * 1024 * 1024;
const MAX_SOUND = 15 * 1024 * 1024;
const IMAGE_EDGE = 1024;
const SYNTHS = ['gong', 'thunder', 'bell'];
const MAX_WHEELS = 200;
const MAX_MEDIA_BYTES = 1024 * 1024 * 1024;
const MAX_QUEUE = 300;

$DATA = rtrim(getenv('WOM_DATA') ?: '/var/lib/wom', '/'); // set WOM_DATA in the pool to move it
$DEV = getenv('WOM_DEV') === '1';

header('Content-Type: application/json; charset=utf-8');
header('Cache-Control: no-store');

function out(int $code, mixed $body): never
{
    http_response_code($code);
    echo json_encode($body, JSON_UNESCAPED_SLASHES | JSON_UNESCAPED_UNICODE);
    exit;
}

function fail(int $code, string $msg): never
{
    out($code, ['error' => $msg]);
}

$method = $_SERVER['REQUEST_METHOD'] ?? 'GET';
if ($method === 'POST') {
    if (($_SERVER['HTTP_X_WOM'] ?? '') !== '1') fail(403, 'missing request header');
    $origin = $_SERVER['HTTP_ORIGIN'] ?? '';
    $host = strtolower((string)($_SERVER['HTTP_HOST'] ?? ''));
    $ohost = strtolower((string)parse_url($origin, PHP_URL_HOST) . (parse_url($origin, PHP_URL_PORT) ? ':' . parse_url($origin, PHP_URL_PORT) : ''));
    if (!$DEV && $origin !== '' && ($host === '' || $ohost !== $host)) fail(403, 'cross-site request');
} elseif ($method !== 'GET' && $method !== 'HEAD') {
    fail(405, 'method not allowed');
}

$path = (string)parse_url($_SERVER['REQUEST_URI'] ?? '/', PHP_URL_PATH);
$route = preg_match('#/api/(.*)$#', $path, $m) ? trim($m[1], '/') : '';
$seg = $route === '' ? [] : explode('/', $route);

foreach (['wheels', 'media', 'media/tts', 'queue', 'incoming', 'failed', 'throttle'] as $d) {
    if (!is_dir("$DATA/$d") && !@mkdir("$DATA/$d", 0750, true)) fail(500, 'storage unavailable');
}

// ---------------------------------------------------------------------------
// rate limits: at most $max actions per $window seconds per client IP. The IP is only ever
// stored as an HMAC under a random key kept beside the counters, and files idle for a day go.

function throttle(string $action, int $max, int $window): void
{
    global $DATA, $DEV;
    if ($DEV) return;
    $keyFile = "$DATA/throttle/.key";
    if (!is_file($keyFile)) {
        $tmp = "$keyFile." . bin2hex(random_bytes(4));
        file_put_contents($tmp, random_bytes(32));
        @rename($tmp, $keyFile);
    }
    $id = hash_hmac('sha256', $action . '|' . ($_SERVER['REMOTE_ADDR'] ?? ''), (string)file_get_contents($keyFile));
    $fh = fopen("$DATA/throttle/" . substr($id, 0, 32), 'c+');
    if (!$fh || !flock($fh, LOCK_EX)) fail(500, 'storage unavailable');
    $now = time();
    $ts = array_values(array_filter(array_map('intval', explode("\n", (string)stream_get_contents($fh))), fn($t) => $t > $now - $window));
    if (count($ts) >= $max) {
        fclose($fh);
        fail(429, 'Too many changes from here. Try again in a little while.');
    }
    $ts[] = $now;
    ftruncate($fh, 0);
    rewind($fh);
    fwrite($fh, implode("\n", $ts));
    fclose($fh);
    if (random_int(1, 50) === 1) {
        foreach (glob("$DATA/throttle/[0-9a-f]*") ?: [] as $f) if (filemtime($f) < $now - 86400) @unlink($f);
    }
}

function media_bytes(): int
{
    global $DATA;
    $n = 0;
    foreach (glob("$DATA/media/*.{webp,mp3}", GLOB_BRACE) ?: [] as $f) $n += (int)filesize($f);
    foreach (glob("$DATA/incoming/*") ?: [] as $f) $n += (int)filesize($f);
    return $n;
}

// ---------------------------------------------------------------------------
// storage

function wheel_file(string $id): string
{
    global $DATA;
    if (!preg_match('/^[0-9a-f]{12}$/', $id)) fail(404, 'no such wheel');
    return "$DATA/wheels/$id.json";
}

function load_wheel(string $id): array
{
    $f = wheel_file($id);
    $w = is_file($f) ? json_decode((string)file_get_contents($f), true) : null;
    if (!is_array($w)) fail(404, 'no such wheel');
    return $w;
}

function write_atomic(string $file, string $data): void
{
    $tmp = $file . '.' . bin2hex(random_bytes(4)) . '.tmp';
    if (file_put_contents($tmp, $data) === false || !rename($tmp, $file)) {
        @unlink($tmp);
        fail(500, 'write failed');
    }
}

function save_wheel(array $w): void
{
    write_atomic(wheel_file($w['id']), json_encode($w, JSON_UNESCAPED_SLASHES | JSON_UNESCAPED_UNICODE | JSON_PRETTY_PRINT));
    queue_voices($w);
}

function all_wheels(): array
{
    global $DATA;
    seed();
    $list = [];
    foreach (glob("$DATA/wheels/*.json") ?: [] as $f) {
        $w = json_decode((string)file_get_contents($f), true);
        if (is_array($w) && isset($w['id'])) $list[] = $w;
    }
    usort($list, fn($a, $b) => ($a['created'] ?? 0) <=> ($b['created'] ?? 0));
    return $list;
}

// First run: install the starter wheels once. Deleting them later is final.
function seed(): void
{
    global $DATA;
    $mark = "$DATA/wheels/.seeded";
    if (is_file($mark)) return;
    $starters = json_decode((string)@file_get_contents(__DIR__ . '/starter-wheels.json'), true);
    $t = time();
    foreach (is_array($starters) ? $starters : [] as $i => $s) {
        $w = normalize($s);
        $w['id'] = bin2hex(random_bytes(6));
        $w['created'] = $t + $i;
        $w['updated'] = $t;
        save_wheel($w);
    }
    touch($mark);
}

// ---------------------------------------------------------------------------
// validation: everything that reaches disk goes through here

function text(mixed $s, int $max, bool $multiline = false): string
{
    if (!is_string($s)) return '';
    $s = $multiline ? str_replace("\r\n", "\n", $s) : preg_replace('/\s+/u', ' ', $s);
    $s = preg_replace($multiline ? '/[\x00-\x09\x0B-\x1F\x7F]/u' : '/[\x00-\x1F\x7F]/u', '', (string)$s) ?? '';
    return mb_substr(trim($s), 0, $max);
}

function media_ref(mixed $s, string $kind): string
{
    if (!is_string($s) || $s === '') return '';
    if ($kind === 'sound' && preg_match('/^synth:(\w+)$/', $s, $m) && in_array($m[1], SYNTHS, true)) return $s;
    $ext = $kind === 'image' ? 'webp' : 'mp3';
    return preg_match('#^media/[0-9a-f]{16}\.' . $ext . '$#', $s) ? $s : '';
}

function normalize(mixed $in): array
{
    if (!is_array($in)) fail(400, 'expected a wheel');
    $items = [];
    foreach (array_slice(is_array($in['items'] ?? null) ? $in['items'] : [], 0, MAX_ITEMS) as $it) {
        if (!is_array($it)) continue;
        $label = text($it['label'] ?? '', 48);
        if ($label === '') continue;
        $id = is_string($it['id'] ?? null) && preg_match('/^[0-9a-f]{8}$/', $it['id']) ? $it['id'] : bin2hex(random_bytes(4));
        $items[] = [
            'id' => $id,
            'label' => $label,
            'description' => text($it['description'] ?? '', 2000, true),
            'image' => media_ref($it['image'] ?? '', 'image'),
            'sound' => media_ref($it['sound'] ?? '', 'sound'),
            'weight' => max(1, min(10, (int)round((float)($it['weight'] ?? 5)))),
        ];
    }
    $name = text($in['name'] ?? '', 60);
    return [
        'name' => $name === '' ? 'Untitled Wheel' : $name,
        'description' => text($in['description'] ?? '', 600, true),
        'items' => $items,
    ];
}

function body_json(): mixed
{
    $raw = file_get_contents('php://input', false, null, 0, 512 * 1024 + 1);
    if ($raw === false || strlen($raw) > 512 * 1024) fail(413, 'too large');
    $v = json_decode($raw, true);
    if ($v === null) fail(400, 'bad JSON');
    return $v;
}

// ---------------------------------------------------------------------------
// voice lines (Piper, rendered by the worker)

function voice_path(string $label): string
{
    return 'media/tts/' . hash('sha256', VOICE . "\n" . $label) . '.mp3';
}

function queue_job(string $name, array $job): void
{
    global $DATA;
    $f = "$DATA/queue/$name.json";
    if (is_file($f)) return;
    $tmp = "$DATA/incoming/$name.job";
    file_put_contents($tmp, json_encode($job, JSON_UNESCAPED_SLASHES | JSON_UNESCAPED_UNICODE));
    rename($tmp, $f); // appears in queue/ whole, so the worker never reads half a job
}

function queue_voices(array $w): void
{
    global $DATA;
    if (count(glob("$DATA/queue/*.json") ?: []) >= MAX_QUEUE) return; // busy: the browser speaks them meanwhile
    foreach ($w['items'] as $it) {
        $out = voice_path($it['label']);
        if (is_file("$DATA/$out")) continue;
        queue_job('tts-' . substr(basename($out, '.mp3'), 0, 32), ['type' => 'tts', 'voice' => VOICE, 'text' => $it['label'], 'out' => $out]);
    }
}

function with_voices(array $w): array
{
    global $DATA;
    foreach ($w['items'] as &$it) {
        $v = voice_path($it['label']);
        if (is_file("$DATA/$v")) $it['voice'] = $v;
    }
    return $w;
}

// ---------------------------------------------------------------------------
// uploads

// JPEG EXIF orientation (tag 0x0112 in IFD0), without the exif extension.
function jpeg_orientation(string $bytes): int
{
    $len = strlen($bytes);
    for ($p = 2; $p + 4 < $len;) {
        if (ord($bytes[$p]) !== 0xFF) return 1;
        $marker = ord($bytes[$p + 1]);
        $size = unpack('n', substr($bytes, $p + 2, 2))[1];
        if ($marker === 0xE1 && substr($bytes, $p + 4, 6) === "Exif\0\0") {
            $t = substr($bytes, $p + 10, $size - 8);
            $le = substr($t, 0, 2) === 'II';
            $u16 = fn($o) => unpack($le ? 'v' : 'n', substr($t, $o, 2))[1] ?? 0;
            $u32 = fn($o) => unpack($le ? 'V' : 'N', substr($t, $o, 4))[1] ?? 0;
            if (strlen($t) < 8) return 1;
            $ifd = $u32(4);
            if ($ifd + 2 > strlen($t)) return 1;
            for ($i = 0, $n = $u16($ifd); $i < $n; $i++) {
                $e = $ifd + 2 + 12 * $i;
                if ($e + 12 > strlen($t)) break;
                if ($u16($e) === 0x0112) return max(1, min(8, $u16($e + 8)));
            }
            return 1;
        }
        if ($marker === 0xDA) return 1;
        $p += 2 + $size;
    }
    return 1;
}

// Decode, orient, shrink and re-encode: strips EXIF/GPS and anything smuggled.
function store_image(string $tmp): string
{
    global $DATA;
    if (filesize($tmp) > MAX_IMAGE) fail(413, 'image too large (12 MB max)');
    $info = @getimagesize($tmp);
    if (!$info || !in_array($info[2], [IMAGETYPE_JPEG, IMAGETYPE_PNG, IMAGETYPE_GIF, IMAGETYPE_WEBP], true)) fail(415, 'not a JPEG, PNG, GIF or WebP image');
    if ($info[0] * $info[1] > 40_000_000) fail(413, 'image too large (40 megapixels max)');
    $bytes = (string)file_get_contents($tmp);
    $im = @imagecreatefromstring($bytes);
    if (!$im) fail(415, 'image could not be read');
    if ($info[2] === IMAGETYPE_JPEG) {
        $o = jpeg_orientation($bytes);
        if (in_array($o, [2, 4, 5, 7], true)) imageflip($im, IMG_FLIP_HORIZONTAL);
        $deg = [3 => 180, 4 => 180, 5 => 270, 6 => 270, 7 => 90, 8 => 90][$o] ?? 0;
        if ($deg) $im = imagerotate($im, $deg, 0);
    }
    if (!$im) fail(415, 'image could not be read');
    $w = imagesx($im);
    $h = imagesy($im);
    $k = min(1, IMAGE_EDGE / max($w, $h));
    $nw = max(1, (int)round($w * $k));
    $nh = max(1, (int)round($h * $k));
    // always redraw onto a fresh truecolor canvas (also covers palette images + alpha)
    $outIm = imagecreatetruecolor($nw, $nh);
    if (!$outIm) fail(500, 'image could not be processed');
    imagealphablending($outIm, false);
    imagesavealpha($outIm, true);
    imagefill($outIm, 0, 0, imagecolorallocatealpha($outIm, 0, 0, 0, 127));
    if (!imagecopyresampled($outIm, $im, 0, 0, 0, 0, $nw, $nh, $w, $h)) fail(500, 'image could not be processed');
    $name = 'media/' . bin2hex(random_bytes(8)) . '.webp';
    if (!imagewebp($outIm, "$DATA/$name", 82)) fail(500, 'image could not be saved');
    return $name;
}

// Sniff the container, then hand the file to the worker (ffmpeg → 10 s mp3).
function store_sound(string $tmp): string
{
    global $DATA;
    if (filesize($tmp) > MAX_SOUND) fail(413, 'sound too large (15 MB max)');
    $head = (string)file_get_contents($tmp, false, null, 0, 16);
    $ok = str_starts_with($head, 'ID3') || str_starts_with($head, 'fLaC') || str_starts_with($head, 'OggS')
        || (str_starts_with($head, 'RIFF') && substr($head, 8, 4) === 'WAVE')
        || (strlen($head) > 1 && ord($head[0]) === 0xFF && (ord($head[1]) & 0xE0) === 0xE0);
    if (!$ok) fail(415, 'not an MP3, FLAC, OGG or WAV file');
    $hex = bin2hex(random_bytes(8));
    if (!move_uploaded_file($tmp, "$DATA/incoming/$hex.in")) fail(500, 'upload could not be saved');
    queue_job("snd-$hex", ['type' => 'sound', 'in' => "incoming/$hex.in", 'out' => "media/$hex.mp3"]);
    return "media/$hex.mp3";
}

// Remove uploaded media that no wheel points at any more (older than an hour, so
// an upload in an editor that hasn't saved yet survives).
function gc_media(): void
{
    global $DATA;
    $used = [];
    foreach (all_wheels() as $w) {
        foreach ($w['items'] ?? [] as $it) {
            foreach (['image', 'sound'] as $k) if (!empty($it[$k])) $used[$it[$k]] = true;
        }
    }
    foreach (glob("$DATA/media/*.{webp,mp3}", GLOB_BRACE) ?: [] as $f) {
        $ref = 'media/' . basename($f);
        if (!isset($used[$ref]) && filemtime($f) < time() - 3600) @unlink($f);
    }
}

// ---------------------------------------------------------------------------
// routes

$n = count($seg);
$top = $seg[0] ?? '';

if ($top === 'wheels' && $method !== 'POST' && $n === 1) {
    out(200, ['wheels' => array_map(fn($w) => [
        'id' => $w['id'],
        'name' => $w['name'],
        'description' => $w['description'],
        'count' => count($w['items']),
        'updated' => $w['updated'] ?? 0,
    ], all_wheels())]);
}

if ($top === 'wheels' && $method !== 'POST' && $n === 2) {
    out(200, ['wheel' => with_voices(load_wheel($seg[1]))]);
}

if ($top === 'wheels' && $method === 'POST') throttle('wheels', 60, 3600);

if ($top === 'wheels' && $method === 'POST' && $n <= 2) {
    $w = normalize(body_json());
    if ($n === 2) {
        $old = load_wheel($seg[1]);
        $w['id'] = $old['id'];
        $w['created'] = $old['created'] ?? time();
    } else {
        if (count(glob("$DATA/wheels/*.json") ?: []) >= MAX_WHEELS) fail(409, 'The archive is full (' . MAX_WHEELS . ' wheels). Delete one first.');
        $w['id'] = bin2hex(random_bytes(6));
        $w['created'] = time();
    }
    $w['updated'] = time();
    save_wheel($w);
    out(200, ['wheel' => with_voices($w)]);
}

if ($top === 'wheels' && $method === 'POST' && $n === 3 && $seg[2] === 'copy') {
    $w = load_wheel($seg[1]);
    if (count(glob("$DATA/wheels/*.json") ?: []) >= MAX_WHEELS) fail(409, 'The archive is full (' . MAX_WHEELS . ' wheels). Delete one first.');
    $w['id'] = bin2hex(random_bytes(6));
    $w['name'] = mb_substr('Copy of ' . $w['name'], 0, 60);
    $w['created'] = $w['updated'] = time();
    save_wheel($w);
    out(200, ['wheel' => with_voices($w)]);
}

if ($top === 'wheels' && $method === 'POST' && $n === 3 && $seg[2] === 'delete') {
    $f = wheel_file($seg[1]);
    if (!is_file($f)) fail(404, 'no such wheel');
    unlink($f);
    gc_media();
    out(200, ['ok' => true]);
}

if ($top === 'upload' && $method === 'POST' && $n === 1) {
    throttle('upload', 30, 3600);
    if (media_bytes() >= MAX_MEDIA_BYTES) fail(507, 'No room for more pictures or sounds right now.');
    $f = $_FILES['file'] ?? null;
    if (!is_array($f) || !is_string($f['tmp_name'] ?? null)) fail(400, 'no file');
    if ($f['error'] === UPLOAD_ERR_INI_SIZE || $f['error'] === UPLOAD_ERR_FORM_SIZE) fail(413, 'file too large');
    if ($f['error'] !== UPLOAD_ERR_OK || !is_uploaded_file($f['tmp_name'])) fail(400, 'upload failed');
    $kind = $_POST['kind'] ?? '';
    if ($kind === 'image') out(200, ['url' => store_image($f['tmp_name'])]);
    if ($kind === 'sound') out(200, ['url' => store_sound($f['tmp_name']), 'pending' => true]);
    fail(400, 'unknown kind');
}

if ($top === 'status' && $n === 1) {
    $u = (string)($_GET['u'] ?? '');
    if (!preg_match('#^media/([0-9a-f]{16})\.mp3$#', $u, $m)) fail(400, 'bad reference');
    out(200, ['ready' => is_file("$DATA/$u"), 'failed' => is_file("$DATA/failed/snd-{$m[1]}.json")]);
}

fail(404, 'not found');
