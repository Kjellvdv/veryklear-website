import { defineConfig } from 'astro/config';
import sitemap from '@astrojs/sitemap';
import { REDIRECTS } from './src/redirects.js';

export default defineConfig({
  // www.veryklear.com is the canonical home since 2026-10-14. The site is served by
  // server/ on Railway, which only takes a CNAME, and SiteGround's DNS can't alias
  // the bare domain, so veryklear.com and veryklear.be 301 here from SiteGround.
  // Canonicals, og:url, the share images and the sitemap all derive from this.
  site: 'https://www.veryklear.com',
  // One URL per page, without trailing slash: links are written that way, and
  // server/pages.ts 301s the slashed form. The sitemap follows this setting.
  trailingSlash: 'never',
  // Retired URLs: the server 301s them, Astro builds stubs from the same map.
  redirects: REDIRECTS,
  integrations: [sitemap()],
});
