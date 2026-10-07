// Which pages get a share image, and what it says. The image for a page at
// /some/path is /og/some/path.png (the home page is /og/home.png); Base.astro
// links it. Titles come from the copy files, so they follow copy edits.
import { getCopy } from '../lib/copy.js';
import { getArticles, PILLARS, PILLAR_SLUG, PILLAR_COPY } from '../lib/articles.js';

const plain = (html = '') => html.replace(/<br\s*\/?>/g, ' ').replace(/<[^>]+>/g, '').replace(/\s+/g, ' ').trim();

export const ogPath = (pathname) => {
  const p = pathname.replace(/\/$/, '');
  return `/og/${p === '' ? 'home' : p.slice(1)}.png`;
};

export async function ogPages() {
  const home = await getCopy('home');
  const diensten = await getCopy('diensten');
  const fractioneel = await getCopy('fractioneel');
  const partners = await getCopy('partners');
  const contact = await getCopy('contact');
  const artikels = await getCopy('artikels');
  const privacy = await getCopy('privacy');
  const notFound = await getCopy('404');

  const pages = [
    { path: '/', title: plain(home.hero.title_html), label: 'Positionering, marketing strategie en AI' },
    { path: '/diensten', title: plain(diensten.hero.title_html), label: 'Diensten' },
    { path: '/fractioneel', title: plain(fractioneel.hero.title_html), label: 'Fractioneel' },
    { path: '/partners', title: plain(partners.hero.title_html), label: 'Partners' },
    { path: '/contact', title: contact.form.title, label: 'Contact' },
    { path: '/artikels', title: artikels.overview.title, label: 'Eén idee per artikel' },
    { path: '/privacy', title: privacy.hero.title, label: 'Privacy' },
    { path: '/404', title: notFound.title, label: '404' },
  ];
  for (const name of PILLARS) {
    const c = await getCopy(PILLAR_COPY[name]);
    pages.push({ path: `/${PILLAR_SLUG[name]}`, title: plain(c.hero.title_html), label: 'Diensten' });
    pages.push({ path: `/artikels/${PILLAR_SLUG[name]}`, title: `Artikels over ${name.split(' ').map((w) => (w === w.toUpperCase() ? w : w.toLowerCase())).join(' ')}`, label: 'Artikels' });
  }
  for (const post of await getArticles()) {
    pages.push({ path: `/artikels/${PILLAR_SLUG[post.data.category]}/${post.slug}`, title: post.data.title, label: `Artikel · ${post.data.category}` });
  }
  return pages;
}
