import { describe, expect, it } from "vitest";
import type { Goal } from "@paperclipai/shared";
import {
  groupGoalsByRoot,
  parseGoalOrdinal,
  sortGoalSiblings,
  splitGoalTitle,
} from "./goal-order";

function makeGoal(overrides: Partial<Goal> & { id: string; title: string }): Goal {
  return {
    companyId: "company",
    level: "team",
    status: "active",
    parentId: null,
    ownerAgentId: null,
    description: "",
    createdAt: "2026-11-19T00:00:00.000Z",
    updatedAt: "2026-11-19T00:00:00.000Z",
    ...overrides,
  } as Goal;
}

describe("parseGoalOrdinal", () => {
  it("reads a flat and a dotted ordinal off the title prefix", () => {
    expect(parseGoalOrdinal("KR3 · 获客渠道扩展")).toEqual([3]);
    expect(parseGoalOrdinal("KR2.10 · 某子项")).toEqual([2, 10]);
  });

  it("returns null for titles with no leading number", () => {
    expect(parseGoalOrdinal("风险 · 加量与降效率成本方向相反")).toBeNull();
    expect(parseGoalOrdinal("里程碑 · Q4 关键节点")).toBeNull();
    expect(parseGoalOrdinal("O · Q4 买量增长")).toBeNull();
  });

  it("ignores digits that live in the descriptive tail, not the prefix", () => {
    // "6 条" must not be read as this goal's ordinal.
    expect(parseGoalOrdinal("需要拍板 · 11 项未决")).toBeNull();
    expect(parseGoalOrdinal("KR2.2 · campaign 调优：暂停最差 6 条")).toEqual([2, 2]);
  });
});

describe("sortGoalSiblings", () => {
  it("orders KR1..KR5 numerically regardless of the incoming order", () => {
    const goals = [
      makeGoal({ id: "kr1", title: "KR1 · 投放效率优化" }),
      makeGoal({ id: "kr5", title: "KR5 · Organic 拉新" }),
      makeGoal({ id: "kr3", title: "KR3 · 获客渠道扩展" }),
      makeGoal({ id: "kr4", title: "KR4 · Android 预装渠道效率优化" }),
      makeGoal({ id: "kr2", title: "KR2 · 预算调整" }),
    ];
    expect(sortGoalSiblings(goals).map((g) => g.id)).toEqual([
      "kr1",
      "kr2",
      "kr3",
      "kr4",
      "kr5",
    ]);
  });

  it("sorts sub-ordinals numerically, not lexicographically", () => {
    const goals = [
      makeGoal({ id: "b", title: "KR1.10 · 第十" }),
      makeGoal({ id: "a", title: "KR1.2 · 第二" }),
      makeGoal({ id: "c", title: "KR1.1 · 第一" }),
    ];
    // A string sort would give 1.1, 1.10, 1.2 — the numeric sort must not.
    expect(sortGoalSiblings(goals).map((g) => g.id)).toEqual(["c", "a", "b"]);
  });

  it("puts unnumbered goals after numbered ones, keeping their relative order", () => {
    const goals = [
      makeGoal({ id: "risk", title: "风险 · 加量与降效率成本方向相反" }),
      makeGoal({ id: "kr2", title: "KR2 · 预算调整" }),
      makeGoal({ id: "milestone", title: "里程碑 · Q4 关键节点" }),
      makeGoal({ id: "kr1", title: "KR1 · 投放效率优化" }),
      makeGoal({ id: "decide", title: "需要拍板 · 11 项未决" }),
    ];
    expect(sortGoalSiblings(goals).map((g) => g.id)).toEqual([
      "kr1",
      "kr2",
      "risk",
      "milestone",
      "decide",
    ]);
  });

  it("sorts a shorter ordinal ahead of its own children", () => {
    const goals = [
      makeGoal({ id: "child", title: "KR1.1 · 子项" }),
      makeGoal({ id: "parent", title: "KR1 · 父项" }),
    ];
    expect(sortGoalSiblings(goals).map((g) => g.id)).toEqual(["parent", "child"]);
  });

  it("does not mutate the input array", () => {
    const goals = [
      makeGoal({ id: "kr2", title: "KR2 · 乙" }),
      makeGoal({ id: "kr1", title: "KR1 · 甲" }),
    ];
    sortGoalSiblings(goals);
    expect(goals.map((g) => g.id)).toEqual(["kr2", "kr1"]);
  });
});

describe("groupGoalsByRoot", () => {
  it("splits two company-level objectives into separate blocks with their subtrees", () => {
    const goals = [
      makeGoal({ id: "o1", title: "O · Q4 买量增长", level: "company" }),
      makeGoal({ id: "o2", title: "O · 打造业界领先的 agent 系统", level: "company" }),
      makeGoal({ id: "o1-kr1", title: "KR1 · 投放效率优化", parentId: "o1" }),
      makeGoal({ id: "o2-kr1", title: "KR1 · 换壳", parentId: "o2" }),
      makeGoal({ id: "o1-kr1-1", title: "KR1.1 · 新卖点和素材挖掘", parentId: "o1-kr1" }),
    ];
    const groups = groupGoalsByRoot(goals);
    expect(groups.map((g) => g.root.id)).toEqual(["o1", "o2"]);
    expect(groups[0].descendants.map((g) => g.id).sort()).toEqual(["o1-kr1", "o1-kr1-1"]);
    expect(groups[1].descendants.map((g) => g.id)).toEqual(["o2-kr1"]);
  });

  it("treats a goal whose parent is absent as its own root", () => {
    const goals = [
      makeGoal({ id: "root", title: "O · 根" }),
      makeGoal({ id: "orphan", title: "KR1 · 孤儿", parentId: "missing" }),
    ];
    expect(groupGoalsByRoot(goals).map((g) => g.root.id)).toEqual(["orphan", "root"]);
  });

  it("survives a parent cycle instead of looping forever", () => {
    const goals = [
      makeGoal({ id: "root", title: "O · 根" }),
      makeGoal({ id: "a", title: "KR1 · 甲", parentId: "root" }),
      makeGoal({ id: "b", title: "KR2 · 乙", parentId: "a" }),
    ];
    // Point the grandchild's child back at its ancestor.
    goals.push(makeGoal({ id: "c", title: "KR3 · 丙", parentId: "b" }));
    const groups = groupGoalsByRoot(goals);
    expect(groups).toHaveLength(1);
    expect(groups[0].descendants).toHaveLength(3);
  });

  it("returns no groups for an empty list", () => {
    expect(groupGoalsByRoot([])).toEqual([]);
  });
});

describe("splitGoalTitle", () => {
  it("splits a title at its first full-width colon", () => {
    expect(splitGoalTitle("KR6 · 规模：48 个 agent 并发")).toEqual({
      label: "KR6 · 规模",
      detail: "48 个 agent 并发",
    });
  });

  it("leaves a title without a colon untouched", () => {
    expect(splitGoalTitle("KR1.4 · 加量闸门")).toEqual({
      label: "KR1.4 · 加量闸门",
      detail: null,
    });
  });

  it("does not split on a colon that has nothing after it", () => {
    expect(splitGoalTitle("KR1 · 某项：")).toEqual({
      label: "KR1 · 某项：",
      detail: null,
    });
  });
});
