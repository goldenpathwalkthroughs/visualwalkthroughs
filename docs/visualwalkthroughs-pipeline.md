# VisualWalkthroughs — Autonomous Overnight Content Pipeline

**Codename: The Night Shift.** A spec for an unattended agent that turns a queue of game titles into published, QA'd, 2000s-Prima-style walkthroughs while you sleep, and leaves a report for the morning.

Built on your three decisions:
- Publishing target: **the Next.js + CMS stack from the architecture doc.**
- Going live: **straight to production**, no human approval overnight.
- Fix autonomy: **full code + redeploy.**

---

## 0. The principle that makes maximum autonomy safe

You removed the human from the loop. So the *machine* has to be the loop. The whole design rests on one rule:

> **Nothing reaches production unless it passed every gate on an immutable preview first — and anything that breaks production after promotion is rolled back automatically, instantly, without a human.**

This is achievable because Vercel (and equivalent platforms) treat **every deploy as an immutable, separately-addressable artifact**. "Promote to production" and "roll back to the last good deploy" are atomic pointer-swaps that take seconds. That single property converts "straight to prod, full code autonomy" from reckless into merely bold.

**Residual risk, stated once and honestly:** an agent with code-write + redeploy rights can, in principle, ship a subtly-wrong page that passes automated checks but reads badly, or burn budget looping on a fix it can't make. The guardrails below cap the blast radius (additive-only, protected paths, spend/time limits, auto-rollback, full audit log), but they reduce risk — they don't zero it. The morning report exists so a bad night is caught by 9am, not by your users.

---

## 1. Components

| Component | Role |
|---|---|
| **Orchestrator** | The nightly agent loop. Runs the stages, holds the guardrail config, writes the audit log. |
| **Author model** | Claude Opus — validates, researches, writes content to schema, diagnoses QA failures, writes fixes. |
| **Research tools** | Web search + fetch; IGDB (game validation + covers); YouTube Data API (video candidates). |
| **CMS API** | Reads schema, writes `draft` content (Sanity/Payload from the architecture doc). |
| **Repo + deploy** | Git repo write access on a working branch; build + deploy via the platform CLI (e.g., Vercel). |
| **QA harness** | Headless browser (Playwright) + Lighthouse + visual-regression baseline. |
| **Queue** | A simple list the human appends to during the day: game titles + optional notes. |
| **Guardrail config** | A protected, agent-unwritable file defining limits, protected paths, and thresholds. |

---

## 2. The nightly run, stage by stage

Each queued game runs through this. Stages are sequential; failure routes to the fix loop or to "stop and report," never to a blind promote.

### Stage 0 — Intake
Read the queue. De-duplicate against already-published games. Order by queue position. Start the audit log for the night.

### Stage 1 — Validate the game is real
Look the title up in **IGDB**. If found, lock the canonical title, release year, platforms, and cover `image_id`. **If not found or ambiguous → do not invent it.** Mark the queue item `unverified`, skip it, and flag it in the morning report with the closest matches for you to disambiguate.

### Stage 2 — Research (the sourcing rules live here)
Gather facts from **multiple** public sources, then build a structured **fact sheet** with a citation for every claim: golden-path order, dungeons/bosses, item-gating, upgrade locations and *when they unlock*, easiest collectibles, missables, common stuck-points.

Hard rules, enforced, not optional:
- Sources are **reference for facts**, never text to reproduce or reword. The draft is written from the fact sheet, in original prose.
- Cross-check anything load-bearing across **≥2 independent sources**; single-source claims get flagged `low-confidence` in the content and the report.
- Prefer primary/permissive sources (official manuals, game text, wikis with open licenses) where they exist.
- Capture **video candidates** (YouTube IDs) per section but don't trust them yet — Stage 4 verifies them.

### Stage 3 — Author to schema
Opus fills the `Game → Section → {steps, advisories, collectibles, video}` schema from the architecture doc. House style is fixed in the system prompt:

- **Voice:** 2000s Prima / Official Nintendo Magazine — warm, thorough, confident, plainly readable; a guidebook, not a wiki dump.
- Golden-path steps first; then **typed advisories** (`do-now` carries the timing insight — "you can reach the bomb-bag fairy now because you finally have bombs"); then completionist collectibles, flagged.
- **Spoiler-tag** late-game reveals at the span level.
- Pick **one verified video per section**; write original `creator`/`title`/`duration` metadata.
- Emit **strict JSON** matching the schema (structured output / tool use), so it's machine-checkable.

