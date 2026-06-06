/**
 * sequencer.js — the progression-graph compiler
 *
 * Takes a game object (from the content schema) and walks the golden path
 * section by section. Tracks the growing set of items the player holds.
 * At each section, computes:
 *
 *   nowAvailable  — detours whose prerequisites are now met (not yet surfaced)
 *   gateWarnings  — items this section requires that the player doesn't have yet
 *   hubUpdates    — hub-location activities that newly unlock at this section
 *
 * This is a pure function: it never mutates the game object, never writes files,
 * and contains no game-specific facts. Item names, detour counts, map dimensions
 * — all of that lives in the game's content file, discovered by the researcher.
 *
 * Usage (Astro page, build time):
 *   import { computeSequencing, applySequencing } from '../lib/sequencer.js';
 *   const seq = computeSequencing(game);      // inspect/test
 *   const enriched = applySequencing(game);   // get back game with recommendedDetours filled
 *
 * Usage (test):
 *   node scripts/test-sequencer.js
 */

// ── Core algorithm ────────────────────────────────────────────────────────────

/**
 * computeSequencing(game) → SequencingResult
 *
 * SequencingResult: {
 *   sections: Array<{
 *     sectionId:    string,
 *     order:        number,
 *     title:        string,
 *     gateWarnings: Array<{ itemId: string, name: string }>,
 *     nowAvailable: Array<Detour>,   // full detour objects, sorted by type priority
 *     hubUpdates:   Array<{ cellName: string, activities: HubActivity[] }>,
 *   }>,
 *   unsurfacedDetours: Array<Detour>,  // detours whose prerequisites were never met
 *   itemTimeline:      Map<itemId, sectionOrder>,  // when each item is acquired
 * }
 */
export function computeSequencing(game) {
  const { sections = [], detours = [], items = [], worldMap } = game;

  // Sort sections by order — the canonical golden path sequence
  const ordered = [...sections].sort((a, b) => a.order - b.order);

  // Build lookup maps
  const itemById   = new Map((items).map(it => [it.id, it]));
  const detourById = new Map((detours).map(d => [d.id, d]));

  // Map sectionId (or fallback String(order)) → numeric order index
  // Used to compare section positions without assuming any ID format
  const sectionOrderOf = (sid) => {
    const sec = ordered.find(s => (s.sectionId ?? String(s.order)) === sid);
    return sec ? sec.order : Infinity;
  };

  // Hub cells from the world map (cells where isHub is true)
  const hubCells = (worldMap?.cells ?? []).filter(c => c.isHub && c.activities?.length > 0);

  // State
  const acquired  = new Set();   // item IDs the player currently holds
  const surfaced  = new Set();   // detour IDs already surfaced (never show twice)
  const itemTimeline = new Map();

  const sectionResults = [];

  for (const section of ordered) {
    const sid = section.sectionId ?? String(section.order);

    // ── Gate warnings ──────────────────────────────────────────────────────
    // Items this section requires that the player doesn't hold yet.
    // Shown BEFORE the section so the player knows to detour first.
    const gateWarnings = (section.gates ?? [])
      .filter(id => !acquired.has(id))
      .map(id => ({ itemId: id, name: itemById.get(id)?.name ?? id }));

    // ── Unlock items ───────────────────────────────────────────────────────
    // The player gains these during this section.
    for (const id of (section.unlocks ?? [])) {
      if (!acquired.has(id)) {
        acquired.add(id);
        itemTimeline.set(id, section.order);
      }
    }

    // ── Now-available detours ──────────────────────────────────────────────
    // A detour is surfaced here if:
    //   1. Not yet surfaced
    //   2. All required items are now held
    //   3. The current section is at or after the detour's earliestSectionId
    const nowAvailable = detours.filter(d => {
      if (surfaced.has(d.id)) return false;
      if (!d.requires.every(id => acquired.has(id))) return false;
      const earliest = sectionOrderOf(d.earliestSectionId);
      if (section.order < earliest) return false;
      return true;
    });

    // Sort by type priority: upgrades first (highest value), then hearts,
    // then convenience, then rupee/secret — purely aesthetic ordering
    const typePriority = { upgrade: 0, convenience: 1, heart: 2, rupee: 3, secret: 4 };
    nowAvailable.sort((a, b) =>
      (typePriority[a.type] ?? 9) - (typePriority[b.type] ?? 9)
    );

    for (const d of nowAvailable) surfaced.add(d.id);

    // ── Hub updates ────────────────────────────────────────────────────────
    // Hub activities that newly unlock at this section (their first required
    // item was just acquired this section, or they require nothing new).
    const hubUpdates = hubCells.flatMap(cell => {
      const newActivities = (cell.activities ?? []).filter(act => {
        // Only emit if ALL requires are now met AND at least one was acquired this turn
        const allMet = act.requires.every(id => acquired.has(id));
        const someNew = act.requires.some(id => itemTimeline.get(id) === section.order);
        // Activities with no requires surface at the first section
        const noReqs = act.requires.length === 0;
        return allMet && (someNew || (noReqs && section.order === ordered[0]?.order));
      });
      if (newActivities.length === 0) return [];
      return [{ cellName: cell.name, activities: newActivities }];
    });

    sectionResults.push({
      sectionId: sid,
      order: section.order,
      title: section.title,
      gateWarnings,
      nowAvailable,
      hubUpdates,
    });
  }

  // Detours whose prerequisites were never met on the golden path
  // (data issue — researcher should check these)
  const unsurfacedDetours = detours.filter(d => !surfaced.has(d.id));

  return { sections: sectionResults, unsurfacedDetours, itemTimeline };
}

/**
 * applySequencing(game) → enriched game
 *
 * Returns a shallow copy of the game with each section's `recommendedDetours`
 * array replaced by the IDs computed by the sequencing engine.
 * The original game object is not mutated.
 */
export function applySequencing(game) {
  const seq = computeSequencing(game);
  const resultById = new Map(seq.sections.map(s => [s.sectionId, s]));

  const enrichedSections = game.sections.map(section => {
    const sid = section.sectionId ?? String(section.order);
    const result = resultById.get(sid);
    return {
      ...section,
      recommendedDetours: result ? result.nowAvailable.map(d => d.id) : [],
    };
  });

  return { ...game, sections: enrichedSections, _sequencing: seq };
}
