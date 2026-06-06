# VisualWalkthroughs — Content Engine v2
### Turning "competent" walkthroughs into S-tier ones

This is an upgrade spec for the content system (research → compile → edit), written for Claude Code (Sonnet) to implement. It complements the existing architecture/pipeline/style docs; it doesn't replace them. The goal: close the gaps a player who finished the game can feel — sequencing, prerequisites, hubs, big collection quests, and visuals.

Reference note: the Prima guide is our **completeness benchmark only** — it shows *what categories* a complete guide covers. The system keeps writing original prose cross-checked across multiple sources. We never reproduce its text or its (scanned, copyrighted) screenshots.

---

## 0. Principle zero: build capabilities, not Wind Waker

**This is a content engine for thousands of story games. Wind Waker HD is the first test case, not the design target.** Everything in this spec must work for any narrative game — RPGs, metroidvanias, action-adventures — and nothing game-specific may live in the engine.

The test for any line you write: **is this a *capability* or a *fact?***
- **Capabilities are game-agnostic and belong in code/prompts:** "items gate optional activities," "collection quests have a canonical count," "maps have regions," "detours surface when their prerequisites are met." Build these.
- **Facts are per-game and are *discovered by the researcher*, never hardcoded:** item names, map dimensions, collectible totals, character and place names, specific methods. These live only in a game's content files.

Hard rule: **no game-specific proper noun may appear in any `.ts` file or any prompt.** If "7×7", "Skull Hammer", "Ballad of Gales", "44 Pieces of Heart", or "Tingle" shows up in code or a prompt, that's a bug. Every Wind Waker example below is an *illustration of a general shape* — implement the shape, not the example.

How to keep it honest: prove the engine on Wind Waker (a game the owner knows deeply), then immediately run a **structurally different** game through it (a linear RPG, a metroidvania) to expose anything you overfit. An engine validated on one game shape is a Wind Waker shrine, not an engine.

---

## 1. The architectural shift: a progression graph, not hand-written tips

The biggest quality lever. Stop hand-writing "do this now" advice; **compute it** from a model of the game.

Model two things explicitly:
- **An item/ability timeline** — when, on the golden path, the player gains each key item, song, or ability.
- **A dependency graph** — every optional activity declares what it *requires*.

Then the compiler walks the golden path and, at each checkpoint, automatically surfaces exactly the detours whose requirements are now met and not yet shown. This is what guarantees nothing is recommended too early, and nothing time-sensitive is forgotten.

---

## 2. Schema upgrades

Add to the content schema:

```
Game.worldMap:
  kind: "grid" | "regions"
  grid?: { cols, rows }                 // e.g. 7×7 for the Great Sea
  cells: [{ coord, name, regionId,
            goldenPathRelevance,        // none | passes-through | required
            secrets: [collectibleId],
            requires: [itemId] }]       // what you need to access/clear it

Game.items: [                            // the registry that drives everything
  { id, name, type: item|song|ability|upgrade,
    acquiredAtSectionId,                 // where on the golden path you get it
    class: progression | optional } ]

Section.unlocks: [itemId]                // items gained in this section
Section.gates:   [itemId]                // items REQUIRED to progress here (mandatory)
Section.recommendedDetours: [detourId]   // COMPUTED, not written

Detour: {                                // an optional, character-strengthening activity
  id, location, coord?,
  type: upgrade | heart | rupee | secret | convenience,
  requires: [itemId],
  benefit,                               // "Bomb Bag 30→60", "+1 heart", "map-wide warp"
  method,                                // the correct way to do it
  earliestSectionId,                     // first point it's possible
  recommendedSectionId,                  // when we tell the player (often = earliest)
  mandatory: false }

Collectible: {                           // gains prerequisites + method + counting
  ..., requires: [itemId], method, locationDetail,
  category, categoryTotalKnown }         // e.g. category "Piece of Heart", total 44

CollectionQuest: {                       // for big multi-part hunts (Triforce)
  id, name, totalCount,
  items: [{ label, chartLocation, decipherStep, salvageLocation, requires: [itemId] }] }

Location.isHub: bool                      // recurring places you return to (Windfall)
Location.activities: [{ label, requires: [itemId], benefit }]

Step.videoTimestamp?: number             // seconds — deep-link the embed to this moment
```

