<?php
/*
 * Very Klear contact form handler.
 *
 * Lives on SiteGround at https://forms.veryklear.com/contact.php (see README.md
 * next to this file). The contact page on veryklear.com posts JSON here in the
 * background; this script checks it and mails it to the inbox below.
 *
 * It is not part of the Astro build and is not deployed by GitHub Actions.
 * After changing it, upload it again through SiteGround's File Manager.
 */

const TO_ADDRESS   = 'kjell@veryklear.be';
const FROM_ADDRESS = 'website@veryklear.com';   // covered by veryklear.com's SPF on SiteGround
const ALLOWED_ORIGINS = [
    'https://veryklear.com',
    'https://www.veryklear.com',
    'http://localhost:4321',   // local preview
    'http://localhost:4324',
];
const MAX_PER_HOUR = 5;        // per IP address

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

$headers = [
    'From: Very Klear website <' . FROM_ADDRESS . '>',
    'Reply-To: ' . ($name !== '' ? '"' . str_replace('"', '', $name) . '" ' : '') . "<$email>",
    'Content-Type: text/plain; charset=utf-8',
    'Content-Transfer-Encoding: 8bit',
];

$sent = mail(
    TO_ADDRESS,
    '=?UTF-8?B?' . base64_encode($subject) . '?=',
    implode("\n", $lines),
    implode("\r\n", $headers),
    '-f' . FROM_ADDRESS
);

if (!$sent) {
    reply(500, false, 'Mail could not be sent');
}

$hits[] = time();
@file_put_contents($bucket, json_encode(array_values($hits)));
reply(200, true);
