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

## 1. The architectural shift: a recommended route over a graph, not rails

The biggest quality lever. Stop hand-writing "do this now" advice; **compute it** from a model of the game. And — critically — **don't assume the game is linear.**

Model the game as a **graph of objectives/regions** with a **recommended route** laid over the top. A strictly linear game is just the degenerate case where that graph is a single chain. Most modern games aren't:
- **Open (Breath of the Wild-class):** there's a recommended route that keeps the game palatable for an average player, but the *critical path* — what's strictly required to reach the ending — is tiny, and almost everything is skippable.
- **Hub-and-regions / soft-gated (Mina the Hollower-class):** a hub connects regions you can tackle in many orders; progress is gated by *readiness and skill*, not hard locks.
- **Metroidvania:** regions open as you gain abilities (hard gating), but in a branching order.

So model these explicitly per game:
- **`structureType`** — linear | hub-and-spoke | open | metroidvania (extensible).
- **Recommended route** — the curated order that makes the game palatable. *This is the editorial value* and what most readers follow.
- **Critical (minimum) path** — what's strictly required to finish. Surface it for players who want to know what's skippable.
- **Any-order clusters** — sets of objectives doable in any sequence; never present these as forced-linear.
- **Gating type per step** — *hard* (item/ability lock) vs *soft* (you can go now, but it's tuned for later — expect a tough time).

Then the compiler walks the **recommended route**, and at each point surfaces the detours/objectives now available — by hard prerequisite where gating is hard, and by *readiness* where gating is soft ("you can reach this now; recommended after X for an easier fight"). Each objective/region page also stands alone, so a reader who sequence-breaks can still navigate by where they actually are.

> **Structure is a discovered fact, not an assumption.** A brand-new or obscure game (Mina released into a world where no model has training knowledge of it) must have its `structureType` and route **classified from live sources during research** — never pattern-matched from memory or from a similar-sounding title. This is the §0 principle extended: don't bake in facts, and don't bake in *shape* either. Flag low confidence when sources are thin.

---

## 2. Schema upgrades

Add to the content schema:

```
Game.structure:                          // discovered per game, NEVER assumed
  structureType: linear | hub-and-spoke | open | metroidvania
  recommendedRoute: [objectiveId]        // the curated, palatable order most readers follow
  criticalPath: [objectiveId]            // the minimum strictly required to finish (may be tiny)
  anyOrderGroups: [[objectiveId]]        // clusters doable in any sequence — never forced linear

Game.worldMap:
  kind: "grid" | "regions" | "metroidvania"
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
Section.gates:   [itemId]                // HARD prerequisites to progress here
Section.gatingType: hard | soft          // soft = reachable now, but tuned for later
Section.readinessNote?                   // for soft gates: "doable now; tough before X"
Section.skippable: bool                  // not on the critical path
Section.routeOrder?: number              // position in the recommended route
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

Location: {                              // THE shared vocabulary for map AND text
  id, name,
  ref,                                   // canonical reference the text cites: grid coord ("F2")
                                         //   for grid games, named region otherwise
  coord?,                                // grid cell, if the game is grid-based
  reachableBy,                           // how you get here ("sail from Outset", "warp via song")
  whereWithin?,                          // sub-location detail ("the east cliff", "room past the throne")
  isHub: bool,                           // recurring place you return to
  contains: [{ label, kind, requires: [itemId], sectionId }] }  // beats, NPCs, secrets, shops here

BossFight: {                             // a first-class type — never a single sentence
  id, name, locationRef,
  prep: { recommendedItems: [itemId], healthAdvice, topUpBefore },  // how to be ready
  phases: [{ name, tells, counter, damageWindow }],                 // each phase: what it does + how to beat it
  ifYouStruggle: { whereToHeal, easierTactic, retreatOption },      // the bounce-point safety net
  reward }

Step.videoTimestamp?: number             // seconds — deep-link the embed to this moment
Step.locationRef?: string                // EVERY actionable step resolves to a Location.ref
```

---

## 3. The expanded research checklist (the researcher's brief)

For **every** game, the researcher must gather (and cite ≥2 sources for each load-bearing fact). This checklist is the antidote to "significant gaps":

1. **Structure first** — classify the game from live sources: linear, hub-and-spoke, open, or metroidvania? Identify the **recommended route**, the **critical (minimum) path**, and any **any-order clusters**. Never assume linearity or pattern-match a similar game. For very new or obscure titles, rely entirely on current sources and flag confidence.
2. **Recommended route** — the curated, palatable order from start to credits, each objective with location, method, and boss strategy. (For a linear game this is simply the one path.)
3. **Item/ability timeline** — where each key item, song, and ability is obtained along the route.
4. **Gating per step** — *hard* (item/ability lock) or *soft* (reachable early but tuned for later)? For soft gates, capture the readiness expectation ("doable now, brutal before X"). Flag mandatory progression gates distinctly from optional power-ups.
5. **World map** — the grid/region/metroidvania layout, what's in each area, and prerequisites to access each.
6. **Optional power detours** — every upgrade, heart, resource cache, and secret, with `requires`, `benefit`, `method`, and earliest-available point.
7. **Hubs** — recurring locations and what becomes available there as the player gains items over time.
8. **Major collection quests** — full enumeration of multi-part collectibles: every piece and how to get it. Never a one-line summary of a multi-hour activity.
9. **Convenience / efficiency unlocks** — fast-travel and big time-savers: when they become available, the *correct* acquisition method, and why getting them early pays off.
10. **Skippability** — for each objective, is it on the critical path or genuinely optional? Open games hinge on telling the player what they can skip.
11. **Canonical counts** — the known total for each collectible category so completeness can be verified.
12. **Confidence** — flag any single-source or uncertain fact as low-confidence rather than stating it firmly.
13. **Boss fights — full breakdown.** For each boss: its phases, the tells/attacks in each, the concrete counter for each, the recommended prep/loadout, and where to recover (hearts, fairies, potions) if the player is struggling. A boss is never a one-line note.
14. **Locations — build the registry.** Every place, NPC, and object the guide references gets a `Location`: a canonical reference (grid coord for grid games, named region otherwise), how to reach it, and what's there. If a place isn't in the registry, the guide may not reference it.

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

## 5. The world map — interactive, and built from the Location registry

The map is not decoration; it's the navigation layer, and it renders from `Game.locations` — the *same* registry the written steps cite. That shared vocabulary is what fixes "where is the ivy / where is Komali": if a place isn't in the registry, the writer can't reference it, and the map can't omit it.

Requirements:
- **Labelled.** For grid games, draw the coordinate labels (rows A–G, columns 1–7, or whatever the game uses) so a cell is unambiguously "F2". The written guide uses these exact refs.
- **Complete.** Every `Location` in the registry appears on the map — no partial maps. A map-completeness QA check enforces this against the registry.
- **Interactive — click to learn about a place.** Clicking a cell/pin opens a **detail panel** (a slide-in side panel on desktop, a bottom sheet on mobile — better than a small pop-up because it holds real content and works on touch). The panel shows: name + ref, how to reach it, what's here (golden-path beats, secrets, shops, NPCs — respecting the spoiler-safe and Completionist toggles), prerequisites to access, and a **"go to the walkthrough section"** button. Lazy-load the panel's detail on open.
- **Expandable overview.** The world-overview section collapses/expands like the walkthrough sections.

**Is this worth it for non-grid / open games?** Yes — but separate two things:
- The **interactive click-to-detail map is universal**: it's the orientation layer for any game with a navigable space. Open and region games show named pins on a region map (same panel on click); the only thing that changes is the layout, not the value.
- The **grid coordinate labels are grid-games only.** Region/open games reference places by name, not "F2".
- The map is **optional and scaled to the game.** A linear corridor game with no overworld doesn't get a map — the research step (which already classifies `structureType`) decides whether a navigable space exists worth orienting in. Don't force a map where it adds nothing.

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

After drafting, the editor runs these gates and loops until they pass. This is the "stress test for the route, then completionist, then structure" you described:

1. **Recommended-route completion test.** Simulate a first-time player following only the recommended route to the credits. Flag any break: an item used before it's acquired, a location referenced but never reached, a boss with no strategy, a dead-end.
2. **Critical-path validity test.** Confirm the stated minimum path actually reaches the ending — important for open games where most content is skippable and players want to know what's truly required.
3. **No-false-linearity check.** Any-order clusters must be presented as such, not as a forced sequence; skippable objectives must be marked skippable. Catch a linear write-up imposed on a non-linear game.
4. **Completionist completion test.** For each collectible category, check the guide lists the full canonical count, and that every entry has a location, a method, and satisfied prerequisites. Flag anything missing or uncounted.
5. **Sequencing / readiness audit.** Graph check: every hard-gated detour's `recommendedSectionId` must be ≥ the acquisition point of all its `requires` (the catch for "recommended too early"); every soft-gated one must carry a readiness note.
6. **Coverage-weight check.** Major, time-heavy segments must have depth proportional to their size. Flag a multi-hour activity covered in one line.
7. **Method-accuracy check.** Key methods cross-checked across ≥2 sources; disagreements flagged, not guessed.
8. **No-assumed-knowledge / specificity test (the big one).** Read every step as a player who has never touched the game. Flag any instruction that names a place, NPC, or object to find without saying *where it is and how to reach it*, and any action without concrete inputs. "Deliver the letter to Komali" fails until it says where Komali is; "climb the ivy" fails until it says which wall; "head to the cyclone" fails until it gives the ref. If a human would have to already know the game to follow the line, it doesn't pass.
9. **Location-reference completeness.** Every place the text mentions resolves to a `Location` in the registry (with a `ref`), and the map renders every registry location — no partial maps, no unreferenced places.
10. **Boss-fight depth check.** Every `BossFight` has prep, at least one fully-described phase (tells + counter + damage window), and an "if you struggle" recovery note (where to heal, an easier tactic). Flag any boss reduced to a single sentence — these are the bounce points where players quit.

Only when all gates pass does the game proceed to the existing site-QA and publish stages.

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
