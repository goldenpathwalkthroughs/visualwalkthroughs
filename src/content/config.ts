import { defineCollection, z } from 'astro:content';
import { glob } from 'astro/loaders';

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
  startSeconds: z.number().optional(),
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
  type: z.enum(['heart', 'upgrade', 'shard', 'figurine', 'key', 'other', 'misc', 'flower', 'discovery', 'key-item']).default('misc'),
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
  name: z.string(),                      // e.g. "Phase 1 — Tentacles" or "Brock's Onix (Lv 14)"
  tells: z.string().optional(),          // what the boss signals before attacking (action-game bosses)
  counter: z.string().optional(),        // the concrete thing the player must do
  damageWindow: z.string().optional(),   // when and how to deal damage
  summary: z.string().optional(),        // free-form description (used for turn-based RPGs)
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

// ── v3: Creature-collector reference layers (genre pack D) ────────────────────
//
// These power the "Game Essentials", "Pokédex", and "Index" pillars that a
// gold-standard creature-collector guide needs alongside the route. All are
// optional/defaulted, so games without them stay valid (Principle §0: no proper
// nouns here — every value is a discovered fact in the content file).

// Standing mechanics reference (type chart, status, evolution taxonomy).
const typeChartRow = z.object({
  type: z.string(),                              // attacking type label
  strongVs: z.array(z.string()).default([]),     // 2× damage to
  weakVs: z.array(z.string()).default([]),       // ½× damage to
  noEffectVs: z.array(z.string()).default([]),   // 0× damage to
});

const statusCondition = z.object({
  name: z.string(),
  effect: z.string(),
  cure: z.string().optional(),
});

const evolutionMethod = z.object({
  method: z.string(),                            // "Level up", "Trade", "Stone", …
  detail: z.string(),
  examples: z.string().optional(),
});

const mechanicsReference = z.object({
  typeChart: z.array(typeChartRow).default([]),
  statusConditions: z.array(statusCondition).default([]),
  evolutionMethods: z.array(evolutionMethod).default([]),
  notes: z.array(z.string()).default([]),
});

// TM/HM + key-item index (the "Index" pillar).
const tmHmEntry = z.object({
  id: z.string(),                                // "TM01", "HM03"
  move: z.string(),
  typeLabel: z.string().optional(),
  location: z.string(),                          // where it's found / bought
  notes: z.string().optional(),
});

const moveItemIndex = z.object({
  tms: z.array(tmHmEntry).default([]),
  hms: z.array(tmHmEntry).default([]),
});

// Curated creature reference (the "Pokédex" pillar). Not every species — the
// team-relevant catchables, each with catch data, evolution, and notable moves.
const creatureLearn = z.object({
  level: z.string(),                             // "Lv 12", "TM", "Start"
  move: z.string(),
});

const creatureCatch = z.object({
  where: z.string(),
  method: z.enum(['grass', 'surf', 'fishing', 'old-rod', 'good-rod', 'super-rod', 'gift', 'static', 'trade', 'fossil', 'game-corner', 'other']).default('grass'),
  rarity: z.enum(['very-common', 'common', 'uncommon', 'rare', 'very-rare', 'one-time']).default('common'),
  levelRange: z.string().optional(),
  versionExclusive: z.enum(['firered', 'leafgreen', 'both']).default('both'),
});

const creature = z.object({
  id: z.string(),
  name: z.string(),
  dexNo: z.number().optional(),
  types: z.array(z.string()).default([]),
  catchLocations: z.array(creatureCatch).default([]),
  evolution: z.string().optional(),
  notableMoves: z.array(creatureLearn).default([]),
  role: z.string().optional(),                   // why it matters for a team
});

// Per-area reference data attached to a section (the annotated-walkthrough
// pillar, in data form). Each area is a route/town/dungeon the section covers.
const encounterRow = z.object({
  species: z.string(),
  method: z.enum(['grass', 'surf', 'old-rod', 'good-rod', 'super-rod', 'rock-smash', 'gift', 'static', 'other']).default('grass'),
  rarity: z.enum(['very-common', 'common', 'uncommon', 'rare', 'very-rare', 'one-time']).default('common'),
  levelRange: z.string().optional(),
  versionExclusive: z.enum(['firered', 'leafgreen', 'both']).default('both'),
  note: z.string().optional(),
});

const trainerEntry = z.object({
  trainer: z.string(),                           // "Bug Catcher Rick"
  team: z.string(),                              // "Caterpie Lv6, Weedle Lv6"
  reward: z.string().optional(),
  note: z.string().optional(),
});

