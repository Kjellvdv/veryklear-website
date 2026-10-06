// Build-time share images, one per page. See src/og/.
import { ogPages, ogPath } from '../../og/pages.js';
import { renderOg } from '../../og/render.js';

export async function getStaticPaths() {
  const pages = await ogPages();
  return pages.map((p) => ({
    params: { path: ogPath(p.path).replace(/^\/og\//, '').replace(/\.png$/, '') },
    props: p,
  }));
}

export async function GET({ props }) {
  const png = await renderOg(props);
  return new Response(png, { headers: { 'Content-Type': 'image/png' } });
}
