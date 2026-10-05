import { defineCollection, z } from 'astro:content';

/* Categories are the three pillars (decided 2026-10-01, see
   ~/brands/very-klear/memory/decisions_content-categories.md). */
const artikels = defineCollection({
  type: 'content',
  schema: z.object({
    title: z.string(),
    description: z.string(),
    category: z.enum(['Positionering', 'Marketing strategie', 'AI inzetten']),
    published_at: z.coerce.date(),
    draft: z.boolean().default(false),
  }),
});

export const collections = { artikels };
