#!/usr/bin/env node
/**
 * test-sequencer.js — unit tests for the sequencing engine
 *
 * Uses entirely invented test data.  No real game names, items, or places.
 * Covers the key invariants the spec requires:
 *
 *   1. A detour never surfaces before all its prerequisites are held.
 *   2. A detour is never surfaced twice.
 *   3. Gate warnings fire only when the player is missing the required item.
 *   4. A detour requiring multiple items waits until ALL are acquired.
 *   5. unsurfacedDetours lists anything whose requirements were never met.
 *   6. Hub activities appear at the first section where all their requires are met.
 *
 * Exit 0 = all pass.  Exit 1 = failure.
 */

import { computeSequencing, applySequencing } from '../src/lib/sequencer.js';

// ── Helpers ───────────────────────────────────────────────────────────────────

let passed = 0;
let failed = 0;

function assert(label, condition, detail = '') {
  if (condition) {
    console.log(`  ✅  ${label}`);
    passed++;
  } else {
    console.log(`  ❌  ${label}${detail ? ` — ${detail}` : ''}`);
    failed++;
  }
}

function assertEqual(label, actual, expected) {
  const ok = JSON.stringify(actual) === JSON.stringify(expected);
  assert(label, ok, ok ? '' : `got ${JSON.stringify(actual)}, want ${JSON.stringify(expected)}`);
}

// ── Invented test data ────────────────────────────────────────────────────────
//
// A made-up five-section adventure.
// Items: rope-hook (section 1), bombs (section 2), frost-arrow (section 4)
// Detours test a range of prerequisite combinations.

const ITEMS = [
  { id: 'rope-hook',    name: 'Rope Hook',    type: 'item',    acquiredAtSectionId: '1', class: 'progression' },
  { id: 'bombs',        name: 'Bombs',        type: 'item',    acquiredAtSectionId: '2', class: 'progression' },
  { id: 'speed-boots',  name: 'Speed Boots',  type: 'upgrade', acquiredAtSectionId: '3', class: 'optional'    },
  { id: 'frost-arrow',  name: 'Frost Arrow',  type: 'item',    acquiredAtSectionId: '4', class: 'progression' },
  { id: 'phantom-key',  name: 'Phantom Key',  type: 'item',    acquiredAtSectionId: '5', class: 'progression' },
];

const DETOURS = [
  // No prerequisites — available from the very first section
  {
    id: 'easy-heart',
    location: 'Starting Village', coord: null,
    type: 'heart',
    requires: [],
    benefit: '+1 heart container',
    method: 'Speak to the innkeeper after the opening cutscene',
    earliestSectionId: '1',
    recommendedSectionId: '1',
    mandatory: false,
  },
  // Requires rope-hook → should surface at section 1 (when rope-hook is unlocked)
  {
    id: 'cliff-upgrade',
    location: 'Rocky Cliff',
    type: 'upgrade',
    requires: ['rope-hook'],
    benefit: 'Capacity 10→30',
    method: 'Grapple the upper ledge; chest is on the platform above',
    earliestSectionId: '1',
    recommendedSectionId: '1',
    mandatory: false,
  },
  // Requires bombs → must wait until section 2
  {
    id: 'bomb-chest',
    location: 'Cracked Wall Cave',
    type: 'secret',
    requires: ['bombs'],
    benefit: 'Wallet upgrade (cap 200→1 000)',
    method: 'Bomb the cracked south wall; the chest is inside',
    earliestSectionId: '2',
    recommendedSectionId: '2',
    mandatory: false,
  },
  // Requires BOTH rope-hook AND bombs → must wait until section 2 (second item)
  {
    id: 'combined-shortcut',
    location: 'Sealed Bridge',
    type: 'convenience',
    requires: ['rope-hook', 'bombs'],
    benefit: 'Unlocks fast-travel shortcut saving ~10 min per round trip',
    method: 'Grapple across the gap, then bomb the stone seal on the far side',
    earliestSectionId: '2',
    recommendedSectionId: '2',
    mandatory: false,
  },
  // Requires frost-arrow → must wait until section 4
  {
    id: 'ice-shrine-heart',
    location: 'Ice Shrine Exterior',
    type: 'heart',
    requires: ['frost-arrow'],
    benefit: '+1 heart container',
    method: 'Freeze the lava flow with a frost arrow; the platform rises',
    earliestSectionId: '4',
    recommendedSectionId: '4',
    mandatory: false,
  },
  // Requires phantom-key — but phantom-key is section 5 (the last section).
  // No section after 5 exists in this game, so this detour will be unsurfaced.
  {
    id: 'post-game-secret',
    location: 'Hidden Vault',
    type: 'secret',
    requires: ['phantom-key'],
    benefit: 'Unlocks post-game dungeon entrance',
    method: 'Insert the key in the altar inside the waterfall cave',
    earliestSectionId: '5',
    recommendedSectionId: '5',
    mandatory: false,
  },
];

