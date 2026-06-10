# VisualWalkthroughs — Genre Packs
### Making the engine genre-aware without genre-specific rebuilds

This extends Principle 0 one level up. The core engine builds *capabilities, not game facts*. Genre packs build *capabilities, not genre assumptions*: a game is classified into a **primary pack plus stackable feature tags**, each pack loading the content types, research questions, UI, and QA a guide for that kind of game needs. The action-adventure games you've built so far are simply the first pack; everything else is additive.

---

## 1. The principle: compose, don't special-case

A game is described as: **primary pack + feature tags + guide shape**, all *discovered from research*, never assumed (same rule as structure classification).

- **Primary pack** — the dominant shape (action-adventure, CRPG, creature-collector…).
- **Feature tags** — modules that stack on top (open-world, soulslike, branching-narrative, co-op, survival-resource, run-based…). These map directly to the "hybrid & taggable features" in the genre taxonomy.
- **Guide shape** — sequential walkthrough, reference/strategy compendium, branching-narrative guide, or a hybrid (see §3).

Elden Ring = action-RPG pack + `open-world` + `soulslike`. Baldur's Gate 3 = CRPG pack + `branching-narrative` + `turn-based-tactics` + `party`. The packs and tags are reused across games; only the combination changes.

---

## 2. Detection (a research step, before drafting)

The researcher classifies the game against a genre taxonomy (the one you supplied works as the vocabulary): primary genre, hybrid tags, and the resulting guide shape. This slots in beside the existing "structure first" classification. Rules carried over: never assume from a title; flag low confidence; for brand-new or data-thin releases, lean on live sources and the Content Advisor's "high demand, low confidence — revisit in two weeks" signal rather than publishing a shaky day-one guide.

---

## 3. Anatomy of a genre pack

Every pack defines the same six things. The first is the most important and the one you asked for — it's the **game-design lens**: *what makes a player stuck or quit in this genre, and therefore what the guide must provide.*

1. **Stuck-point thesis** — the design reason players get blocked here. This drives everything else.
2. **Schema extensions** — content types/fields this genre needs.
3. **Research-checklist additions** — what the researcher must gather.
4. **Guide shape** — sequential / reference / branching / hybrid.
5. **UI affordances** — genre-specific components.
6. **QA gates** — genre-specific completeness/quality tests.

