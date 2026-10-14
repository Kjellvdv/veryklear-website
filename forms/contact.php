<?php
/*
 * Very Klear contact form handler.
 *
 * Lives on SiteGround at https://forms.veryklear.com/contact.php (see README.md
 * next to this file). The contact page on veryklear.com posts JSON here in the
 * background; this script checks it and mails it to the inbox below.
 *
 * Sending: it logs in to a real mailbox over SMTP (settings in
 * contact-config.php, which lives on the server only, one folder above
 * public_html). PHP's own mail() turned out to be silently dropped by
 * SiteGround (2026-10-07), so it is only a fallback when no config is found.
 *
 * It is not part of the Astro build and is not deployed by GitHub Actions.
 * After changing it, upload it again through SiteGround's File Manager.
 */

const TO_ADDRESS = 'kjell@veryklear.be';
const ALLOWED_ORIGINS = [
    'https://veryklear.com',
    'https://www.veryklear.com',
    'http://localhost:4321',   // local preview
    'http://localhost:4324',
    'http://localhost:3011',   // the built site served by server/ (npm run serve)
];
const MAX_PER_HOUR = 5;        // per IP address
const MAX_PER_HOUR_ALL = 30;   // across all visitors, so a flood can't fill the inbox
const MAX_BODY_BYTES = 40000;  // a real message is a few KB

// SMTP settings: SMTP_HOST, SMTP_PORT, SMTP_SECURE ('ssl' or 'tls'), SMTP_USER, SMTP_PASS.
$configUsed = '';
foreach ([__DIR__ . '/../contact-config.php', __DIR__ . '/contact-config.php'] as $config) {
    if (is_file($config)) { require $config; $configUsed = realpath($config); break; }
}

header('Content-Type: application/json; charset=utf-8');
header('X-Content-Type-Options: nosniff');
// A JSON endpoint is never meant to be framed or to load anything.
header('X-Frame-Options: DENY');
header("Content-Security-Policy: default-src 'none'; frame-ancestors 'none'");

$origin = $_SERVER['HTTP_ORIGIN'] ?? '';
if (in_array($origin, ALLOWED_ORIGINS, true)) {
    header('Access-Control-Allow-Origin: ' . $origin);
    header('Vary: Origin');
    header('Access-Control-Allow-Methods: POST, OPTIONS');
    header('Access-Control-Allow-Headers: Content-Type, Accept');
}

function reply(int $status, bool $ok, string $message = ''): void {
    http_response_code($status);
    echo json_encode(['success' => $ok, 'message' => $message]);
    exit;
}

/*
 * Minimal SMTP client: connect, log in, send one message, quit.
 * Returns '' on success, or the server's error line.
 */
function smtp_send(string $from, string $to, string $data): string {
    $secure = defined('SMTP_SECURE') ? SMTP_SECURE : 'ssl';
    $host = ($secure === 'ssl' ? 'ssl://' : '') . SMTP_HOST;
    $port = defined('SMTP_PORT') ? SMTP_PORT : 465;
    $fp = @stream_socket_client("$host:$port", $errno, $errstr, 15);
    if (!$fp) return "connect: $errstr ($errno)";
    stream_set_timeout($fp, 15);

    $read = function () use ($fp): string {
        $out = '';
        while (($line = fgets($fp, 515)) !== false) {
            $out .= $line;
            if (strlen($line) < 4 || $line[3] === ' ') break;  // last line of a reply
        }
        return $out;
    };
    $cmd = function (string $line, int $expect) use ($fp, $read): string {
        if ($line !== '') fwrite($fp, $line . "\r\n");
        $res = $read();
        return ((int) substr($res, 0, 3) === $expect) ? '' : trim($res);
    };

    $helo = gethostname() ?: 'forms.veryklear.com';
    if ($e = $cmd('', 220)) return $e;
    if ($e = $cmd("EHLO $helo", 250)) return $e;
    if ($secure === 'tls') {
        if ($e = $cmd('STARTTLS', 220)) return $e;
        if (!stream_socket_enable_crypto($fp, true, STREAM_CRYPTO_METHOD_TLS_CLIENT)) return 'starttls failed';
        if ($e = $cmd("EHLO $helo", 250)) return $e;
    }
    // Log in: AUTH LOGIN first, AUTH PLAIN if that is refused.
    $loginError = '';
    if (!($e = $cmd('AUTH LOGIN', 334)) && !($e = $cmd(base64_encode(SMTP_USER), 334))) {
        $e = $cmd(base64_encode(SMTP_PASS), 235);
    }
    if ($e) {
        $loginError = $e;
        $e = $cmd('AUTH PLAIN ' . base64_encode("\0" . SMTP_USER . "\0" . SMTP_PASS), 235);
    }
    if ($e) {
        // A short fingerprint lets you compare the password in this file with
        // another copy, without the password itself ever being shown.
        $fingerprint = substr(hash('sha256', SMTP_PASS), 0, 8) . ', ' . strlen(SMTP_PASS) . ' chars';
        return 'login failed for ' . SMTP_USER . " (password fingerprint $fingerprint): " . ($loginError ?: $e);
    }
    if ($e = $cmd("MAIL FROM:<$from>", 250)) return $e;
    if ($e = $cmd("RCPT TO:<$to>", 250)) return $e;
    if ($e = $cmd('DATA', 354)) return $e;
    // Dot-stuffing: a line starting with "." gets an extra "." in SMTP.
    $body = preg_replace('/^\./m', '..', str_replace(["\r\n", "\r"], "\n", $data));
    if ($e = $cmd(str_replace("\n", "\r\n", $body) . "\r\n.", 250)) return $e;
    $cmd('QUIT', 221);
    fclose($fp);
    return '';
}

