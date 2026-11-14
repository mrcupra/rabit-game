<?php
/**
 * api.php — حسابات اللاعبين، السباقات الأونلاين، الجواهر، والعشائر للعبة "الأرنوبة الشقية" (v10 Mega Online)
 *
 * - No database setup needed: data is stored in data/users.php (JSON behind a PHP exit guard,
 *   so it can never be downloaded directly even if .htaccess is ignored).
 * - Passwords are stored with password_hash(); session tokens are stored as SHA-256 hashes.
 * - Requires PHP 7.1+ (standard on cPanel).
 */
declare(strict_types=1);

header('Content-Type: application/json; charset=utf-8');
header('Cache-Control: no-store, no-cache, must-revalidate, max-age=0');
header('X-Content-Type-Options: nosniff');
header('Referrer-Policy: same-origin');

define('DATA_DIR', __DIR__ . '/data');
define('DB_FILE', DATA_DIR . '/users.php');
define('DB_GUARD', "<?php http_response_code(403); exit; ?>\n");
define('MAX_TOKENS', 5);
define('MAX_FAILS', 8);
define('LOCK_SECONDS', 300);
define('MAX_USERS', 100000);
define('RACE_TTL', 300);

function world_ids(): array
{
    return ['auto', 'candy_1000', 'cyber_2000', 'pharaoh_3000', 'lava_4000', 'galaxy_5000', 'atlantis_gems', 'crystal_heaven'];
}

function char_ids(): array
{
    return ['classic', 'snow_princess', 'ninja_bunny', 'cyber_bunny', 'golden_king', 'cosmic_legend', 'phantom_shadow', 'diamond_empress'];
}

function pet_ids(): array
{
    return ['none', 'baby_fox', 'mini_dragon', 'cyber_owl', 'star_fairy', 'golden_griffin'];
}

function board_ids(): array
{
    return ['none', 'neon_board', 'flame_jet', 'galactic_surf'];
}

function trail_ids(): array
{
    return ['default', 'rainbow', 'fire', 'galaxy', 'hearts', 'lightning'];
}

function ultimate_ids(): array
{
    return ['nova', 'time_warp', 'gold_rush'];
}

function topup_packages(): array
{
    return [
        'gems_100' => ['gems' => 100, 'bonusCarrots' => 500, 'vip' => false, 'priceLabel' => '25 ج.م'],
        'gems_600' => ['gems' => 600, 'bonusCarrots' => 2500, 'vip' => false, 'priceLabel' => '99 ج.م'],
        'gems_1900' => ['gems' => 1900, 'bonusCarrots' => 8000, 'vip' => true, 'priceLabel' => '249 ج.م'],
        'gems_6500' => ['gems' => 6500, 'bonusCarrots' => 30000, 'vip' => true, 'priceLabel' => '699 ج.م'],
    ];
}

function promo_codes(): array
{
    return [
        'ARNOUBA2026' => ['gems' => 250, 'carrots' => 2000, 'label' => '250 جوهرة + 2000 جزرة'],
        'VIPGEMS' => ['gems' => 500, 'carrots' => 1000, 'label' => '500 جوهرة + 1000 جزرة'],
        'MEGA1000' => ['gems' => 1000, 'carrots' => 5000, 'label' => '1000 جوهرة + 5000 جزرة'],
        'FREE500' => ['gems' => 100, 'carrots' => 500, 'label' => '100 جوهرة + 500 جزرة'],
        'SPEEDKING' => ['gems' => 300, 'carrots' => 1500, 'label' => '300 جوهرة + 1500 جزرة'],
    ];
}

function respond(array $data, int $code = 200): void
{
    http_response_code($code);
    echo json_encode($data, JSON_UNESCAPED_UNICODE);
    exit;
}

function respond_result(array $res): void
{
    $code = isset($res['code']) ? (int)$res['code'] : (!empty($res['ok']) ? 200 : 400);
    unset($res['code']);
    respond($res, $code);
}

function lower_name(string $s): string
{
    return function_exists('mb_strtolower') ? mb_strtolower($s, 'UTF-8') : strtolower($s);
}

function safe_len(string $s): int
{
    return function_exists('mb_strlen') ? mb_strlen($s, 'UTF-8') : strlen($s);
}

function safe_sub(string $s, int $max): string
{
    return function_exists('mb_substr') ? mb_substr($s, 0, $max, 'UTF-8') : substr($s, 0, $max);
}

function ensure_storage(): void
{
    if (!is_dir(DATA_DIR) && !@mkdir(DATA_DIR, 0755, true)) {
        respond(['ok' => false, 'error' => 'تعذر إنشاء مجلد البيانات على السيرفر (data)'], 500);
    }
    $ht = DATA_DIR . '/.htaccess';
    if (!file_exists($ht)) {
        @file_put_contents($ht, "<IfModule mod_authz_core.c>\nRequire all denied\n</IfModule>\n<IfModule !mod_authz_core.c>\nOrder allow,deny\nDeny from all\n</IfModule>\n");
    }
    $idx = DATA_DIR . '/index.html';
    if (!file_exists($idx)) {
        @file_put_contents($idx, '');
    }
}

