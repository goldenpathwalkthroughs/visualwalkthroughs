#!/usr/bin/env node
/**
 * author.js — Phase 3: AI authoring
 *
 * Researches a game and drafts a complete walkthrough JSON file using the
 * Claude API. Runs research first (one call), then drafts each section
 * individually (one call per section), then assembles and validates.
 *
 * Engine/content separation (spec §2):
 *   Output goes to /content/games/<slug>.json — outside /src/ so the nightly
 *   pipeline writes new data files without touching engine code.
 *   The genre pack for the game's primary genre is loaded and injected into
 *   the research and draft prompts so only relevant rules are loaded per run.
 *
 * Token efficiency (spec §3):
 *   - Fixed system-prompt content (style guide, schema rules, research checklist)
 *     is marked with cache_control so it is cached after the first call.
 *   - Token usage is tracked per phase: loading / research / drafting / QA.
 *   - Model-per-step: research + draft use claude-sonnet; schemaFill uses haiku.
 *
 * Usage:
 *   node scripts/author.js --game "Ocarina of Time" --franchise zelda --slug ocarina-of-time
 *   node scripts/author.js --game "Hollow Knight" --franchise hollow-knight --slug hollow-knight [--genre action-adventure]
 *
 * Required env:
 *   ANTHROPIC_API_KEY=sk-ant-...
 *
 * Exit 0 = game JSON written to content/games/<slug>.json
 * Exit 1 = failure (no file written)
 */

import Anthropic from '@anthropic-ai/sdk';
import { readFileSync, writeFileSync, existsSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import { execSync } from 'child_process';

const __dir = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dir, '..');
const CONFIG = JSON.parse(readFileSync(join(ROOT, 'pipeline.config.json'), 'utf8'));

// ── CLI args ──────────────────────────────────────────────────────────────────
const args = process.argv.slice(2);
function arg(flag) {
  const i = args.indexOf(flag);
  return i !== -1 ? args[i + 1] : null;
}

const gameTitle = arg('--game');
const franchiseSlug = arg('--franchise');
const slug = arg('--slug');
const year = arg('--year') || '';
const platforms = arg('--platforms') || '';
const genreArg = arg('--genre') || 'action-adventure';  // default to action-adventure

if (!gameTitle || !franchiseSlug || !slug) {
  console.error('Usage: node scripts/author.js --game "Title" --franchise slug --slug game-slug [--year YYYY] [--platforms "PS5, PC"] [--genre action-adventure]');
  process.exit(1);
}

// ── Safety checks ─────────────────────────────────────────────────────────────
// Output path: /content/games/ (spec §2 — outside /src/, no engine code touched)
const outPath = join(ROOT, 'content/games', `${slug}.json`);
if (existsSync(outPath)) {
  console.error(`\n❌  STOP: ${outPath} already exists.`);
  console.error('    The pipeline is additive-only. To replace, add --allow-replace flag.');
  if (!args.includes('--allow-replace')) process.exit(1);
}

// ── Claude client ─────────────────────────────────────────────────────────────
const apiKey = process.env.ANTHROPIC_API_KEY;
if (!apiKey) {
  console.error('❌  ANTHROPIC_API_KEY not set in environment');
  process.exit(1);
}

// maxRetries: the SDK retries transient errors (429 / 500 / 502 / 503 / 529 /
// connection resets) with exponential backoff. A long authoring run makes many
// calls, so one upstream blip shouldn't kill the whole build.
const claude = new Anthropic({ apiKey, maxRetries: 6 });

// Model-per-step (spec §3.b): research+draft → sonnet, schemaFill → haiku
const RESEARCH_MODEL  = CONFIG.model.research;
const DRAFT_MODEL     = CONFIG.model.draft;
const SCHEMA_FILL_MODEL = CONFIG.model.schemaFill;

// ── Token tracking (spec §3.b) ────────────────────────────────────────────────
const tokens = { loading: 0, research: 0, drafting: 0, qa: 0 };

function trackTokens(phase, usage) {
  if (!usage) return;
  tokens[phase] += (usage.input_tokens || 0) + (usage.output_tokens || 0);
  // cache_read_input_tokens and cache_creation_input_tokens are informational
}

// ── Load prompts ──────────────────────────────────────────────────────────────
const researchPromptTemplate = readFileSync(join(ROOT, 'prompts/research.md'), 'utf8');
const draftPromptTemplate    = readFileSync(join(ROOT, 'prompts/draft.md'),    'utf8');

// The draft system prompt is everything up to "## User message template"
const draftSystemPromptText = draftPromptTemplate.split('## User message template')[0].trim();