if ($_SERVER['REQUEST_METHOD'] === 'OPTIONS') {
    reply(204, true);
}
if ($_SERVER['REQUEST_METHOD'] !== 'POST') {
    reply(405, false, 'POST only');
}
if (!in_array($origin, ALLOWED_ORIGINS, true)) {
    reply(403, false, 'Origin not allowed');
}

// Read one byte past the cap, so an oversized body is refused instead of being
// cut off into something that still parses.
$raw = (string) file_get_contents('php://input', false, null, 0, MAX_BODY_BYTES + 1);
if (strlen($raw) > MAX_BODY_BYTES) {
    reply(413, false, 'Request too large');
}
$data = json_decode($raw, true);
if (!is_array($data)) {
    reply(400, false, 'Invalid request');
}

// Honeypot: real visitors never see or tick this box. Pretend it worked.
if (!empty($data['botcheck'])) {
    reply(200, true);
}

// Per-IP and site-wide limits, kept in small files one folder above public_html,
// next to the config. Shared hosting means a shared /tmp, where another tenant
// could plant a file that locks the form. A hit is only recorded after the mail
// went out, so a broken mail server doesn't lock real visitors out.
$ip = $_SERVER['REMOTE_ADDR'] ?? 'unknown';
$stateDir = __DIR__ . '/../vk-form-state';
if (!is_dir($stateDir) && !@mkdir($stateDir, 0700)) {
    $stateDir = sys_get_temp_dir();  // fallback, should not happen on SiteGround
}
$ipBucket = $stateDir . '/vk-form-' . md5($ip);
$allBucket = $stateDir . '/vk-form-all';
// Timestamps in the future are ignored too, so a planted file can't block forever.
$recentHits = function (string $file): array {
    $hits = is_file($file) ? (array) json_decode((string) file_get_contents($file), true) : [];
    return array_values(array_filter($hits, fn($t) => is_int($t) && $t > time() - 3600 && $t <= time()));
};
$ipHits = $recentHits($ipBucket);
$allHits = $recentHits($allBucket);
if (count($ipHits) >= MAX_PER_HOUR || count($allHits) >= MAX_PER_HOUR_ALL) {
    reply(429, false, 'Too many messages');
}

// Control characters (CR, LF, NUL and friends) never belong in a name or an
// address, and a line break in a mail header would let a visitor add headers.
// Anything that isn't a string, such as an array, counts as empty.
$clean = fn($v, $max) => trim(mb_substr(preg_replace('/[\x00-\x1F\x7F]+/', ' ', is_string($v) ? $v : ''), 0, $max));

$name    = $clean($data['name'] ?? '', 120);
$company = $clean($data['bedrijf'] ?? '', 120);
$email   = $clean($data['email'] ?? '', 160);
$topics  = $clean($data['onderwerp'] ?? '', 200);
// The message keeps its line breaks and tabs. Every other control character goes.
$message = is_string($data['bericht'] ?? null)
    ? trim(mb_substr(
        preg_replace('/[\x00-\x08\x0B\x0C\x0E-\x1F\x7F]/', '', str_replace(["\r\n", "\r"], "\n", $data['bericht'])),
        0,
        5000
    ))
    : '';

// FILTER_VALIDATE_EMAIL still accepts quoted local parts like "a>,<b"@x.com.
// Nobody mails a contact form from one, and it would confuse the Reply-To header.
$emailOk = filter_var($email, FILTER_VALIDATE_EMAIL) && !preg_match('/["<>,;\\\\\s]/', $email);
if ($name === '' || !$emailOk) {
    reply(422, false, 'Name and a valid e-mail are required');
}

