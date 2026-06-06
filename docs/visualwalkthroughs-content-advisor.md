# VisualWalkthroughs — The Content Advisor
### The AI step that tells you what to build next

A small, daily-running advisor whose only job is to hand you a short, ranked shortlist of the most valuable walkthroughs to make next — so your evening "pick games" decision takes thirty seconds and is well-informed. This is the **one place a human stays in the loop by design**: the advisor signposts, you choose, your choice goes into the queue.

It runs as part of the nightly job (cheap — it's a small amount of reasoning over public signals) and writes its shortlist into the morning report.

---

## 1. The job, in one line

Each day, propose the games that will earn the most reader value per pound of writing budget — and **only** games that actually suit a step-by-step story walkthrough.

---

## 2. The eligibility gate (a game must pass this first)

Before anything is scored, a candidate must have a **guidable route** — defined story objectives a walkthrough can guide a player through, whether the game is strictly linear or an open world with a recommended path. It does **not** have to be linear: an open game like Breath of the Wild qualifies, because it still has objectives and a route most players want guided, even though much is skippable. What disqualifies a game is the *absence of guidable objectives*, not the *freedom to skip them*. If it fails this, it is never recommended, no matter how popular.

**Include (eligible):** any story/objective-driven game — linear, semi-linear, hub-based, open-world, or metroidvania: action-adventure, RPGs, story-led platformers, narrative shooters, survival-horror. *Examples of the shape:* The Legend of Zelda (linear *and* open entries), Final Fantasy, God of War, Metroid, Resident Evil, Hollow Knight, Elden Ring, Mina the Hollower.

**Exclude (ineligible):** narrative-free titles where there's no objective to be stuck on — competitive/multiplayer-only (battle royales, hero shooters, MOBAs), sports and racing sims, pure sandboxes and builders, abstract puzzle games, party games, and roguelikes/roguelites with no story spine.

**Borderline → flag for the human, don't auto-recommend:** games with goals but no real route to guide (life-sims, colony-sims, some survival-crafting). Surface them separately labelled "uncertain — has goals but little to guide; your call."

> Rule of thumb the advisor applies: *"Could a player be 'stuck' on a specific next objective that written steps would unblock?"* If yes, eligible — even if the game is wide open and that objective is one of many. If the game has no objectives to be stuck on, it's out.

The advisor uses IGDB/game-metadata (genre, themes, "has a campaign/story" signals) plus a quick reasoning check to decide eligibility, and **flags low-confidence calls** rather than guessing.

---

## 3. The value signals (for eligible games only)

Three things make a walkthrough worth building. The advisor estimates each from cheap, public data.

1. **Demand — is anyone looking for this?**
   - *New & popular:* recent or upcoming releases generating buzz (release calendars, store charts, trending coverage).
   - *Evergreen / legacy:* older games that *still* pull steady walkthrough searches year after year (the quiet, reliable traffic — often more valuable than chasing a launch).
2. **Gap — is the demand underserved, and do we already have it?**
   - Skip anything already in your library or in tonight's queue.
   - Favour games where existing guides are thin, ugly, fragmented, or paywalled — the whole reason this site exists.
3. **Fit — can we actually do it well, cheaply?**
   - Are there enough reliable sources to research from?
   - Does its length fit the nightly budget, or should it be flagged as a multi-night build?

---

## 4. How it ranks them

A simple, transparent score the human can sanity-check:

**Priority ≈ Demand × Gap × Fit**, each rated low/medium/high, with a **confidence** note.

Then it returns a **ranked shortlist (top 5)** with a one-line reason each — never a wall of data. It deliberately mixes types so you're not all-in on hype: aim for roughly **one hot new release + a couple of evergreen legacy picks + one gap-filler** per shortlist.

---

## 5. Where it gets its data (all cheap/public)

- **Release & popularity:** web search of release calendars, storefront charts, and trending gaming coverage.
- **Search demand:** public trend signals and autocomplete patterns for "[game] walkthrough/guide" — a direct proxy for who's stuck and looking.
- **Legacy demand:** which older titles still surface strongly for guide searches.
- **Eligibility metadata:** IGDB genre/theme/campaign data (already in your stack for box art).
- **Your own analytics (once you have traffic — the best signal of all):** which sections readers open most (where people get stuck), and especially **internal searches that returned nothing** — that's your audience explicitly asking for a game you don't have yet. Weight these heavily as they accumulate.

---

## 6. The daily signpost (output format)

A short block at the top of your morning report:

```
ADVISOR — build-next shortlist (2026-06-06)

1. Silksong (new release, huge buzz) — eligible (story Metroidvania)
   demand HIGH · gap HIGH (guides still thin) · fit HIGH · confidence HIGH
2. Ocarina of Time (evergreen) — eligible
   demand MED-HIGH (steady searches) · gap MED · fit HIGH
3. Final Fantasy VII Rebirth — eligible
   demand HIGH · gap MED · fit MED (long — flag as 2-night build)
4. Chrono Trigger (legacy gem) — eligible
   demand MED · gap HIGH · fit HIGH
5. Hollow Knight (backfill) — eligible
   demand MED · gap MED · fit HIGH

FLAGGED — your call (soft progression, no fixed golden path):
   • Stardew Valley — has goals, no story path. Skip for now?

ALREADY COVERED / IN QUEUE: Wind Waker HD, Majora's Mask
```

You glance, you pick, you paste your choices into `queue.md`. Done.

---

## 7. Cadence & handoff

- Runs nightly as part of the pipeline; shortlist appears in the morning report.
- You make the call during the day and queue tonight's pick(s) in the evening.
- It remembers what's already covered or in progress so it never repeats itself.

---

## 8. Guardrails

- **Never recommend an ineligible genre.** The story-path gate is absolute.
- **Flag, don't guess** on borderline eligibility and on low-confidence demand estimates.
- **No duplicates** — exclude published, in-queue, and in-progress games.
- **Respect the budget** — if a game is too large for one night, recommend it *with* a "multi-night" flag rather than silently overspending.
- **Diversify** — don't return five near-identical hype picks; balance new vs evergreen vs gap-fill.
- **Stay advisory** — it proposes; it never auto-queues. The human's pick is the trigger.

---

## 9. Why this is worth a dedicated step

Left alone, an autonomous content factory will happily produce walkthroughs nobody searches for. The advisor is the difference between *busy* and *valuable*: it points the night's single, budget-limited build at the game most likely to earn readers — and keeps you, the one human touchpoint, making a fast, well-informed choice instead of guessing.
