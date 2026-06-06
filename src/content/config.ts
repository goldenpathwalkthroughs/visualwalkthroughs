import { defineCollection, z } from 'astro:content';

// ─────────────────────────────────────────────────────────────────────────────
// PRINCIPLE §0: no game-specific proper noun in this file.
// Names, counts, coordinates, and methods are facts discovered by the researcher
// and live only in a game's content file.  Everything here is a capability shape.
// ─────────────────────────────────────────────────────────────────────────────

// ── Primitives (unchanged from v1) ───────────────────────────────────────────

const advisory = z.object({
  type: z.enum(['do-now', 'upgrade', 'missable', 'warning', 'tip']),
  title: z.string(),
  body: z.string(),
  completionistOnly: z.boolean().default(false),
});

const video = z.object({
  provider: z.literal('youtube').default('youtube'),
  id: z.string(),
  creator: z.string(),
  title: z.string(),
  durationLabel: z.string(),
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

// ── v2: Step (union — v1 plain strings stay valid) ────────────────────────────
//
// A step is either:
//   v1  "Do the thing with <strong>the item</strong>."    — plain HTML string
//   v2  { text: "...", videoTimestamp?: 142, locationRef?: "B6" }
//
// videoTimestamp is seconds into the section's embedded video.
// locationRef is the canonical ref of the Location where this action takes place
//   (grid coord like "B6" for grid games; named region for others).
// The UI renders timestamp as a clickable seek button and locationRef as a
// small badge that can link to the map panel for that cell.

const step = z.union([
  z.string(),
  z.object({
    text: z.string(),
    videoTimestamp: z.number().optional(),
    locationRef: z.string().optional(),  // e.g. "B6" for Dragon Roost Island
  }),
]);

// ── v2: Collectible (v1 fields kept; new fields all optional) ─────────────────

const collectible = z.object({
  label: z.string(),
  note: z.string(),
  // 'key' and 'other' added; existing values unchanged
  type: z.enum(['heart', 'upgrade', 'shard', 'figurine', 'key', 'other', 'misc']).default('misc'),
  completionistOnly: z.boolean().default(true),
  // v2 additions
  requires: z.array(z.string()).default([]),   // item IDs needed to reach/collect this
  method: z.string().optional(),              // exact acquisition method (cross-checked)
  locationDetail: z.string().optional(),      // precise location description
  category: z.string().optional(),            // collectible category label (game-specific)
  categoryTotalKnown: z.number().optional(),  // canonical count for this category
});

// ── v2: Items registry ────────────────────────────────────────────────────────
//
// Every key item, song, or ability in the game.  The sequencing engine uses this
// to know what the player holds at each point on the route — which determines
// which detours to surface and which gates to warn about.
//
// Names are discovered by the researcher; they are not hardcoded here.

const item = z.object({
  id: z.string(),                                         // stable slug, unique within the game
  name: z.string(),                                       // display name (content-file fact)
  type: z.enum(['item', 'song', 'ability', 'upgrade']),
  acquiredAtSectionId: z.string().optional(),             // which section awards this
  class: z.enum(['progression', 'optional']).default('optional'),
});

// ── v2: Detours ───────────────────────────────────────────────────────────────
//
// An optional activity that strengthens the player.
// Writers fill in `requires`, `benefit`, `method`, and `earliestSectionId`.
// The sequencing engine computes `recommendedSectionId` — writers do NOT set this.

const detour = z.object({
  id: z.string(),
  location: z.string(),
  coord: z.object({ col: z.number(), row: z.number() }).optional(),
  type: z.enum(['upgrade', 'heart', 'rupee', 'secret', 'convenience']),
  requires: z.array(z.string()).default([]),               // item IDs the player must hold
  benefit: z.string(),                                    // one-line payoff description
  method: z.string(),                                     // how to obtain (cross-checked)
  earliestSectionId: z.string(),                          // first section at which this is possible
  recommendedSectionId: z.string(),                       // engine-computed; when to surface it
  mandatory: z.literal(false).default(false),             // detours are never mandatory
});

// ── v2: Collection quests ─────────────────────────────────────────────────────
//
// Multi-part hunts where enumeration matters.
// Every piece must have its own entry — one-line summaries of multi-hour activities
// are a coverage-weight failure.

const collectionQuestPiece = z.object({
  label: z.string(),
  chartLocation: z.string().optional(),    // where the chart/clue is found
  decipherStep: z.string().optional(),     // intermediate step before collection
  salvageLocation: z.string().optional(),  // where the piece is actually collected
  requires: z.array(z.string()).default([]),
});

const collectionQuest = z.object({
  id: z.string(),
  name: z.string(),
  totalCount: z.number(),
  pieces: z.array(collectionQuestPiece),
});

// ── v2: Location registry ─────────────────────────────────────────────────────
//
// THE shared vocabulary for both the world map and every written step.
// If a place isn't in this registry the writer cannot reference it and the map
// cannot omit it — enforced by content-QA gate #9.
//
// `ref` is the canonical short reference the text uses:
//   - grid games: "B6" (row letter A-G + column number 1-7)
//   - region/open games: a brief place name ("Northern Highlands")
//
// `contains` lists everything physically here — golden-path beats, NPCs,
// secrets, shops — so the map detail panel can render real content and respect
// spoiler-safe and Completionist toggles.

const locationContains = z.object({
  label: z.string(),
  kind: z.enum(['beat', 'npc', 'secret', 'shop', 'other']),
  requires: z.array(z.string()).default([]),  // item IDs needed to access this thing
  sectionId: z.string().optional(),           // which section covers this beat
  completionistOnly: z.boolean().default(false),
});

const location = z.object({
  id: z.string(),               // stable slug, unique within the game
  name: z.string(),             // display name
  ref: z.string(),              // canonical reference — "B6" or "Windfall Island"
  coord: z.object({ col: z.number(), row: z.number() }).optional(),
  reachableBy: z.string(),      // how to get here from the player's perspective
  whereWithin: z.string().optional(),  // sub-location detail if needed
  isHub: z.boolean().default(false),
  contains: z.array(locationContains).default([]),
});

// ── v2: Boss fights ───────────────────────────────────────────────────────────
//
// A first-class content type — never a single sentence.
// `prep` tells the player how to be ready; `phases` describe each attack
// pattern and its counter; `ifYouStruggle` gives the bounce-back safety net.
//
// `locationRef` links to the Location.ref where the fight takes place,
// so the map panel can surface the fight and the fight card can link to the map.

const bossPhase = z.object({
  name: z.string(),          // e.g. "Phase 1 — Tentacles"
  tells: z.string(),         // what the boss signals before attacking
  counter: z.string(),       // the concrete thing the player must do
  damageWindow: z.string(),  // when and how to deal damage
});

const bossFight = z.object({
  id: z.string(),
  name: z.string(),
  sectionId: z.string(),     // which section this boss belongs to
  locationRef: z.string(),   // Location.ref for the arena
  prep: z.object({
    recommendedItems: z.array(z.string()).default([]),  // item IDs
    healthAdvice: z.string(),       // how many hearts / potions to bring
    topUpBefore: z.string().optional(),  // where to top up nearby
  }),
  phases: z.array(bossPhase),
  ifYouStruggle: z.object({
    whereToHeal: z.string(),
    easierTactic: z.string(),
    retreatOption: z.string().optional(),
  }),
  reward: z.string(),  // what the player receives for winning
});

// ── v2: World map ─────────────────────────────────────────────────────────────
//
// Layout abstraction.  `kind` drives which renderer the UI uses.
// Implement `grid` first (Phase C); `regions` follows.
// Coordinates, counts, names — all game-specific facts in the content file.

const hubActivity = z.object({
  label: z.string(),
  requires: z.array(z.string()).default([]),  // item IDs that unlock this activity
  benefit: z.string(),
});

const worldMapCell = z.object({
  coord: z.object({ col: z.number(), row: z.number() }).optional(),
  name: z.string(),
  locationId: z.string().optional(),  // links to Location.id in the registry
  regionId: z.string().optional(),
  // How important is this cell to the story route?
  routeRelevance: z.enum(['none', 'passes-through', 'required']).default('none'),
  secrets: z.array(z.string()).default([]),   // collectible IDs discoverable here
  requires: z.array(z.string()).default([]),  // item IDs needed to access/clear this cell
  isHub: z.boolean().default(false),         // true for recurring locations
  activities: z.array(hubActivity).default([]),
});

const worldMap = z.object({
  kind: z.enum(['grid', 'regions']),
  grid: z.object({ cols: z.number(), rows: z.number() }).optional(),
  cells: z.array(worldMapCell).default([]),
});

// ── v2: Game structure ────────────────────────────────────────────────────────
//
// A game's structure is a discovered fact, classified by the researcher from
// live research — never pattern-matched from memory.
//
// structureType describes the game's fundamental shape:
//   linear        — one mandatory path from start to credits
//   semi-linear   — some branching/optional areas but a clear main trunk
//   hub-based     — a central hub unlocks multiple directions; revisited repeatedly
//   open-world    — large free-roam area; objectives completable in many orders
//   metroidvania  — interconnected map; earlier areas revisitable with new abilities
//
// recommendedRoute: the sectionIds in the order we guide players through them.
//   For linear games this matches narrative order.
//   For open/hub games this is the route the guide recommends, which may differ
//   from any "critical path" the game itself imposes.
//
// criticalPath: sectionIds the player MUST complete to reach the credits
//   (hard-gated by the game engine).  May be a subset of recommendedRoute.
//
// anyOrderGroups: clusters of objectives that are completable in any order.
//   The sequencing engine uses these to know it can surface detours freely
//   within the group rather than in strict sequence.

const anyOrderGroup = z.object({
  groupId: z.string(),
  label: z.string(),           // human-readable, e.g. "Temples (any order)"
  sectionIds: z.array(z.string()),
});

const gameStructure = z.object({
  structureType: z.enum(['linear', 'semi-linear', 'hub-based', 'open-world', 'metroidvania']),
  recommendedRoute: z.array(z.string()).default([]),   // sectionIds in recommended order
  criticalPath: z.array(z.string()).default([]),        // sectionIds that must be completed
  anyOrderGroups: z.array(anyOrderGroup).default([]),
});

// ── Section ───────────────────────────────────────────────────────────────────

const section = z.object({
  // v1 fields — unchanged
  stage: z.string(),
  title: z.string(),
  order: z.number(),
  chips: z.array(z.string()).default([]),
  steps: z.array(step),   // now accepts v1 plain strings AND v2 {text, videoTimestamp?}
  advisories: z.array(advisory).default([]),
  collectibles: z.array(collectible).default([]),
  video,

  // v2 additions — all optional/defaulted so existing content stays valid
  sectionId: z.string().optional(),     // stable ID for cross-references and route arrays

  // Progression graph fields
  unlocks: z.array(z.string()).default([]),   // item IDs gained by completing this section
  gates: z.array(z.string()).default([]),     // item IDs needed to enter/proceed

  // Gating type — how strictly the gate must be obeyed
  //   hard   — player is literally blocked by the game; cannot proceed without these items
  //   soft   — player CAN proceed but the readinessNote explains why they shouldn't
  //   none   — no gate (default)
  gatingType: z.enum(['hard', 'soft', 'none']).default('none'),
  readinessNote: z.string().optional(),   // for soft gates: the "why now" explanation

  // Route fields (for non-linear games)
  skippable: z.boolean().default(false),    // true for optional objectives in open games
  routeOrder: z.number().optional(),        // position in recommendedRoute (may differ from order)

  // Computed by the sequencing engine — writers do NOT populate this
  recommendedDetours: z.array(z.string()).default([]),
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
    // v1 fields — unchanged
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

    // v2 additions — all optional/defaulted; existing games stay valid
    structure: gameStructure.optional(),
    items: z.array(item).default([]),
    detours: z.array(detour).default([]),
    collectionQuests: z.array(collectionQuest).default([]),
    worldMap: worldMap.optional(),
    locations: z.array(location).default([]),      // shared vocab: map + written steps
    bossFights: z.array(bossFight).default([]),    // first-class boss content type
  }),
});

export const collections = { franchises, games };
