import { describe, expect, it } from "vitest";
import type { OrgNode } from "@/api/agents";
import {
  allParentIds,
  defaultExpandedIds,
  descendantCount,
  pruneCollapsed,
  reconcileExpandedIds,
  toggleExpanded,
} from "./org-collapse";

function node(id: string, reports: OrgNode[] = []): OrgNode {
  return { id, name: id, role: "engineer", status: "active", reports };
}

/**
 * Shaped like the org that motivated collapsing: a CEO over three deputies,
 * two of which carry large teams of their own.
 */
function org(): OrgNode[] {
  return [
    node("ceo", [
      node("cao", [node("dev-1"), node("dev-2"), node("reviewer", [node("reviewer-1")])]),
      node("coo", [node("growth", [node("paid-growth", [node("buyer-1")])])]),
      node("cpo", [node("hr")]),
      node("secretary"),
    ]),
  ];
}

describe("descendantCount", () => {
  it("counts every level, not just direct reports", () => {
    const [ceo] = org();
    // cao(3) + reviewer-1 + coo(1) + growth + paid-growth + buyer-1 + cpo(1) + hr + secretary
    expect(descendantCount(ceo!)).toBe(12);
  });

  it("counts a leaf as zero", () => {
    expect(descendantCount(node("solo"))).toBe(0);
  });

  it("counts a single level of reports", () => {
    expect(descendantCount(node("lead", [node("a"), node("b")]))).toBe(2);
  });
});

describe("defaultExpandedIds", () => {
  it("expands the root so the top two levels are visible", () => {
    expect(defaultExpandedIds(org())).toEqual(new Set(["ceo"]));
  });

  it("leaves the deputies collapsed", () => {
    const expanded = defaultExpandedIds(org());
    expect(expanded.has("cao")).toBe(false);
    expect(expanded.has("coo")).toBe(false);
  });

  it("expands every root of a forest", () => {
    const roots = [node("r1", [node("a")]), node("r2", [node("b")])];
    expect(defaultExpandedIds(roots)).toEqual(new Set(["r1", "r2"]));
  });

  it("omits a childless root, which has nothing to expand", () => {
    expect(defaultExpandedIds([node("solo")])).toEqual(new Set());
  });

  it("returns an empty set for an empty forest", () => {
    expect(defaultExpandedIds([])).toEqual(new Set());
  });
});

describe("pruneCollapsed", () => {
  it("keeps the children of expanded nodes and drops the rest", () => {
    const pruned = pruneCollapsed(org(), new Set(["ceo"]));

    expect(pruned[0]!.reports.map((r) => r.id)).toEqual(["cao", "coo", "cpo", "secretary"]);
    // The deputies are collapsed, so their teams take no space in the layout.
    expect(pruned[0]!.reports.every((r) => r.reports.length === 0)).toBe(true);
  });

  it("reveals exactly one more level when a deputy is expanded", () => {
    const pruned = pruneCollapsed(org(), new Set(["ceo", "cao"]));
    const cao = pruned[0]!.reports.find((r) => r.id === "cao")!;

    expect(cao.reports.map((r) => r.id)).toEqual(["dev-1", "dev-2", "reviewer"]);
    // reviewer itself stays collapsed.
    expect(cao.reports.find((r) => r.id === "reviewer")!.reports).toEqual([]);
  });

  it("hides every report when nothing is expanded", () => {
    const pruned = pruneCollapsed(org(), new Set());

    expect(pruned).toHaveLength(1);
    expect(pruned[0]!.reports).toEqual([]);
  });

  it("does not mutate the source tree", () => {
    const roots = org();
    pruneCollapsed(roots, new Set());

    expect(roots[0]!.reports).toHaveLength(4);
    expect(roots[0]!.reports[0]!.reports).toHaveLength(3);
  });

  it("preserves the node fields the chart renders", () => {
    const roots = [{ id: "a", name: "Ada", role: "ceo", status: "running", reports: [node("b")] }];
    const [pruned] = pruneCollapsed(roots, new Set());

    expect(pruned).toMatchObject({ id: "a", name: "Ada", role: "ceo", status: "running" });
  });
});

