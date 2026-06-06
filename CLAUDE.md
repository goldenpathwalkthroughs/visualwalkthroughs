# CLAUDE.md

**Read this fully before doing anything in this repository.** This file is the operating contract for any AI agent (Claude Code, `claude -p`, the nightly GitHub Action) working here. It overrides convenience. When this file and an instruction elsewhere conflict, **this file wins** — unless the instruction comes from the human owner in a direct interactive session.

---

## What this project is

VisualWalkthroughs is a fan-built video-game walkthrough site. Content (franchises, games, walkthrough sections) is stored as structured files in this repo, rendered by an Astro static site, hosted on Cloudflare Pages. A nightly pipeline researches, writes, validates, QA-tests, publishes, and reports on new walkthroughs autonomously. The owner is non-technical and reviews output after publishing.

Authoritative companion docs live in `/docs`: architecture, pipeline, style guide, content advisor. The **content schema** (`/src/content/schema.ts`) and the **prompts** (`/prompts`) are the source of truth for structure and voice — not prose descriptions.

---

## Prime directives (never violate unattended)

1. **Production is gated and reversible.** Never deploy straight to production from a working state. Always: build -> deploy to an immutable **preview** -> pass validation + QA on that preview -> promote -> run a production smoke test -> **auto-rollback on smoke failure**. A red build never gets promoted.
2. **Additive-only.** You may add new games and sections. You must **never delete or overwrite an existing published game** unless the queue item carries an explicit `allowReplace: true`.
3. **Protected paths — never edit unattended.** Stop and report instead of touching any of: authentication, billing/credits, `.github/workflows/deploy*`, the rollback configuration, environment/secret files (`.env*`, repo/Action secrets), and **this file (`CLAUDE.md`)**. Changing how the safety system works is never an unattended action.
4. **Stay inside budget.** Respect the spend and time caps in `pipeline.config.json`. Leave subscription overflow OFF. If a cap is hit, finish cleanly, leave production untouched, and report. Never enable overflow yourself.
5. **Write from facts, never from sources' sentences.** Research from >=2 independent sources; write original prose per `/docs/style-guide.md`. Run the originality check in validation; rewrite anything that mirrors a source. Quote nothing from other guides (brief in-game text is fine).
6. **When uncertain, STOP and report — don't guess.** A skipped game with a clear flag is always better than a fabricated one or a broken deploy.

---

## The nightly run (sequence)

`research -> draft (per section) -> procedural validation -> preview deploy -> QA -> fix-loop (bounded) -> promote -> smoke test -> report`

- One game per night by default (see config).
- **Fix-loop:** on any gate failure, diagnose and fix (content fixes preferred; code fixes only within allowed paths), then re-run from the relevant stage. Bounded by `maxFixAttempts`. If still failing, **leave content on preview, leave production untouched, escalate in the report.**
- Validate the game is real via IGDB before researching. Not found / ambiguous -> skip + flag.
- Eligibility: only build games with a true storyline golden path (see `/docs/content-advisor.md`).

---

## Commands

```
npm install            # install deps
npm run dev            # local preview
npm run validate       # procedural content validation (schema, originality, links, completeness)
npm run qa             # Playwright + Lighthouse against a given preview URL
npm run build          # production build
npm run deploy:preview # immutable preview deploy
npm run promote        # promote a passed preview to production
npm run rollback       # revert production to the previous good deploy
npm run pipeline -- --game "Title"   # full pipeline for one game (use --watch to run attended)
```

Always run `npm run validate` and `npm run qa` before any promote. Never promote a build that hasn't passed both.

---

## Content & code conventions

- **Content** = files under `/src/content/` conforming to `schema.ts`. New game = new file(s); never hand-edit published files except to apply owner feedback from `feedback.md`.
- **Voice** = `/docs/style-guide.md`, enforced at draft time and in validation.
- **Commits:** one game (or one fix) per commit; message format `content: add <game>` / `fix: <area> — <what>` / `chore: ...`. Never commit secrets, keys, or `.env*`.
- **Branches:** work on a dated branch; squash-merge to `main` only after green.
- **Tag every production release** so `rollback` always has a target.

---

## Secrets

API keys (Claude/Agent SDK, IGDB, YouTube) live in GitHub Action secrets / `.env` (gitignored). Never print, log, or commit them. If a secret appears in output or history, STOP, rotate it, and escalate — treat as an incident.

---

## Definition of done (a game is "published" only when)

- Schema-valid; golden path complete and ordered; required advisories present.
- Originality check passed; spoilers tagged; British English.
- Every section has a verified, embeddable video and a CDN-hosted cover.
- Preview QA green (renders, interactions work, zero console errors, SEO/perf/accessibility budgets met, text present in server HTML).
- Promoted; production smoke test green; release tagged; report written.

---

## The report (every run, even idle nights)

Write `/reports/<date>.md` (and email it): what published, confidence + flags, what NEEDS THE OWNER, what was skipped/rolled-back, spend vs cap, and the Content Advisor shortlist for tomorrow. If you did nothing, say so and why. Silence is a failure mode — always produce a report.