### Guide shapes (the engine must support more than linear)
- **Sequential walkthrough** — ordered steps to the end (Zelda, RE, a Bond mission). What you have today.
- **Reference / strategy compendium** — no fixed path; databases + strategy (Slay the Spire's cards/relics, a Pokédex, an Elden Ring boss compendium).
- **Branching-narrative guide** — decision points, consequences, missables, points of no return (BG3, Disco Elysium).
- **Hybrid** — most big games: a route *plus* reference layers. The norm, not the exception.

Building the reference and branching shapes is the main *new* engineering beyond the existing sequential engine — do it when the first game that needs it is queued, not before.

---

## 4. The starter pack catalogue

Concise definitions — enough to build from when each is needed. Each leads with its stuck-point thesis.

### A. Action-Adventure *(baseline — already built)*
- **Stuck because:** can't find the way forward, can't solve a puzzle, or can't beat a boss — and, uniquely to this genre, can't tell *which* of those it is. The wall is geographic/mechanical (a locked room, an unread switch, an unused new item), not statistical.
- Guide shape: sequential / hybrid.

> **Gold-standard reference:** the *Legend of Zelda: Ocarina of Time* Prima Official Strategy Guide (1998). Its anatomy — analysed below, not copied — sets the depth bar for this pack and for the Zelda guides already on the site. The lesson it teaches is that a great action-adventure guide is **four interlocking layers**, not just a wall of route prose:
> 1. **Objectives** — each area/dungeon opens with a short numbered goal list ("what am I trying to do here"), separate from the steps.
> 2. **The annotated map** — every area and every dungeon floor is a keyed map (1F / B1 / B2 …), and the prose references the keys.
> 3. **Room-by-room solutions** — dungeons are broken into named rooms, each with its puzzle solution called out as its own beat.
> 4. **The reference back-matter** — item/equipment tables (what, where, child-or-adult), songs/abilities, collectible enumerations, shops, and side-quest chains.

**Schema extensions (`Adds`):**
- `Objective` list per section — the 2–6 numbered goals that define an area/dungeon, rendered up front and tickable, distinct from `steps`.
- `Dungeon`/area **annotated map** with **keyed markers** and **multiple floors/levels** (1F/B1/B2…); markers tag rooms, chests, switches, locked doors, and the boss. Reuses the prerequisite graph (a marker can require an item).
- `Room` beats — a dungeon is a list of **named rooms**, each carrying its own **puzzle solution** (the explicit "how to solve this" beat), enemies, and chests. Puzzle solutions are first-class, never a clause buried in a sentence.
- `BossFight` (already core) gains the genre convention: each boss links to **the dungeon item just acquired** ("use the new tool here") plus pattern/weakness/phase.
- `Item`/`Equipment` reference table — name, **where obtained**, **when obtainable** (e.g. an availability/era flag like child vs adult), and what it unlocks. These are the progression-gating tools that drive backtracking.
- `Ability`/`Song`/`Key` reference — the non-item toolkit (Ocarina songs, movement tech, dungeon keys) that gates and reopens areas; already partly covered by the core `items` registry, extended with usage notes.
- `Collectible` enumerations with **exact location + the ability/item each requires** — the genre's optional spine (Gold Skulltulas, Heart Pieces, Great Fairy upgrades). Uses `categoryTotalKnown` against canonical totals.
- `SideQuestChain` — multi-step optional chains (trading sequence → reward weapon), each step enumerated with its prerequisite, never summarised as one line.
- **Backtracking callouts** — "you can't reach this until you have X," and revisit prompts when a world-state change (a new item, a time/era switch) reopens an earlier area. Surfaced through the prerequisite graph.
- `Shop` lists with prices, plus a short **how-to-earn-currency** note.
- Inline **enemy callouts** (how to beat it + its drop) and **NPC-hint** prompts ("talk to everyone here").

**Research-checklist additions:**
- Per-area objectives; per-dungeon floor maps and the keyed contents of each room.
- Every puzzle's solution, stated explicitly; every locked door's key source.
- Each boss's pattern, weakness, and the dungeon item that beats it.
- The full progression-item table: where and when each is obtained, and what it unlocks/reopens.
- Songs/abilities/keys and their uses; shop stock and prices; how currency is earned.
- Collectible locations with their gating ability/item, against canonical totals; side-quest chains step by step.
- Which earlier areas must be revisited after gaining an item or a world-state change, and what the revisit yields.

**UI affordances:**
- A per-section **objectives checklist** rendered above the steps.
- **Annotated, multi-floor area/dungeon maps** with toggleable marker layers (chests, switches, locked doors, boss, collectibles).
- A **progression-item reference** ("where/when/unlocks") and a **songs/abilities** panel.
- **Collectible checklists** per area, each entry showing its required ability/item, with running totals.
- "Come back later" markers that light up once the gating item or world-state is obtained.
- Side-quest-chain trackers that step through each handoff.

**QA gates:**
- Every dungeon has a floor map whose keys are all referenced in the prose, and a boss with pattern + weakness + the item that beats it.
- Every puzzle beat states its solution; every locked door names its key.
- Every collectible lists its location **and** its required ability/item; counts match canonical totals.
- Every progression item states where/when it's obtained and what it reopens; every backtracking-gated reward names its unlock.
- Every shop lists stock and prices; every side-quest chain enumerates its steps.

### B. Open-World Action-RPG / Soulslike
- **Stuck because:** under-levelled, wrong build, or a wall-boss — *not* lost. The fix is usually "improve the character or go elsewhere," not "find the door."
- **Adds:** `Build` type (stats, weapons, scaling, recommended early/mid/late setups); `recommendedLevel`/readiness per region (soft gating, already in core); deep `BossFight` entries with summon/co-op options and "if stuck, go here instead"; non-linear region routing.
- **Research:** viable starter builds, area level expectations, boss weaknesses, where power spikes.
- **UI:** build cards; a region-readiness map.
- **QA:** every major boss has a counter-strategy *and* a "come back later" alternative; every recommended route segment states an expected level/power.
- Shape: hybrid (region route + boss compendium + build reference).

### C. Party-Based CRPG
- **Stuck because:** "did I lock myself out of something," "which choice," "how do I pass this check," "I missed a companion/quest." Branching and missables, not geography.
- **Adds:** `DecisionPoint` type (choices, consequences, what each path gates/opens, reversibility); `Companion`/quest-availability tracking; `SkillCheck` guidance (odds, how to improve them); multi-solution encounters; point-of-no-return warnings.
- **Research:** major branches and their consequences, missable companions/quests, recruitment conditions, check thresholds, points of no return.
- **UI:** a branch/consequence map; a missable-content checklist tied to progress.
- **QA:** every point of no return is flagged *before* it; every missable lists its window; choices state consequences without dictating a "right" one.
- Shape: branching-narrative + hybrid. *(Composes the `branching-narrative` module.)*

### D. Creature-Collector RPG
- **Stuck because:** "my team can't beat this gym/boss," "where do I catch X," "how do I evolve Y," "where do I go next and what did I miss on the way." Team composition and collection, layered on a story route whose every town and route is dense with trainers, items, and one-time events.
- Guide shape: hybrid (story route + creature/team reference + standing mechanics reference). *(A `field-research` tag covers the Legends-style catch/agile-strong mechanics that differ from mainline.)*

> **Gold-standard reference:** the *Pokémon FireRed/LeafGreen* Prima Official Game Guide (2004). Its anatomy — analysed below, not copied — sets the depth bar for this pack. It is built on **four pillars**, and a good creature-collector guide needs all four, not just the route:
> 1. **Game Essentials** — a standing mechanics reference (type chart, catching, evolution paths, status conditions, stats).
> 2. **The Walkthrough** — the sequential route, but every town/route is an *annotated map* with keyed markers, not just prose.
> 3. **The Pokédex** — a per-creature reference (locations + rarity, evolution chain, full movelist, TM/HM compatibility).
> 4. **The Index** — item/move/economy reference (TMs, HMs, Berries: where found, what they do, who can learn them).

**Schema extensions (`Adds`):**
- `Creature` type — catch location(s) each with **rarity** (common/rare) and **level range**; catch **method**; evolution conditions (level / trade / trade-with-item / special criteria); version exclusives; trade evolutions; **level-up movelist** and **TM/HM learnset compatibility**.
- `EncounterTable` per route/area — which species appear, at what rarity and level, by method (grass / surf / fishing / gift / static).
- `Location` (town or route) carries an **annotated map** with **keyed markers**, and three keyed lists tied to those markers:
  - `Items` — including **hidden items** flagged as their own missable class.
  - `Trainers` — **every** trainer (not only gym leaders), each with full roster: species + level.
  - `Events` — numbered, one-time story beats distinct from golden-path steps (rival battles, receiving an HM/key item, cutscene triggers, NPC gates that later clear).
- `Shop` / Poké-Mart inventory per town — stock list with **prices** (the economy/where-to-buy layer).
- `MajorBattle` (gym leader / rival / Elite Four / champion) — full roster, type theme, and a **recommended counter-team** with the reasoning.
- `MechanicsReference` (game-wide, built once per game) — type-effectiveness chart, damage multipliers, status conditions, catch-rate factors, the evolution-method taxonomy.
- `MoveItemIndex` — TMs/HMs (location + effect + which creatures can learn them), Berries, key items.
- **Backtracking callouts** — content gated behind a later HM/badge ("return with Surf/Strength/Cut"), surfaced through the existing prerequisite graph as a "come back when you have X" marker rather than buried in prose.
- **Readiness cautions** at route boundaries — soft-gate warnings ("don't push past here under-levelled"), using the core `readinessNote`.

**Research-checklist additions:**
- Catch locations, **rarity, and level ranges** per species; encounter tables by method.
- Evolution methods and exact criteria; version differences; trade-evolution chains.
- Per-route **complete** trainer rosters (species + levels), not just gyms.
- **Hidden** item locations alongside visible ones; Poké-Mart stock and prices per town.
- TM/HM locations and learnset compatibility; Berry locations and effects.
- Recommended team and level expectations per major battle; the type chart and status mechanics.
- HM/badge gates that require backtracking, and where the return-trips pay off.

**UI affordances:**
- An interactive **type-matchup helper**.
- A **catch-location index** and per-route encounter tables (filter by species/method/rarity).
- A **living Pokédex-style checklist** (caught / evolved / movelist).
- **Annotated location maps** with toggleable layers: items (incl. hidden), trainers, events.
- A **TM/HM + item index** with "who can learn this" and "where to find it."
- "Come back later" markers that light up once the gating HM/badge is obtained.

**QA gates:**
- Every gym/major battle carries a recommended counter-team **with reasoning**.
- Every listed creature has a catch method **and** at least one location with rarity + level range.
- Every town with a shop lists its stock and prices; every route lists its full trainer roster.
- Hidden items are flagged distinctly from visible ones; no item marker is unkeyed to the map.
- Every backtracking-gated area names the HM/badge that unlocks it.
- The standing mechanics reference (type chart, status, evolution taxonomy) is present and complete.

### E. Collectathon Platformer
- **Stuck because:** "where are the last collectibles," "how do I reach that one," "what unlocks the next area." Density and movement tech.
- **Adds:** per-region collectible enumeration with exact conditions and the *movement tech / ability* each requires (uses the prerequisite graph — some need an ability or, in co-op LEGO games, a specific character); "main path vs 100%"; post-game content.
- **Research:** every collectible's location and unlock condition; movement/ability tech; what gates region progress.
- **UI:** per-region collectible map and checklist.
- **QA:** collectible counts match canonical totals; each lists its required ability/character.
- Shape: hybrid (area route + collectible reference). *(Composes `co-op` and `collectathon` tags.)*

### F. Survival / Crafting
- **Stuck because:** there's no quest marker — "where do I find material X," "how do I craft/progress," "how do I survive this biome." Self-directed progression is the wall.
- **Adds:** `CraftTree`/blueprint graph (what unlocks what, where blueprints/materials are); resource-location maps; biome/threat guidance; base-progression milestones; needs management (oxygen/hunger/temperature).
- **Research:** tech/crafting dependencies, resource locations, biome dangers, the *implicit* progression most players miss.
- **UI:** a crafting dependency map; a resource locator.
- **QA:** every craftable lists its materials and where to get them; the implicit progression path is made explicit.
- Shape: hybrid (soft progression route + crafting/resource reference + map).

### G. Roguelike / Deckbuilder
- **Stuck because:** there is no path — "how do I beat the act boss," "what build with these cards," "what does this relic do." Runs, RNG, synergies.
- **Adds:** `Card`/`Relic`/item database; `Archetype`/build guides; per-encounter and per-boss strategy; act structure; meta-progression unlock order.
- **Research:** the item database, viable archetypes, boss/elite strategies, unlock progression.
- **UI:** searchable card/relic reference; archetype guides.
- **QA:** every act boss has a strategy; build guides cover the main archetypes; reference entries are complete.
- Shape: **reference / strategy compendium** (the clearest case where the guide is *not* a walkthrough).

---

## 5. Feature-tag modules (stack onto any pack)

Small, reusable. Examples: `open-world` (region routing + soft gating), `soulslike` (build + brutal-boss handling), `branching-narrative` (decisions/consequences/missables), `stealth` (detection, routes, non-lethal options), `survival-resource` (when to fight vs flee, save/resource management — RE-style), `co-op` (character-gated content, who-does-what), `run-based` (shifts guide shape toward reference + strategy), `field-research` (Legends-style catching), `time-loop` (scheduled world — see below). These map onto the taxonomy's "hybrid & taggable features."

### `time-loop` (scheduled world)

> **Gold-standard reference:** the *Legend of Zelda: Majora's Mask* Prima and Nintendo Power guides (2000). Majora's Mask is Action-Adventure (pack A) **+ `time-loop`**, and the tag is what makes its guide work. The lesson: in a looping, scheduled world the wall is no longer *where to go* but ***when to be where*** — events fire at specific times across a repeating cycle, and a flat route can't express that.

- **Stuck because:** an event only happens on a particular day at a particular hour, and the clock resets before you finish a chain. The player isn't lost on the map — they're lost in *time*. The fix is a timetable and a reset-aware plan, not a door.
- **Adds:**
  - `TimeCycle` — the loop's length, the songs/items that **reset, slow, or skip** time, and exactly **what persists vs is lost** across a reset (e.g. masks/hearts/keys kept, consumables/event-items lost). This is the single most important thing to state up front.
  - `ScheduledEvent` timetable (the "Bombers' Notebook") — each tracked NPC event keyed by **day + clock-time window + location**, its **prerequisite chain**, and its **reward** (mask / Heart Piece). Multi-day chains (the Kafei & Anju line) list every timed handoff in order.
  - A **master event flowchart** with **"earliest you can attempt this"** annotations — mandatory beats in required order, with each optional mask/Heart Piece slotted at the exact point in the loop it first becomes reachable.
  - Masks/abilities tagged as **tools** (what they unlock) *and* **collectibles** (the checklist), since many are rewards from scheduled events.
- **Research:** the cycle rules and persistence; every scheduled event's day/time window, location, prerequisite, and reward; which optional content is reachable in which loop; transformation/ability gating per region.
- **UI:** a **timetable view** (day × hour grid, or per-event "be here at …" cards); a persistent **"what you keep on reset" note**; "earliest-attemptable" markers on optional content; a mask/ability checklist that doubles as a tool reference.
- **QA:** every scheduled event states its **day + time window + location + reward**; every multi-step chain is ordered and names each prerequisite; the cycle's persistence rules are stated explicitly; no optional pickup is listed before the loop point it's reachable.
- Shape: hybrid (region route + timetable + collectible/mask reference). Composes cleanly onto pack A's objectives / keyed dungeon maps / room-by-room layers.

---

## 6. The stress test: your target games

How each resolves under the framework — primary pack, tags, and guide shape:

| Game | Primary pack | Feature tags | Guide shape |
|---|---|---|---|
| Pokémon Scarlet & Violet | Creature-Collector | open-world | hybrid |
| Pokémon Legends (Arceus, ZA) | Creature-Collector | open-world, field-research | hybrid |
| Mario Odyssey | Collectathon Platformer | — | hybrid |
| Disco Elysium | Party CRPG | branching-narrative, *no-combat* | branching |
| 007 First Light *(new)* | Action-Adventure | stealth, shooter | sequential |
| Subnautica 2 *(new)* | Survival / Crafting | open-world | hybrid |
| Resident Evil Requiem *(new)* | Action-Adventure | survival-resource, puzzle, horror | sequential + strategy |
| LEGO Batman: Legacy of the Dark Knight | Collectathon Platformer | co-op | hybrid |
| Elden Ring | Open-World Action-RPG | open-world, soulslike | hybrid |
| Slay the Spire 2 *(new)* | Roguelike / Deckbuilder | run-based | reference/strategy |
| Baldur's Gate 3 | Party CRPG | branching-narrative, turn-based-tactics, party | branching + hybrid |
| Zelda: Majora's Mask | Action-Adventure | time-loop, puzzle | hybrid (route + timetable) |

Seven packs and a handful of tags cover all twelve. That's the framework doing its job: no game on this list needs a bespoke system — Majora's Mask, the most structurally unusual of them, is just pack A plus the `time-loop` tag.

> Note the *(new)* titles. Brand-new and data-heavy releases (especially Pokémon and RE entries, whose precise data gets corrected for weeks post-launch) should be flagged low-confidence and *queued to wait* for reliable community sources — the Advisor treats them as "high demand now, build in a fortnight."

---

## 7. Rollout

- **Build the framework now** (detection + pack/tag/shape concepts), and treat the existing action-adventure engine as pack A.
- **Build each pack on demand**, when the first game that needs it is queued — not speculatively. The reference and branching *guide shapes* are the main new engineering; build the first one when BG3 or Slay the Spire reaches the top of your list.
- **Order by your roadmap and by data-readiness**, not hype: an established game with deep sources (Elden Ring, BG3, Odyssey) is a safer, higher-quality first non-Zelda build than a brand-new release whose data is still settling.
- Each new pack is the real test of Principle 0: if adding it requires touching the core engine rather than just loading a module, the abstraction leaked — fix the abstraction, not the symptom.