const shopEntry = z.object({
  item: z.string(),
  price: z.string(),
});

const areaItem = z.object({
  label: z.string(),
  hidden: z.boolean().default(false),
  requires: z.array(z.string()).default([]),     // item IDs needed to reach it
});

const backtrackEntry = z.object({
  what: z.string(),                              // what's gated here
  needs: z.string(),                             // HM / badge / item required
  reward: z.string().optional(),
});

const areaEvent = z.object({
  label: z.string(),
  detail: z.string().optional(),
  spoiler: z.boolean().default(false),
});

const areaReference = z.object({
  name: z.string(),                              // "Route 3", "Mt Moon", "Pewter City"
  kind: z.enum(['town', 'route', 'cave', 'dungeon', 'sea', 'building', 'other']).default('route'),
  summary: z.string().optional(),
  encounters: z.array(encounterRow).default([]),
  trainers: z.array(trainerEntry).default([]),
  items: z.array(areaItem).default([]),
  shop: z.array(shopEntry).default([]),
  events: z.array(areaEvent).default([]),
  backtrack: z.array(backtrackEntry).default([]),
});

// ── v4: Action-adventure reference layers (genre pack A) ──────────────────────
//
// Powers the four layers a gold-standard action-adventure guide needs alongside
// the route: per-area objectives, keyed multi-floor dungeon maps, room-by-room
// puzzle solutions, and reference back-matter (items, songs, collectibles,
// side-quest chains, shops). All optional/defaulted (Principle §0).

const objective = z.object({
  label: z.string(),
  optional: z.boolean().default(false),
});

const dungeonMarker = z.object({
  key: z.string(),                              // "1", "B2-3"
  kind: z.enum(['room', 'chest', 'small-key', 'boss-key', 'switch', 'locked-door', 'boss', 'item', 'npc', 'collectible', 'secret', 'shop']).default('room'),
  label: z.string(),
  requires: z.array(z.string()).default([]),    // item IDs needed to reach/clear
});

const dungeonFloor = z.object({
  label: z.string(),                            // "1F", "B1", "B2"
  markers: z.array(dungeonMarker).default([]),
});

const dungeonMap = z.object({
  floors: z.array(dungeonFloor).default([]),
});

const roomBeat = z.object({
  name: z.string(),                             // "Water Column Bridge Room"
  solution: z.string(),                         // the explicit puzzle solution / what to do
  enemies: z.string().optional(),
  treasure: z.string().optional(),
  requires: z.array(z.string()).default([]),
});

// Reference back-matter (game-level)
const itemReferenceEntry = z.object({
  name: z.string(),
  category: z.string(),                         // "Sword","Shield","C-Item","Magic","Bottle","Upgrade"…
  where: z.string(),                            // where obtained
  when: z.string().optional(),                  // "Child","Adult","Either"
  unlocks: z.string().optional(),               // what it lets you do / reopens
});

const songEntry = z.object({
  name: z.string(),
  where: z.string(),
  use: z.string(),
});

// ── v6: Voices / ability-driven character reference ───────────────────────────
//
// For CRPGs where the character's abilities are the spine of the experience —
// e.g. the "internal voices" of Disco-Elysium-likes. Each entry is one ability:
// its name, the voice/theme it embodies, what it governs mechanically, and an
// optional build note. Rendered as a dedicated panel, NOT mislabelled as items.
const voice = z.object({
  ability: z.string(),                  // short label, e.g. "STR", "Wisdom"
  name: z.string(),                     // display name of the voice
  theme: z.string(),                    // what it embodies thematically
  governs: z.string(),                  // what it controls mechanically
  buildNote: z.string().optional(),     // when/why to invest
});

const collectibleEntry = z.object({
  label: z.string(),
  location: z.string(),
  requires: z.string().optional(),              // gating ability/item (free text)
  era: z.string().optional(),                   // "Child","Adult","Either"
});

const collectibleCategory = z.object({
  name: z.string(),                             // "Pieces of Heart","Gold Skulltulas","Great Fairies"
  total: z.number().optional(),                 // canonical total
  note: z.string().optional(),
  entries: z.array(collectibleEntry).default([]),
});

const sideQuestStep = z.object({
  label: z.string(),
  detail: z.string().optional(),
  requires: z.string().optional(),
});

const sideQuestChain = z.object({
  id: z.string(),
  name: z.string(),
  reward: z.string(),
  era: z.string().optional(),
  steps: z.array(sideQuestStep).default([]),
});

