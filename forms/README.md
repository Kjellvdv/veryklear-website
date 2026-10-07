# Contact form backend

`veryklear.com` runs on GitHub Pages, which can't run code, so the contact form
posts to a small PHP script on SiteGround instead: `contact.php` in this folder,
served at `https://forms.veryklear.com/contact.php`. It mails each message to
kjell@veryklear.be. No outside service, no account, no key.

This folder is not part of the Astro build and GitHub Actions doesn't deploy it.
After changing `contact.php`, upload it again by hand (step 3).

## One-time setup on SiteGround

1. **Create the subdomain.** Site Tools for the site that holds veryklear.com,
   then Domain → Subdomains. Create `forms`. SiteGround adds the DNS record and a
   folder for it (usually `forms.veryklear.com/public_html`).
   If veryklear.com isn't a site in your SiteGround account (only its DNS is
   there), add `forms.veryklear.com` as a new site instead: Websites → New
   website → existing domain. GrowBig allows more than one site.
2. **Turn on HTTPS.** Security → SSL Manager → install a free Let's Encrypt
   certificate for `forms.veryklear.com`. The form won't post to plain http.
3. **Upload the script.** Site Tools → Site → File Manager, open the
   subdomain's `public_html` folder, upload `contact.php`.
4. **Check it.** Open https://forms.veryklear.com/contact.php in a browser. You
   should see `{"success":false,"message":"POST only"}`. That means it works.
   Then send a test message from https://veryklear.com/contact.

## Sending through a mailbox (required)

PHP's built-in `mail()` gets silently dropped on SiteGround (found 2026-10-07:
the script reported success, nothing arrived). So the script logs in to a real
mailbox and sends over SMTP, like a mail app.

1. **Create the mailbox.** Site Tools → Email → Accounts → create
   `website@veryklear.be` with a strong password.
2. **Look up the outgoing server.** Same page, on that mailbox: ⋮ → Mail
   Configuration → Manual settings. Note the outgoing (SMTP) server name and
   port (465 with SSL).
3. **Make the settings file.** Copy `contact-config.example.php` to a file named
   `contact-config.php` and fill in the server, port and password.
4. **Upload it one folder above `public_html`** of the forms subdomain, so it
   can never be opened in a browser. (Next to `contact.php` also works, as a
   fallback, but above is safer.) Never commit the real file; `.gitignore`
   already excludes it.
5. **Upload the new `contact.php`** over the old one in `public_html`.
6. **Test** by sending a message from https://veryklear.com/contact.

If sending fails, the visitor sees the error pop-up and the reason lands in the
site's PHP error log (Site Tools → Statistics → Error Log), starting with `[vk-form]`.

## What it does

- Only accepts posts from veryklear.com (and the local preview).
- Drops bots that tick the hidden `botcheck` field.
- Allows 5 messages per hour per IP address.
- Sends from the form mailbox (`website@veryklear.be`) with Reply-To set to
  the visitor, so hitting reply in your mail answers them directly.

To change the inbox, edit `TO_ADDRESS` at the top of `contact.php`.
