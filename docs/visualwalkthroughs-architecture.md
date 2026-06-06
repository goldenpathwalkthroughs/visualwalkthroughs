# VisualWalkthroughs — Build & Operations Architecture

A practical blueprint for turning the prototype into a hosted, CDN-backed, AI-populated site with an admin panel. Written so you can hand it to a developer (or build it yourself in stages).

---

## 1. The shape of the system

Three layers, deliberately separated:

1. **Content** — structured data (franchises, games, sections, typed blocks) living in a CMS, not in code. This is the product; everything else is plumbing.
2. **Site** — a framework that reads that content and renders the fast, SEO-friendly, per-game-themed pages you prototyped.
3. **Authoring** — an AI-assisted pipeline that drafts new content *to your schema and house rules*, which a human approves before it goes live.

Keeping content out of code is what makes "drop new content in easily" and "tweak featured content" possible without a deploy.

---

## 2. Hosting & framework

**Recommendation: Next.js (App Router) on Vercel.**

- **Why Next.js:** it server-renders pages, so all your walkthrough *text* is in the HTML for Google (the SEO win), while the expand/collapse, progress, TTS and video stay interactive on the client. It has first-class image optimization and a huge ecosystem of CMS integrations.
- **Why Vercel:** zero-config global CDN/edge network, automatic HTTPS, preview deployments for every change, and built-in image optimization. A content site like this fits its model exactly.
- **Leaner alternative:** **Astro** ships even less JavaScript (it hydrates only the interactive "islands" — your walkthrough widget — and serves the rest as static HTML). Slightly better raw performance and SEO; slightly more friction wiring up a rich admin. If performance is the obsession, Astro; if breadth of tooling is, Next.js.
- **Budget/scale alternative:** **Cloudflare Pages + Workers** is the cheapest at scale.

**Rendering strategy:** statically generate (SSG/ISR) each game page at build or on a revalidation timer. Walkthroughs change rarely, so they should be cached at the edge and regenerated only when you edit content — fast and cheap.

---

## 3. The content model (the important part)

Everything you liked about the prototype is really a **typed content schema**. Define it once; the UI and the AI authoring both conform to it.

```
Franchise
  id, name, slug
  theme: { ink, accent, gold, ... }      // drives per-IP CSS variables
  coverAssetId                            // box art
  featured: boolean, featureRank: number

Game (belongs to Franchise)
  id, title, slug, year, platforms[]
  theme (optional override of franchise theme)
  coverAssetId
  status: draft | published
  sections: [Section]

Section ("Forsaken Fortress")
  id, stage, title, order
  chips: string[]                         // "Stealth", "No sword"
  steps: RichText[]                       // golden path
  advisories: Advisory[]
  collectibles: Collectible[]
  video: { provider:'youtube', id, creator, title, durationLabel }

Advisory
  type: do-now | upgrade | missable | warning | tip
  title, body (RichText)
  completionistOnly: boolean

Collectible
  label, note, type: heart | upgrade | shard | figurine | misc
  completionistOnly: boolean
```

Notes that matter:

- **Spoilers** are a mark on a RichText span (`spoiler: true`), so the front-end can blur/reveal them. Don't store spoiler text differently — just tag it.
- **`do-now` advisories carry timing.** The whole "go get the Bomb Bag now because you finally have bombs" insight lives here. Optionally add `availableAfterSectionId` so the engine can *surface* an upgrade reminder in the right section automatically.
- **Completionist content is the same schema, flagged.** One toggle hides/shows it — no duplicate pages.

**Where it lives — pick one:**

| Option | Best when | Trade-off |
|---|---|---|
| **Sanity** (hosted, customizable Studio) | You want a polished admin UI fast | Hosted dependency; usage pricing |
| **Payload CMS** (self-hostable, code-first schemas) | You want strict schemas + own your data | You host/maintain it |
| **MDX files in Git + Zod validation** | Devs author; love version control | Weak admin UI for non-devs |

For your goals — friendly admin **plus** structured rules **plus** AI ingestion — **Sanity or Payload** is the right call. Both give you the management UI in section 6 largely for free, and both expose an API the AI pipeline can write to.

---

## 4. Box art & a reliable CDN

**Source of truth for covers: IGDB** (the Internet Game Database, owned by Twitch/Amazon). It has a free API (auth via a Twitch developer client-credentials token) covering essentially every game, with cover images served from its own image CDN at multiple sizes (`t_cover_small`, `t_cover_big`, `t_1080p`, etc.). Alternatives: **SteamGridDB** (great for stylized art), **MobyGames**, **TheGamesDB**.

**The reliability pattern — don't hot-link a third party at request time:**

