// Share images (og:image) in the site's visual style: red gradient, white
// lockup, one heavy Inter headline, and the 60.5° parallelogram from the
// section device. Rendered at build time with satori + resvg, so new pages and
// artikels get one automatically.
import fs from 'node:fs';
import path from 'node:path';

// Read from the project root: at build time this module runs from a bundle in dist/.
const src = (f) => path.join(process.cwd(), 'src', f);
import satori from 'satori';
import { Resvg } from '@resvg/resvg-js';

const font = (w) => fs.readFileSync(src(`og/Inter-${w}.ttf`));
const fonts = [
  { name: 'Inter', data: font(500), weight: 500, style: 'normal' },
  { name: 'Inter', data: font(800), weight: 800, style: 'normal' },
];

// The lockup paths, read from the one place they're defined.
const symbol = fs.readFileSync(src('components/LogoSymbol.astro'), 'utf8');
const paths = symbol.match(/<symbol[^>]*>([\s\S]*?)<\/symbol>/)[1];
const logo = `data:image/svg+xml;base64,${Buffer.from(
  `<svg xmlns="http://www.w3.org/2000/svg" viewBox="143 111 960 163" fill="#fff">${paths}</svg>`
).toString('base64')}`;

const h = (type, style, children) => ({ type, props: { style, children } });

export async function renderOg({ title, label }) {
  const size = title.length > 60 ? 60 : title.length > 36 ? 70 : 82;
  const tree = h('div', {
    width: 1200, height: 630, display: 'flex', flexDirection: 'column', justifyContent: 'space-between',
    padding: '72px 80px', color: '#fff', fontFamily: 'Inter', position: 'relative', overflow: 'hidden',
    backgroundImage: 'linear-gradient(135deg, #e23b5b 0%, #c8102e 100%)',
  }, [
    h('div', { position: 'absolute', top: -60, right: 40, width: 380, height: 780, display: 'flex',
      backgroundColor: 'rgba(255,255,255,0.10)', transform: 'skewX(-29.5deg)' }),
    h('div', { position: 'absolute', top: -60, right: -260, width: 260, height: 780, display: 'flex',
      backgroundColor: 'rgba(255,255,255,0.06)', transform: 'skewX(-29.5deg)' }),
    { type: 'img', props: { src: logo, width: 236, height: 40 } },
    h('div', { display: 'flex', flexDirection: 'column', gap: 18, maxWidth: 940 }, [
      label ? h('div', { fontSize: 28, fontWeight: 500, opacity: 0.88, display: 'flex' }, label) : null,
      h('div', { fontSize: size, fontWeight: 800, lineHeight: 1.06, letterSpacing: '-0.02em', display: 'flex' }, title),
    ].filter(Boolean)),
    h('div', { fontSize: 26, fontWeight: 500, opacity: 0.88, display: 'flex' }, 'veryklear.com'),
  ]);
  const svg = await satori(tree, { width: 1200, height: 630, fonts });
  return new Resvg(svg).render().asPng();
}
