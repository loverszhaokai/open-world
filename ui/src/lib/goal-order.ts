import type { Goal } from "@paperclipai/shared";

/**
 * Goals carry no explicit ordering column, so sibling order is derived from the
 * numbering operators authors already put in the title ("KR1", "KR2.10", "O").
 * Without this the API's arbitrary row order renders as KR1 → KR5 → KR3, which
 * reads as broken even though the tree itself is correct.
 */

/**
 * Pulls the dotted number out of a title prefix: "KR2.10 · ..." → [2, 10].
 * Returns null when the title carries no number, so those entries can be sorted
 * after the numbered ones instead of being forced to position zero.
 */
export function parseGoalOrdinal(title: string): number[] | null {
  // Only look at the label before the "·" / ":" separator so digits inside the
  // descriptive part ("暂停最差 6 条") can never be mistaken for an ordinal.
  const head = title.split(/[·:：]/u, 1)[0] ?? "";
  const match = head.match(/^\s*[A-Za-z]*\s*(\d+(?:\.\d+)*)/u);
  if (!match) return null;
  return match[1].split(".").map((part) => Number.parseInt(part, 10));
}

/**
 * Compares two dotted ordinals numerically, so KR1.2 precedes KR1.10 (a plain
 * string compare would invert them). A shorter prefix wins: KR1 before KR1.1.
 */
function compareOrdinals(left: number[], right: number[]): number {
  const length = Math.max(left.length, right.length);
  for (let index = 0; index < length; index += 1) {
    const a = left[index];
    const b = right[index];
    if (a === undefined) return -1;
    if (b === undefined) return 1;
    if (a !== b) return a - b;
  }
  return 0;
}

/**
 * Orders one sibling group: numbered goals first in numeric order, then the
 * unnumbered ones (risks, tracking items, milestones, open decisions) in their
 * original relative order. The sort is stable, so equal keys never shuffle.
 */
export function sortGoalSiblings(goals: Goal[]): Goal[] {
  return goals
    .map((goal, index) => ({ goal, index, ordinal: parseGoalOrdinal(goal.title) }))
    .sort((left, right) => {
      if (left.ordinal && right.ordinal) {
        const diff = compareOrdinals(left.ordinal, right.ordinal);
        if (diff !== 0) return diff;
      } else if (left.ordinal) {
        return -1;
      } else if (right.ordinal) {
        return 1;
      }
      return left.index - right.index;
    })
    .map((entry) => entry.goal);
}

/** A top-level goal together with every descendant that hangs off it. */
export interface GoalTreeRoot {
  root: Goal;
  descendants: Goal[];
}

/**
 * Splits a flat goal list into one group per root, so each company-level
 * objective can be rendered as its own block instead of running together in a
 * single undifferentiated list. Roots are returned in sibling order; orphans
 * (parent missing from the list) are treated as roots so nothing is dropped.
 */
export function groupGoalsByRoot(goals: Goal[]): GoalTreeRoot[] {
  const ids = new Set(goals.map((goal) => goal.id));
  const roots = sortGoalSiblings(
    goals.filter((goal) => !goal.parentId || !ids.has(goal.parentId)),
  );

  const childrenOf = new Map<string, Goal[]>();
  for (const goal of goals) {
    if (!goal.parentId || !ids.has(goal.parentId)) continue;
    const siblings = childrenOf.get(goal.parentId) ?? [];
    siblings.push(goal);
    childrenOf.set(goal.parentId, siblings);
  }

  return roots.map((root) => {
    const descendants: Goal[] = [];
    const queue = [root.id];
    const seen = new Set<string>([root.id]);
    while (queue.length > 0) {
      const parentId = queue.shift();
      if (!parentId) continue;
      for (const child of childrenOf.get(parentId) ?? []) {
        // Guard against a parentId cycle so a bad row cannot hang the page.
        if (seen.has(child.id)) continue;
        seen.add(child.id);
        descendants.push(child);
        queue.push(child.id);
      }
    }
    return { root, descendants };
  });
}

/** Title split into the short scannable label and the trailing detail, if any. */
export interface GoalTitleParts {
  label: string;
  detail: string | null;
}

/**
 * Splits a long title at its first "：" / ":" so the list can show the short
 * label and tuck the quantified tail away. Nothing is discarded — the detail is
 * still rendered (dimmed, and the full string stays in the `title` attribute).
 */
export function splitGoalTitle(title: string): GoalTitleParts {
  const trimmed = title.trim();
  const match = trimmed.match(/^(.*?[^\s])\s*[:：]\s*(\S.*)$/u);
  if (!match) return { label: trimmed, detail: null };
  return { label: match[1], detail: match[2] };
}
