import { defineConfig } from 'astro/config';

export default defineConfig({
  // veryklear.com is the permanent home (2026-10-06). veryklear.be 301s to it
  // from SiteGround, so canonicals and redirect pages point at .com.
  site: 'https://veryklear.com',
  // GitHub Pages has no server redirects, so retired pages get a static
  // redirect page instead. These replace the old .htaccess rules (2026-10-01
  // restructure: three pillars, two paths).
  redirects: {
    '/strategie': '/diensten#marketing-strategie',
    '/automatisatie': '/diensten#ai-inzetten',
    '/websites': '/diensten',
    '/partners': '/diensten',
    '/strategiesessie': '/contact',
  },
});
