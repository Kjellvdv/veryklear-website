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

## What it does

- Only accepts posts from veryklear.com (and the local preview).
- Drops bots that tick the hidden `botcheck` field.
- Allows 5 messages per hour per IP address.
- Sends from `website@veryklear.com` with Reply-To set to the visitor, so
  hitting reply in your mail answers them directly.

To change the inbox, edit `TO_ADDRESS` at the top of `contact.php`.