describe("toggleExpanded", () => {
  it("expands a collapsed node", () => {
    expect(toggleExpanded(new Set(["ceo"]), "cao")).toEqual(new Set(["ceo", "cao"]));
  });

  it("collapses an expanded node", () => {
    expect(toggleExpanded(new Set(["ceo", "cao"]), "cao")).toEqual(new Set(["ceo"]));
  });

  it("returns a new set rather than mutating the old one", () => {
    const before = new Set(["ceo"]);
    const after = toggleExpanded(before, "cao");

    expect(after).not.toBe(before);
    expect(before).toEqual(new Set(["ceo"]));
  });

  it("leaves a collapsed deputy's own expansion untouched", () => {
    // Collapsing cao keeps reviewer in the set, so re-expanding cao restores
    // the branch the user had already opened.
    const after = toggleExpanded(new Set(["ceo", "cao", "reviewer"]), "cao");
    expect(after.has("reviewer")).toBe(true);
  });
});

describe("allParentIds", () => {
  it("lists every node that has reports, at any depth", () => {
    expect(allParentIds(org())).toEqual(
      new Set(["ceo", "cao", "reviewer", "coo", "growth", "paid-growth", "cpo"]),
    );
  });

  it("excludes leaves", () => {
    const ids = allParentIds(org());
    expect(ids.has("secretary")).toBe(false);
    expect(ids.has("dev-1")).toBe(false);
  });
});

describe("reconcileExpandedIds", () => {
  it("falls back to the default when nothing is remembered", () => {
    expect(reconcileExpandedIds(org(), null)).toEqual(new Set(["ceo"]));
  });

  it("keeps a remembered expansion across a refetch", () => {
    expect(reconcileExpandedIds(org(), new Set(["ceo", "cao"]))).toEqual(new Set(["ceo", "cao"]));
  });

  it("drops ids that no longer exist in the tree", () => {
    const kept = reconcileExpandedIds(org(), new Set(["ceo", "fired-vp"]));
    expect(kept).toEqual(new Set(["ceo"]));
  });

  it("drops ids that became leaves", () => {
    // cao lost its whole team, so it is no longer expandable.
    const trimmed = [node("ceo", [node("cao"), node("coo", [node("growth")])])];
    expect(reconcileExpandedIds(trimmed, new Set(["ceo", "cao"]))).toEqual(new Set(["ceo"]));
  });

  it("re-defaults when the remembered set matches nothing (company switch)", () => {
    const other = [node("other-ceo", [node("other-vp", [node("ic")])])];
    expect(reconcileExpandedIds(other, new Set(["ceo", "cao"]))).toEqual(new Set(["other-ceo"]));
  });

  it("re-defaults rather than fully collapsing an org it cannot match", () => {
    // Guards the case the user would read as a bug: coming back to the page
    // and seeing a single lonely root card.
    const reconciled = reconcileExpandedIds(org(), new Set(["stale-only"]));
    expect(reconciled.size).toBeGreaterThan(0);
  });

  it("handles an empty tree", () => {
    expect(reconcileExpandedIds([], new Set(["ceo"]))).toEqual(new Set());
  });

  it("only ever returns ids that are parents in the tree", () => {
    // The chart decides "is everything expanded?" by comparing this set's
    // size against the parent count, which is only valid while the result
    // stays a subset of the parents.
    const parents = allParentIds(org());
    for (const remembered of [null, new Set<string>(), new Set(["ceo", "ghost", "dev-1"])]) {
      for (const id of reconcileExpandedIds(org(), remembered)) {
        expect(parents.has(id)).toBe(true);
      }
    }
  });
});
