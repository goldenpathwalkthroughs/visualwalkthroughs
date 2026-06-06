#!/usr/bin/env node
/**
 * test-sequencer.js — unit tests for the sequencing engine
 *
 * All test data is invented.  No real game names, items, places, or counts.
 * The invented game: "Ironveil Chronicles" — a hub-based adventure with:
 *   - A prologue section (linear)
 *   - Three optional dungeons in an any-order group
 *   - A final tower with a hard gate requiring all three dungeon rewards
 *
 * Tests cover every invariant the spec requires:
 *   1. Hard-gated detour never surfaces before prerequisites (key invariant)
 *   2. Detour with multiple prerequisites waits until ALL are acquired
 *   3. A detour is never surfaced twice
 *   4. Hard gate warning fires when the player is missing required items
 *   5. Hard gate warning is absent when the player holds all required items
 *   6. Soft gate: readinessNote is emitted; player is NOT blocked
 *   7. anyOrderGroup membership is recorded correctly
 *   8. Hub activities surface at the right route step
 *   9. Orphaned detour (requirements never met) appears in unsurfacedDetours
 *  10. Non-linear recommendedRoute is respected over narrative section.order
 *  11. applySequencing fills recommendedDetours without mutating the original
 *  12. Linear fallback: games with no structure field still work
 *
 * Exit 0 = all pass.  Exit 1 = one or more failures.
 */

import { computeSequencing, applySequencing } from '../src/lib/sequencer.js';

// ── Tiny assertion framework ──────────────────────────────────────────────────

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

// ── Invented test data ────────────────────────────────────────────────────────
//
// "Ironveil Chronicles" — hub-based, 5 sections.
//
// Items:
//   rope-claw   gained in the Prologue   (progression)
//   frost-gem   gained in the Ice Cave   (progression)
//   ember-key   gained in the Fire Vault (progression)
//   gale-stone  gained in the Wind Spire (progression)
//
// Detours:
//   cave-heart      requires [rope-claw]              → surfaces after Prologue
//   frozen-cache    requires [frost-gem]               → surfaces after Ice Cave
//   ember-chest     requires [ember-key]               → surfaces after Fire Vault
//   combined-vault  requires [frost-gem, ember-key]    → surfaces after Fire Vault (last of the two)
//   sky-shortcut    requires [gale-stone]              → surfaces after Wind Spire
//   orphan-detour   requires [mythic-blade]            → NEVER surfaces (item never gained)
//
// Structure: hub-based
//   recommendedRoute: prologue → ice-cave → fire-vault → wind-spire → final-tower
//   anyOrderGroup: [ice-cave, fire-vault, wind-spire]  (the three dungeons)
//   criticalPath:  all five
//
// Gates:
//   final-tower: HARD gate — requires [frost-gem, ember-key, gale-stone]
//   wind-spire:  SOFT gate — requires [frost-gem] — player can enter without but readinessNote explains why not to

const ITEMS = [
  { id: 'rope-claw',  name: 'Rope Claw',  type: 'item', acquiredAtSectionId: 'prologue',    class: 'progression' },
  { id: 'frost-gem',  name: 'Frost Gem',  type: 'item', acquiredAtSectionId: 'ice-cave',    class: 'progression' },
  { id: 'ember-key',  name: 'Ember Key',  type: 'item', acquiredAtSectionId: 'fire-vault',  class: 'progression' },
  { id: 'gale-stone', name: 'Gale Stone', type: 'item', acquiredAtSectionId: 'wind-spire',  class: 'progression' },
];

