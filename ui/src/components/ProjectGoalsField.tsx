import { useId, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import type { Goal, Project } from "@paperclipai/shared";
import { goalsApi } from "@/api/goals";
import { queryKeys } from "@/lib/queryKeys";
import { sortGoalSiblings } from "@/lib/goal-order";
import { Button } from "./ui/button";
import { Input } from "./ui/input";

type GoalProject = Pick<Project, "companyId" | "goalId" | "goalIds" | "goals">;

// Show the ancestor path so identically named KRs remain distinguishable.
// A malformed cycle must not hang the configuration page.
function goalPath(goal: Goal, byId: Map<string, Goal>): string {
  const titles = [goal.title];
  const seen = new Set([goal.id]);
  let parent = goal.parentId ? byId.get(goal.parentId) : undefined;
  while (parent && !seen.has(parent.id)) {
    seen.add(parent.id);
    titles.unshift(parent.title);
    parent = parent.parentId ? byId.get(parent.parentId) : undefined;
  }
  return titles.join(" / ");
}

export function ProjectGoalsField({ project, onSave }: {
  project: GoalProject;
  onSave?: (goalIds: string[]) => void | Promise<unknown>;
}) {
  const inputId = useId();
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState<string[]>([]);
  const [search, setSearch] = useState("");
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const goals = useQuery({
    queryKey: queryKeys.goals.list(project.companyId),
    queryFn: () => goalsApi.list(project.companyId),
    enabled: editing,
  });
  const selectedIds = project.goalIds ?? (project.goalId ? [project.goalId] : []);
  const refs = new Map((project.goals ?? []).map((goal) => [goal.id, goal.title]));
  const available = (goals.data ?? []).filter((goal) => goal.companyId === project.companyId);
  const byId = new Map(available.map((goal) => [goal.id, goal]));
  const options = sortGoalSiblings(available).map((goal) => ({ id: goal.id, label: goalPath(goal, byId) }));
  // Never silently drop an existing link just because it is absent from a list.
  for (const id of selectedIds) {
    if (!byId.has(id)) options.push({ id, label: refs.get(id) ?? "Unavailable goal" });
  }
  const visible = options.filter((goal) => goal.label.toLocaleLowerCase().includes(search.trim().toLocaleLowerCase()));

  const save = async () => {
    if (!onSave || saving) return;
    setSaving(true);
    setSaveError(null);
    try {
      await onSave(draft);
      setEditing(false);
    } catch {
      setSaveError("Could not save goals. Your selection is kept; try again.");
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="w-full min-w-0 space-y-2">
      {selectedIds.length > 0 ? (
        <ul className="space-y-1 text-sm">
          {selectedIds.map((id) => (
            <li className="break-words" key={id}>{refs.get(id) ?? byId.get(id)?.title ?? "Unavailable goal"}</li>
          ))}
        </ul>
      ) : <p className="text-sm text-muted-foreground">No goals linked</p>}
      {onSave && !editing && (
        <Button type="button" size="sm" variant="outline" onClick={() => {
          setDraft([...selectedIds]);
          setSearch("");
          setSaveError(null);
          setEditing(true);
        }}>Edit goals</Button>
      )}
      {editing && (
        <div className="space-y-3 rounded-md border p-3">
          <label htmlFor={inputId} className="text-sm font-medium">Find goals</label>
          <Input id={inputId} value={search} onChange={(event) => setSearch(event.target.value)}
            placeholder="Search by goal or parent" disabled={saving} />
          {goals.isPending ? <p role="status" className="text-sm text-muted-foreground">Loading goals…</p>
            : goals.isError ? <div role="alert" className="space-y-2 text-sm text-destructive">
              <p>Could not load goals.</p>
              <Button type="button" size="sm" variant="outline" onClick={() => void goals.refetch()}>Retry loading goals</Button>
            </div>
            : <div className="max-h-64 space-y-2 overflow-y-auto">
              {visible.length === 0 && <p className="text-sm text-muted-foreground">
                {options.length === 0 ? "No goals yet. Create one on the Goals page." : "No matching goals"}
              </p>}
              {visible.map((goal) => (
                <label key={goal.id} className="flex items-start gap-2 text-sm">
                  <input type="checkbox" checked={draft.includes(goal.id)} disabled={saving}
                    className="mt-1 shrink-0"
                    onChange={(event) => setDraft((current) => event.target.checked
                      ? [...current, goal.id] : current.filter((id) => id !== goal.id))} />
                  <span className="min-w-0 break-words">{goal.label}</span>
                </label>
              ))}
            </div>}
          {saveError && <p role="alert" className="text-sm text-destructive">{saveError}</p>}
          <div className="flex items-center justify-between gap-2">
            <Button type="button" size="sm" variant="ghost" disabled={saving} onClick={() => setEditing(false)}>Cancel</Button>
            <div className="flex items-center gap-2">
              <Button type="button" size="sm" variant="ghost" disabled={saving || goals.isPending || goals.isError}
                onClick={() => setDraft([])}>Clear selection</Button>
              <Button type="button" size="sm" disabled={saving || goals.isPending || goals.isError} onClick={() => void save()}>
                {saving ? "Saving…" : "Save goals"}
              </Button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
