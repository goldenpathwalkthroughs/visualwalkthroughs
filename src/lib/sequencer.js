/**
 * sequencer.js — the progression-graph compiler
 *
 * Takes a game object (from the content schema) and walks the recommended
 * route, tracking the growing set of items the player holds.  At each step
 * it computes what new optional activities (detours) are now reachable and
 * what gates, if any, the player needs to clear.
 *
 * Key design principles (§0 / §1 of the v2 spec):
 *   - This is a capability, not a Wind Waker module.  No game-specific facts live here.
 *   - Linear is just the degenerate case of a graph; the engine handles any structureType.
 *   - Hard gates and soft/readiness gates are explicitly distinguished.
 *   - anyOrderGroups are respected: within a group the engine does not imply a fixed sequence.
 *
 * Exports:
 *   computeSequencing(game)  → SequencingResult   (inspect / test)
 *   applySequencing(game)    → enriched game       (sections get recommendedDetours filled in)
 *
 * SequencingResult shape:
 *   {
 *     route: Array<{
 *       sectionId:    string,
 *       routeIndex:   number,       // position in the recommended route (0-based)
 *       title:        string,
 *       gateWarnings: Array<GateWarning>,
 *       readinessNote: string|null, // soft-gate guidance (player can proceed but shouldn't)
 *       nowAvailable: Array<Detour>,
 *       hubUpdates:   Array<HubUpdate>,
 *       inAnyOrderGroup: string|null,  // groupId if this section is in a freely-orderable cluster
 *     }>,
 *     unsurfacedDetours: Array<Detour>,
 *     itemTimeline:      Map<itemId, routeIndex>,
 *   }
 *
 * GateWarning: { itemId, name, gatingType: 'hard'|'soft' }
 * HubUpdate:   { cellName, activities: Array<HubActivity> }
 */

// ─────────────────────────────────────────────────────────────────────────────
// Internal helpers
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Resolve the ordered list of sections to walk.
 *
 * Priority:
 *   1. game.structure.recommendedRoute  — explicit sectionId list from the researcher
 *   2. sections sorted by routeOrder    — if individual sections have routeOrder set
 *   3. sections sorted by order         — v1 fallback (linear assumption)
 *
 * This means linear games need no structure field at all; everything still works.
 */
function resolveRoute(game) {
  const { sections = [], structure } = game;

  // Build a lookup: sectionId → section
  const byId = new Map(
    sections
      .filter(s => s.sectionId)
      .map(s => [s.sectionId, s])
  );

  if (structure?.recommendedRoute?.length > 0) {
    // Use the explicit recommended route, resolving each sectionId
    return structure.recommendedRoute
      .map(id => byId.get(id))
      .filter(Boolean);
  }

  // Fall back to routeOrder if present, else narrative order
  return [...sections].sort((a, b) => {
    const ra = a.routeOrder ?? a.order;
    const rb = b.routeOrder ?? b.order;
    return ra - rb;
  });
}

/**
 * Build a map of sectionId → anyOrderGroup groupId.
 * Sections not in any group map to null.
 */
function buildGroupMap(structure) {
  const map = new Map();
  for (const group of (structure?.anyOrderGroups ?? [])) {
    for (const id of group.sectionIds) {
      map.set(id, group.groupId);
    }
  }
  return map;
}

/** Type-priority sort order for detours (higher value = lower priority). */
const DETOUR_TYPE_PRIORITY = { upgrade: 0, convenience: 1, heart: 2, rupee: 3, secret: 4 };

// ─────────────────────────────────────────────────────────────────────────────
// Core algorithm
// ─────────────────────────────────────────────────────────────────────────────

