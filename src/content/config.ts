import { defineCollection, z } from 'astro:content';

/* Categories are the three pillars (decided 2026-10-01, see
   ~/brands/very-klear/memory/decisions_content-categories.md). */
const artikels = defineCollection({
  type: 'content',
  schema: z.object({
    title: z.string(),
    description: z.string(),
    category: z.enum(['Positionering', 'Marketing strategie', 'AI implementeren']),
    published_at: z.coerce.date(),
    draft: z.boolean().default(false),
    /* Illustration in the locked ink-line style (design-spec.md, "Artikel
       illustrations"). Path under public/, e.g. /artikels/<slug>.jpg. */
    image: z.string().optional(),
    image_alt: z.string().default(''),
  }),
});

/* Page copy, one YAML file per page in src/content/copy/. Loose on purpose:
   the templates read the fields they need, and a missing field shows up as an
   empty spot in the preview rather than a build error. */
const copy = defineCollection({
  type: 'data',
  schema: z.record(z.any()),
});

export const collections = { artikels, copy };
