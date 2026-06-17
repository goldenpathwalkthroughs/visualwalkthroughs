#!/usr/bin/env node
/**
 * pipeline.js — nightly pipeline orchestrator
 *
 * Sequence (per CLAUDE.md):
 *   read queue → validate game → research → draft → Gate #1 (validate) →
 *   build → deploy preview → Gate #2 (qa) → fix-loop → promote →
 *   smoke test → rollback on failure → write report
 *
 * Usage:
 *   node scripts/pipeline.js                      — reads queue.md
 *   node scripts/pipeline.js --game "Title" --franchise slug --slug game-slug
 *   node scripts/pipeline.js --watch              — attended mode (extra logging)
 *   node scripts/pipeline.js --skip-qa            — skip Gate #2 (dev only)
 *   node scripts/pipeline.js --dry-run            — stop after Gate #1, no deploy
 *
 * Required env:
 *   ANTHROPIC_API_KEY
 *   CLOUDFLARE_API_TOKEN
 *   CLOUDFLARE_ACCOUNT_ID
 *
 * Exit 0 = published successfully (or idle night — no queue item)
 * Exit 1 = failure (report written, production untouched)
 */

import { execSync, spawnSync } from 'child_process';
import { readFileSync, writeFileSync, existsSync, mkdirSync, readdirSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dir = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dir, '..');
const CONFIG = JSON.parse(readFileSync(join(ROOT, 'pipeline.config.json'), 'utf8'));

// ── CLI args ──────────────────────────────────────────────────────────────────
const args = process.argv.slice(2);
function arg(flag) { const i = args.indexOf(flag); return i !== -1 ? args[i + 1] : null; }
const watchMode = args.includes('--watch');
const skipQa = args.includes('--skip-qa');
const dryRun = args.includes('--dry-run');

// ── Report scaffolding ────────────────────────────────────────────────────────
const runDate = new Date().toISOString().slice(0, 10);
const runStart = Date.now();
const report = {
  date: runDate,
  published: [],
  skipped: [],
  rolledBack: [],
  errors: [],
  flags: [],        // things needing owner attention
  spendNote: '',
  advisorShortlist: '',
  tokenBreakdown: null,  // populated from author.js sidecar after authoring
};

function flag(msg) {
  report.flags.push(msg);
  console.log(`  🚩  FLAG: ${msg}`);
}

function logSection(title) {
  console.log(`\n── ${title} ──────────────────────────────`);
}

// ── Spend / time cap enforcement ──────────────────────────────────────────────
const timeCap = CONFIG.timeCapMinutes * 60 * 1000;
function checkTimeCap(label) {
  if (Date.now() - runStart > timeCap) {
    flag(`Time cap (${CONFIG.timeCapMinutes} min) hit at: ${label}`);
    writeReport('timeout');
    process.exit(1);
  }
}

// ── Protected path guard ──────────────────────────────────────────────────────
function assertNotProtected(filePath) {
  const rel = filePath.replace(ROOT + '/', '');
  for (const pattern of CONFIG.protectedPaths) {
    const re = new RegExp('^' + pattern.replace(/\*/g, '.*') + '$');
    if (re.test(rel)) {
      throw new Error(`Refused to touch protected path: ${rel}`);
    }
  }
}

// ── Run a command, capture output ─────────────────────────────────────────────
function run(cmd, opts = {}) {
  const result = spawnSync(cmd, { shell: true, cwd: ROOT, env: process.env, ...opts });
  return {
    ok: result.status === 0,
    stdout: result.stdout?.toString() || '',
    stderr: result.stderr?.toString() || '',
    status: result.status,
  };
}

function runOrThrow(cmd, label) {
  const r = run(cmd, { stdio: 'inherit' });
  if (!r.ok) throw new Error(`${label} failed (exit ${r.status})`);
  return r;
}

// ── Queue helpers ─────────────────────────────────────────────────────────────
function slugify(s) {
  return String(s).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
}
// Titles already published — the picker must never re-queue these.
function builtTitles() {
  const dir = join(ROOT, 'content/games');
  if (!existsSync(dir)) return new Set();
  return new Set(readdirSync(dir).filter((f) => f.endsWith('.json'))
    .map((f) => { try { return JSON.parse(readFileSync(join(dir, f), 'utf8')).title.toLowerCase(); } catch { return ''; } }));
}