---

## 3. The expanded research checklist (the researcher's brief)

For **every** game, the researcher must gather (and cite ≥2 sources for each load-bearing fact). This checklist is the antidote to "significant gaps":

1. **Golden path** — ordered story objectives, start to credits, each with location, method, and boss strategy.
2. **Item/ability timeline** — where each key item, song, and ability is obtained along that path.
3. **Progression gates** — anything that *blocks* golden-path progress (e.g. fire/ice arrows needed to proceed): what's required, and where to get it. Flag these as mandatory, distinct from optional power-ups.
4. **World map** — the grid or region layout, what's in each cell/region, and prerequisites to access each.
5. **Optional power detours** — every upgrade, heart, rupee cache, and secret, with `requires`, `benefit`, `method`, and earliest-available point.
6. **Hubs** — recurring locations (Windfall-class) and what becomes available there as the player gains items over time.
7. **Major collection quests** — full enumeration of multi-part collectibles (Triforce-class): every piece, its chart, decipher step, and salvage location. Never a one-line summary of a multi-hour activity.
8. **Convenience / efficiency unlocks** — fast-travel and big time-savers (Ballad of Gales-class): when they become available, the *correct* acquisition method, and why getting them early pays off.
9. **Canonical counts** — the known total for each collectible category (Pieces of Heart, shards, etc.) so completeness can be verified.
10. **Confidence** — flag any single-source or uncertain fact as low-confidence rather than stating it firmly.

> **Method accuracy is non-negotiable.** The "I wasted time bombing the frog when it needed arrows" failure is a research-accuracy bug. Every key method gets cross-checked across sources; if sources disagree, flag it, don't guess.

---

## 4. The sequencing engine (the compiler's job)

Walk the golden path section by section. Maintain the set of items acquired so far. At each section:

- Emit a **"Now available"** block: every Detour whose `requires` ⊆ acquired-items, not yet surfaced, sorted by benefit. Mark clearly **optional**, with the benefit and a one-line *why now* (e.g. "grab the warp song now — it saves hours of sailing for the rest of the game").
- Emit any **mandatory gate** warnings for the *next* section ("you'll need fire arrows to continue past here — here's where to get them").
- For **hubs**, emit a "back at [hub], you can now…" block when new activities unlock there.

This is what produces correct, time-aware advice automatically: optional power detours appear at the moment they're both possible and beneficial; mandatory gates are flagged before the player hits the wall; convenience unlocks are pushed early.

Two clearly separated categories in the UI: **must-do to progress** vs **recommended to strengthen your character**. The player should never confuse a hard gate with an optional side-trip.

---

## 5. The world map (the feature you missed most)

Build an original `WorldMap` component as a **layout abstraction**, not a grid. Most games aren't grids — they're connected regions, hub-and-spoke overworlds, or metroidvania maps — so the component takes a `kind` and renders accordingly behind one common interface:
- `grid` — a coordinate grid (a sea/overworld divided into squares). **Implement this first**, because the first test case needs it.
- `regions` — connected named areas with adjacency.
- (extensible) metroidvania-style interconnected maps.

Whatever the layout, each node is clickable, shows its name, a marker for golden-path relevance, and — in Completionist mode — its secrets and the items required to reach them, and links to the section/detour that covers it. The data is original (built from researched facts, per game); the art is our own. This is the single highest-value visual addition, and it must not assume any particular game's shape.

---

## 6. The screenshots question — resolved

Prima's screenshots are scanned, copyrighted page images; we can't reuse them, and AI-generated fake screenshots would be inaccurate (dangerous in a walkthrough). The original, legal, and arguably *better* substitutes:

