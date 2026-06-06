#!/usr/bin/env node
/**
 * validate.js — Gate #1: procedural content validation
 *
 * Checks every game file in src/content/games/ against the schema,
 * style guide, and structural rules from CLAUDE.md.
 *
 * Usage:
 *   npm run validate                     — check all games
 *   npm run validate -- --game slug      — check one game
 *
 * Exit 0 = all pass, Exit 1 = one or more failures
 */

import { readFileSync, readdirSync } from 'fs';
import { join, dirname, basename } from 'path';
import { fileURLToPath } from 'url';

const __dir = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dir, '..');
const GAMES_DIR = join(ROOT, 'content/games');

// ── CLI args ──────────────────────────────────────────────────────────────────
const args = process.argv.slice(2);
const gameArgIdx = args.indexOf('--game');
const gameArg = gameArgIdx !== -1 ? args[gameArgIdx + 1] : null;

// ── Constants ─────────────────────────────────────────────────────────────────

// Banned phrases from style guide §6 — the "AI tells"
const BANNED_PHRASES = [
  "whether you're a seasoned",
  "in this section, we'll",
  "let's dive in",
  "in conclusion",
  "without further ado",
  "it's worth noting that",
  "keep in mind that",
  "as you can see",
  "elevate",
  "delve",
  "embark on a journey",
  "a beloved classic",
  "so what do you do next",
  "!!! ",
  "simply ",
];