// ── Parse queue (content/queue.json — legacy queue.md fallback) ───────────────
function parseQueue() {
  const jsonPath = join(ROOT, 'content/queue.json');
  if (existsSync(jsonPath)) {
    const q = JSON.parse(readFileSync(jsonPath, 'utf8'));
    const built = builtTitles();
    // Highest-ranked item that is 'queued' (skip 'hold'/'building'/'published') and not already built.
    const next = (q.queue || [])
      .filter((it) => it.status === 'queued' && !built.has(String(it.title || '').toLowerCase()))
      .sort((a, b) => (a.rank ?? 999) - (b.rank ?? 999))[0];
    if (!next) return null; // empty / all on hold — idle night
    return {
      game: next.title,
      franchise: next.franchise || slugify(next.title),
      slug: next.slug || slugify(next.title),
      year: next.year || '',
      platforms: Array.isArray(next.platforms) ? next.platforms.join(', ') : (next.platforms || ''),
      allowReplace: next.allowReplace === true,
    };
  }

  // Legacy queue.md fallback
  const queuePath = join(ROOT, 'queue.md');
  if (!existsSync(queuePath)) return null;
  const raw = readFileSync(queuePath, 'utf8');
  const blockMatch = raw.match(/##\s*TONIGHT[\s\S]*?```\n([\s\S]*?)```/);
  if (!blockMatch) return null;
  const block = blockMatch[1];
  const field = (name) => { const m = block.match(new RegExp(`^${name}:[ \\t]*(.*)`, 'm')); return m ? m[1].trim() : ''; };
  const game = field('game');
  if (!game) return null;
  return { game, franchise: field('franchise'), slug: field('slug'), year: field('year'), platforms: field('platforms'), allowReplace: /allowReplace:\s*true/i.test(block) };
}

// ── Record a successful publish back into the queue ──────────────────────────
function markQueueDone(gameTitle) {
  const jsonPath = join(ROOT, 'content/queue.json');
  if (existsSync(jsonPath)) {
    const q = JSON.parse(readFileSync(jsonPath, 'utf8'));
    const it = (q.queue || []).find((x) => String(x.title || '').toLowerCase() === gameTitle.toLowerCase());
    if (it) { it.status = 'published'; it.publishedOn = runDate; }
    if (q._meta) q._meta.updated = runDate;
    writeFileSync(jsonPath, JSON.stringify(q, null, 2) + '\n', 'utf8');
    return;
  }

  // Legacy queue.md fallback
  const queuePath = join(ROOT, 'queue.md');
  if (!existsSync(queuePath)) return;
  let raw = readFileSync(queuePath, 'utf8');
  raw = raw.replace(/(##\s*TONIGHT[\s\S]*?```\n)([\s\S]*?)(```)/,
    (_, open, _block, close) => `${open}game:      \nfranchise: \nslug:      \nyear:      \nplatforms: \n${close}`);
  const doneLine = `- ${gameTitle} — published ${runDate}`;
  if (!raw.includes(doneLine)) {
    raw = raw.replace(/## DONE[^\n]*\n/, `## DONE (the pipeline appends here after each successful publish)\n\n${doneLine}\n`);
  }
  writeFileSync(queuePath, raw, 'utf8');
}

// ── Make a validated draft publishable ───────────────────────────────────────
// After Gate #1 passes, flip the game JSON to `published` so the generic
// renderer (src/pages/[franchise]/[game].astro) emits its page, and ensure the
// franchise file exists so the franchise index + breadcrumb resolve. New
// franchises are created from the game's own theme. Runs BEFORE the build, so
// QA tests the real public page; nothing is committed until promote (so a QA
// failure leaves production untouched).
function titleCase(s) {
  return String(s).replace(/[-_]+/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase()).trim();
}
function ensurePublishable(gameSlug, franchiseSlug, gameTitle) {
  // 1. Flip game status → published
  const gamePath = join(ROOT, 'content/games', `${gameSlug}.json`);
  const game = JSON.parse(readFileSync(gamePath, 'utf8'));
  if (game.status !== 'published') {
    game.status = 'published';
    writeFileSync(gamePath, JSON.stringify(game, null, 2) + '\n', 'utf8');
    console.log(`  ✅  ${gameSlug} flipped draft → published`);
  }

  // 2. Recompute the franchise's published game count
  const gamesDir = join(ROOT, 'content/games');
  const guideCount = readdirSync(gamesDir).filter((f) => f.endsWith('.json'))
    .map((f) => { try { return JSON.parse(readFileSync(join(gamesDir, f), 'utf8')); } catch { return null; } })
    .filter((g) => g && g.franchiseSlug === franchiseSlug && g.status === 'published').length;

  // 3. Ensure the franchise file exists
  const frDir = join(ROOT, 'content/franchises');
  if (!existsSync(frDir)) mkdirSync(frDir, { recursive: true });
  const frPath = join(frDir, `${franchiseSlug}.json`);
  if (existsSync(frPath)) {
    const fr = JSON.parse(readFileSync(frPath, 'utf8'));
    if (fr.guideCount !== guideCount) {
      fr.guideCount = guideCount;
      writeFileSync(frPath, JSON.stringify(fr, null, 2) + '\n', 'utf8');
    }
  } else {
    // Derive a human franchise name: prefer the part before a colon in the game
    // title ("Clair Obscur: Expedition 33" → "Clair Obscur"); else title-case slug.
    const name = gameTitle.includes(':') ? gameTitle.split(':')[0].trim() : titleCase(franchiseSlug);
    const fr = {
      name,
      slug: franchiseSlug,
      developer: 'TBC',
      description: `Guides and complete walkthroughs for ${name}.`,
      featured: false,
      featureRank: 99,
      guideCount,
      theme: game.theme ?? {},
    };
    writeFileSync(frPath, JSON.stringify(fr, null, 2) + '\n', 'utf8');
    console.log(`  ✅  created franchise content/franchises/${franchiseSlug}.json ("${name}") — flagged for owner review (developer/description)`);
    flag(`New franchise "${name}" (${franchiseSlug}) was auto-created — review developer + description in content/franchises/${franchiseSlug}.json`);
  }
}

// ── Smoke test (basic HTTP check against production) ─────────────────────────
async function smokeTest(url) {
  logSection('Production smoke test');
  try {
    const res = await fetch(url, { signal: AbortSignal.timeout(15_000) });
    if (res.ok) {
      console.log(`  ✅  ${url} → HTTP ${res.status}`);
      return true;
    }
    console.log(`  ❌  ${url} → HTTP ${res.status}`);
    return false;
  } catch (e) {
    console.log(`  ❌  Smoke test failed: ${e.message}`);
    return false;
  }
}

// ── Replenish the queue when it runs low (folded into the nightly advisor) ────
// Keeps content/queue.json topped up so the nightly build never goes idle for
// lack of candidates. Dedups against built / queued / excluded titles; brand-new
// (low-confidence) picks land as 'hold' until their sources settle.
async function topUpQueue(claude) {
  const jsonPath = join(ROOT, 'content/queue.json');
  if (!existsSync(jsonPath)) return null;
  let q;
  try { q = JSON.parse(readFileSync(jsonPath, 'utf8')); } catch { return 'queue top-up skipped — queue.json unreadable'; }
  const queue = q.queue || [];
  const built = builtTitles();
  const buildable = queue.filter((it) => it.status === 'queued' && !built.has(String(it.title).toLowerCase()));
  const LOW = 6, TARGET = 10;
  if (buildable.length >= LOW) return `queue healthy — ${buildable.length} ready, no top-up needed`;

  const known = new Set([
    ...queue.map((it) => String(it.title).toLowerCase()),
    ...built,
    ...((q.excluded || []).map((e) => String(e.title).toLowerCase())),
  ]);
  const need = TARGET - buildable.length;
  try {
    const resp = await claude.messages.create({
      model: CONFIG.model.advisor,
      max_tokens: 1000,
      messages: [{ role: 'user', content:
`You are the VisualWalkthroughs Content Advisor. Today is ${runDate}.
Propose ${need + 4} NEW single-player, story-driven games with a clear start-to-finish golden path (action-adventure, RPG/JRPG, story platformer, narrative/horror) that would make strong walkthroughs.
EXCLUDE competitive/multiplayer, MOBAs, sandboxes/sims, and roguelites with no story spine.
EXCLUDE these already-known titles: ${[...known].slice(0, 220).join(', ')}.
Prefer popular or in-demand recent/upcoming titles; flag brand-new or unreleased ones as low confidence (their walkthrough sources won't have settled yet).
Return ONLY JSON, no prose: {"candidates":[{"title":"...","platforms":["..."],"franchise":"slug-like","signal":"one-line why it's worth building","confidence":"high|medium|low"}]}` }],
    });
    const m = (resp.content[0]?.text || '').match(/\{[\s\S]*\}/);
    if (!m) return 'queue top-up: advisor returned no parseable candidates';
    const cands = JSON.parse(m[0]).candidates || [];
    let added = 0;
    let maxRank = queue.reduce((r, it) => Math.max(r, it.rank || 0), 0);
    for (const c of cands) {
      const key = String(c.title || '').toLowerCase();
      if (!c.title || known.has(key)) continue;
      known.add(key);
      const low = c.confidence === 'low';
      const entry = {
        rank: ++maxRank, title: c.title,
        platforms: Array.isArray(c.platforms) ? c.platforms : [c.platforms].filter(Boolean),
        franchise: c.franchise || slugify(c.title),
        signal: c.signal || 'advisor pick',
        eligibility: 'story-driven golden path (advisor)',
        confidence: ['high', 'medium', 'low'].includes(c.confidence) ? c.confidence : 'medium',
        status: low ? 'hold' : 'queued',
        addedOn: runDate, addedBy: 'nightly-advisor',
      };
      if (low) entry.holdReason = 'brand-new / data thin — revisit once sources settle';
      queue.push(entry);
      added += 1;
    }
    q.queue = queue;
    if (q._meta) q._meta.updated = runDate;
    writeFileSync(jsonPath, JSON.stringify(q, null, 2) + '\n', 'utf8');
    return `queue was low (${buildable.length} ready) — advisor added ${added} candidate${added === 1 ? '' : 's'}`;
  } catch (e) {
    return `queue top-up skipped: ${e.message}`;
  }
}

// ── Content Advisor shortlist (cheap reasoning call) ─────────────────────────
async function runAdvisor(publishedSlug) {
  if (!process.env.ANTHROPIC_API_KEY) return '(advisor skipped — no API key)';

  logSection('Content Advisor shortlist');
  try {
    const { default: Anthropic } = await import('@anthropic-ai/sdk');
    const claude = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY, maxRetries: 6 });

    const alreadyCovered = [];
    const gamesDir = join(ROOT, 'content/games');
    if (existsSync(gamesDir)) {
      const { readdirSync } = await import('fs');
      alreadyCovered.push(...readdirSync(gamesDir).filter(f => f.endsWith('.json')).map(f => f.replace('.json', '')));
    }

    const response = await claude.messages.create({
      model: CONFIG.model.advisor,
      max_tokens: 800,
      messages: [{
        role: 'user',
        content: `You are the VisualWalkthroughs Content Advisor. Today is ${runDate}.

Already covered or in queue: ${alreadyCovered.join(', ') || 'none yet'}.

Propose a ranked shortlist of the 5 most valuable walkthroughs to build next.
Rules: only story-driven games with a true golden path; mix one new release + evergreen picks + one gap-fill;
flag borderline cases; respect the "no duplicates" rule.
Use the exact output format from your content-advisor document: numbered list, demand/gap/fit/confidence per entry, then a FLAGGED section.
Keep it under 300 words.`,
      }],
    });

    const shortlist = response.content[0].text;
    console.log(shortlist);

    // Fold the weekly "keep the list fresh" job into the nightly run:
    // top up the queue whenever it's running low.
    const topup = await topUpQueue(claude);
    if (topup) console.log(`\n  ${topup}`);

    return shortlist + (topup ? `\n\n_Queue replenishment: ${topup}._` : '');
  } catch (e) {
    return `(advisor error: ${e.message})`;
  }
}

// ── Write report ──────────────────────────────────────────────────────────────
function writeReport(outcome) {
  const reportsDir = join(ROOT, 'reports');
  if (!existsSync(reportsDir)) mkdirSync(reportsDir);

  const elapsed = Math.round((Date.now() - runStart) / 1000 / 60);
  const lines = [
    `# Pipeline Report — ${runDate}`,
    '',
    `**Outcome:** ${outcome}  |  **Runtime:** ${elapsed} min`,
    '',
  ];

  if (report.published.length) {
    lines.push('## Published');
    for (const g of report.published) lines.push(`- ✅ ${g}`);
    lines.push('');
  }

  if (report.skipped.length) {
    lines.push('## Skipped');
    for (const g of report.skipped) lines.push(`- ⏭ ${g}`);
    lines.push('');
  }

  if (report.rolledBack.length) {
    lines.push('## Rolled back');
    for (const g of report.rolledBack) lines.push(`- ↩ ${g}`);
    lines.push('');
  }

  if (report.flags.length) {
    lines.push('## ⚠ Needs owner attention');
    for (const f of report.flags) lines.push(`- ${f}`);
    lines.push('');
  }

  if (report.errors.length) {
    lines.push('## Errors');
    for (const e of report.errors) lines.push(`- ${e}`);
    lines.push('');
  }

  if (report.tokenBreakdown) {
    const tb = report.tokenBreakdown;
    lines.push('## Token usage breakdown');
    lines.push('');
    lines.push(`| Phase | Tokens |`);
    lines.push(`|-------|--------|`);
    lines.push(`| Loading (genre pack) | ${(tb.tokens.loading || 0).toLocaleString()} |`);
    lines.push(`| Research | ${(tb.tokens.research || 0).toLocaleString()} |`);
    lines.push(`| Drafting (${tb.sectionCount} sections) | ${(tb.tokens.drafting || 0).toLocaleString()} |`);
    lines.push(`| QA / validation | ${(tb.tokens.qa || 0).toLocaleString()} |`);
    lines.push(`| **Total** | **${(tb.totalTokens || 0).toLocaleString()}** |`);
    lines.push('');
  }

  if (report.advisorShortlist) {
    lines.push('## Content Advisor — build-next shortlist');
    lines.push('');
    lines.push(report.advisorShortlist);
    lines.push('');
  }

  lines.push('---');
  lines.push(`*Generated by pipeline.js at ${new Date().toISOString()}*`);

  const reportPath = join(reportsDir, `${runDate}.md`);
  writeFileSync(reportPath, lines.join('\n'), 'utf8');
  console.log(`\n  📄  Report written: reports/${runDate}.md`);
}

// ── Main ──────────────────────────────────────────────────────────────────────

console.log('\n══════════════════════════════════════════');
console.log(' VisualWalkthroughs — Nightly Pipeline');
console.log(`  Date: ${runDate}  |  Mode: ${watchMode ? 'attended' : 'unattended'}`);
console.log('══════════════════════════════════════════');

// 1. Read queue (or use CLI override)
logSection('Queue');
let queueItem;
if (arg('--game')) {
  queueItem = {
    game: arg('--game'),
    franchise: arg('--franchise') || '',
    slug: arg('--slug') || '',
    year: arg('--year') || '',
    platforms: arg('--platforms') || '',
    allowReplace: args.includes('--allow-replace'),
  };
  console.log(`  Using CLI override: ${queueItem.game}`);
} else {
  queueItem = parseQueue();
}

if (!queueItem || !queueItem.game) {
  console.log('  No game queued for tonight. Idle run.');
  report.skipped.push('(no queue item)');
  report.advisorShortlist = await runAdvisor(null);
  writeReport('idle');
  process.exit(0);
}

const { game: gameTitle, franchise: franchiseSlug, slug, year, platforms, allowReplace } = queueItem;

if (!slug || !franchiseSlug) {
  flag(`Queue item "${gameTitle}" is missing franchise or slug — skipping`);
  report.skipped.push(gameTitle);
  report.advisorShortlist = await runAdvisor(null);
  writeReport('skipped — incomplete queue item');
  process.exit(1);
}

console.log(`  Tonight: ${gameTitle}  (${franchiseSlug}/${slug})`);

// 2. Check additive-only rule
// Output lives in /content/games/ (spec §2 — engine/content separation)
const outPath = join(ROOT, 'content/games', `${slug}.json`);
if (existsSync(outPath) && !allowReplace) {
  flag(`${slug}.json already exists and allowReplace is not set — skipping to protect published content`);
  report.skipped.push(gameTitle);
  report.advisorShortlist = await runAdvisor(null);
  writeReport('skipped — would overwrite published game');
  process.exit(0);
}

// 3. Author (research + draft)
logSection('AI authoring');
checkTimeCap('authoring');

const authorCmd = [
  'node scripts/author.js',
  `--game "${gameTitle}"`,
  `--franchise "${franchiseSlug}"`,
  `--slug "${slug}"`,
  year ? `--year "${year}"` : '',
  platforms ? `--platforms "${platforms}"` : '',
  allowReplace ? '--allow-replace' : '',
].filter(Boolean).join(' ');

const authorResult = run(authorCmd, { stdio: 'inherit' });

// Load token sidecar written by author.js (spec §3.b)
const tokenSidecarPath = join(ROOT, 'content/games', `.${slug}.tokens.json`);
if (existsSync(tokenSidecarPath)) {
  try { report.tokenBreakdown = JSON.parse(readFileSync(tokenSidecarPath, 'utf8')); } catch { /* ignore */ }
}

if (!authorResult.ok) {
  report.errors.push(`Authoring failed for ${gameTitle}`);
  flag(`Authoring failed — check API key and network`);
  report.advisorShortlist = await runAdvisor(null);
  writeReport('failed — authoring error');
  process.exit(1);
}

// 4. Gate #1: validate
logSection('Gate #1 — content validation');
checkTimeCap('validation');

let fixAttempts = 0;
let validateOk = false;

while (fixAttempts <= CONFIG.maxFixAttempts) {
  const r = run(`node scripts/validate.js --game ${slug}`, { stdio: 'inherit' });
  if (r.ok) { validateOk = true; break; }

  fixAttempts++;
  if (fixAttempts > CONFIG.maxFixAttempts) break;

  flag(`Validation failed (attempt ${fixAttempts}/${CONFIG.maxFixAttempts}) — pipeline cannot auto-fix content; review manually`);
  // Content fixes require human review — do not auto-modify content in unattended mode
  break;
}

if (!validateOk) {
  report.errors.push(`Validation failed for ${slug} after ${fixAttempts} attempt(s)`);
  report.skipped.push(gameTitle);
  flag(`${slug}.json left on disk as draft — requires manual review before promoting`);
  report.advisorShortlist = await runAdvisor(null);
  writeReport('failed — validation gate');
  process.exit(1);
}

console.log('  ✅  Gate #1 passed');

// Gate #1 passed — make the draft publishable (flip status, ensure franchise)
// so the build renders the real public page for QA to test.
ensurePublishable(slug, franchiseSlug, gameTitle);

if (dryRun) {
  console.log('\n  --dry-run: stopping before deploy');
  report.skipped.push(`${gameTitle} (dry-run — not deployed)`);
  writeReport('dry-run');
  process.exit(0);
}

// 5. Build
logSection('Build');
checkTimeCap('build');

const buildResult = run('npm run build', { stdio: 'inherit' });
if (!buildResult.ok) {
  report.errors.push('Build failed');
  flag('Build error — check Astro output');
  report.advisorShortlist = await runAdvisor(null);
  writeReport('failed — build error');
  process.exit(1);
}
console.log('  ✅  Build complete');

// 6. Deploy to preview
logSection('Preview deploy');
checkTimeCap('preview deploy');

// Deploy to a named staging branch so it gets a stable preview URL
const previewResult = run(
  'npx wrangler pages deploy dist --project-name=visualwalkthroughs --branch=staging',
  { stdio: 'inherit' },
);

if (!previewResult.ok) {
  report.errors.push('Preview deploy failed');
  flag('Wrangler preview deploy failed — check CLOUDFLARE_API_TOKEN');
  report.advisorShortlist = await runAdvisor(null);
  writeReport('failed — preview deploy');
  process.exit(1);
}

const previewUrl = 'https://staging.visualwalkthroughs.pages.dev';
console.log(`  ✅  Preview live: ${previewUrl}`);

// Wait briefly for Cloudflare edge propagation
await new Promise(r => setTimeout(r, 8000));

// 7. Gate #2: QA
if (!skipQa) {
  logSection('Gate #2 — QA harness');
  checkTimeCap('QA');

  const qaResult = run(
    `node scripts/qa.js --url ${previewUrl} --game ${franchiseSlug}/${slug}`,
    { stdio: 'inherit' },
  );

  if (!qaResult.ok) {
    flag(`QA failed on preview — ${gameTitle} left on preview, production untouched`);
    flag('Review QA output above, fix content or CSS, then re-run pipeline');
    report.errors.push(`QA gate failed for ${gameTitle}`);
    report.skipped.push(gameTitle);
    report.advisorShortlist = await runAdvisor(null);
    writeReport('failed — QA gate');
    process.exit(1);
  }

  console.log('  ✅  Gate #2 passed');
} else {
  console.log('  ⚠   Gate #2 skipped (--skip-qa)');
  flag('QA gate was skipped — production deploy is unverified');
}

// 8. Promote to production
logSection('Promote to production');
checkTimeCap('promote');

const tag = `release-${runDate}-${slug}`;
const promoteResult = run(`node scripts/promote.js --tag ${tag}`, { stdio: 'inherit' });

if (!promoteResult.ok) {
  report.errors.push('Promote failed');
  flag('Wrangler production deploy failed — site unchanged, check Cloudflare');
  report.advisorShortlist = await runAdvisor(null);
  writeReport('failed — promote');
  process.exit(1);
}

// 9. Smoke test
const productionUrl = 'https://visualwalkthroughs.pages.dev';
const smokeOk = await smokeTest(`${productionUrl}/${franchiseSlug}/${slug}/`);

if (!smokeOk) {
  logSection('AUTO-ROLLBACK');
  flag('Smoke test failed — triggering rollback');
  report.rolledBack.push(gameTitle);

  const rollbackResult = run('node scripts/rollback.js', { stdio: 'inherit' });
  if (!rollbackResult.ok) {
    flag('ROLLBACK ALSO FAILED — manual intervention required. Check Cloudflare dashboard.');
    report.errors.push('Rollback failed');
  } else {
    console.log('  ✅  Rolled back to previous good deploy');
  }

  report.advisorShortlist = await runAdvisor(null);
  writeReport('failed — smoke test + rollback');
  process.exit(1);
}

console.log('  ✅  Production smoke test passed');

// 10. Mark queue done (before commit, so the queue update is part of the commit)
markQueueDone(gameTitle);

// 11. Commit the new game file (+ franchise, + queue) so Cloudflare's git build
// publishes it. promote.js only pushes tags; the public site builds from main.
logSection('Commit');
try {
  const paths = [`content/games/${slug}.json`];
  const frPath = join(ROOT, 'content/franchises', `${franchiseSlug}.json`);
  if (existsSync(frPath)) paths.push(`content/franchises/${franchiseSlug}.json`);
  if (existsSync(join(ROOT, 'content/queue.json'))) paths.push('content/queue.json');
  if (existsSync(join(ROOT, 'queue.md'))) paths.push('queue.md');
  execSync(`git add ${paths.join(' ')}`, { cwd: ROOT });
  execSync(`git commit -m "content: add ${gameTitle}"`, { cwd: ROOT });
  execSync('git push', { cwd: ROOT });
  console.log(`  ✅  Committed and pushed: ${slug}.json`);
} catch (e) {
  flag(`Git commit/push failed: ${e.message} — content is live but not in repo`);
}

// 12. Content Advisor shortlist for tomorrow
report.advisorShortlist = await runAdvisor(slug);

// 13. Report
report.published.push(`${gameTitle} (${productionUrl}/${franchiseSlug}/${slug}/)`);
writeReport('published');

const elapsed = Math.round((Date.now() - runStart) / 1000 / 60);
console.log('\n══════════════════════════════════════════');
console.log(`✅  Pipeline complete — ${gameTitle} is live`);
console.log(`    ${productionUrl}/${franchiseSlug}/${slug}/`);
console.log(`    Runtime: ${elapsed} min`);
console.log('══════════════════════════════════════════\n');