/** Runs $fn(array &$db, bool &$changed) under an exclusive file lock and persists changes. */
function db_transaction(callable $fn): array
{
    ensure_storage();
    $fh = @fopen(DB_FILE, 'c+');
    if (!$fh) {
        respond(['ok' => false, 'error' => 'تعذر فتح ملف البيانات (اتأكد إن مجلد data قابل للكتابة)'], 500);
    }
    flock($fh, LOCK_EX);
    $raw = stream_get_contents($fh);
    $db = ['users' => [], 'tokens' => [], 'races' => [], 'clans' => []];
    if (is_string($raw) && strlen($raw) > strlen(DB_GUARD)) {
        $decoded = json_decode(substr($raw, strlen(DB_GUARD)), true);
        if (is_array($decoded)) {
            $db = array_merge($db, $decoded);
        }
    }
    if (!isset($db['users']) || !is_array($db['users'])) $db['users'] = [];
    if (!isset($db['tokens']) || !is_array($db['tokens'])) $db['tokens'] = [];
    if (!isset($db['races']) || !is_array($db['races'])) $db['races'] = [];
    if (!isset($db['clans']) || !is_array($db['clans'])) $db['clans'] = [];

    $changed = false;
    $result = $fn($db, $changed);
    if ($changed) {
        $json = json_encode($db, JSON_UNESCAPED_UNICODE);
        if ($json !== false) {
            ftruncate($fh, 0);
            rewind($fh);
            fwrite($fh, DB_GUARD . $json);
            fflush($fh);
        }
    }
    flock($fh, LOCK_UN);
    fclose($fh);
    return $result;
}

function default_progress(): array
{
    return [
        'seenIntro' => false,
        'bankCarrots' => 0,
        'totalCarrots' => 0,
        'gems' => 50,
        'trophies' => 0,
        'xp' => 0,
        'endlessHighScore' => 0,
        'racesPlayed' => 0,
        'racesWon' => 0,
        'unlockedLevel' => 1,
        'levelStars' => [],
        'devilUnlockedLevel' => 1,
        'devilStars' => [],
        'devilDeaths' => 0,
        'ownedWorlds' => ['auto'],
        'equippedWorld' => 'auto',
        'ownedChars' => ['classic'],
        'equippedChar' => 'classic',
        'ownedPets' => ['none'],
        'equippedPet' => 'none',
        'ownedBoards' => ['none'],
        'equippedBoard' => 'none',
        'ownedTrails' => ['default'],
        'equippedTrail' => 'default',
        'equippedUltimate' => 'nova',
        'playStyle' => 'runner',
        'title' => 'أرنوب مغامر',
        'clanId' => '',
        'vipPass' => false,
        'bpClaimed' => [],
        'loginStreak' => 0,
        'lastLoginDate' => '',
        'lastSpinTime' => 0,
        'quests' => [
            'date' => '',
            'carrots' => 0,
            'races' => 0,
            'dashes' => 0,
            'levels' => 0,
            'claimed' => [],
        ],
        'achievements' => [],
        'redeemedCodes' => [],
        'topupHistory' => [],
        'upgrades' => ['maxLives' => 0, 'magnetDuration' => 0, 'dashPower' => 0, 'doubleCarrot' => 0],
    ];
}

function clamp_int($v, int $min, int $max): int
{
    $n = is_numeric($v) ? (int)$v : 0;
    return max($min, min($max, $n));
}

function sanitize_list($arr, array $allowed, array $required): array
{
    $out = $required;
    if (is_array($arr)) {
        foreach ($arr as $item) {
            if (is_string($item) && in_array($item, $allowed, true) && !in_array($item, $out, true)) {
                $out[] = $item;
            }
        }
    }
    return $out;
}

function sanitize_string_list($arr, int $maxLen = 40, int $maxItems = 100): array
{
    $out = [];
    if (!is_array($arr)) return $out;
    foreach ($arr as $item) {
        if (is_string($item) || is_int($item)) {
            $s = trim((string)$item);
            if ($s !== '' && strlen($s) <= $maxLen && !in_array($s, $out, true)) {
                $out[] = $s;
                if (count($out) >= $maxItems) break;
            }
        }
    }
    return $out;
}