const DETOURS = [
  {
    id: 'cave-heart',
    location: 'Roadside Cave',
    type: 'heart',
    requires: ['rope-claw'],
    benefit: '+1 heart container',
    method: 'Hook-launch to the upper ledge; the chest is behind the waterfall',
    earliestSectionId: 'prologue',
    recommendedSectionId: 'prologue',
    mandatory: false,
  },
  {
    id: 'frozen-cache',
    location: 'Glacial Shelf',
    type: 'upgrade',
    requires: ['frost-gem'],
    benefit: 'Quiver capacity 20→40',
    method: 'Place the gem in the altar on the shelf; the cache unseals',
    earliestSectionId: 'ice-cave',
    recommendedSectionId: 'ice-cave',
    mandatory: false,
  },
  {
    id: 'ember-chest',
    location: 'Scorched Plaza',
    type: 'heart',
    requires: ['ember-key'],
    benefit: '+1 heart container',
    method: 'Unlock the sealed chest in the south plaza with the ember key',
    earliestSectionId: 'fire-vault',
    recommendedSectionId: 'fire-vault',
    mandatory: false,
  },
  {
    id: 'combined-vault',
    location: 'Crossroads Vault',
    type: 'upgrade',
    requires: ['frost-gem', 'ember-key'],   // both required — waits until LATER of the two
    benefit: 'Pouch capacity 10→30',
    method: 'Use both gems on the twin locks at the vault entrance',
    earliestSectionId: 'fire-vault',
    recommendedSectionId: 'fire-vault',
    mandatory: false,
  },
  {
    id: 'sky-shortcut',
    location: 'Wind Bridge',
    type: 'convenience',
    requires: ['gale-stone'],
    benefit: 'Fast-travel hub to all three dungeon entrances',
    method: 'Attune the stone at the bridge apex; the wind-path unlocks',
    earliestSectionId: 'wind-spire',
    recommendedSectionId: 'wind-spire',
    mandatory: false,
  },
  {
    id: 'orphan-detour',
    location: 'Sealed Sanctum',
    type: 'secret',
    requires: ['mythic-blade'],             // item never obtained on this route
    benefit: 'Hidden lore chamber',
    method: 'Insert the mythic blade into the dais',
    earliestSectionId: 'prologue',
    recommendedSectionId: 'prologue',
    mandatory: false,
  },
];

function makeSection(id, order, title, stage, unlocks, gates, gatingType, readinessNote, skippable) {
  return {
    sectionId: id,
    order,
    title,
    stage,
    chips: [],
    unlocks:            unlocks ?? [],
    gates:              gates ?? [],
    gatingType:         gatingType ?? 'none',
    readinessNote:      readinessNote ?? null,
    skippable:          skippable ?? false,
    recommendedDetours: [],
    steps: [],
    advisories: [],
    collectibles: [],
    video: { provider: 'youtube', id: 'placeholder', creator: 'Test', title: 'Test', durationLabel: '1:00' },
  };
}

const SECTIONS = [
  makeSection('prologue',    1, 'The Fallen Gate',     'Prologue',   ['rope-claw'], [],                                        'none', null),
  makeSection('ice-cave',    2, 'The Glacial Ice Cave', 'Chapter 1', ['frost-gem'], [],                                        'none', null, false),
  makeSection('fire-vault',  3, 'The Fire Vault',       'Chapter 1', ['ember-key'], [],                                        'none', null, false),
  makeSection('wind-spire',  4, 'The Wind Spire',       'Chapter 1', ['gale-stone'], ['frost-gem'],                            'soft', 'Clearing the Ice Cave first gives you the Frost Gem, which makes the Spire\'s second-floor puzzles straightforward rather than painful.'),
  makeSection('final-tower', 5, 'The Final Tower',      'Endgame',   [],           ['frost-gem', 'ember-key', 'gale-stone'],   'hard', null),
];

const WORLD_MAP = {
  kind: 'grid',
  grid: { cols: 5, rows: 4 },
  cells: [
    {
      name: 'Crossroads Town',
      coord: { col: 2, row: 2 },
      routeRelevance: 'none',
      secrets: [],
      requires: [],
      isHub: true,
      activities: [
        { label: 'Rope-claw training arena', requires: ['rope-claw'],              benefit: 'Hook proficiency upgrade' },
        { label: 'Gem-fusion workshop',       requires: ['frost-gem', 'ember-key'], benefit: 'Fused gem armour buff'   },
      ],
    },
  ],
};

