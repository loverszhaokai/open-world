import type { Project } from "@paperclipai/shared";

type HierarchyProject = Pick<Project, "id" | "name" | "parentProjectId">;

export function projectAncestorPath(project: HierarchyProject, byId: Map<string, HierarchyProject>) {
  const names: string[] = [];
  const seen = new Set([project.id]);
  let parent = project.parentProjectId ? byId.get(project.parentProjectId) : undefined;
  while (parent && !seen.has(parent.id)) {
    seen.add(parent.id);
    names.unshift(parent.name);
    parent = parent.parentProjectId ? byId.get(parent.parentProjectId) : undefined;
  }
  return names.join(" / ");
}

export function isProjectDescendant(candidate: HierarchyProject, ancestorId: string, byId: Map<string, HierarchyProject>) {
  const seen = new Set<string>();
  let current: HierarchyProject | undefined = candidate;
  while (current && !seen.has(current.id)) {
    if (current.id === ancestorId) return true;
    seen.add(current.id);
    current = current.parentProjectId ? byId.get(current.parentProjectId) : undefined;
  }
  return false;
}

// Preserve caller sorting within sibling groups. Missing/filtered parents become
// roots; malformed cycles must not hang rendering or make projects disappear.
export function projectHierarchyRows<T extends HierarchyProject>(projects: T[], collapsed = new Set<string>()) {
  const byId = new Map(projects.map(project => [project.id, project]));
  const children = new Map<string, T[]>();
  const roots: T[] = [];
  for (const project of projects) {
    if (project.parentProjectId && byId.has(project.parentProjectId)) {
      const siblings = children.get(project.parentProjectId) ?? [];
      siblings.push(project);
      children.set(project.parentProjectId, siblings);
    } else roots.push(project);
  }
  const rows: { project: T; depth: number; hasChildren: boolean }[] = [];
  const visited = new Set<string>();
  for (const root of [...roots, ...projects]) {
    const stack = [{ project: root, depth: 0, hidden: false }];
    while (stack.length) {
      const { project, depth, hidden } = stack.pop()!;
      if (visited.has(project.id)) continue;
      visited.add(project.id);
      const descendants = children.get(project.id) ?? [];
      if (!hidden) rows.push({ project, depth, hasChildren: descendants.length > 0 });
      for (const child of [...descendants].reverse()) {
        stack.push({ project: child, depth: depth + 1, hidden: hidden || collapsed.has(project.id) });
      }
    }
  }
  return rows;
}