function sanitize_progress($p): array
{
    $p = is_array($p) ? $p : [];
    $stars = [];
    if (isset($p['levelStars']) && is_array($p['levelStars'])) {
        foreach ($p['levelStars'] as $k => $v) {
            $lvl = (int)$k;
            if ($lvl >= 1 && $lvl <= 100) {
                $stars[(string)$lvl] = clamp_int($v, 0, 3);
            }
        }
    }
    $devilStars = [];
    if (isset($p['devilStars']) && is_array($p['devilStars'])) {
        foreach ($p['devilStars'] as $k => $v) {
            $dlvl = (int)$k;
            if ($dlvl >= 1 && $dlvl <= 200) {
                $devilStars[(string)$dlvl] = clamp_int($v, 0, 3);
            }
        }
    }

    $ownedWorlds = sanitize_list($p['ownedWorlds'] ?? [], world_ids(), ['auto']);
    $equippedWorld = (isset($p['equippedWorld']) && is_string($p['equippedWorld']) && in_array($p['equippedWorld'], $ownedWorlds, true))
        ? $p['equippedWorld'] : 'auto';

    $ownedChars = sanitize_list($p['ownedChars'] ?? [], char_ids(), ['classic']);
    $equippedChar = (isset($p['equippedChar']) && is_string($p['equippedChar']) && in_array($p['equippedChar'], $ownedChars, true))
        ? $p['equippedChar'] : 'classic';

    $ownedPets = sanitize_list($p['ownedPets'] ?? [], pet_ids(), ['none']);
    $equippedPet = (isset($p['equippedPet']) && is_string($p['equippedPet']) && in_array($p['equippedPet'], $ownedPets, true))
        ? $p['equippedPet'] : 'none';

    $ownedBoards = sanitize_list($p['ownedBoards'] ?? [], board_ids(), ['none']);
    $equippedBoard = (isset($p['equippedBoard']) && is_string($p['equippedBoard']) && in_array($p['equippedBoard'], $ownedBoards, true))
        ? $p['equippedBoard'] : 'none';

    $ownedTrails = sanitize_list($p['ownedTrails'] ?? [], trail_ids(), ['default']);
    $equippedTrail = (isset($p['equippedTrail']) && is_string($p['equippedTrail']) && in_array($p['equippedTrail'], $ownedTrails, true))
        ? $p['equippedTrail'] : 'default';

    $equippedUltimate = (isset($p['equippedUltimate']) && is_string($p['equippedUltimate']) && in_array($p['equippedUltimate'], ultimate_ids(), true))
        ? $p['equippedUltimate'] : 'nova';

    $playStyle = (isset($p['playStyle']) && is_string($p['playStyle']) && in_array($p['playStyle'], ['runner', 'jetpack', 'lanes'], true))
        ? $p['playStyle'] : 'runner';

    $up = (isset($p['upgrades']) && is_array($p['upgrades'])) ? $p['upgrades'] : [];
    $q = (isset($p['quests']) && is_array($p['quests'])) ? $p['quests'] : [];

    $title = isset($p['title']) && is_string($p['title']) ? trim(safe_sub($p['title'], 40)) : 'أرنوب مغامر';
    if ($title === '') $title = 'أرنوب مغامر';

    $clanId = isset($p['clanId']) && is_string($p['clanId']) ? trim(safe_sub($p['clanId'], 32)) : '';
    $lastLoginDate = isset($p['lastLoginDate']) && is_string($p['lastLoginDate']) ? trim(safe_sub($p['lastLoginDate'], 16)) : '';
    $qDate = isset($q['date']) && is_string($q['date']) ? trim(safe_sub($q['date'], 16)) : '';

    $topupHistory = [];
    if (isset($p['topupHistory']) && is_array($p['topupHistory'])) {
        foreach (array_slice($p['topupHistory'], -15) as $th) {
            if (is_array($th)) {
                $topupHistory[] = [
                    'pkg' => safe_sub((string)($th['pkg'] ?? ''), 24),
                    'gems' => clamp_int($th['gems'] ?? 0, 0, 100000),
                    'method' => safe_sub((string)($th['method'] ?? ''), 24),
                    'at' => clamp_int($th['at'] ?? 0, 0, 2147483647),
                ];
            }
        }
    }

    $gemsVal = array_key_exists('gems', $p) ? clamp_int($p['gems'], 0, 1000000000) : 50;

    return [
        'seenIntro' => !empty($p['seenIntro']),
        'bankCarrots' => clamp_int($p['bankCarrots'] ?? 0, 0, 1000000000),
        'totalCarrots' => clamp_int($p['totalCarrots'] ?? 0, 0, 2000000000),
        'gems' => $gemsVal,
        'trophies' => clamp_int($p['trophies'] ?? 0, 0, 1000000000),
        'xp' => clamp_int($p['xp'] ?? 0, 0, 1000000000),
        'endlessHighScore' => clamp_int($p['endlessHighScore'] ?? 0, 0, 1000000000),
        'racesPlayed' => clamp_int($p['racesPlayed'] ?? 0, 0, 1000000),
        'racesWon' => clamp_int($p['racesWon'] ?? 0, 0, 1000000),
        'unlockedLevel' => clamp_int($p['unlockedLevel'] ?? 1, 1, 100),
        'levelStars' => $stars,
        'devilUnlockedLevel' => clamp_int($p['devilUnlockedLevel'] ?? 1, 1, 200),
        'devilStars' => $devilStars,
        'devilDeaths' => clamp_int($p['devilDeaths'] ?? 0, 0, 1000000),
        'ownedWorlds' => $ownedWorlds,
        'equippedWorld' => $equippedWorld,
        'ownedChars' => $ownedChars,
        'equippedChar' => $equippedChar,
        'ownedPets' => $ownedPets,
        'equippedPet' => $equippedPet,
        'ownedBoards' => $ownedBoards,
        'equippedBoard' => $equippedBoard,
        'ownedTrails' => $ownedTrails,
        'equippedTrail' => $equippedTrail,
        'equippedUltimate' => $equippedUltimate,
        'playStyle' => $playStyle,
        'title' => $title,
        'clanId' => $clanId,
        'vipPass' => !empty($p['vipPass']),
        'bpClaimed' => sanitize_string_list($p['bpClaimed'] ?? [], 24, 60),
        'loginStreak' => clamp_int($p['loginStreak'] ?? 0, 0, 365),
        'lastLoginDate' => $lastLoginDate,
        'lastSpinTime' => clamp_int($p['lastSpinTime'] ?? 0, 0, 2147483647),
        'quests' => [
            'date' => $qDate,
            'carrots' => clamp_int($q['carrots'] ?? 0, 0, 10000000),
            'races' => clamp_int($q['races'] ?? 0, 0, 10000),
            'dashes' => clamp_int($q['dashes'] ?? 0, 0, 100000),
            'levels' => clamp_int($q['levels'] ?? 0, 0, 10000),
            'claimed' => sanitize_string_list($q['claimed'] ?? [], 24, 30),
        ],
        'achievements' => sanitize_string_list($p['achievements'] ?? [], 32, 80),
        'redeemedCodes' => sanitize_string_list($p['redeemedCodes'] ?? [], 32, 50),
        'topupHistory' => $topupHistory,
        'upgrades' => [
            'maxLives' => clamp_int($up['maxLives'] ?? 0, 0, 3),
            'magnetDuration' => clamp_int($up['magnetDuration'] ?? 0, 0, 3),
            'dashPower' => clamp_int($up['dashPower'] ?? 0, 0, 3),
            'doubleCarrot' => clamp_int($up['doubleCarrot'] ?? 0, 0, 3),
        ],
    ];
}