export function computeSequencing(game) {
  const { detours = [], items = [], worldMap, structure } = game;

  const route         = resolveRoute(game);
  const groupMap      = buildGroupMap(structure);
  const itemById      = new Map((items).map(it => [it.id, it]));

  // Hub cells from the world map
  const hubCells = (worldMap?.cells ?? []).filter(c => c.isHub && c.activities?.length > 0);

  // Build a map: sectionId → routeIndex (for earliestSectionId comparisons)
  const routeIndexOf = new Map(
    route.map((s, i) => [s.sectionId ?? String(s.order), i])
  );

  // Running state
  const acquired    = new Set();   // item IDs held so far
  const surfaced    = new Set();   // detour IDs already surfaced
  const itemTimeline = new Map();  // itemId → routeIndex when acquired

  const routeResults = [];

  for (let ri = 0; ri < route.length; ri++) {
    const section = route[ri];
    const sid     = section.sectionId ?? String(section.order);

    // ── Gate warnings ──────────────────────────────────────────────────────
    // Items this section needs that the player doesn't currently hold.
    // Both hard (blocked) and soft (inadvisable) gates are captured here;
    // the UI renders them differently.
    const gateWarnings = (section.gates ?? [])
      .filter(id => !acquired.has(id))
      .map(id => ({
        itemId:     id,
        name:       itemById.get(id)?.name ?? id,
        gatingType: section.gatingType ?? 'hard',
      }));

    // ── Soft-gate readiness note ───────────────────────────────────────────
    // If the gating is 'soft' and the section has a note, surface it.
    const readinessNote =
      section.gatingType === 'soft' && section.readinessNote
        ? section.readinessNote
        : null;

    // ── Unlock items ───────────────────────────────────────────────────────
    for (const id of (section.unlocks ?? [])) {
      if (!acquired.has(id)) {
        acquired.add(id);
        itemTimeline.set(id, ri);
      }
    }

    // ── Now-available detours ──────────────────────────────────────────────
    // A detour is surfaced here when:
    //   1. Not yet surfaced.
    //   2. All required items are now held.
    //   3. The current route position is at or after the detour's earliestSectionId.
    const nowAvailable = detours.filter(d => {
      if (surfaced.has(d.id)) return false;
      if (!d.requires.every(id => acquired.has(id))) return false;
      const earliestIdx = routeIndexOf.get(d.earliestSectionId) ?? 0;
      if (ri < earliestIdx) return false;
      return true;
    });

    nowAvailable.sort(
      (a, b) => (DETOUR_TYPE_PRIORITY[a.type] ?? 9) - (DETOUR_TYPE_PRIORITY[b.type] ?? 9)
    );

    for (const d of nowAvailable) surfaced.add(d.id);

    // ── Hub updates ────────────────────────────────────────────────────────
    // Activities at hub locations that newly unlock this route step.
    // An activity unlocks if ALL its requires are now met AND at least one
    // was acquired this step (or the activity has no requires at all and this
    // is the first route step).
    const hubUpdates = hubCells.flatMap(cell => {
      const newActivities = (cell.activities ?? []).filter(act => {
        const allMet  = act.requires.every(id => acquired.has(id));
        const someNew = act.requires.some(id => itemTimeline.get(id) === ri);
        const noReqs  = act.requires.length === 0;
        return allMet && (someNew || (noReqs && ri === 0));
      });
      return newActivities.length > 0
        ? [{ cellName: cell.name, activities: newActivities }]
        : [];
    });

    routeResults.push({
      sectionId:       sid,
      routeIndex:      ri,
      title:           section.title,
      gateWarnings,
      readinessNote,
      nowAvailable,
      hubUpdates,
      inAnyOrderGroup: groupMap.get(sid) ?? null,
    });
  }

  // Detours whose requirements were never fully met on this route
  const unsurfacedDetours = detours.filter(d => !surfaced.has(d.id));

  return { route: routeResults, unsurfacedDetours, itemTimeline };
}

// ─────────────────────────────────────────────────────────────────────────────
// applySequencing — returns an enriched game (no mutation)
// ─────────────────────────────────────────────────────────────────────────────

export function applySequencing(game) {
  const seq = computeSequencing(game);

  // Build sectionId → computed nowAvailable IDs
  const detoursBySid = new Map(
    seq.route.map(r => [r.sectionId, r.nowAvailable.map(d => d.id)])
  );

  const enrichedSections = game.sections.map(section => {
    const sid = section.sectionId ?? String(section.order);
    return {
      ...section,
      recommendedDetours: detoursBySid.get(sid) ?? [],
    };
  });

  return { ...game, sections: enrichedSections, _sequencing: seq };
}
