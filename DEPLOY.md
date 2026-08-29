# Deploying Very Klear

Static Astro build. No server, no CI. `npm run build` produces `dist/`, and
`dist/` is what gets uploaded.

## Where it runs

SiteGround, same as the current live site. That is why `public/.htaccess` exists
(Apache cache headers). GitHub Pages would ignore that file, and would mean
moving DNS away from hosting that is already paid for, so it is not worth it.

## Deploying

```
npm run build
```

Then upload the **contents** of `dist/` to the document root via SiteGround File
Manager or SFTP.

**Include `.htaccess`.** File Manager hides dotfiles by default. Turn on "show
hidden files" or the cache headers silently do not ship.

## Preview vs live

Right now the site is a **preview on veryklear.com** while veryklear.be still
serves the old site.

`src/layouts/Base.astro` has `const PREVIEW = true`. While that is true every
page ships `noindex, nofollow` and no canonical tag, so the preview cannot be
indexed and cannot compete with .be.

**Before going live on veryklear.be:**

1. Set `PREVIEW = false` in `src/layouts/Base.astro`.
2. `npm run build` and check: `grep -c noindex dist/index.html` must return 0,
   and `grep -c canonical dist/index.html` must return 1.
3. Upload.
4. Decide what .com does afterwards. Most likely a 301 to .be, so the two
   domains never serve the same content at once.

Kjell owns both domains. `astro.config.mjs` has `site: 'https://veryklear.be'`,
which is the intended permanent home and drives the canonical tags once preview
mode is off.

## Extra safety for the preview

SiteGround can password-protect a directory from cPanel. Worth switching on for
the .com preview: `noindex` stops search engines, a password stops everyone
else, and neither touches the code.