function public_user(array $u): array
{
    $p = sanitize_progress($u['progress'] ?? []);
    $p['levelStars'] = (object)$p['levelStars'];
    return ['username' => $u['username'], 'progress' => $p];
}

function issue_token(array &$db, string $key): string
{
    $token = bin2hex(random_bytes(24));
    $hash = hash('sha256', $token);
    $db['tokens'][$hash] = $key;
    if (!isset($db['users'][$key]['tokens']) || !is_array($db['users'][$key]['tokens'])) {
        $db['users'][$key]['tokens'] = [];
    }
    $db['users'][$key]['tokens'][] = $hash;
    while (count($db['users'][$key]['tokens']) > MAX_TOKENS) {
        $old = array_shift($db['users'][$key]['tokens']);
        unset($db['tokens'][$old]);
    }
    return $token;
}

function user_key_from_token(array $db, $token): ?string
{
    if (!is_string($token) || !preg_match('/^[a-f0-9]{48}$/', $token)) {
        return null;
    }
    $hash = hash('sha256', $token);
    $key = $db['tokens'][$hash] ?? null;
    return (is_string($key) && isset($db['users'][$key])) ? $key : null;
}

function player_stats(array $u): array
{
    $p = sanitize_progress($u['progress'] ?? []);
    return [
        'username' => $u['username'],
        'stars' => array_sum($p['levelStars']),
        'level' => $p['unlockedLevel'],
        'carrots' => $p['totalCarrots'],
        'trophies' => $p['trophies'],
        'endless' => $p['endlessHighScore'],
        'char' => $p['equippedChar'],
        'board' => $p['equippedBoard'],
        'title' => $p['title'],
        'vip' => $p['vipPass'],
    ];
}

function cleanup_races(array &$db): void
{
    $now = time();
    if (!isset($db['races']) || !is_array($db['races'])) {
        $db['races'] = [];
        return;
    }
    foreach ($db['races'] as $rid => $race) {
        if (!is_array($race) || ($now - (int)($race['updatedAt'] ?? 0)) > RACE_TTL) {
            unset($db['races'][$rid]);
        }
    }
}

