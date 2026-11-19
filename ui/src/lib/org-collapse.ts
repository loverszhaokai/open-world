import type { OrgNode } from "@/api/agents";

/**
 * Collapse bookkeeping for the org chart.
 *
 * Large orgs (a CEO with a couple of 15-report deputies) blow past any
 * viewport when every level is drawn at once, so the chart ships collapsed:
 * the root and its direct reports are visible, everything below that is
 * folded behind a per-node toggle that advertises how many people it hides.
 *
 * The layout runs over a *pruned* tree rather than dimming hidden cards, so a
 * collapsed subtree costs no horizontal space and its siblings close ranks.
 */

/** Node ids whose children are drawn. */
export type ExpandedIds = ReadonlySet<string>;

/**
 * Total descendants under a node — the number a collapsed toggle promises to
 * reveal, counting every level rather than only direct reports.
 */
export function descendantCount(node: OrgNode): number {
  let total = 0;
  for (const child of node.reports) {
    total += 1 + descendantCount(child);
  }
  return total;
}

/**
 * The default expansion: every root plus, for a single-root org, that root's
 * direct reports.
 *
 * Expanding a node means "draw its children", so expanding the roots is what
 * makes the top two levels (CEO + the C-suite) visible. A forest of several
 * roots is already wide, so there we expand only the roots themselves.
 */
export function defaultExpandedIds(roots: readonly OrgNode[]): Set<string> {
  const expanded = new Set<string>();
  for (const root of roots) {
    if (root.reports.length > 0) expanded.add(root.id);
  }
  return expanded;
}

/**
 * Drop the children of every collapsed node.
 *
 * The returned nodes are fresh objects, so the caller's layout pass can treat
 * them as an ordinary tree and never has to know about collapse state.
 */
export function pruneCollapsed(roots: readonly OrgNode[], expanded: ExpandedIds): OrgNode[] {
  return roots.map((node) => ({
    ...node,
    reports: expanded.has(node.id) ? pruneCollapsed(node.reports, expanded) : [],
  }));
}

/** Toggle one node's children between drawn and folded. */
export function toggleExpanded(expanded: ExpandedIds, id: string): Set<string> {
  const next = new Set(expanded);
  if (next.has(id)) next.delete(id);
  else next.add(id);
  return next;
}

/** Every node id in the tree that has at least one report. */
export function allParentIds(roots: readonly OrgNode[]): Set<string> {
  const ids = new Set<string>();
  function walk(node: OrgNode) {
    if (node.reports.length > 0) ids.add(node.id);
    node.reports.forEach(walk);
  }
  roots.forEach(walk);
  return ids;
}

/**
 * Restrict remembered expansion to ids that still exist.
 *
 * The chart keeps its expansion across navigations and refetches; agents that
 * were deleted, or filtered out of an embedded tree, must not keep a stale id
 * alive in the set. Ids the incoming tree never mentions are dropped, and a
 * subtree that is newly present falls back to the default for its branch.
 */
export function reconcileExpandedIds(
  roots: readonly OrgNode[],
  remembered: ExpandedIds | null,
): Set<string> {
  if (!remembered) return defaultExpandedIds(roots);

  const parents = allParentIds(roots);
  const kept = new Set<string>();
  for (const id of remembered) {
    if (parents.has(id)) kept.add(id);
  }

  // A tree that shares nothing with the remembered set is a different org
  // (company switch, or the first load after a filter cleared everything), so
  // start it collapsed at the default rather than fully folded.
  if (kept.size === 0) return defaultExpandedIds(roots);
  return kept;
}