// Words that suggest hedging (should be flagged, not hard-blocked)
const HEDGING_PATTERNS = [
  /\byou('ll)? probably\b/i,
  /\byou might want to\b/i,
  /\bit's possible\b/i,
  /\byou can try\b/i,
];

// Advisory types allowed by schema
const VALID_ADVISORY_TYPES = ['do-now', 'upgrade', 'missable', 'warning', 'tip'];

// Valid YouTube ID: 11 chars, base64url alphabet
const YT_ID_RE = /^[a-zA-Z0-9_-]{8,12}$/;

// Duration label format: e.g. "18:42" or "1:05:30"
const DURATION_RE = /^\d+:\d{2}(:\d{2})?$/;

// ── Helpers ───────────────────────────────────────────────────────────────────

function stripHtml(str) {
  return str.replace(/<[^>]+>/g, '').trim();
}

function checkBannedPhrases(text, location) {
  const lower = text.toLowerCase();
  return BANNED_PHRASES
    .filter(p => lower.includes(p))
    .map(p => `${location}: banned phrase — "${p}"`);
}

function checkHedging(text, location) {
  return HEDGING_PATTERNS
    .filter(re => re.test(text))
    .map(() => `${location}: hedging language detected — rewrite with confidence`);
}

// ── Main validator ────────────────────────────────────────────────────────────

function validateGame(filePath) {
  const slug = basename(filePath, '.json');
  const errors = [];
  const warnings = [];

  // ── 1. Parse JSON ──
  let game;
  try {
    game = JSON.parse(readFileSync(filePath, 'utf8'));
  } catch (e) {
    return { slug, errors: [`JSON parse error: ${e.message}`], warnings, passed: false };
  }

  // ── 2. Required top-level fields ──
  const required = ['franchiseSlug', 'title', 'slug', 'year', 'platforms', 'status', 'lede', 'sections'];
  for (const f of required) {
    if (game[f] === undefined || game[f] === null || game[f] === '') {
      errors.push(`Missing required field: ${f}`);
    }
  }
  if (errors.length) return { slug, errors, warnings, passed: false };

  // ── 3. Slug matches filename ──
  if (game.slug !== slug) {
    errors.push(`slug "${game.slug}" does not match filename "${slug}.json"`);
  }

  // ── 4. Status ──
  if (!['published', 'draft', 'coming-soon'].includes(game.status)) {
    errors.push(`Invalid status "${game.status}" — must be published | draft | coming-soon`);
  }

  // ── 5. Lede ──
  if (game.lede && game.lede.length < 30) {
    errors.push(`lede is too short (${game.lede.length} chars, minimum 30)`);
  }
  errors.push(...checkBannedPhrases(game.lede || '', 'lede'));

  // ── 6. Sections ──
  if (!Array.isArray(game.sections) || game.sections.length === 0) {
    errors.push('sections array is empty — a published game must have at least one section');
    return { slug, errors, warnings, passed: false };
  }

  for (let i = 0; i < game.sections.length; i++) {
    const sec = game.sections[i];
    const loc = `Section ${i + 1} "${sec.title || '(unnamed)'}"`;

    // Required section fields
    for (const f of ['stage', 'title', 'order', 'steps', 'video']) {
      if (!sec[f]) errors.push(`${loc}: missing required field "${f}"`);
    }

    // Order must be sequential
    if (sec.order !== i + 1) {
      errors.push(`${loc}: order is ${sec.order}, expected ${i + 1} — sections must be numbered sequentially`);
    }

    // ── Steps ──
    if (!Array.isArray(sec.steps) || sec.steps.length === 0) {
      errors.push(`${loc}: steps array is empty`);
    } else {
      for (let j = 0; j < sec.steps.length; j++) {
        const raw = sec.steps[j];
        // v2 steps may be objects {text, videoTimestamp?, locationRef?}
        const rawText = typeof raw === 'object' && raw !== null && 'text' in raw ? raw.text : raw;
        const text = stripHtml(rawText);
        const stepLoc = `${loc}, step ${j + 1}`;

        // Must start with action verb (imperative) — check for common non-verb openers
        const firstWord = text.split(/\s/)[0].replace(/[^a-zA-Z]/g, '').toLowerCase();
        const nonVerbStarters = ['in', 'the', 'a', 'an', 'this', 'there', 'it', 'note', 'once', 'after', 'before', 'when'];
        if (nonVerbStarters.includes(firstWord)) {
          warnings.push(`${stepLoc}: starts with "${firstWord}" — golden-path steps should lead with an action verb`);
        }

        errors.push(...checkBannedPhrases(text, stepLoc));
        warnings.push(...checkHedging(text, stepLoc));

        // Minimum step length (strip tags)
        if (text.length < 10) {
          errors.push(`${stepLoc}: step text is too short after stripping HTML (${text.length} chars)`);
        }
      }

      // Spoiler lint: first step of first section should not be ALL spoiler
      if (i === 0) {
        const firstStep0 = sec.steps[0];
        const firstStep0Text = typeof firstStep0 === 'object' && firstStep0 !== null && 'text' in firstStep0 ? firstStep0.text : firstStep0;
        const firstStepText = stripHtml(firstStep0Text);
        if (firstStepText.length < 5) {
          errors.push(`${loc}, step 1: first step of first section is empty after stripping tags — check spoiler tagging`);
        }
      }
    }

    // ── Video ──
    if (sec.video) {
      const v = sec.video;
      if (!v.id || !YT_ID_RE.test(v.id)) {
        errors.push(`${loc}: invalid YouTube ID "${v.id}" — must be 8–12 alphanumeric/dash/underscore chars`);
      }
      if (!v.creator || v.creator.trim() === '') {
        errors.push(`${loc}: video missing creator`);
      }
      if (!v.title || v.title.trim() === '') {
        errors.push(`${loc}: video missing title`);
      }
      if (!v.durationLabel || !DURATION_RE.test(v.durationLabel)) {
        errors.push(`${loc}: video durationLabel "${v.durationLabel}" is invalid — expected format "18:42" or "1:05:30"`);
      }
    }

    // ── Advisories ──
    for (let k = 0; k < (sec.advisories || []).length; k++) {
      const adv = sec.advisories[k];
      const advLoc = `${loc}, advisory ${k + 1}`;

      if (!VALID_ADVISORY_TYPES.includes(adv.type)) {
        errors.push(`${advLoc}: invalid type "${adv.type}" — must be ${VALID_ADVISORY_TYPES.join(' | ')}`);
      }
      if (!adv.title || adv.title.trim() === '') {
        errors.push(`${advLoc}: missing title`);
      }
      if (!adv.body || stripHtml(adv.body).length < 10) {
        errors.push(`${advLoc}: body is missing or too short`);
      }

      const bodyText = stripHtml(adv.body || '');
      errors.push(...checkBannedPhrases(bodyText, advLoc));
      warnings.push(...checkHedging(bodyText, advLoc));

      // do-now advisories must carry timing language
      if (adv.type === 'do-now') {
        const timingWords = ['now', 'before', 'after', 'once', 'finally', 'already', 'until', 'when', 'while'];
        const hasTimingWord = timingWords.some(w => bodyText.toLowerCase().includes(w));
        if (!hasTimingWord) {
          warnings.push(`${advLoc}: do-now advisory has no timing language — should explain WHEN and WHY`);
        }
      }
    }

    // ── Collectibles ──
    for (let k = 0; k < (sec.collectibles || []).length; k++) {
      const c = sec.collectibles[k];
      const cLoc = `${loc}, collectible ${k + 1}`;
      if (!c.label || c.label.trim() === '') errors.push(`${cLoc}: missing label`);
      if (!c.note || c.note.trim() === '') errors.push(`${cLoc}: missing note`);
    }
  }

  return {
    slug,
    errors,
    warnings,
    passed: errors.length === 0,
  };
}

// ── Run ───────────────────────────────────────────────────────────────────────

let files;
try {
  files = readdirSync(GAMES_DIR)
    .filter(f => f.endsWith('.json'))
    .filter(f => !gameArg || f === `${gameArg}.json`);
} catch {
  console.error(`Cannot read games directory: ${GAMES_DIR}`);
  process.exit(1);
}

if (files.length === 0) {
  console.error(gameArg ? `No game file found for slug "${gameArg}"` : 'No game files found in content/games/');
  process.exit(1);
}

let anyFailed = false;
const results = [];

for (const file of files) {
  const result = validateGame(join(GAMES_DIR, file));
  results.push(result);
  if (!result.passed) anyFailed = true;
}

// ── Report ────────────────────────────────────────────────────────────────────

console.log('\n══════════════════════════════════════════');
console.log(' VisualWalkthroughs — Content Validation');
console.log('══════════════════════════════════════════\n');

for (const r of results) {
  const icon = r.passed ? '✅' : '❌';
  const summary = r.passed
    ? `PASS${r.warnings.length ? ` (${r.warnings.length} warning${r.warnings.length > 1 ? 's' : ''})` : ''}`
    : `FAIL — ${r.errors.length} error${r.errors.length > 1 ? 's' : ''}`;
  console.log(`${icon}  ${r.slug}  ·  ${summary}`);

  for (const e of r.errors) {
    console.log(`     ✗  ${e}`);
  }
  for (const w of r.warnings) {
    console.log(`     ⚠  ${w}`);
  }
  if (r.errors.length || r.warnings.length) console.log('');
}

console.log('──────────────────────────────────────────');
if (anyFailed) {
  console.log('❌  Validation FAILED — fix errors before deploying\n');
  process.exit(1);
} else {
  console.log(`✅  All ${results.length} game${results.length > 1 ? 's' : ''} valid\n`);
  process.exit(0);
}