$subject = 'Bericht via veryklear.com: ' . ($company !== '' ? $company : $name);
$lines = ["Naam: $name"];
if ($company !== '') $lines[] = "Bedrijf: $company";
$lines[] = "E-mail: $email";
if ($topics !== '') $lines[] = "Onderwerp: $topics";
$lines[] = '';
$lines[] = $message !== '' ? $message : '(geen bericht)';
$lines[] = '';
$lines[] = '--';
$lines[] = 'Verstuurd via het contactformulier op veryklear.com. Antwoorden gaat rechtstreeks naar de afzender.';
// Where it came from, so a test or spam message can be traced. The forwarded
// address is shown next to REMOTE_ADDR because behind SiteGround's proxy only
// one of them may be the visitor. Anyone can fake the forwarded one: a hint, not proof.
$fwd = $clean($_SERVER['HTTP_X_FORWARDED_FOR'] ?? ($_SERVER['HTTP_X_REAL_IP'] ?? ''), 100);
$lines[] = 'Verzonden op ' . date('c') . ' vanaf ' . $clean($ip, 45) . ($fwd !== '' ? " (doorgegeven: $fwd)" : '');
$lines[] = 'Browser: ' . $clean($_SERVER['HTTP_USER_AGENT'] ?? '', 200);
$text = implode("\n", $lines);

$fromAddress = defined('SMTP_USER') ? SMTP_USER : 'website@veryklear.com';
// mb_encode_mimeheader folds long values over several lines, which keeps each
// header line under the 76 characters mail servers expect. Our headers are joined
// with "\n", hence that as the line break; smtp_send turns it into CRLF.
$encodedSubject = mb_encode_mimeheader($subject, 'UTF-8', 'B', "\n", strlen('Subject: '));
// A quote, backslash or angle bracket in the name would end the display name
// early or fake a second address inside it. Non-ASCII names are encoded, since a
// raw UTF-8 display name isn't valid in a header.
$headerName = trim(str_replace(['"', '\\', '<', '>'], '', $name));
if ($headerName === '') {
    $replyTo = "<$email>";
} elseif (preg_match('/^[\x20-\x7E]+$/', $headerName)) {
    $replyTo = "\"$headerName\" <$email>";
} else {
    $replyTo = mb_encode_mimeheader($headerName, 'UTF-8', 'B', "\n", strlen('Reply-To: ')) . " <$email>";
}

if (defined('SMTP_HOST') && defined('SMTP_USER') && defined('SMTP_PASS')) {
    $headers = [
        'Date: ' . date('r'),
        'From: Very Klear website <' . $fromAddress . '>',
        'To: <' . TO_ADDRESS . '>',
        'Reply-To: ' . $replyTo,
        'Subject: ' . $encodedSubject,
        'Message-ID: <' . bin2hex(random_bytes(12)) . '@forms.veryklear.com>',
        'MIME-Version: 1.0',
        'Content-Type: text/plain; charset=utf-8',
        'Content-Transfer-Encoding: 8bit',
    ];
    $error = smtp_send($fromAddress, TO_ADDRESS, implode("\n", $headers) . "\n\n" . $text);
    if ($error !== '') {
        // The reason never contains the password: it's the server's reply or a
        // connection error. It goes to vk-form.log, one folder above public_html.
        $reason = mb_substr(preg_replace('/\s+/', ' ', $error), 0, 200) . ' [config: ' . $configUsed . ']';
        error_log('[vk-form] SMTP: ' . $reason);
        @file_put_contents(__DIR__ . '/../vk-form.log', date('c') . " SMTP: $reason\n", FILE_APPEND);
        reply(500, false, 'Mail could not be sent');  // details are in vk-form.log, not in public replies
    }
} else {
    // Fallback without SMTP settings. SiteGround drops these, so set up contact-config.php.
    $sent = mail(
        TO_ADDRESS,
        $encodedSubject,
        $text,
        implode("\r\n", [
            'From: Very Klear website <' . $fromAddress . '>',
            'Reply-To: ' . $replyTo,
            'Content-Type: text/plain; charset=utf-8',
            'Content-Transfer-Encoding: 8bit',
        ]),
        '-f' . $fromAddress
    );
    if (!$sent) {
        reply(500, false, 'Mail could not be sent');
    }
}

$ipHits[] = time();
$allHits[] = time();
@file_put_contents($ipBucket, json_encode($ipHits), LOCK_EX);
@file_put_contents($allBucket, json_encode($allHits), LOCK_EX);
reply(200, true);
