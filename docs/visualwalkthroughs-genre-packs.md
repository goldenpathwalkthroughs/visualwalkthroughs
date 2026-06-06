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
- **Stuck because:** can't find the way forward, a puzzle, or a boss. → route + locations + bosses. (Your current engine.)
- Guide shape: sequential / hybrid.

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
- **Stuck because:** "my team can't beat this gym/boss," "where do I catch X," "how do I evolve Y." Team composition and collection, on top of a story route.
- **Adds:** `Creature` type (catch location/method, evolution conditions, version exclusives, trade evolutions); `TeamComposition`/type-matchup advisories per major battle; typed trainer/gym battles; level-curve guidance.
- **Research:** catch locations & methods, evolution methods, version differences, recommended team per gym, level expectations.
- **UI:** a type-matchup helper; a catch-location index; a living Pokédex-style checklist.
- **QA:** every gym/major battle carries a recommended counter-team; every listed creature has a catch method.
- Shape: hybrid (story route + creature/team reference). *(A `field-research` tag covers the Legends-style catch mechanics that differ from mainline.)*

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

Small, reusable. Examples: `open-world` (region routing + soft gating), `soulslike` (build + brutal-boss handling), `branching-narrative` (decisions/consequences/missables), `stealth` (detection, routes, non-lethal options), `survival-resource` (when to fight vs flee, save/resource management — RE-style), `co-op` (character-gated content, who-does-what), `run-based` (shifts guide shape toward reference + strategy), `field-research` (Legends-style catching). These map onto the taxonomy's "hybrid & taggable features."

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

Seven packs and a handful of tags cover all eleven. That's the framework doing its job: no game on this list needs a bespoke system.

> Note the *(new)* titles. Brand-new and data-heavy releases (especially Pokémon and RE entries, whose precise data gets corrected for weeks post-launch) should be flagged low-confidence and *queued to wait* for reliable community sources — the Advisor treats them as "high demand now, build in a fortnight."

---

## 7. Rollout

- **Build the framework now** (detection + pack/tag/shape concepts), and treat the existing action-adventure engine as pack A.
- **Build each pack on demand**, when the first game that needs it is queued — not speculatively. The reference and branching *guide shapes* are the main new engineering; build the first one when BG3 or Slay the Spire reaches the top of your list.
- **Order by your roadmap and by data-readiness**, not hype: an established game with deep sources (Elden Ring, BG3, Odyssey) is a safer, higher-quality first non-Zelda build than a brand-new release whose data is still settling.
- Each new pack is the real test of Principle 0: if adding it requires touching the core engine rather than just loading a module, the abstraction leaked — fix the abstraction, not the symptom.
