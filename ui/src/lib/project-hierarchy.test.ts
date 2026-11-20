import { describe, expect, it } from "vitest";
import { isProjectDescendant, projectAncestorPath, projectHierarchyRows } from "./project-hierarchy";
const root = { id: "a", name: "Root", parentProjectId: null };
const child = { id: "b", name: "Child", parentProjectId: "a" };
const leaf = { id: "c", name: "Leaf", parentProjectId: "b" };
describe("project navigation hierarchy", () => {
  it("orders ancestors before descendants and hides the whole collapsed subtree", () => {
    expect(projectHierarchyRows([leaf, child, root]).map(row => [row.project.id, row.depth]))
      .toEqual([["a", 0], ["b", 1], ["c", 2]]);
    expect(projectHierarchyRows([leaf, child, root], new Set(["a"])).map(row => row.project.id)).toEqual(["a"]);
  });
  it("keeps search matches whose parents are missing and survives malformed cycles", () => {
    expect(projectHierarchyRows([leaf])[0].depth).toBe(0);
    const cycle = [{ ...root, parentProjectId: "c" }, child, leaf];
    expect(projectHierarchyRows(cycle)).toHaveLength(3);
    const byId = new Map(cycle.map(row => [row.id, row]));
    expect(projectAncestorPath(leaf, byId)).toBe("Root / Child");
    expect(isProjectDescendant(leaf, "missing", byId)).toBe(false);
  });
  it("excludes self and indirect descendants from parent choices", () => {
    const byId = new Map([root, child, leaf].map(row => [row.id, row]));
    expect(isProjectDescendant(root, "a", byId)).toBe(true);
    expect(isProjectDescendant(leaf, "a", byId)).toBe(true);
    expect(isProjectDescendant(root, "c", byId)).toBe(false);
  });
});