1. At content-creation time, query IGDB for the game → get its cover `image_id`.
2. Fetch that image once and **re-upload it into your own asset store** (your CMS's asset pipeline, or Cloudinary / Vercel Blob / Cloudflare Images / an S3 bucket fronted by a CDN).
3. Serve from *your* CDN thereafter, with your own resizing/format (AVIF/WebP) and caching.

This means: no broken images if IGDB changes, you control sizing and optimization, and you can apply consistent treatment (the gradient overlays, rounded corners) across all art.

> **Rights note:** box art is copyrighted by the publishers. Aggregators serve it and fan/editorial sites use it widely, but it is not "free." For a fan site this is normal practice; if you ever monetize heavily, get advice on cover-art usage. The *video* embedding model is cleaner (see below).

**Same CDN handles:** game screenshots, your own diagrams/maps, and — see section 7 — pre-rendered narration audio.

---

## 5. Per-game / per-franchise theming

You already proved the mechanism: CSS variables + a theme class. In production:

- Store a `theme` object on each Franchise (and optional override per Game): `{ ink, panel, accent, gold, signal, line, muted }`.
- On render, inject those as inline CSS custom properties on the page root (`<html style="--accent:#36c6c0; ...">`). The stylesheet stays static; only the variables change. This is exactly what the prototype does with `body.theme-ww`, just data-driven.
- Optional: a hero treatment field (gradient stops, background image asset) per game for the big banner.

Result: a new game's look is **content, not code** — editable in the admin, no deploy.

---

## 6. Management / admin tools

If you use Sanity or Payload, the admin is the CMS Studio, customized. Core management surfaces:

- **Homepage curation** — a single "Homepage" document with ordered reference lists: `featuredFranchises[]`, `featuredGames[]`, `latestOverride[]`, plus hero copy. Editors drag to reorder; the live site reads it on next revalidation. This is your "highlight specific franchises/titles" control.
- **Publish workflow** — `draft → in review → published`, with scheduled publish dates. Nothing AI-drafted goes live without a human flipping it to published.
- **Theming editor** — color pickers bound to the `theme` object, with a live preview.
- **Asset manager** — the IGDB-import button (paste a game, it fetches + stores the cover), plus uploads for maps/screenshots.
- **Content QA dashboard** — flags sections missing a video, missing advisories, or with `do-now` upgrades that have no `availableAfterSection` set. Quality guardrails.
- **Redirects & SEO** — slug history → 301s, per-page meta/OG image, sitemap generation.
- **Analytics hooks** — which sections get opened most (where players actually get stuck), which videos get played, search queries with no results (content gaps to fill).

The "additional admin functions in scope" list naturally grows from analytics: most-stuck sections tell you where to invest writing effort.

---

## 7. AI-assisted content pipeline (using Claude)

This is how you "populate content to the highest standard, on demand." The principle: **the AI fills the schema; it never free-writes a page.** Structure is the quality control.

**The loop:**

1. **House rules + schema as a system prompt.** Write a style guide once: voice ("plain, universal, no fluff"), what a `do-now` advisory is for, when to recommend a video over text, spoiler-tagging rules, banned phrasings, reading level. This becomes a reusable system prompt.
2. **Ask for structured output.** Have Claude (via the Anthropic API) return the section as **JSON matching your schema** — use tool-use / structured-output so the response is guaranteed-parseable, then validate it against the same Zod/CMS schema before accepting. Reject + retry on validation failure.
3. **Ground it.** Feed Claude reference material you're allowed to use (official guides you license, your own notes, the game's manual) so it's writing *original prose from facts*, not paraphrasing someone's copyrighted walkthrough. This keeps you on the right side of the "embed video / write your own text" line.
4. **Human review in the CMS.** The draft lands as a `draft` document. An editor reads, fixes, approves. Only then publish.
5. **Cheap bulk runs.** For populating a whole game at once, the **Batch API** processes many sections asynchronously at lower cost — good for backfilling a franchise.
6. **Video selection.** Either: (a) curate the YouTube ID by hand per section (most reliable, full editorial control — recommended), or (b) query the **YouTube Data API** for the section title and let an editor confirm the top result. Store the chosen `id`; never rely on a live search at page-render time.

You can prototype this whole authoring tool *as a Claude-powered app* before building it for real — even inside an artifact — to feel out the prompt and schema. For current API specifics (models, structured outputs, Batch API, pricing), see **https://docs.claude.com/en/api/overview**.

> On TTS: the browser Web Speech API (what the prototype uses) is robotic. For human-sounding narration, pre-render each section's audio with a neural TTS service (ElevenLabs, Amazon Polly Neural, Google WaveNet) at publish time, store the MP3 on your CDN, and play that file. Regenerate only when the text changes. This also means zero per-listen cost and instant playback.

---

## 8. Suggested build order

1. **Schema + one game, hand-authored, in the CMS.** Prove the data model with Wind Waker. (You basically have the content already.)
2. **Next.js front-end reading the CMS**, deployed to Vercel — port the prototype's UI to live data + per-game theming.
3. **IGDB import + own-CDN asset pipeline** for covers.
4. **Homepage curation + publish workflow** in the admin.
5. **AI authoring pipeline** with schema-validated output and human review.
6. **Pre-rendered neural audio**, analytics, QA dashboard, then scale to more games.

Ship one *genuinely excellent* game before widening the franchise grid — the content quality is the moat, not the feature list.