1. **Timestamped video moments.** Add `videoTimestamp` to steps and deep-link the existing embedded clip to the exact second (`...embed/ID?start=NN`). For "which way do I aim / where do I go," a 5-second clip beats a static screenshot — and the video is already there.
2. **Original maps and diagrams.** The world grid (above), plus simple original route arrows drawn on our own map art for tricky navigation.
3. **(Optional, with care)** openly-licensed community map assets — only if the licence is verified; default to building our own.

Net: per-step *visual aim cues* become timestamped clips; *spatial/where-is-it* cues become the original map. No copyrighted images, and a more modern result than static screenshots.

---

## 7. What model to research with

You want S-tier, and that won't come from Haiku alone. Recommended split:

- **Research + sequencing + editorial stress-tests → Sonnet.** These are the reasoning-heavy steps where quality is made or lost (synthesising many sources, building the dependency graph, auditing completeness). Sonnet is the right tool.
- **Bulk formatting, schema-filling, simple rewrites, validation → Haiku.** Cheap grunt work.
- **(Optional) escalate only the hardest completeness audit → Opus** if you later raise the budget.

**Honest trade-off:** Sonnet costs ~3× Haiku per token, so within the fixed £20 Agent SDK credit you'll produce **fewer games per month** — think a polished game every 2–3 nights rather than nightly. For S-tier that's the right call: depth over volume, exactly as you've been saying. Prompt-cache the style guide and the research checklist to claw a lot of that cost back. Keep overflow OFF; the cap still holds — you'll just build less often, not overspend.

---

## 8. Content QA — the stress tests (the editor's job)

After drafting, the editor runs these gates and loops until they pass. This is the "stress test for golden-path, then completionist, then structure" you described:

1. **Golden-path completion test.** Simulate a first-time player following only the golden-path steps to the credits. Flag any break: an item used before it's acquired, a location referenced but never reached, a boss with no strategy, a dead-end.
2. **Completionist completion test.** For each collectible category, check the guide lists the full canonical count, and that every entry has a location, a method, and satisfied prerequisites. Flag anything missing or uncounted.
3. **Sequencing / prerequisite audit.** Graph check: every detour's `recommendedSectionId` must be ≥ the acquisition point of all its `requires`. This is the automated catch for "recommended too early."
4. **Coverage-weight check.** Major, time-heavy segments (the Triforce hunt) must have depth proportional to their size. Flag a multi-hour activity covered in one line.
5. **Method-accuracy check.** Key methods cross-checked across ≥2 sources; disagreements flagged, not guessed.

Only when all five pass does the game proceed to the existing site-QA and publish stages.

---

## 9. The role flow, upgraded

- **Researcher (Sonnet):** fills the §3 checklist into a structured, cited fact sheet — including the item timeline, dependency graph, hubs, and full collection-quest enumerations.
- **Compiler (Sonnet/Haiku):** assembles the schema and runs the §4 sequencing engine to compute the "now available" blocks and gate warnings.
- **Editor (Sonnet):** runs the §8 stress tests and loops until S-tier; writes a content-QA note into the morning report (what it checked, what it flagged).

---

## 10. Rollout — prove depth, then prove generality

Two stages, in order:

1. **Depth test — Wind Waker HD.** Regenerate it under this spec and compare its *coverage* against the Prima benchmark: does it now have the world map, the full multi-part Triforce breakdown, correctly-timed upgrade detours, the recurring hub, and the early warp-song call? The owner's just-completed playthrough is the acceptance test.
2. **Generality test — a structurally different game.** Immediately run a game with a *different shape* through the unchanged engine — a linear RPG or a metroidvania, whose map is regions-not-grid and whose progression differs. This is the test that proves you built an engine and not a Wind Waker shrine: watch for any place the code or prompts assumed grids, sea-sailing, or Zelda-shaped progression, and fix the abstraction.

Only after a game passes the generality test unchanged should you trust the engine on the long tail of future titles.