const shopRef = z.object({
  name: z.string(),
  where: z.string(),
  items: z.array(z.object({ item: z.string(), price: z.string() })).default([]),
});

// ── v5: time-loop / scheduled-world module (feature tag) ──────────────────────
//
// For games built on a repeating, scheduled cycle (Majora's Mask). The wall is
// "when to be where," so the guide needs the loop's rules and a timetable.

const timeCycle = z.object({
  cycleLength: z.string(),                       // "72 hours · three in-game days"
  resetMechanic: z.string(),                     // how you reset the loop
  persists: z.array(z.string()).default([]),     // what carries across a reset
  lost: z.array(z.string()).default([]),         // what is wiped on a reset
  controls: z.array(z.object({                   // songs/items that slow/skip/reset time
    name: z.string(),
    effect: z.string(),
  })).default([]),
  note: z.string().optional(),
});

const scheduledEvent = z.object({
  name: z.string(),
  days: z.string(),                              // "All", "Day 1", "Final Day"…
  time: z.string().optional(),                   // clock-time window
  location: z.string(),
  prereq: z.string().optional(),
  reward: z.string().optional(),
  detail: z.string().optional(),
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
  video: video.optional(),   // optional: autonomous guides ship text-first; a video can be added later

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

  // v3: per-area reference layers (encounters / trainers / items / shops / events)
  areas: z.array(areaReference).default([]),

  // v4: action-adventure per-section layers (objectives / dungeon map / rooms)
  objectives: z.array(objective).default([]),
  dungeonMap: dungeonMap.optional(),
  rooms: z.array(roomBeat).default([]),
});

// ── Collections ───────────────────────────────────────────────────────────────

// ── Engine/content separation (spec §2) ──────────────────────────────────────
//
// Content files live under /content/ (outside /src/) so the nightly pipeline
// can write new game files without touching engine code.
// The glob loader reads them at build time; Astro type-checks against the schema.
//
// /content/games/       — one JSON file per game
// /content/franchises/  — one JSON file per franchise

const franchises = defineCollection({
  loader: glob({ pattern: '*.json', base: './content/franchises' }),
  schema: z.object({
    name: z.string(),
    slug: z.string(),
    developer: z.string(),
    description: z.string(),
    featured: z.boolean().default(false),
    featureRank: z.number().default(99),
    guideCount: z.number().default(0),
    theme,
    cover: z.string().optional(),  // CDN-hosted cover URL (IGDB box art)
  }),
});

const games = defineCollection({
  loader: glob({ pattern: '*.json', base: './content/games' }),
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
    cover: z.string().optional(),  // CDN-hosted cover URL (IGDB box art)
    genre: z.string().optional(),  // primary genre ID from taxonomy/genres.json
    sections: z.array(section),

    // v2 additions — all optional/defaulted; existing games stay valid
    structure: gameStructure.optional(),
    items: z.array(item).default([]),
    detours: z.array(detour).default([]),
    collectionQuests: z.array(collectionQuest).default([]),
    worldMap: worldMap.optional(),
    locations: z.array(location).default([]),      // shared vocab: map + written steps
    bossFights: z.array(bossFight).default([]),    // first-class boss content type

    // v3: creature-collector reference pillars (all optional)
    mechanicsReference: mechanicsReference.optional(),  // type chart, status, evolution
    moveItemIndex: moveItemIndex.optional(),            // TM/HM index
    creatures: z.array(creature).default([]),           // curated Pokédex reference

    // v4: action-adventure reference back-matter (all optional)
    itemReference: z.array(itemReferenceEntry).default([]),       // equipment table
    songs: z.array(songEntry).default([]),                       // ocarina songs / abilities
    collectibleCategories: z.array(collectibleCategory).default([]), // skulltulas, hearts, fairies
    sideQuestChains: z.array(sideQuestChain).default([]),        // trading sequence etc.
    shops: z.array(shopRef).default([]),

    // v5: time-loop / scheduled-world module (all optional)
    timeCycle: timeCycle.optional(),                             // the loop's rules
    scheduledEvents: z.array(scheduledEvent).default([]),        // Bombers'-Notebook timetable

    // v6: ability-driven character reference (CRPG "voices") — optional
    voices: z.array(voice).default([]),
    voicesTitle: z.string().optional(),                          // panel heading, e.g. "The Six Voices"
    voicesIntro: z.string().optional(),                          // one-line intro under the heading
  }),
});

export const collections = { franchises, games };
