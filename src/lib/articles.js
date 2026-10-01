import { getCollection } from 'astro:content';

export const PILLARS = ['Positionering', 'Marketing strategie', 'AI inzetten'];

// Anchor on /diensten for each pillar, used by article CTAs.
export const PILLAR_ANCHOR = {
  Positionering: 'positionering',
  'Marketing strategie': 'marketing-strategie',
  'AI inzetten': 'ai-inzetten',
};

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