function makeSection(id, order, title, unlocks, gates, stage = 'Chapter') {
  return {
    sectionId: String(id),
    order,
    title,
    stage,
    chips: [],
    unlocks,
    gates,
    recommendedDetours: [],
    steps: [],
    advisories: [],
    collectibles: [],
    video: { provider: 'youtube', id: 'placeholder', creator: 'Test', title: 'Test', durationLabel: '1:00' },
  };
}

const SECTIONS = [
  makeSection(1, 1, 'Forest Village',    ['rope-hook'],   [],           'Prologue'),
  makeSection(2, 2, 'Stone Quarry',      ['bombs'],       [],           'Chapter 1'),
  makeSection(3, 3, 'Sky Temple',        ['speed-boots'], [],           'Chapter 2'),
  makeSection(4, 4, 'Frozen Peak',       ['frost-arrow'], ['bombs'],    'Chapter 3'),  // gate: need bombs to enter
  makeSection(5, 5, 'Final Stronghold',  ['phantom-key'], ['frost-arrow', 'bombs'], 'Endgame'),
];

// Hub cell: the Market Square unlocks activities as the player gains items
const WORLD_MAP = {
  kind: 'grid',
  grid: { cols: 4, rows: 3 },
  cells: [
    {
      name: 'Market Square',
      coord: { col: 2, row: 1 },
      goldenPathRelevance: 'none',
      secrets: [],
      requires: [],
      isHub: true,
      activities: [
        { label: 'Buy rope upgrade',     requires: ['rope-hook'],  benefit: 'Hook range +50%' },
        { label: 'Trade bombs for coins', requires: ['bombs'],      benefit: '+200 coins' },
      ],
    },
  ],
};

const TEST_GAME = {
  items: ITEMS,
  detours: DETOURS,
  sections: SECTIONS,
  worldMap: WORLD_MAP,
};

// ── Run the engine ─────────────────────────────────────────────────────────────
const seq = computeSequencing(TEST_GAME);

// Helper: find result for a given section order
const byOrder = (n) => seq.sections.find(s => s.order === n);

// ── Tests ─────────────────────────────────────────────────────────────────────

console.log('\n══════════════════════════════════════════');
console.log(' Sequencer unit tests');
console.log('══════════════════════════════════════════\n');

// ── Invariant 1: No detour appears before its prerequisites are held ───────────
console.log('── Invariant 1: prerequisites always met before surfacing ──────────');

// Walk every section result and check that every surfaced detour's requires
// are all in the acquired set AT THAT POINT.
{
  const acquired = new Set();
  let broken = false;
  for (const secResult of seq.sections) {
    // Unlock items for this section (mirrors the engine's order)
    const sec = SECTIONS.find(s => String(s.order) === secResult.sectionId);
    for (const id of (sec?.unlocks ?? [])) acquired.add(id);

    for (const detour of secResult.nowAvailable) {
      const missing = detour.requires.filter(id => !acquired.has(id));
      if (missing.length > 0) {
        console.log(`  ❌  Detour "${detour.id}" surfaced at section ${secResult.order} but missing: ${missing.join(', ')}`);
        broken = true;
        failed++;
      }
    }
  }
  if (!broken) {
    console.log('  ✅  All surfaced detours have their prerequisites held at time of surfacing');
    passed++;
  }
}