const TEST_GAME = {
  items: ITEMS,
  detours: DETOURS,
  sections: SECTIONS,
  worldMap: WORLD_MAP,
  structure: {
    structureType: 'hub-based',
    recommendedRoute: ['prologue', 'ice-cave', 'fire-vault', 'wind-spire', 'final-tower'],
    criticalPath:     ['prologue', 'ice-cave', 'fire-vault', 'wind-spire', 'final-tower'],
    anyOrderGroups: [
      { groupId: 'dungeons', label: 'Dungeons (any order)', sectionIds: ['ice-cave', 'fire-vault', 'wind-spire'] },
    ],
  },
};

// ── Run the engine ─────────────────────────────────────────────────────────────
const seq = computeSequencing(TEST_GAME);

const bySection = (id) => seq.route.find(r => r.sectionId === id);

// ── Tests ─────────────────────────────────────────────────────────────────────

console.log('\n══════════════════════════════════════════');
console.log(' Sequencer unit tests — Ironveil Chronicles');
console.log('══════════════════════════════════════════\n');

// ──────────────────────────────────────────────────────────────────────────────
console.log('── Invariant 1: hard-gated detour never surfaces before prerequisites ──');
{
  // Walk every route step and verify that every surfaced detour's required items
  // are ALL in the acquired set AT THAT POINT in the route.
  const acquired = new Set();
  let broken = false;
  for (const step of seq.route) {
    // Mirror the engine: unlock items, THEN check what surfaced
    const sec = SECTIONS.find(s => s.sectionId === step.sectionId);
    for (const id of (sec?.unlocks ?? [])) acquired.add(id);

    for (const d of step.nowAvailable) {
      const missing = d.requires.filter(id => !acquired.has(id));
      if (missing.length > 0) {
        console.log(`  ❌  "${d.id}" surfaced at "${step.sectionId}" but missing: ${missing.join(', ')}`);
        broken = true;
        failed++;
      }
    }
  }
  if (!broken) {
    console.log('  ✅  Every surfaced detour has all its prerequisites held at time of surfacing');
    passed++;
  }
}

// ──────────────────────────────────────────────────────────────────────────────
console.log('\n── Invariant 2: multi-prerequisite detour waits for ALL items ──────');
{
  const iceStep  = bySection('ice-cave');
  const fireStep = bySection('fire-vault');

  // After ice-cave: frost-gem acquired, but not ember-key → combined-vault must NOT surface
  assert('combined-vault absent after ice-cave (ember-key still missing)',
    !iceStep.nowAvailable.some(d => d.id === 'combined-vault'));

  // After fire-vault: both frost-gem and ember-key acquired → combined-vault MUST surface
  assert('combined-vault present after fire-vault (both prerequisites now held)',
    fireStep.nowAvailable.some(d => d.id === 'combined-vault'));
}

