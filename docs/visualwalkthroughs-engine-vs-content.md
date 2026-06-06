# VisualWalkthroughs — Engine vs Content (and token efficiency)

How the project is laid out so that adding a game is a cheap *data* operation, not an expensive *code* one — and where the box art comes from.

---

## 1. The principle

The engine is a printing press; everything that grows or changes over time is a plate you swap in. **Code is written once and rarely touched. Anything that accumulates — games, franchises, genres, prompts, config — lives outside the engine as data the nightly run loads.** The test for where something belongs: *does it change how the engine works, or just what the engine is fed?* If it's "what it's fed," it's data.

This is what makes daily adds cheap: the nightly run never re-reads the engine's implementation to add a game to it, any more than you re-read a spreadsheet's source code to add a row.

---

## 2. The layout

```
/src/engine/            code — schema, sequencer, QA gates, renderers, map component.
                        Stable. The nightly run loads its INTERFACES (schema), not its guts.
/content/
    games/              one file per game  → wind-waker-hd.json, elden-ring.json …
    franchises/         franchise info + per-IP theming (colours) + key art reference
/genre-packs/           one file per genre — thesis, added fields, research checklist, QA rules
/taxonomy/genres.json   the genre + tag vocabulary itself (edit when a new genre popularises)
/prompts/               research, draft, QA-fix, advisor prompts — versioned
/prompts/style-guide    the house voice
/assets/covers/         box art, re-hosted on your own CDN (see §5)
pipeline.config.json    budget caps, model-per-step, research limits
queue.md / feedback.md  your daily inputs
/reports/               morning reports
```

Adding a game = writing one file in `/content/games/`. The engine is untouched. A new genre = one file in `/genre-packs/` (plus, occasionally, one small UI widget — see §4). Existing games are never disturbed by either.

---

## 3. What this buys you (the token win)

The nightly run loads only **what tonight's game needs**: that game's data file, its one or two genre packs, and the cached prompts. It does *not* re-ingest the engine implementation, the other games, or unused genre packs. Your 50th genre pack costs nothing on a night you build an action-adventure game.

Result: the *fixed overhead* of "knowing how to build a guide" drops to near-zero, and spend concentrates where you actually want it — research and writing. That's the right place for the cost to live, because that's where depth comes from.

---

## 4. Efficiency levers (set these in the pipeline)

In order of impact:

1. **Per-game data files** — the structural fix above. The nightly run reads the schema (interface) + tonight's game file, never the engine's code.
2. **Prompt caching on the fixed rules** — the style guide, schema, research checklist, and house rules are identical every night. Cached, that repeated input costs ~10% of full price. On a daily cadence this is the single biggest lever. Mark them as cached context.
3. **Work section by section** — draft and validate one section at a time: each call carries only that section's facts plus the cached rules, not the whole game. A bad section re-rolls for pennies instead of regenerating the guide.
4. **Model per step** — Haiku for mechanical work (formatting, schema-filling, simple validation); the stronger model only for genuine reasoning (research synthesis, sequencing graph, editorial stress-tests).
5. **Incremental feedback** — a `feedback.md` note rewrites the *unit that changed* (a step, a section), never the whole game.
6. **Research budget cap** — research is the variable cost that balloons. Cap sources/fetched pages per game and lean on canonical wikis over broad crawling.
7. **Token instrumentation** — the morning report prints a per-game breakdown: tokens on loading vs research vs drafting vs QA. You currently *feel* the cost is high but can't see where it goes; make it visible and you'll know which lever to pull.

> **The honest trade.** Depth raises research and drafting cost on purpose — that's intended, not waste. Within the fixed £20 the lever you trade is **cadence, not quality**: a great game every two or three nights, not a thin one nightly. Levers 1–3 are what keep that cost *clean* (no overhead), so every token goes to the guide itself.

---

## 5. Genre packs: mostly data, occasionally one widget

A genre pack is largely declarative — its stuck-point thesis, the fields it adds, the research checklist, the QA gates — all data the run loads. The one exception: a genre that needs a genuinely new *visual component* (a type-matchup table for Pokémon, a card grid for a deckbuilder) — that component is code. So adding a genre is "a data file, plus sometimes one small widget," never an engine rewrite. The press stays the same; sometimes you add a font to it.

---

## 6. Box art — franchise and game grids only

The dull gradient tiles are placeholders; the cover source was never wired in. The fix, scoped strictly to the **franchise grid** and the **game-selection grid** (not section tiles):

- **Source: IGDB** (the games database, free via a Twitch developer key) for cover art.
- **Pipeline:** when a game is created, fetch its cover from IGDB → **re-host it on your own CDN** (don't hot-link a third party at render time) → store the path in the game's data file. Optimise to AVIF/WebP and the right size. Franchise tiles use a representative cover or franchise key art via the same flow.
- **Fallback:** if IGDB has no usable cover (very new or obscure), fall back to the clean styled placeholder — never a wrong or AI-generated image. Inaccurate art is worse than a tasteful placeholder.
- **Rights posture:** covers are the publishers' copyright, used here for identification, as fan and wiki sites do. Your compliance pack's attribution and takedown policy already covers this — it's accepted risk, not zero risk.

**Out of scope:** section tiles get no box art. There is no official "art" for "chapter 2," and creator video thumbnails are a wildcard — reused across chapters and often mismatched — so they're rejected as section art. Section richness comes from the content and the interactive map, not from a stretched, possibly-wrong image. Selection grids get real covers; everything else stays clean and typographic.

---

## 7. Sequencing note

The engine/content separation and prompt caching are worth doing **before** more heavy depth iteration, because they make every "fix this section" re-roll a cheap, section-level cached operation instead of reprocessing the whole game. They don't change content quality — only structure and cost — so they're low-risk to land mid-project, and they pay for themselves immediately during the depth-tuning you're doing now.