// ── Invariant 2: No detour surfaced twice ─────────────────────────────────────
console.log('\n── Invariant 2: no detour surfaced more than once ──────────────────');
{
  const seen = new Set();
  let dupes = false;
  for (const secResult of seq.sections) {
    for (const d of secResult.nowAvailable) {
      if (seen.has(d.id)) {
        console.log(`  ❌  Detour "${d.id}" surfaced again at section ${secResult.order}`);
        dupes = true;
        failed++;
      }
      seen.add(d.id);
    }
  }
  if (!dupes) {
    console.log('  ✅  No detour appeared in nowAvailable more than once');
    passed++;
  }
}

// ── Section-by-section spot checks ───────────────────────────────────────────
console.log('\n── Section 1 (Forest Village — unlocks rope-hook) ──────────────────');
{
  const s1 = byOrder(1);
  const ids = s1.nowAvailable.map(d => d.id).sort();
  assert('easy-heart surfaces at section 1 (no prerequisites)',   ids.includes('easy-heart'));
  assert('cliff-upgrade surfaces at section 1 (rope-hook just acquired)', ids.includes('cliff-upgrade'));
  assert('bomb-chest does NOT surface at section 1 (bombs missing)',      !ids.includes('bomb-chest'));
  assert('combined-shortcut does NOT surface at section 1 (bombs missing)', !ids.includes('combined-shortcut'));
  assert('ice-shrine-heart does NOT surface at section 1 (frost-arrow missing)', !ids.includes('ice-shrine-heart'));
  assert('No gate warnings at section 1 (player needs nothing to enter)', s1.gateWarnings.length === 0);
}

console.log('\n── Section 2 (Stone Quarry — unlocks bombs) ────────────────────────');
{
  const s2 = byOrder(2);
  const ids = s2.nowAvailable.map(d => d.id).sort();
  assert('bomb-chest surfaces at section 2 (bombs just acquired)',          ids.includes('bomb-chest'));
  assert('combined-shortcut surfaces at section 2 (rope-hook + bombs now)', ids.includes('combined-shortcut'));
  assert('easy-heart NOT re-surfaced at section 2 (already shown)',         !ids.includes('easy-heart'));
  assert('cliff-upgrade NOT re-surfaced at section 2 (already shown)',      !ids.includes('cliff-upgrade'));
  assert('No gate warnings at section 2 (player needs nothing to enter)',   s2.gateWarnings.length === 0);
}

console.log('\n── Section 3 (Sky Temple — unlocks speed-boots) ────────────────────');
{
  const s3 = byOrder(3);
  const ids = s3.nowAvailable.map(d => d.id);
  assert('No new detours at section 3 (no detour requires only speed-boots)', ids.length === 0);
}

console.log('\n── Section 4 (Frozen Peak — gates: bombs; unlocks frost-arrow) ─────');
{
  const s4 = byOrder(4);
  const ids = s4.nowAvailable.map(d => d.id);
  assert('ice-shrine-heart surfaces at section 4 (frost-arrow just acquired)', ids.includes('ice-shrine-heart'));
  assert('Gate warning absent (player has bombs from section 2)',               s4.gateWarnings.length === 0);
}

console.log('\n── Section 5 (Final Stronghold — gates: frost-arrow + bombs) ───────');
{
  const s5 = byOrder(5);
  assert('No gate warnings at section 5 (player holds both required items)', s5.gateWarnings.length === 0);
}