// ── Genre pack loading (spec §2.c) ────────────────────────────────────────────
// Load tonight's genre pack; inject its QA gates and research additions into
// the prompts. Never load engine code — only the data pack for this game's genre.
let genrePack = null;
const genrePackPath = join(ROOT, 'genre-packs', `${genreArg}.json`);
if (existsSync(genrePackPath)) {
  genrePack = JSON.parse(readFileSync(genrePackPath, 'utf8'));
  // Count tokens for loading phase (approximation: pack size / 4 chars per token)
  tokens.loading += Math.round(readFileSync(genrePackPath, 'utf8').length / 4);
  console.log(`  📦  Genre pack loaded: ${genrePack.name} (${genreArg})`);
} else {
  console.log(`  ⚠   No genre pack found for "${genreArg}" — proceeding without genre-specific rules`);
}

// Append genre-specific research checklist items to research prompt
function buildResearchPrompt() {
  if (!genrePack?.researchChecklistAdditions?.length) return researchPromptTemplate;
  const additions = genrePack.researchChecklistAdditions
    .map(item => `- ${item}`)
    .join('\n');
  return `${researchPromptTemplate}\n\n## Genre-specific research requirements (${genrePack.name})\n${additions}`;
}

// Append genre QA gates to draft system prompt
function buildDraftSystemPrompt() {
  if (!genrePack?.qaGates?.length) return draftSystemPromptText;
  const gates = genrePack.qaGates
    .map(g => `- [${g.flag}] ${g.test}`)
    .join('\n');
  return `${draftSystemPromptText}\n\n## Genre QA gates (${genrePack.name} — ${genrePack.stuckPointThesis})\n${gates}`;
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function log(msg) { console.log(`  ${msg}`); }
function section(title) { console.log(`\n── ${title} ──────────────────────────────`); }

function toSlug(str) {
  return str.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
}

function extractJson(text) {
  const start = text.indexOf('{');
  const end = text.lastIndexOf('}');
  if (start === -1 || end === -1) return null;
  try {
    return JSON.parse(text.slice(start, end + 1));
  } catch {
    return null;
  }
}

function originalityCheck(text, threshold = CONFIG.originality.similarityThreshold) {
  const wikiPhrases = [
    'the player must', 'the player can', 'this area contains', 'this room contains',
    'the player will need to', 'in order to progress', 'the player is able to',
    'it is recommended', 'the player should', 'can be found in',
  ];
  const lower = text.toLowerCase();
  const hits = wikiPhrases.filter(p => lower.includes(p));
  if (hits.length >= 3) {
    return { ok: false, reason: `Wiki-voice phrases detected: ${hits.join(', ')}` };
  }
  return { ok: true };
}

// ── Stage 1: Research ─────────────────────────────────────────────────────────
// Prompt caching (spec §3.a): the research system prompt (fixed rules) is
// marked ephemeral so it is cached after the first API call in this session.

async function research() {
  section('Research');
  log(`Game: ${gameTitle}`);
  log(`Model: ${RESEARCH_MODEL}`);

  const researchPrompt = buildResearchPrompt();

  const userMessage = `Research the following game for the VisualWalkthroughs pipeline.

Game title: ${gameTitle}
Franchise: ${franchiseSlug}
${year ? `Year: ${year}` : ''}
${platforms ? `Platforms: ${platforms}` : ''}

Follow the research template exactly. Use web search knowledge to compile the fact sheet.
Flag any facts you are uncertain about as [LOW CONFIDENCE — verify].
Output only the completed fact sheet — no preamble.`;

  const response = await claude.messages.create({
    model: RESEARCH_MODEL,
    max_tokens: 16384,   // a full fact sheet (10–14 sections + bosses/items/collectibles) far exceeds 4096
    system: [
      // Mark the fixed system prompt as cacheable (spec §3.a)
      { type: 'text', text: researchPrompt, cache_control: { type: 'ephemeral' } },
    ],
    messages: [{ role: 'user', content: userMessage }],
  });

  trackTokens('research', response.usage);

  const factSheet = response.content[0].text;
  const cacheNote = response.usage?.cache_read_input_tokens
    ? ` (${response.usage.cache_read_input_tokens} cached)`
    : response.usage?.cache_creation_input_tokens
    ? ` (cache primed: ${response.usage.cache_creation_input_tokens} tokens)`
    : '';
  log(`Research complete — ${factSheet.length} chars, ${response.usage.input_tokens} in / ${response.usage.output_tokens} out${cacheNote}`);

  const lowConfidenceCount = (factSheet.match(/\[LOW CONFIDENCE/gi) || []).length;
  if (lowConfidenceCount > 0) {
    log(`⚠   ${lowConfidenceCount} low-confidence flag(s) — review before publishing`);
  }

  return factSheet;
}

// ── Stage 2: Draft sections ───────────────────────────────────────────────────
// Prompt caching: the draft system prompt (fixed rules + genre gates) is cached.
// Each section is drafted with just the variable user message — the large fixed
// context is loaded from cache on sections 2+.

async function draftSection(factSheet, sectionIndex, sectionFacts, draftSystemPrompt) {
  const userMessage = `GAME: ${gameTitle}
SECTION ${sectionIndex + 1}: ${sectionFacts.stage || ''} — ${sectionFacts.title || ''}

Here is the full research fact sheet for context:
---
${factSheet}
---

Now draft ONLY section ${sectionIndex + 1} (${sectionFacts.title || `Section ${sectionIndex + 1}`}) as a single JSON object.
Use order: ${sectionIndex + 1}.
Output only the JSON object — no markdown fences, no commentary.`;

  const response = await claude.messages.create({
    model: DRAFT_MODEL,
    max_tokens: 4096,   // a section's JSON (steps + advisories + collectibles) can exceed 2048
    system: [
      // Fixed draft rules cached after first section
      { type: 'text', text: draftSystemPrompt, cache_control: { type: 'ephemeral' } },
    ],
    messages: [{ role: 'user', content: userMessage }],
  });

  trackTokens('drafting', response.usage);

  const raw = response.content[0].text;
  const parsed = extractJson(raw);

  if (!parsed) {
    throw new Error(`Section ${sectionIndex + 1}: could not extract JSON from response.\nRaw:\n${raw.slice(0, 500)}`);
  }

  parsed.order = sectionIndex + 1;

  const allText = [
    ...(parsed.steps || []),
    ...(parsed.advisories || []).map(a => a.body || ''),
  ].join(' ');
  const orig = originalityCheck(allText);
  if (!orig.ok) {
    log(`  ⚠   Section ${sectionIndex + 1} originality warning: ${orig.reason}`);
  }

  const cacheNote = response.usage?.cache_read_input_tokens
    ? ` [${response.usage.cache_read_input_tokens} cached]`
    : '';
  log(`  ✅  Section ${sectionIndex + 1}: "${parsed.title}" — ${(parsed.steps || []).length} steps, ${(parsed.advisories || []).length} advisories${cacheNote}`);
  return parsed;
}

// ── Parse section stubs from fact sheet ──────────────────────────────────────

// The research template emits "--- Section: <slug> ---"; tolerate a numeric
// form "--- Section 1 ---" too. (research.md §Output template / SECTIONS)
const SECTION_MARKER = /^---\s*Section[:\s]\s*(.+?)\s*---\s*$/;

function parseSectionCount(factSheet) {
  const matches = factSheet.match(new RegExp(SECTION_MARKER.source, 'gm'));
  return matches ? matches.length : null;
}

function parseSectionStubs(factSheet) {
  const stubs = [];
  const lines = factSheet.split('\n');
  let current = null;

  for (const line of lines) {
    const m = SECTION_MARKER.exec(line);
    if (m) {
      if (current) stubs.push(current);
      current = { stage: '', title: '', slug: (m[1] || '').trim() };
    } else if (current && /^STAGE:/.test(line)) {
      current.stage = line.replace('STAGE:', '').trim();
    } else if (current && /^TITLE:/.test(line)) {
      current.title = line.replace('TITLE:', '').trim();
    }
  }
  if (current) stubs.push(current);
  return stubs;
}

// ── Stage 3: Assemble game JSON ───────────────────────────────────────────────

function assembleGame(sections, factSheet) {
  function extractField(label) {
    const re = new RegExp(`^${label}:\\s*(.+)`, 'm');
    const m = factSheet.match(re);
    return m ? m[1].trim() : '';
  }

  function extractLede(fs) {
    const m = fs.match(/^LEDE[^:]*:\s*\n?([\s\S]+?)(?=\nSECTIONS:|$)/m);
    return m ? m[1].replace(/\n/g, ' ').trim() : '';
  }

  function extractPlatforms(fs) {
    const raw = extractField('PLATFORMS');
    return raw ? raw.split(',').map(s => s.trim()).filter(Boolean) : [];
  }

  const theme = {
    ink: '#0a0a0f',
    ink2: '#10101a',
    panel: '#141420',
    panel2: '#1a1a2e',
    accent: '#7c6af7',
    accentSoft: 'rgba(124,106,247,.16)',
    gold: '#f3c969',
    signal: '#ff8a5b',
    line: 'rgba(180,170,255,.12)',
    muted: '#8888aa',
    bodyClass: `theme-${toSlug(franchiseSlug)}`,
    cardGradient: 'linear-gradient(160deg,#2a2060,#0a0a1a 60%,#050510)',
  };

  const game = {
    franchiseSlug,
    title: gameTitle,
    slug,
    year: year || extractField('YEAR'),
    platforms: platforms ? platforms.split(',').map(s => s.trim()) : extractPlatforms(factSheet),
    status: 'draft',
    lede: extractLede(factSheet),
    theme,
    coverGradient: theme.cardGradient,
    genre: genreArg,  // links to taxonomy/genres.json
    sections,
  };

  return game;
}

// ── Main ──────────────────────────────────────────────────────────────────────

console.log('\n══════════════════════════════════════════');
console.log(' VisualWalkthroughs — AI Author');
console.log(`  Game:  ${gameTitle}`);
console.log(`  Slug:  ${slug}`);
console.log(`  Genre: ${genreArg}`);
console.log('══════════════════════════════════════════');

// Stage 1: research
const factSheet = await research();

// Stage 2: draft sections
section('Drafting sections');
const sectionCount = parseSectionCount(factSheet);
if (!sectionCount || sectionCount === 0) {
  console.error('❌  Could not detect sections in research output. Check the fact sheet.');
  console.error(factSheet.slice(0, 1000));
  process.exit(1);
}

log(`Detected ${sectionCount} section(s) in fact sheet`);
const sectionStubs = parseSectionStubs(factSheet);

// Build draft system prompt once — cached on sections 2+
const draftSystemPromptBuilt = buildDraftSystemPrompt();

const draftedSections = [];
for (let i = 0; i < sectionCount; i++) {
  try {
    const sec = await draftSection(factSheet, i, sectionStubs[i] || {}, draftSystemPromptBuilt);
    draftedSections.push(sec);
  } catch (err) {
    console.error(`\n❌  Failed drafting section ${i + 1}: ${err.message}`);
    process.exit(1);
  }
}

// Stage 3: assemble
section('Assembling game JSON');
const game = assembleGame(draftedSections, factSheet);
log(`Assembled — ${draftedSections.length} sections`);

// Stage 4: fetch IGDB cover art (Part C)
// Writes to /assets/covers/<slug>.webp and injects the CDN path into the game JSON.
// Falls back to the styled gradient placeholder if IGDB returns nothing (exit 2)
// or if credentials are not configured (exit 1).
let coverPath = null;
if (process.env.IGDB_CLIENT_ID && process.env.IGDB_CLIENT_SECRET) {
  section('Fetching IGDB cover art');
  try {
    const { execSync: execSyncCover } = await import('child_process');
    const coverResult = execSyncCover(
      `node ${join(ROOT, 'scripts/fetch-cover.js')} --title "${gameTitle}" --slug "${slug}"`,
      { cwd: ROOT, env: process.env, stdio: ['ignore', 'pipe', 'inherit'] },
    );
    coverPath = coverResult.toString().trim();
    if (coverPath) {
      game.cover = coverPath;
      log(`✅  Cover: ${coverPath}`);
    }
  } catch (e) {
    if (e.status === 2) {
      log('⚠   No IGDB cover found — styled placeholder will be used');
    } else {
      log(`⚠   Cover fetch failed (${e.message}) — styled placeholder will be used`);
    }
  }
} else {
  log('⚠   IGDB credentials not set — cover art skipped (styled placeholder used)');
}

// Stage 5: write file (after cover path is potentially injected)
const jsonFinal = JSON.stringify(game, null, 2);
writeFileSync(outPath, jsonFinal, 'utf8');
log(`Written to ${outPath}`);

// Stage 5: validate
section('Running validation gate');
try {
  execSync(`node ${join(ROOT, 'scripts/validate.js')} --game ${slug}`, { stdio: 'inherit' });
} catch {
  console.error('\n⚠   Validation found issues — review and fix before promoting.');
  console.error('    File written to draft status. Run: npm run validate -- --game ' + slug);
  process.exit(1);
}

// ── Token breakdown (spec §3.b) ───────────────────────────────────────────────
const totalTokens = Object.values(tokens).reduce((a, b) => a + b, 0);
console.log('\n── Token breakdown ──────────────────────────────');
console.log(`  Loading (genre pack):  ${tokens.loading.toLocaleString()}`);
console.log(`  Research:              ${tokens.research.toLocaleString()}`);
console.log(`  Drafting (${sectionCount} sections): ${tokens.drafting.toLocaleString()}`);
console.log(`  QA/validation:         ${tokens.qa.toLocaleString()}`);
console.log(`  ─────────────────────────────────────────`);
console.log(`  Total:                 ${totalTokens.toLocaleString()}`);

// Write token summary to a side-car file for pipeline.js to include in reports
const tokenSummaryPath = join(ROOT, 'content/games', `.${slug}.tokens.json`);
writeFileSync(tokenSummaryPath, JSON.stringify({ slug, tokens, totalTokens, sectionCount }, null, 2), 'utf8');

console.log('\n══════════════════════════════════════════');
console.log(`✅  ${gameTitle} drafted and validated`);
console.log(`    File: content/games/${slug}.json`);
console.log(`    Status: draft — review before promoting to published`);
console.log('══════════════════════════════════════════\n');