### Stage 4 — Procedural validation (gate #1)
Automated, pass/fail. Any failure → fix loop. Checks:
1. **Schema validation** (Zod/CMS schema) — structure is exactly right.
2. **Completeness** — every golden-path section present and ordered; required fields non-empty; at least the agreed extras present.
3. **Originality / anti-plagiarism** — n-gram + embedding-similarity comparison of every prose block against the fetched source snippets. Over threshold → **rewrite that block** (this operationalizes the copyright constraint as code).
4. **Spoiler lint** — reveals are tagged; nothing major leaks in a section's first sentence.
5. **Video check** — each ID resolves, is public, and is **embeddable** (not embedding-disabled). Dead/blocked → swap for next candidate.
6. **Assets** — cover fetched from IGDB and **re-hosted to your own CDN** (never hot-linked); images optimized.
7. **Reading-level + link health** — within target; no broken links.

### Stage 5 — Build & deploy to PREVIEW
Write content as `draft` to the CMS on a working branch. Build. Deploy to an **immutable preview URL**. Production is untouched.

### Stage 6 — QA the preview (gate #2)
Playwright drives the real rendered preview:
- Page renders; sections expand/collapse; lazy video loads on click; TTS control present; spoiler toggle and completionist toggle work.
- **Zero console errors**; no failed network requests.
- **Lighthouse budgets** met (performance, SEO, accessibility ≥ targets) — SEO especially, since that's the point.
- **Visual regression** vs the approved baseline (catches layout breakage from any code change).
- **Mobile viewport** pass.
- Crawl check: walkthrough **text is present in server-rendered HTML** (indexable).

### Stage 7 — Fix loop (bounded)
On any gate failure, Opus gets the failure artifacts (logs, screenshots, diffs) and diagnoses:
- **Content fix** (bad/missing/over-similar prose) → rewrite, re-run from Stage 4.
- **Code fix** (component/style/build) → edit within guardrails on the working branch, re-run from Stage 5.

Bounded by `maxFixAttempts` (e.g., 3) and the night's time/spend budget. **If it can't reach all-green → it stops.** The content stays on preview, production is left exactly as it was, and the failure is escalated in the report. A broken build never gets promoted.

### Stage 8 — Promote to PRODUCTION + smoke test
Only a fully-green preview is promoted. "Straight to production" = the orchestrator promotes that immutable preview to the production alias — no human, but no blind build either. Then a **production smoke test** (canary): load the new live URLs, assert 200s, key elements present, no console errors.
- **Smoke pass** → done; tag the release for instant future rollback.
- **Smoke fail** → **auto-rollback** to the previous production deploy (seconds), mark the game `rolled-back`, escalate in the report.

### Stage 9 — Morning report
Written to a dated file (and emailed/Slacked). Format in §5.

---

## 3. Guardrails — the safety envelope

These live in an agent-**unwritable** config and are enforced by the orchestrator, not by the model's goodwill.

- **Additive-only by default.** New games are added; existing published games are **never deleted or overwritten** without an explicit per-item `allowReplace` flag in the queue.
- **Protected paths (never edited unattended):** auth, billing/payments, the deploy & rollback configuration, CI secrets, environment variables, and the guardrail file itself. A needed change here = stop and report, don't touch.
- **Branch discipline:** the agent works on a dated branch and promotes via immutable deploys; commits to `main` are squash-merged **only after green**. Every prod release is tagged.
- **Spend cap & time cap:** hard ceilings on API/compute spend and wall-clock per night and per game. Hitting either trips the **circuit breaker** → stop, report, leave prod safe.
- **Secrets** are injected at runtime, never written into content, logs, or commits.
- **Full audit log:** every source consulted, every prompt, every file changed, every deploy and rollback — reproducible after the fact.
- **Rollback is sacred:** the mechanism that lets you undo a night is the one thing the agent can never modify.

---

## 4. What "full code + redeploy" actually means in practice

You granted code autonomy; here's the bounded shape of it so it's powerful without being a loose cannon:

- **Allowed:** edit rendering components, styles/theme tokens, content-schema-adjacent UI, run codegen, add a game's route, fix a failing build or a visual-regression break.
- **Requires stop-and-report (not allowed unattended):** anything touching a protected path, any change that would delete/replace published content without the flag, any dependency change that fails the build twice, any edit the agent itself flags `low-confidence`.
- **Mechanism:** branch → preview deploy → gates → promote → smoke → (rollback on fail). Direct-to-prod-without-a-preview is impossible by construction.

---

## 5. Morning report (sample shape)

```
NIGHT SHIFT — 2026-06-06  (ran 01:02–03:48, spend £3.71 / cap £15)

PUBLISHED ✅
  • Ocarina of Time (N64, 1998) — 9 sections, 41 collectibles, 9 videos
      confidence: high · all gates green · live + tagged ot-2026-06-06
  • Majora's Mask (N64, 2000) — 7 sections, 33 collectibles, 8 videos
      confidence: high · note: 2 low-confidence collectible locations (flagged in CMS)

NEEDS YOU ⚠️
  • "Zelda Tabletop" — NOT FOUND in IGDB. Skipped.
      closest: "Zelda: Game & Watch", "Cadence of Hyrule". Disambiguate?
  • A Link to the Past — QA failed (boss-section layout regression).
      3 fix attempts exhausted. LEFT ON PREVIEW (not live): <preview-url>
      prod untouched. My diagnosis + suggested patch attached.

ROLLED BACK ↩  (none tonight)

DETAIL: full audit log → /reports/2026-06-06/log
```

The report's job: you can tell in 30 seconds whether to relax or open the laptop.

---

## 6. How it runs (implementation options)

- **Trigger:** a nightly cron (e.g., GitHub Actions scheduled workflow) kicks off the orchestrator.
- **Agent harness — two viable routes:**
  - **Claude Code, run headless** as the agent: it natively has file/repo/shell tooling, can run the build, drive the CLI, and call your scripts. Wrap it in the cron trigger and your guardrail checks. Lowest-effort path to "agent that edits code and redeploys."
  - **Custom Anthropic API agent loop** (tool use + your own tool definitions for CMS/IGDB/YouTube/QA). More control, more to build.
- **Bulk drafting:** for a big backlog, the **Batch API** drafts many sections asynchronously at lower cost; QA/promote still runs per-game.
- Model + API specifics (structured outputs, tool use, Batch API): **https://docs.claude.com/en/api/overview**. Claude Code: **https://docs.claude.com/en/docs/claude-code/overview**.

---

## 7. Failure modes → defined behaviour

| Situation | What happens |
|---|---|
| Game not in IGDB | Skip, flag with closest matches. Never fabricate. |
| Research too thin / single-source | Publish only well-sourced sections; flag gaps `low-confidence`; report it. |
| Source similarity too high | Auto-rewrite the block; if still high after retries, drop it and flag. |
| Procedural validation fails | Fix loop; if unfixable in N tries, stop — content stays on preview. |
| QA fails on preview | Fix loop; if unfixable, leave on preview, prod untouched, escalate. |
| Build/deploy fails | Retry once; on repeat, stop and report. Prod untouched. |
| Production smoke fails | **Auto-rollback** to last good deploy, mark `rolled-back`, escalate. |
| Budget / time cap hit | Circuit breaker: stop cleanly, report partial progress, prod safe. |

---

## 8. Build order

1. **Schema + one hand-authored game live** on the Next.js + CMS stack (the architecture doc's step 1–2). The pipeline has nothing to publish into until this exists.
2. **Procedural validation suite** (Stage 4) as standalone scripts — gate before you automate.
3. **QA harness** (Stage 6) — Playwright + Lighthouse + a visual baseline.
4. **Authoring step** (Stages 2–3) producing schema-valid JSON from a fact sheet, with the originality check.
5. **Deploy/promote/rollback wiring** (Stages 5, 8) with the guardrail config and audit log.
6. **Orchestrator + cron + morning report** (Stages 0, 7, 9) — wire it into one loop.
7. Run **attended** for a week (you watch each morning), tune thresholds, *then* let it run truly unattended.

> Step 7 is the real graduation: prove the gates catch bad nights while you're still watching, before you trust them to catch bad nights while you're asleep.
