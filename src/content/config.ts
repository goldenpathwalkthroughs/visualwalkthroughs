import { defineCollection, z } from 'astro:content';

const advisory = z.object({
  type: z.enum(['do-now', 'upgrade', 'missable', 'warning', 'tip']),
  title: z.string(),
  body: z.string(),
  completionistOnly: z.boolean().default(false),
});

const collectible = z.object({
  label: z.string(),
  note: z.string(),
  type: z.enum(['heart', 'upgrade', 'shard', 'figurine', 'misc']).default('misc'),
  completionistOnly: z.boolean().default(true),
});

const video = z.object({
  provider: z.literal('youtube').default('youtube'),
  id: z.string(),
  creator: z.string(),
  title: z.string(),
  durationLabel: z.string(),
});

const section = z.object({
  stage: z.string(),
  title: z.string(),
  order: z.number(),
  chips: z.array(z.string()).default([]),
  steps: z.array(z.string()),
  advisories: z.array(advisory).default([]),
  collectibles: z.array(collectible).default([]),
  video,
});

const theme = z.object({
  ink: z.string().optional(),
  ink2: z.string().optional(),
  panel: z.string().optional(),
  panel2: z.string().optional(),
  accent: z.string().optional(),
  accentSoft: z.string().optional(),
  gold: z.string().optional(),
  signal: z.string().optional(),
  line: z.string().optional(),
  muted: z.string().optional(),
  bodyClass: z.string().optional(),
  cardGradient: z.string().optional(),
});

const franchises = defineCollection({
  type: 'data',
  schema: z.object({
    name: z.string(),
    slug: z.string(),
    developer: z.string(),
    description: z.string(),
    featured: z.boolean().default(false),
    featureRank: z.number().default(99),
    guideCount: z.number().default(0),
    theme,
  }),
});

const games = defineCollection({
  type: 'data',
  schema: z.object({
    franchiseSlug: z.string(),
    title: z.string(),
    slug: z.string(),
    year: z.string(),
    platforms: z.array(z.string()),
    status: z.enum(['published', 'draft', 'coming-soon']).default('published'),
    lede: z.string(),
    theme: theme.optional(),
    coverGradient: z.string().optional(),
    sections: z.array(section),
  }),
});

export const collections = { franchises, games };
