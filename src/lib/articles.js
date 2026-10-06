import { getCollection } from 'astro:content';

export const PILLARS = ['Positionering', 'Marketing strategie', 'AI implementeren'];

// Anchor on /diensten for each pillar, used by article CTAs.
export const PILLAR_ANCHOR = {
  Positionering: 'positionering',
  'Marketing strategie': 'marketing-strategie',
  'AI implementeren': 'ai-implementeren',
};

// Each pillar is a top-level section: /positionering, /marketing-strategie, /ai.
// The section index lists its artikels, and artikels live under it:
// /marketing-strategie/<slug>.
export const PILLAR_SLUG = {
  Positionering: 'positionering',
  'Marketing strategie': 'marketing-strategie',
  'AI implementeren': 'ai',
};

// Copy file for each pillar's dienst page: src/content/copy/<file>.yaml.
export const PILLAR_COPY = {
  Positionering: 'dienst-positionering',
  'Marketing strategie': 'dienst-marketing-strategie',
  'AI implementeren': 'dienst-ai-implementeren',
};

export const pillarUrl = (name) => `/${PILLAR_SLUG[name]}`;

export const pillarForSlug = (slug) => PILLARS.find((p) => PILLAR_SLUG[p] === slug);

// Lower-case a pillar name mid-sentence, keeping acronyms: "AI implementeren" -> "AI implementeren".
export const pillarLower = (name) => name.split(' ').map((w) => (w === w.toUpperCase() ? w : w.toLowerCase())).join(' ');

// Artikels live under /artikels/<pillar>/<slug>; the pillar's artikel list is
// /artikels/<pillar>. The bare /<pillar> URL is the dienst page.
export const articleUrl = (post) => `/artikels/${PILLAR_SLUG[post.data.category]}/${post.slug}`;
export const pillarArticlesUrl = (name) => `/artikels/${PILLAR_SLUG[name]}`;

export async function getArticles() {
  const posts = await getCollection('artikels', ({ data }) => !data.draft);
  return posts.sort((a, b) => b.data.published_at.getTime() - a.data.published_at.getTime());
}

export function readingMinutes(body = '') {
  const words = body.trim().split(/\s+/).filter(Boolean).length;
  return Math.max(1, Math.round(words / 220));
}

export function formatDate(date, month = 'short') {
  return date.toLocaleDateString('nl-BE', { day: 'numeric', month, year: 'numeric' });
}
