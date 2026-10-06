# Deploying Very Klear

Static Astro build, deployed by GitHub Actions to GitHub Pages on every push to
`main`. Same setup as kjellv-website. `.github/workflows/deploy.yml` does the
work; there is nothing to upload by hand.

## Domains

- **veryklear.com** is the live home (decided 2026-10-06). `public/CNAME` holds
  it, and it ships inside `dist/` so later deploys keep the custom domain bound.
- **veryklear.be** 301-redirects to .com from SiteGround (Site Tools, Domain >
  Redirects), keeping the path. Its MX records stay on SiteGround, so
  `kjell@veryklear.be` keeps working.

## DNS for veryklear.com

Apex A records to GitHub Pages:

```
185.199.108.153
185.199.109.153
185.199.110.153
185.199.111.153
```

Optionally `www` as a CNAME to `kjellvdv.github.io`. Then in the repo's Settings >
Pages: source "GitHub Actions", custom domain `veryklear.com`, and tick
"Enforce HTTPS" once the certificate is issued.

## Redirects

GitHub Pages ignores `.htaccess`, so retired URLs (/strategie, /automatisatie,
/websites, /partners, /strategiesessie) are static redirect pages generated from
`redirects` in `astro.config.mjs`. Add new ones there.

## Preview mode

`src/layouts/Base.astro` has `const PREVIEW`. It is `false` now. Setting it to
`true` makes every page ship `noindex, nofollow` and no canonical tag. After a
build, `grep -c noindex dist/index.html` should be 0 and
`grep -c canonical dist/index.html` should be 1.