function build_clans_summary(array $db): array
{
    $clans = [];
    $clanStats = [];
    foreach ($db['users'] as $u) {
        if (!is_array($u)) continue;
        $p = sanitize_progress($u['progress'] ?? []);
        if ($p['clanId'] !== '') {
            if (!isset($clanStats[$p['clanId']])) {
                $clanStats[$p['clanId']] = ['members' => 0, 'trophies' => 0];
            }
            $clanStats[$p['clanId']]['members']++;
            $clanStats[$p['clanId']]['trophies'] += $p['trophies'];
        }
    }
    foreach ($db['clans'] as $cid => $c) {
        if (!is_array($c)) continue;
        $st = $clanStats[$cid] ?? ['members' => 0, 'trophies' => 0];
        if ($st['members'] <= 0) continue;
        $clans[] = [
            'id' => $cid,
            'name' => $c['name'] ?? $cid,
            'badge' => $c['badge'] ?? '🛡️',
            'leader' => $c['leader'] ?? '',
            'members' => $st['members'],
            'trophies' => $st['trophies'],
        ];
    }
    usort($clans, function ($a, $b) {
        return $b['trophies'] <=> $a['trophies'];
    });
    return array_slice($clans, 0, 30);
}

// ==================== ROUTER ====================
$action = isset($_GET['action']) ? (string)$_GET['action'] : '';
$method = $_SERVER['REQUEST_METHOD'] ?? 'GET';

if ($action === 'ping') {
    respond(['ok' => true, 'service' => 'arnouba', 'version' => 10]);
}

if ($action === 'leaderboard') {
    $res = db_transaction(function (array &$db, bool &$changed) {
        $list = [];
        foreach ($db['users'] as $u) {
            if (is_array($u) && isset($u['username'])) {
                $list[] = player_stats($u);
            }
        }
        $byStars = $list;
        usort($byStars, function ($a, $b) {
            if ($a['stars'] !== $b['stars']) return $b['stars'] <=> $a['stars'];
            if ($a['level'] !== $b['level']) return $b['level'] <=> $a['level'];
            return $b['carrots'] <=> $a['carrots'];
        });
        $byTrophies = $list;
        usort($byTrophies, function ($a, $b) {
            if ($a['trophies'] !== $b['trophies']) return $b['trophies'] <=> $a['trophies'];
            return $b['stars'] <=> $a['stars'];
        });
        $byEndless = $list;
        usort($byEndless, function ($a, $b) {
            if ($a['endless'] !== $b['endless']) return $b['endless'] <=> $a['endless'];
            return $b['carrots'] <=> $a['carrots'];
        });
        return [
            'ok' => true,
            'players' => array_slice($byStars, 0, 25),
            'trophies' => array_slice($byTrophies, 0, 25),
            'endless' => array_slice($byEndless, 0, 25),
            'clans' => build_clans_summary($db),
        ];
    });
    respond_result($res);
}

if ($method !== 'POST') {
    respond(['ok' => false, 'error' => 'Method not allowed'], 405);
}

$rawBody = file_get_contents('php://input', false, null, 0, 65536);
$in = json_decode(is_string($rawBody) && $rawBody !== '' ? $rawBody : '{}', true);
if (!is_array($in)) {
    $in = [];
}

