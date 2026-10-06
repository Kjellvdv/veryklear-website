import { getEntry } from 'astro:content';
import { pillarLower } from './articles.js';

// Page copy lives in src/content/copy/<name>.yaml.
export async function getCopy(name) {
  const entry = await getEntry('copy', name);
  if (!entry) throw new Error(`Missing copy file: src/content/copy/${name}.yaml`);
  return entry.data;
}

// Fill {pillar} (lower case, AI kept) and {Pillar} (as written) in a copy string.
export const fillPillar = (text, name) =>
  text.replaceAll('{Pillar}', name).replaceAll('{pillar}', pillarLower(name));
