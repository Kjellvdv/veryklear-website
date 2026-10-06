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

export const pillarForSlug = (slug) => PILLARS.find((p) => PILLAR_SLUG[p] === slug);

// Lower-case a pillar name mid-sentence, keeping acronyms: "AI implementeren" -> "AI implementeren".
export const pillarLower = (name) => name.split(' ').map((w) => (w === w.toUpperCase() ? w : w.toLowerCase())).join(' ');

export const articleUrl = (post) => `/${PILLAR_SLUG[post.data.category]}/${post.slug}`;

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
