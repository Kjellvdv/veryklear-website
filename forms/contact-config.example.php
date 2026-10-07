<?php
/*
 * SMTP settings for contact.php. Copy this file to the server as
 * contact-config.php, ONE FOLDER ABOVE public_html (so it can never be opened
 * in a browser), and fill in the real values. Never commit the real file.
 *
 * The values come from Site Tools → Email → Accounts → (the mailbox) →
 * Mail Configuration → "Manual settings", outgoing server (SMTP).
 */

const SMTP_HOST   = 'mail.veryklear.be';   // outgoing server name from Mail Configuration
const SMTP_PORT   = 465;                   // 465 with 'ssl', or 587 with 'tls'
const SMTP_SECURE = 'ssl';
const SMTP_USER   = 'website@veryklear.be'; // the mailbox you created for the form
const SMTP_PASS   = 'PASTE-THE-MAILBOX-PASSWORD-HERE';
