import { defineCollection, z } from 'astro:content';

// ── Shared primitives ─────────────────────────────────────────────────────────

const advisory = z.object({
  type: z.enum(['do-now', 'upgrade', 'missable', 'warning', 'tip']),
  title: z.string(),
  body: z.string(),
  completionistOnly: z.boolean().default(false),
});

/**
 * A walkthrough step.
 * v1: plain HTML string (all existing content — stays valid forever).
 * v2: object with text + optional videoTimestamp (seconds) for deep-linking the
 *     section embed to the exact moment this step is shown.
 * Nothing game-specific lives here; timestamps are discovered per-game by the researcher.
 */
const step = z.union([
  z.string(),
  z.object({
    text: z.string(),
    videoTimestamp: z.number().optional(),
  }),
]);

/**
 * A collectible entry.
 * v1 fields kept as-is; v2 fields all optional so existing content stays valid.
 * 'key' and 'other' added to the type enum (additive, non-breaking).
 */
const collectible = z.object({
  label: z.string(),
  note: z.string(),
  type: z.enum(['heart', 'upgrade', 'shard', 'figurine', 'key', 'other', 'misc']).default('misc'),
  completionistOnly: z.boolean().default(true),
  // v2 additions — all optional; existing content omits them without error
  requires: z.array(z.string()).default([]),    // item IDs that must be held first
  method: z.string().optional(),               // exact acquisition method
  locationDetail: z.string().optional(),       // precise location description
  category: z.string().optional(),             // collectible category name (game-specific)
  categoryTotalKnown: z.number().optional(),   // canonical count in this category
});

const video = z.object({
  provider: z.literal('youtube').default('youtube'),
  id: z.string(),
  creator: z.string(),
  title: z.string(),
  durationLabel: z.string(),
});

// ── v2: Items registry ────────────────────────────────────────────────────────
//
// Every key item, song, or ability a player can acquire is registered here.
// The engine uses this to know what the player holds at each point on the
// golden path — which drives detour surfacing and gate warnings.
//
// Names are discovered by the researcher and live only in the game's content file.
// No names are hardcoded in this schema.

const item = z.object({
  id: z.string(),                                          // stable slug, unique within the game
  name: z.string(),                                        // display name (game-specific, in content)
  type: z.enum(['item', 'song', 'ability', 'upgrade']),
  acquiredAtSectionId: z.string().optional(),              // which section awards this item
  class: z.enum(['progression', 'optional']).default('optional'),
});

// ── v2: Detours ───────────────────────────────────────────────────────────────
//
// An optional activity that strengthens the player (upgrade, extra health, etc.).
// The sequencing engine computes which detours to surface after each section
// by comparing each detour's `requires` list against the player's current items.
// Writers do NOT hand-write `recommendedSectionId` — the compiler fills that in.

const detour = z.object({
  id: z.string(),
  location: z.string(),                                    // human-readable location name
  coord: z.object({ col: z.number(), row: z.number() }).optional(), // grid position if applicable
  type: z.enum(['upgrade', 'heart', 'rupee', 'secret', 'convenience']),
  requires: z.array(z.string()).default([]),                // item IDs the player must hold
  benefit: z.string(),                                     // e.g. "+1 heart", "capacity 30→60"
  method: z.string(),                                      // correct acquisition method
  earliestSectionId: z.string(),                           // first section at which this is possible
  recommendedSectionId: z.string(),                        // when the engine surfaces it (≥ earliest)
  mandatory: z.literal(false).default(false),              // always false — mandatory things are gates
});

// ── v2: Collection quests ─────────────────────────────────────────────────────
//
// Multi-part hunts where the full count matters (long collectible chains).
// Coverage-weight QA will flag any hunt with totalCount > 3 that lacks full enumeration.

const collectionQuestItem = z.object({
  label: z.string(),
  chartLocation: z.string().optional(),    // where to find the chart, clue, or pointer
  decipherStep: z.string().optional(),     // intermediate step before collection
  salvageLocation: z.string().optional(),  // where the piece is actually collected
  requires: z.array(z.string()).default([]),
});

const collectionQuest = z.object({
  id: z.string(),
  name: z.string(),
  totalCount: z.number(),
  items: z.array(collectionQuestItem),
});

// ── v2: World map ─────────────────────────────────────────────────────────────
//
// A layout abstraction — the engine renders grids and regions behind one interface.
// `kind: "grid"` is implemented first (Phase C); "regions" follows.
// Coordinates, counts, and names are all game-specific and live in the content file.

const hubActivity = z.object({
  label: z.string(),
  requires: z.array(z.string()).default([]),   // item IDs that unlock this activity
  benefit: z.string(),
});

const worldMapCell = z.object({
  coord: z.object({ col: z.number(), row: z.number() }).optional(), // grid coords
  name: z.string(),
  regionId: z.string().optional(),
  goldenPathRelevance: z.enum(['none', 'passes-through', 'required']).default('none'),
  secrets: z.array(z.string()).default([]),     // collectible IDs hidden here
  requires: z.array(z.string()).default([]),    // item IDs needed to access or clear this cell
  isHub: z.boolean().default(false),           // true for recurring locations with accumulating content
  activities: z.array(hubActivity).default([]),
});

const worldMap = z.object({
  kind: z.enum(['grid', 'regions']),
  grid: z.object({ cols: z.number(), rows: z.number() }).optional(), // present only when kind="grid"
  cells: z.array(worldMapCell).default([]),
});

// ── Section ───────────────────────────────────────────────────────────────────

const section = z.object({
  sectionId: z.string().optional(),            // stable ID for cross-references (e.g. "sec-dragon-roost")
  stage: z.string(),
  title: z.string(),
  order: z.number(),
  chips: z.array(z.string()).default([]),
  steps: z.array(step),                        // accepts v1 strings and v2 objects
  advisories: z.array(advisory).default([]),
  collectibles: z.array(collectible).default([]),
  video,
  // v2 additions — all default to [] so existing content stays valid
  unlocks: z.array(z.string()).default([]),             // item IDs gained in this section
  gates: z.array(z.string()).default([]),               // item IDs REQUIRED to enter/proceed
  recommendedDetours: z.array(z.string()).default([]),  // detour IDs — COMPUTED by the engine
});

// ── Theme ─────────────────────────────────────────────────────────────────────

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

// ── Collections ───────────────────────────────────────────────────────────────

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
    // v2 additions — all optional/defaulted so existing games stay valid
    items: z.array(item).default([]),
    detours: z.array(detour).default([]),
    collectionQuests: z.array(collectionQuest).default([]),
    worldMap: worldMap.optional(),
  }),
});

export const collections = { franchises, games };
