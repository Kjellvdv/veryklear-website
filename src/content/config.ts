import { defineCollection, z } from 'astro:content';

/* Deliberately loose for now. Very Klear's content model still has to be
   rebuilt — the inherited one is 31 English B2B SaaS leaves. */
const artikels = defineCollection({
  type: 'content',
  schema: z.object({
    title: z.string(),
    description: z.string(),
    category: z.enum(['Strategie', 'Automatisatie', 'Websites']),
    published_at: z.coerce.date(),
    draft: z.boolean().default(false),
  }),
});

export const collections = { artikels };