// ──────────────────────────────────────────────────────────────────────────────
console.log('\n── Invariant 3: no detour surfaced more than once ──────────────────');
{
  const seen = new Set();
  let dupes = false;
  for (const step of seq.route) {
    for (const d of step.nowAvailable) {
      if (seen.has(d.id)) {
        console.log(`  ❌  "${d.id}" surfaced again at route step ${step.routeIndex}`);
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

// ──────────────────────────────────────────────────────────────────────────────
console.log('\n── Per-section spot checks ─────────────────────────────────────────');
{
  const prologue   = bySection('prologue');
  const iceCave    = bySection('ice-cave');
  const fireVault  = bySection('fire-vault');
  const windSpire  = bySection('wind-spire');
  const finalTower = bySection('final-tower');

  // Prologue: rope-claw acquired → cave-heart surfaces
  assert('cave-heart surfaces after Prologue (rope-claw acquired)',
    prologue.nowAvailable.some(d => d.id === 'cave-heart'));
  assert('orphan-detour does NOT surface at Prologue (mythic-blade never acquired)',
    !prologue.nowAvailable.some(d => d.id === 'orphan-detour'));

  // Ice Cave: frost-gem acquired → frozen-cache surfaces; combined-vault does NOT
  assert('frozen-cache surfaces after Ice Cave (frost-gem acquired)',
    iceCave.nowAvailable.some(d => d.id === 'frozen-cache'));
  assert('combined-vault NOT surfaced after Ice Cave (ember-key still missing)',
    !iceCave.nowAvailable.some(d => d.id === 'combined-vault'));

  // Fire Vault: ember-key acquired → ember-chest AND combined-vault surface
  assert('ember-chest surfaces after Fire Vault (ember-key acquired)',
    fireVault.nowAvailable.some(d => d.id === 'ember-chest'));
  assert('combined-vault surfaces after Fire Vault (frost-gem + ember-key both held)',
    fireVault.nowAvailable.some(d => d.id === 'combined-vault'));

  // Wind Spire: gale-stone acquired → sky-shortcut surfaces
  assert('sky-shortcut surfaces after Wind Spire (gale-stone acquired)',
    windSpire.nowAvailable.some(d => d.id === 'sky-shortcut'));

  // Final Tower: player holds all three gems by now → no gate warnings
  assert('No gate warnings at Final Tower (player holds all three gems)',
    finalTower.gateWarnings.length === 0);
}

// ──────────────────────────────────────────────────────────────────────────────
console.log('\n── Hard gate warnings ──────────────────────────────────────────────');
{
  // Construct a mini-game where the player hits the final tower without wind-spire's gem
  const miniGame = {
    ...TEST_GAME,
    sections: [
      makeSection('prologue',    1, 'Prologue',   'Prologue', ['rope-claw'], []),
      makeSection('fire-vault',  2, 'Fire Vault', 'Chapter 1', ['ember-key'], []),
      // final-tower reached with only rope-claw + ember-key; missing frost-gem + gale-stone
      makeSection('final-tower', 3, 'Final Tower', 'Endgame', [],
        ['frost-gem', 'ember-key', 'gale-stone'], 'hard'),
    ],
    structure: {
      structureType: 'linear',
      recommendedRoute: ['prologue', 'fire-vault', 'final-tower'],
      criticalPath: ['prologue', 'fire-vault', 'final-tower'],
      anyOrderGroups: [],
    },
  };
  const miniSeq   = computeSequencing(miniGame);
  const miniTower = miniSeq.route.find(r => r.sectionId === 'final-tower');

  assert('Hard gate warning fires for frost-gem (never acquired)',
    miniTower.gateWarnings.some(w => w.itemId === 'frost-gem' && w.gatingType === 'hard'));
  assert('Hard gate warning fires for gale-stone (never acquired)',
    miniTower.gateWarnings.some(w => w.itemId === 'gale-stone' && w.gatingType === 'hard'));
  assert('Hard gate warning ABSENT for ember-key (player holds it)',
    !miniTower.gateWarnings.some(w => w.itemId === 'ember-key'));
}

// ──────────────────────────────────────────────────────────────────────────────
console.log('\n── Soft gate (readiness note, player not blocked) ──────────────────');
{
  const windSpire = bySection('wind-spire');

  // Wind Spire has a soft gate on frost-gem — but the player HAS frost-gem by now
  // (they came through the recommended route), so no warning should fire.
  // The readinessNote IS present regardless because the soft gate is defined.
  assert('No gate warning at Wind Spire when player already holds frost-gem',
    !windSpire.gateWarnings.some(w => w.itemId === 'frost-gem'));

  // Now test: if we arrive at wind-spire WITHOUT frost-gem, the soft-gate warning fires
  const earlyWindGame = {
    ...TEST_GAME,
    sections: [
      makeSection('prologue',   1, 'Prologue',   'Prologue', ['rope-claw'], []),
      // wind-spire reached BEFORE ice-cave (player skips it); soft gate on frost-gem
      makeSection('wind-spire', 2, 'Wind Spire', 'Chapter 1', ['gale-stone'], ['frost-gem'],
        'soft', 'Clearing the Ice Cave first gives you the Frost Gem.'),
    ],
    structure: {
      structureType: 'linear',
      recommendedRoute: ['prologue', 'wind-spire'],
      criticalPath: ['prologue', 'wind-spire'],
      anyOrderGroups: [],
    },
  };
  const earlySeq   = computeSequencing(earlyWindGame);
  const earlySpire = earlySeq.route.find(r => r.sectionId === 'wind-spire');

  assert('Soft gate warning fires when frost-gem is missing at Wind Spire',
    earlySpire.gateWarnings.some(w => w.itemId === 'frost-gem' && w.gatingType === 'soft'));
  assert('readinessNote is emitted on the soft-gated section',
    typeof earlySpire.readinessNote === 'string' && earlySpire.readinessNote.length > 0);
}

// ──────────────────────────────────────────────────────────────────────────────
console.log('\n── anyOrderGroup membership ────────────────────────────────────────');
{
  assert('ice-cave is tagged with the "dungeons" any-order group',
    bySection('ice-cave').inAnyOrderGroup === 'dungeons');
  assert('fire-vault is tagged with the "dungeons" any-order group',
    bySection('fire-vault').inAnyOrderGroup === 'dungeons');
  assert('wind-spire is tagged with the "dungeons" any-order group',
    bySection('wind-spire').inAnyOrderGroup === 'dungeons');
  assert('prologue is NOT in any any-order group',
    bySection('prologue').inAnyOrderGroup === null);
  assert('final-tower is NOT in any any-order group',
    bySection('final-tower').inAnyOrderGroup === null);
}

// ──────────────────────────────────────────────────────────────────────────────
console.log('\n── Hub updates ─────────────────────────────────────────────────────');
{
  const prologue  = bySection('prologue');
  const fireVault = bySection('fire-vault');

  assert('Crossroads Town "rope-claw training" unlocks after Prologue',
    prologue.hubUpdates.some(
      u => u.cellName === 'Crossroads Town' &&
           u.activities.some(a => a.requires.includes('rope-claw'))
    ));

  assert('Crossroads Town "gem-fusion workshop" unlocks after Fire Vault (last of frost-gem + ember-key)',
    fireVault.hubUpdates.some(
      u => u.cellName === 'Crossroads Town' &&
           u.activities.some(a => a.requires.includes('frost-gem') && a.requires.includes('ember-key'))
    ));
}

// ──────────────────────────────────────────────────────────────────────────────
console.log('\n── Unsurfaced detours ───────────────────────────────────────────────');
{
  assert('orphan-detour in unsurfacedDetours (mythic-blade never gained)',
    seq.unsurfacedDetours.some(d => d.id === 'orphan-detour'));
  assert('All other detours were surfaced (nothing else in unsurfaced)',
    seq.unsurfacedDetours.length === 1);
}

// ──────────────────────────────────────────────────────────────────────────────
console.log('\n── recommendedRoute respected over section.order ────────────────────');
{
  // Build a game where narrative order (section.order) differs from recommendedRoute.
  // Researcher recommends: start-area → side-area → mid-area → end-area
  // But section.order numbers are: start=1, mid=2, side=3, end=4
  // (side has order=3 but is recommended second)
  const nonLinearGame = {
    items: [
      { id: 'grapple', name: 'Grapple', type: 'item', acquiredAtSectionId: 'side-area', class: 'progression' },
    ],
    detours: [
      {
        id: 'grapple-upgrade',
        location: 'Clifftop',
        type: 'upgrade',
        requires: ['grapple'],
        benefit: 'Range upgrade',
        method: 'Grapple to the clifftop chest',
        earliestSectionId: 'side-area',
        recommendedSectionId: 'side-area',
        mandatory: false,
      },
    ],
    sections: [
      makeSection('start-area', 1, 'Starting Zone', 'Prologue', [], []),
      makeSection('mid-area',   2, 'Mid Zone',       'Chapter', [],  []),
      makeSection('side-area',  3, 'Side Zone',      'Chapter', ['grapple'], []),
      makeSection('end-area',   4, 'End Zone',        'Endgame', [], []),
    ],
    worldMap: null,
    structure: {
      structureType: 'semi-linear',
      recommendedRoute: ['start-area', 'side-area', 'mid-area', 'end-area'],
      criticalPath: ['start-area', 'mid-area', 'end-area'],
      anyOrderGroups: [],
    },
  };

  const nlSeq = computeSequencing(nonLinearGame);
  const nlRoute = nlSeq.route.map(r => r.sectionId);

  assert('Engine walks recommendedRoute order, not section.order',
    nlRoute[1] === 'side-area' && nlRoute[2] === 'mid-area');

  // grapple is gained at side-area (route step 1); upgrade should surface THERE
  const sideStep = nlSeq.route.find(r => r.sectionId === 'side-area');
  assert('grapple-upgrade surfaces at side-area (route step 1, not at order=3)',
    sideStep.nowAvailable.some(d => d.id === 'grapple-upgrade'));
}

// ──────────────────────────────────────────────────────────────────────────────
console.log('\n── Linear fallback (no structure field) ────────────────────────────');
{
  const linearGame = {
    items: [
      { id: 'sword', name: 'Sword', type: 'item', acquiredAtSectionId: 'area-1', class: 'progression' },
    ],
    detours: [
      {
        id: 'sword-upgrade',
        location: 'Blacksmith',
        type: 'upgrade',
        requires: ['sword'],
        benefit: 'Attack +5',
        method: 'Bring the sword to the blacksmith',
        earliestSectionId: 'area-1',
        recommendedSectionId: 'area-1',
        mandatory: false,
      },
    ],
    sections: [
      makeSection('area-1', 1, 'Area 1', 'Chapter 1', ['sword'], []),
      makeSection('area-2', 2, 'Area 2', 'Chapter 2', [], []),
    ],
    worldMap: null,
    // NO structure field at all — should fall back to section.order
  };

  const linSeq = computeSequencing(linearGame);
  assert('Engine works with no structure field (linear fallback)',
    linSeq.route.length === 2 &&
    linSeq.route[0].sectionId === 'area-1' &&
    linSeq.route[0].nowAvailable.some(d => d.id === 'sword-upgrade'));
}

// ──────────────────────────────────────────────────────────────────────────────
console.log('\n── applySequencing fills recommendedDetours (no mutation) ───────────');
{
  const enriched = applySequencing(TEST_GAME);

  const prologueEnriched   = enriched.sections.find(s => s.sectionId === 'prologue');
  const fireVaultEnriched  = enriched.sections.find(s => s.sectionId === 'fire-vault');

  assert('applySequencing: prologue section has cave-heart in recommendedDetours',
    prologueEnriched.recommendedDetours.includes('cave-heart'));
  assert('applySequencing: fire-vault section has combined-vault in recommendedDetours',
    fireVaultEnriched.recommendedDetours.includes('combined-vault'));
  assert('applySequencing: original game sections are NOT mutated',
    TEST_GAME.sections.every(s => s.recommendedDetours.length === 0));
}

// ── Summary ───────────────────────────────────────────────────────────────────
console.log('\n══════════════════════════════════════════');
if (failed === 0) {
  console.log(`✅  All ${passed} tests passed\n`);
  process.exit(0);
} else {
  console.log(`❌  ${failed} test(s) failed  (${passed} passed)\n`);
  process.exit(1);
}
