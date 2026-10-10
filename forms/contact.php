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
];
const MAX_PER_HOUR = 5;        // per IP address

// SMTP settings: SMTP_HOST, SMTP_PORT, SMTP_SECURE ('ssl' or 'tls'), SMTP_USER, SMTP_PASS.
$configUsed = '';
foreach ([__DIR__ . '/../contact-config.php', __DIR__ . '/contact-config.php'] as $config) {
    if (is_file($config)) { require $config; $configUsed = realpath($config); break; }
}

header('Content-Type: application/json; charset=utf-8');
header('X-Content-Type-Options: nosniff');

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
        $fp = substr(hash('sha256', SMTP_PASS), 0, 8) . ', ' . strlen(SMTP_PASS) . ' chars';
        return 'login failed for ' . SMTP_USER . " (password fingerprint $fp): " . ($loginError ?: $e);
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

$data = json_decode(file_get_contents('php://input') ?: '', true);
if (!is_array($data)) {
    reply(400, false, 'Invalid request');
}

// Honeypot: real visitors never see or tick this box. Pretend it worked.
if (!empty($data['botcheck'])) {
    reply(200, true);
}

// Simple per-IP limit, kept in a small file in the server's temp folder.
$ip = $_SERVER['REMOTE_ADDR'] ?? 'unknown';
$bucket = sys_get_temp_dir() . '/vk-form-' . md5($ip);
$hits = array_filter(
    is_file($bucket) ? (array) json_decode((string) file_get_contents($bucket), true) : [],
    fn($t) => $t > time() - 3600
);
if (count($hits) >= MAX_PER_HOUR) {
    reply(429, false, 'Too many messages');
}

// Strip line breaks from anything that ends up in a mail header.
$clean = fn($v, $max) => trim(mb_substr(str_replace(["\r", "\n"], ' ', (string) ($v ?? '')), 0, $max));

$name    = $clean($data['name'] ?? '', 120);
$company = $clean($data['bedrijf'] ?? '', 120);
$email   = $clean($data['email'] ?? '', 160);
$topics  = $clean($data['onderwerp'] ?? '', 200);
$message = trim(mb_substr((string) ($data['bericht'] ?? ''), 0, 5000));

if ($name === '' || !filter_var($email, FILTER_VALIDATE_EMAIL)) {
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
$text = implode("\n", $lines);

$fromAddress = defined('SMTP_USER') ? SMTP_USER : 'website@veryklear.com';
$encodedSubject = '=?UTF-8?B?' . base64_encode($subject) . '?=';
$replyTo = '"' . str_replace('"', '', $name) . "\" <$email>";

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

$hits[] = time();
@file_put_contents($bucket, json_encode(array_values($hits)));
reply(200, true);
