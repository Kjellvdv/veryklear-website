import { defineConfig } from 'astro/config';

export default defineConfig({
  // veryklear.com is the permanent home (2026-10-06). veryklear.be 301s to it
  // from SiteGround, so canonicals and redirect pages point at .com.
  site: 'https://veryklear.com',
  // GitHub Pages has no server redirects, so retired pages get a static
  // redirect page instead. These replace the old .htaccess rules (2026-10-01
  // restructure: three pillars, two paths).
  redirects: {
    '/strategie': '/marketing-strategie',
    '/automatisatie': '/ai',
    '/websites': '/diensten',
    // /marketing was the pillar's first slug, live for a few hours on 2026-10-06.
    '/marketing': '/marketing-strategie',
    // Artikels moved from /<pillar>/<slug> to /artikels/<pillar>/<slug> (2026-10-06).
    '/marketing-strategie/een-kanaal-erbij-is-zelden-het-antwoord': '/artikels/marketing-strategie/een-kanaal-erbij-is-zelden-het-antwoord',
  },
});
