#!/usr/bin/env node
/**
 * author.js — Phase 3: AI authoring
 *
 * Researches a game and drafts a complete walkthrough JSON file using the
 * Claude API. Runs research first (one call), then drafts each section
 * individually (one call per section), then assembles and validates.
 *
 * Usage:
 *   node scripts/author.js --game "Ocarina of Time" --franchise zelda --slug ocarina-of-time
 *   node scripts/author.js --game "Hollow Knight" --franchise hollow-knight --slug hollow-knight
 *
 * Required env:
 *   ANTHROPIC_API_KEY=sk-ant-...
 *
 * Exit 0 = game JSON written to src/content/games/<slug>.json
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

if (!gameTitle || !franchiseSlug || !slug) {
  console.error('Usage: node scripts/author.js --game "Title" --franchise slug --slug game-slug [--year YYYY] [--platforms "PS5, PC"]');
  process.exit(1);
}

// ── Safety checks ─────────────────────────────────────────────────────────────
const outPath = join(ROOT, 'src/content/games', `${slug}.json`);
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

const claude = new Anthropic({ apiKey });

const RESEARCH_MODEL = CONFIG.model.research;
const DRAFT_MODEL = CONFIG.model.draft;

// ── Load prompts ──────────────────────────────────────────────────────────────
const researchPromptTemplate = readFileSync(join(ROOT, 'prompts/research.md'), 'utf8');
const draftPromptTemplate = readFileSync(join(ROOT, 'prompts/draft.md'), 'utf8');

// Extract the system prompt portion of the draft prompt (everything up to "## User message template")
const draftSystemPrompt = draftPromptTemplate.split('## User message template')[0].trim();

// ── Helpers ───────────────────────────────────────────────────────────────────

function log(msg) { console.log(`  ${msg}`); }
function section(title) { console.log(`\n── ${title} ──────────────────────────────`); }

function toSlug(str) {
  return str.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
}

function extractJson(text) {
  // Find the first { ... } block in the response
  const start = text.indexOf('{');
  const end = text.lastIndexOf('}');
  if (start === -1 || end === -1) return null;
  try {
    return JSON.parse(text.slice(start, end + 1));
  } catch {
    return null;
  }
}

// Rough n-gram originality check (mirrors validate.js logic)
function originalityCheck(text, threshold = CONFIG.originality.similarityThreshold) {
  // We can't compare against real sources here, but we check for long verbatim
  // runs of common "wiki voice" phrases that suggest copy-paste.
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

async function research() {
  section('Research');
  log(`Game: ${gameTitle}`);
  log(`Model: ${RESEARCH_MODEL}`);

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
    max_tokens: 4096,
    system: researchPromptTemplate,
    messages: [{ role: 'user', content: userMessage }],
  });

  const factSheet = response.content[0].text;
  log(`Research complete — ${factSheet.length} chars, ${response.usage.input_tokens} in / ${response.usage.output_tokens} out`);

  // Check for LOW CONFIDENCE flags
  const lowConfidenceCount = (factSheet.match(/\[LOW CONFIDENCE/gi) || []).length;
  if (lowConfidenceCount > 0) {
    log(`⚠   ${lowConfidenceCount} low-confidence flag(s) — review before publishing`);
  }

  return factSheet;
}

// ── Stage 2: Draft sections ───────────────────────────────────────────────────

async function draftSection(factSheet, sectionIndex, sectionFacts, gameContext) {
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
    max_tokens: 2048,
    system: draftSystemPrompt,
    messages: [{ role: 'user', content: userMessage }],
  });

  const raw = response.content[0].text;
  const parsed = extractJson(raw);

  if (!parsed) {
    throw new Error(`Section ${sectionIndex + 1}: could not extract JSON from response.\nRaw:\n${raw.slice(0, 500)}`);
  }

  // Enforce order
  parsed.order = sectionIndex + 1;

  // Originality check on all text content
  const allText = [
    ...(parsed.steps || []),
    ...(parsed.advisories || []).map(a => a.body || ''),
  ].join(' ');
  const orig = originalityCheck(allText);
  if (!orig.ok) {
    log(`  ⚠   Section ${sectionIndex + 1} originality warning: ${orig.reason}`);
  }

  log(`  ✅  Section ${sectionIndex + 1}: "${parsed.title}" — ${(parsed.steps || []).length} steps, ${(parsed.advisories || []).length} advisories`);
  return parsed;
}

// ── Parse section count from fact sheet ──────────────────────────────────────

function parseSectionCount(factSheet) {
  const matches = factSheet.match(/^--- Section \d+ ---/gm);
  return matches ? matches.length : null;
}

function parseSectionStubs(factSheet) {
  // Extract stage + title for each section to give the draft model context
  const stubs = [];
  const lines = factSheet.split('\n');
  let current = null;

  for (const line of lines) {
    if (/^--- Section \d+ ---/.test(line)) {
      if (current) stubs.push(current);
      current = { stage: '', title: '' };
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
  // Extract top-level metadata from fact sheet
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

  // Build a minimal theme (the pipeline uses defaults; owner can customise)
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
    sections,
  };

  return game;
}

// ── Main ──────────────────────────────────────────────────────────────────────

console.log('\n══════════════════════════════════════════');
console.log(' VisualWalkthroughs — AI Author');
console.log(`  Game: ${gameTitle}`);
console.log(`  Slug: ${slug}`);
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

const draftedSections = [];
for (let i = 0; i < sectionCount; i++) {
  try {
    const sec = await draftSection(factSheet, i, sectionStubs[i] || {}, {});
    draftedSections.push(sec);
  } catch (err) {
    console.error(`\n❌  Failed drafting section ${i + 1}: ${err.message}`);
    process.exit(1);
  }
}

// Stage 3: assemble
section('Assembling game JSON');
const game = assembleGame(draftedSections, factSheet);
const json = JSON.stringify(game, null, 2);
log(`Assembled — ${json.length} chars, ${draftedSections.length} sections`);

// Stage 4: write file
writeFileSync(outPath, json, 'utf8');
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

console.log('\n══════════════════════════════════════════');
console.log(`✅  ${gameTitle} drafted and validated`);
console.log(`    File: src/content/games/${slug}.json`);
console.log(`    Status: draft — review before promoting to published`);
console.log('══════════════════════════════════════════\n');