// ── Gate warning fires when prerequisite is missing ───────────────────────────
console.log('\n── Gate warning smoke-test ─────────────────────────────────────────');
{
  // Construct a mini-game where the player skips section 2 (never gets bombs)
  // and hits section 4 (which gates on bombs)
  const minimalGame = {
    items: ITEMS,
    detours: [],
    sections: [
      makeSection(1, 1, 'Start',        ['rope-hook'],  []),
      makeSection(2, 2, 'Skip Zone',    [],             []),  // bombs NOT unlocked
      makeSection(3, 3, 'Gated Entry',  [],             ['bombs']),  // ← needs bombs, won't have them
    ],
    worldMap: null,
  };
  const gapSeq = computeSequencing(minimalGame);
  const gated = gapSeq.sections.find(s => s.order === 3);
  assert('Gate warning fires when bombs are missing at gated section',
    gated.gateWarnings.some(w => w.itemId === 'bombs'));
}

// ── Invariant 3: unsurfacedDetours lists detours whose requires were never met ─
console.log('\n── Invariant 3: unsurfaced detours ─────────────────────────────────');
{
  // post-game-secret requires phantom-key, which is only acquired at section 5.
  // Section 5 is the LAST section, so after it there's no further section to surface at.
  // Actually, let me re-check: phantom-key is unlocked AT section 5.
  // The engine processes unlocks, then computes nowAvailable.
  // So at section 5, phantom-key is acquired → post-game-secret becomes available → surfaced at sec 5.
  // That means it IS surfaced (at section 5). Let me check.
  const sec5 = byOrder(5);
  const sec5Ids = sec5.nowAvailable.map(d => d.id);
  assert('post-game-secret surfaces at section 5 (phantom-key unlocked there)',
    sec5Ids.includes('post-game-secret'));
  assert('unsurfacedDetours is empty when all detour requirements are eventually met',
    seq.unsurfacedDetours.length === 0);
}

// ── Truly unsurfaced detour ────────────────────────────────────────────────────
{
  const gameWithOrphan = {
    ...TEST_GAME,
    detours: [
      ...DETOURS,
      {
        id: 'orphan-detour',
        location: 'Unreachable Isle',
        type: 'secret',
        requires: ['item-that-does-not-exist'],  // never acquired on this path
        benefit: 'Mystery prize',
        method: 'Unknown',
        earliestSectionId: '1',
        recommendedSectionId: '1',
        mandatory: false,
      },
    ],
  };
  const orphanSeq = computeSequencing(gameWithOrphan);
  assert('orphan-detour appears in unsurfacedDetours (its required item is never acquired)',
    orphanSeq.unsurfacedDetours.some(d => d.id === 'orphan-detour'));
}

// ── Hub updates ───────────────────────────────────────────────────────────────
console.log('\n── Hub updates ──────────────────────────────────────────────────────');
{
  const s1Hub = byOrder(1).hubUpdates;
  assert('Market Square "buy rope upgrade" activity surfaces at section 1 (rope-hook acquired)',
    s1Hub.some(u => u.cellName === 'Market Square' && u.activities.some(a => a.requires.includes('rope-hook'))));

  const s2Hub = byOrder(2).hubUpdates;
  assert('Market Square "trade bombs" activity surfaces at section 2 (bombs acquired)',
    s2Hub.some(u => u.cellName === 'Market Square' && u.activities.some(a => a.requires.includes('bombs'))));
}

// ── applySequencing fills recommendedDetours ──────────────────────────────────
console.log('\n── applySequencing ──────────────────────────────────────────────────');
{
  const enriched = applySequencing(TEST_GAME);
  const sec1 = enriched.sections.find(s => s.order === 1);
  assert('applySequencing fills recommendedDetours for section 1',
    sec1.recommendedDetours.includes('cliff-upgrade'));
  const sec2 = enriched.sections.find(s => s.order === 2);
  assert('applySequencing fills recommendedDetours for section 2',
    sec2.recommendedDetours.includes('combined-shortcut'));
  assert('applySequencing does not mutate the original game object',
    TEST_GAME.sections[0].recommendedDetours.length === 0);
}

// ── Summary ───────────────────────────────────────────────────────────────────
console.log('\n══════════════════════════════════════════');
if (failed === 0) {
  console.log(`✅  All ${passed} tests passed\n`);
  process.exit(0);
} else {
  console.log(`❌  ${failed} test(s) failed out of ${passed + failed}\n`);
  process.exit(1);
}
