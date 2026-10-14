// Retired URLs and where they go. The server answers these with a real 301
// (server/pages.ts). Astro builds a meta-refresh stub for each from the same map
// (astro.config.mjs), which only matters when dist/ is served by something else.
// Add new ones here, nowhere else.
export const REDIRECTS = {
  '/strategie': '/marketing-strategie',
  '/automatisatie': '/ai',
  '/websites': '/diensten',
  // /marketing was the pillar's first slug, live for a few hours on 2026-10-06.
  '/marketing': '/marketing-strategie',
  // Artikels moved from /<pillar>/<slug> to /artikels/<pillar>/<slug> (2026-10-06).
  '/marketing-strategie/een-kanaal-erbij-is-zelden-het-antwoord': '/artikels/marketing-strategie/een-kanaal-erbij-is-zelden-het-antwoord',
};