switch ($action) {
    case 'register': {
        $username = trim((string)($in['username'] ?? ''));
        $password = (string)($in['password'] ?? '');
        if (!preg_match('/^[\p{L}\p{N}_]{3,20}$/u', $username)) {
            respond(['ok' => false, 'error' => 'اسم المستخدم لازم يكون من 3 لـ 20 حرف (حروف وأرقام و _ بس)'], 400);
        }
        if (strlen($password) < 4 || strlen($password) > 64) {
            respond(['ok' => false, 'error' => 'كلمة المرور لازم تكون من 4 لـ 64 حرف'], 400);
        }
        $res = db_transaction(function (array &$db, bool &$changed) use ($username, $password) {
            $key = lower_name($username);
            if (isset($db['users'][$key])) {
                return ['ok' => false, 'error' => 'اسم المستخدم ده محجوز، جرّب اسم تاني', 'code' => 409];
            }
            if (count($db['users']) >= MAX_USERS) {
                return ['ok' => false, 'error' => 'التسجيل مقفول مؤقتاً', 'code' => 503];
            }
            $db['users'][$key] = [
                'username' => $username,
                'hash' => password_hash($password, PASSWORD_DEFAULT),
                'created' => time(),
                'lastLogin' => time(),
                'progress' => default_progress(),
                'tokens' => [],
                'fails' => 0,
                'lockUntil' => 0,
            ];
            $token = issue_token($db, $key);
            $changed = true;
            return ['ok' => true, 'token' => $token, 'user' => public_user($db['users'][$key])];
        });
        respond_result($res);
    }

    case 'login': {
        $username = trim((string)($in['username'] ?? ''));
        $password = (string)($in['password'] ?? '');
        if ($username === '' || $password === '') {
            respond(['ok' => false, 'error' => 'اكتب اسم المستخدم وكلمة المرور'], 400);
        }
        $res = db_transaction(function (array &$db, bool &$changed) use ($username, $password) {
            $key = lower_name($username);
            if (!isset($db['users'][$key])) {
                return ['ok' => false, 'error' => 'اسم المستخدم أو كلمة المرور غلط', 'code' => 401];
            }
            $u = &$db['users'][$key];
            if ((int)($u['lockUntil'] ?? 0) > time()) {
                $mins = (int)ceil(((int)$u['lockUntil'] - time()) / 60);
                return ['ok' => false, 'error' => "محاولات كتير غلط، جرّب تاني بعد {$mins} دقيقة", 'code' => 429];
            }
            if (!password_verify($password, (string)$u['hash'])) {
                $u['fails'] = (int)($u['fails'] ?? 0) + 1;
                if ($u['fails'] >= MAX_FAILS) {
                    $u['lockUntil'] = time() + LOCK_SECONDS;
                    $u['fails'] = 0;
                }
                $changed = true;
                return ['ok' => false, 'error' => 'اسم المستخدم أو كلمة المرور غلط', 'code' => 401];
            }
            if (password_needs_rehash((string)$u['hash'], PASSWORD_DEFAULT)) {
                $u['hash'] = password_hash($password, PASSWORD_DEFAULT);
            }
            $u['fails'] = 0;
            $u['lockUntil'] = 0;
            $u['lastLogin'] = time();
            $token = issue_token($db, $key);
            $changed = true;
            return ['ok' => true, 'token' => $token, 'user' => public_user($db['users'][$key])];
        });
        respond_result($res);
    }

    case 'me': {
        $token = $in['token'] ?? '';
        $res = db_transaction(function (array &$db, bool &$changed) use ($token) {
            $key = user_key_from_token($db, $token);
            if ($key === null) {
                return ['ok' => false, 'error' => 'انتهت الجلسة، سجّل دخول تاني', 'code' => 401];
            }
            return ['ok' => true, 'user' => public_user($db['users'][$key])];
        });
        respond_result($res);
    }

    case 'save': {
        $token = $in['token'] ?? '';
        $progress = sanitize_progress($in['progress'] ?? []);
        $res = db_transaction(function (array &$db, bool &$changed) use ($token, $progress) {
            $key = user_key_from_token($db, $token);
            if ($key === null) {
                return ['ok' => false, 'error' => 'انتهت الجلسة، سجّل دخول تاني', 'code' => 401];
            }
            $db['users'][$key]['progress'] = $progress;
            $db['users'][$key]['updated'] = time();
            $changed = true;
            return ['ok' => true];
        });
        respond_result($res);
    }

    case 'redeem_code': {
        $token = $in['token'] ?? '';
        $code = strtoupper(trim((string)($in['code'] ?? '')));
        $codes = promo_codes();
        if ($code === '' || !isset($codes[$code])) {
            respond(['ok' => false, 'error' => 'كود الهدية غير صحيح أو منتهي الصلاحية']);
        }
        $reward = $codes[$code];
        $res = db_transaction(function (array &$db, bool &$changed) use ($token, $code, $reward) {
            $key = user_key_from_token($db, $token);
            if ($key === null) {
                return ['ok' => false, 'error' => 'انتهت الجلسة، سجّل دخول تاني', 'code' => 401];
            }
            $p = sanitize_progress($db['users'][$key]['progress'] ?? []);
            if (in_array($code, $p['redeemedCodes'], true)) {
                return ['ok' => false, 'error' => 'استخدمت الكود ده قبل كده بالفعل!'];
            }
            $p['redeemedCodes'][] = $code;
            $p['gems'] += $reward['gems'];
            $p['bankCarrots'] += $reward['carrots'];
            $p['totalCarrots'] += $reward['carrots'];
            $db['users'][$key]['progress'] = $p;
            $db['users'][$key]['updated'] = time();
            $changed = true;
            return [
                'ok' => true,
                'reward' => $reward,
                'user' => public_user($db['users'][$key]),
            ];
        });
        respond_result($res);
    }

    case 'topup': {
        $token = $in['token'] ?? '';
        $pkgId = trim((string)($in['packageId'] ?? ''));
        $methodLabel = trim((string)($in['method'] ?? 'instant'));
        $packages = topup_packages();
        if (!isset($packages[$pkgId])) {
            respond(['ok' => false, 'error' => 'باقة الشحن غير معروفة']);
        }
        $pkg = $packages[$pkgId];
        $res = db_transaction(function (array &$db, bool &$changed) use ($token, $pkgId, $pkg, $methodLabel) {
            $key = user_key_from_token($db, $token);
            if ($key === null) {
                return ['ok' => false, 'error' => 'انتهت الجلسة، سجّل دخول تاني', 'code' => 401];
            }
            $p = sanitize_progress($db['users'][$key]['progress'] ?? []);
            $p['gems'] += $pkg['gems'];
            $p['bankCarrots'] += $pkg['bonusCarrots'];
            $p['totalCarrots'] += $pkg['bonusCarrots'];
            if (!empty($pkg['vip'])) {
                $p['vipPass'] = true;
            }
            $p['topupHistory'][] = [
                'pkg' => $pkgId,
                'gems' => $pkg['gems'],
                'method' => substr($methodLabel, 0, 24),
                'at' => time(),
            ];
            if (count($p['topupHistory']) > 15) {
                $p['topupHistory'] = array_slice($p['topupHistory'], -15);
            }
            $db['users'][$key]['progress'] = $p;
            $db['users'][$key]['updated'] = time();
            $changed = true;
            return [
                'ok' => true,
                'addedGems' => $pkg['gems'],
                'addedCarrots' => $pkg['bonusCarrots'],
                'vipUnlocked' => !empty($pkg['vip']),
                'user' => public_user($db['users'][$key]),
            ];
        });
        respond_result($res);
    }

    case 'race_join': {
        $token = $in['token'] ?? '';
        $mode = in_array(($in['mode'] ?? 'quick'), ['quick', 'gems', 'private'], true) ? (string)$in['mode'] : 'quick';
        $roomCode = strtoupper(preg_replace('/[^A-Z0-9]/', '', strtoupper((string)($in['roomCode'] ?? ''))));
        $res = db_transaction(function (array &$db, bool &$changed) use ($token, $mode, $roomCode) {
            $key = user_key_from_token($db, $token);
            if ($key === null) {
                return ['ok' => false, 'error' => 'انتهت الجلسة، سجّل دخول تاني', 'code' => 401];
            }
            cleanup_races($db);
            $u = $db['users'][$key];
            $p = sanitize_progress($u['progress'] ?? []);

            if ($mode === 'gems' && $p['gems'] < 20) {
                return ['ok' => false, 'error' => 'محتاج 20 جوهرة 💎 لدخول سباق الجواهر المضاعف'];
            }

            $now = time();
            $targetRid = '';

            if ($mode === 'private') {
                if ($roomCode === '') {
                    $roomCode = substr(strtoupper(bin2hex(random_bytes(3))), 0, 6);
                }
                foreach ($db['races'] as $rid => $r) {
                    if (($r['mode'] ?? '') === 'private' && ($r['roomCode'] ?? '') === $roomCode && count($r['players']) < 4) {
                        $targetRid = $rid;
                        break;
                    }
                }
            } else {
                foreach ($db['races'] as $rid => $r) {
                    if (($r['mode'] ?? '') === $mode && ($r['status'] ?? 'open') === 'open' && count($r['players']) < 4 && ($now - (int)$r['createdAt']) < 25) {
                        $targetRid = $rid;
                        break;
                    }
                }
            }

            if ($targetRid === '') {
                $targetRid = 'race_' . bin2hex(random_bytes(5));
                $db['races'][$targetRid] = [
                    'id' => $targetRid,
                    'mode' => $mode,
                    'roomCode' => $roomCode,
                    'status' => 'open',
                    'createdAt' => $now,
                    'updatedAt' => $now,
                    'seed' => random_int(1000, 999999),
                    'players' => [],
                ];
            }

            $db['races'][$targetRid]['players'][$key] = [
                'username' => $u['username'],
                'char' => $p['equippedChar'],
                'board' => $p['equippedBoard'],
                'pet' => $p['equippedPet'],
                'title' => $p['title'],
                'trophies' => $p['trophies'],
                'pct' => 0,
                'emote' => '',
                'emoteAt' => 0,
                'finished' => false,
                'updatedAt' => $now,
            ];
            $db['races'][$targetRid]['updatedAt'] = $now;

            // Gather real ghost profiles from top players to fill up to 4 racers
            $ghosts = [];
            foreach ($db['users'] as $uk => $ou) {
                if ($uk === $key || isset($db['races'][$targetRid]['players'][$uk])) continue;
                if (!is_array($ou) || empty($ou['username'])) continue;
                $op = sanitize_progress($ou['progress'] ?? []);
                $ghosts[] = [
                    'username' => $ou['username'],
                    'char' => $op['equippedChar'],
                    'board' => $op['equippedBoard'],
                    'pet' => $op['equippedPet'],
                    'trophies' => $op['trophies'],
                ];
                if (count($ghosts) >= 6) break;
            }

            $changed = true;
            return [
                'ok' => true,
                'raceId' => $targetRid,
                'mode' => $mode,
                'roomCode' => $db['races'][$targetRid]['roomCode'],
                'seed' => $db['races'][$targetRid]['seed'],
                'players' => array_values($db['races'][$targetRid]['players']),
                'ghostPool' => $ghosts,
            ];
        });
        respond_result($res);
    }

    case 'race_state': {
        $token = $in['token'] ?? '';
        $raceId = trim((string)($in['raceId'] ?? ''));
        $pct = max(0.0, min(100.0, (float)($in['pct'] ?? 0)));
        $emote = safe_sub(trim((string)($in['emote'] ?? '')), 6);
        $finished = !empty($in['finished']);
        $res = db_transaction(function (array &$db, bool &$changed) use ($token, $raceId, $pct, $emote, $finished) {
            $key = user_key_from_token($db, $token);
            if ($key === null) {
                return ['ok' => false, 'error' => 'انتهت الجلسة', 'code' => 401];
            }
            if (!isset($db['races'][$raceId])) {
                return ['ok' => false, 'error' => 'الغرفة انتهت'];
            }
            $now = time();
            $race = &$db['races'][$raceId];
            if (isset($race['players'][$key])) {
                $race['players'][$key]['pct'] = $pct;
                $race['players'][$key]['finished'] = $finished;
                $race['players'][$key]['updatedAt'] = $now;
                if ($emote !== '') {
                    $race['players'][$key]['emote'] = $emote;
                    $race['players'][$key]['emoteAt'] = $now;
                }
            }
            $race['updatedAt'] = $now;
            $changed = true;
            return [
                'ok' => true,
                'players' => array_values($race['players']),
            ];
        });
        respond_result($res);
    }

    case 'race_finish': {
        $token = $in['token'] ?? '';
        $raceId = trim((string)($in['raceId'] ?? ''));
        $rank = clamp_int($in['rank'] ?? 4, 1, 4);
        $res = db_transaction(function (array &$db, bool &$changed) use ($token, $raceId, $rank) {
            $key = user_key_from_token($db, $token);
            if ($key === null) {
                return ['ok' => false, 'error' => 'انتهت الجلسة', 'code' => 401];
            }
            if (isset($db['races'][$raceId]['players'][$key])) {
                $db['races'][$raceId]['players'][$key]['pct'] = 100;
                $db['races'][$raceId]['players'][$key]['finished'] = true;
                $db['races'][$raceId]['players'][$key]['rank'] = $rank;
                $db['races'][$raceId]['updatedAt'] = time();
                $changed = true;
            }
            return ['ok' => true];
        });
        respond_result($res);
    }

    case 'clan_action': {
        $token = $in['token'] ?? '';
        $sub = trim((string)($in['subAction'] ?? ''));
        $res = db_transaction(function (array &$db, bool &$changed) use ($token, $sub, $in) {
            $key = user_key_from_token($db, $token);
            if ($key === null) {
                return ['ok' => false, 'error' => 'انتهت الجلسة، سجّل دخول تاني', 'code' => 401];
            }
            $p = sanitize_progress($db['users'][$key]['progress'] ?? []);
            if ($sub === 'create') {
                $name = trim((string)($in['name'] ?? ''));
                $badge = trim((string)($in['badge'] ?? '🛡️'));
                if (safe_len($name) < 3 || safe_len($name) > 24) {
                    return ['ok' => false, 'error' => 'اسم العشيرة لازم يكون من 3 لـ 24 حرف'];
                }
                if ($p['clanId'] !== '') {
                    return ['ok' => false, 'error' => 'أنت منضم لعشيرة بالفعل، غادرها أولاً'];
                }
                if ($p['bankCarrots'] < 1000) {
                    return ['ok' => false, 'error' => 'إنشاء عشيرة يتطلب 1000 جزرة 🥕'];
                }
                $cid = 'clan_' . bin2hex(random_bytes(4));
                $db['clans'][$cid] = [
                    'name' => $name,
                    'badge' => safe_sub($badge, 4) ?: '🛡️',
                    'leader' => $db['users'][$key]['username'],
                    'createdAt' => time(),
                ];
                $p['bankCarrots'] -= 1000;
                $p['clanId'] = $cid;
            } elseif ($sub === 'join') {
                $cid = trim((string)($in['clanId'] ?? ''));
                if ($cid === '' || !isset($db['clans'][$cid])) {
                    return ['ok' => false, 'error' => 'العشيرة غير موجودة'];
                }
                $p['clanId'] = $cid;
            } elseif ($sub === 'leave') {
                $p['clanId'] = '';
            } else {
                return ['ok' => false, 'error' => 'عملية غير صالحة'];
            }
            $db['users'][$key]['progress'] = $p;
            $db['users'][$key]['updated'] = time();
            $changed = true;
            return [
                'ok' => true,
                'user' => public_user($db['users'][$key]),
                'clans' => build_clans_summary($db),
            ];
        });
        respond_result($res);
    }

    case 'logout': {
        $token = $in['token'] ?? '';
        $res = db_transaction(function (array &$db, bool &$changed) use ($token) {
            $key = user_key_from_token($db, $token);
            if ($key !== null) {
                $hash = hash('sha256', (string)$token);
                unset($db['tokens'][$hash]);
                $db['users'][$key]['tokens'] = array_values(array_filter(
                    (array)($db['users'][$key]['tokens'] ?? []),
                    function ($h) use ($hash) { return $h !== $hash; }
                ));
                $changed = true;
            }
            return ['ok' => true];
        });
        respond_result($res);
    }

    default:
        respond(['ok' => false, 'error' => 'Unknown action'], 400);
}
