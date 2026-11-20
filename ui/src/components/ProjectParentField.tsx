import { useId, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import type { Project } from "@paperclipai/shared";
import { projectsApi } from "@/api/projects";
import { queryKeys } from "@/lib/queryKeys";
import { isProjectDescendant, projectAncestorPath } from "@/lib/project-hierarchy";
import { Button } from "./ui/button";

export function ProjectParentField({ project, onSave }: {
  project: Pick<Project, "id" | "companyId" | "parentProjectId">;
  onSave?: (parentProjectId: string | null) => void | Promise<unknown>;
}) {
  const id = useId();
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const projects = useQuery({ queryKey: queryKeys.projects.list(project.companyId),
    queryFn: () => projectsApi.list(project.companyId), enabled: editing || !!project.parentProjectId });
  const available = (projects.data ?? []).filter(row => row.companyId === project.companyId);
  const byId = new Map(available.map(row => [row.id, row]));
  const options = available.filter(row => !isProjectDescendant(row, project.id, byId))
    .map(row => ({ id: row.id, label: [projectAncestorPath(row, byId), row.name].filter(Boolean).join(" / ") }))
    .sort((a, b) => a.label.localeCompare(b.label));
  const parent = project.parentProjectId ? byId.get(project.parentProjectId) : undefined;
  async function save() {
    if (!onSave || saving) return;
    setSaving(true); setError(null);
    try { await onSave(draft || null); setEditing(false); }
    catch { setError("Could not save parent project. Your selection is kept; try again."); }
    finally { setSaving(false); }
  }
  return <div className="min-w-0 w-full space-y-2">
    <p className="break-words text-sm">{parent ? [projectAncestorPath(parent, byId), parent.name].filter(Boolean).join(" / ")
      : project.parentProjectId ? "Parent project unavailable" : "No parent project"}</p>
    <p className="text-xs text-muted-foreground">Group projects for navigation. Each project keeps its own access, goals and budget.</p>
    {onSave && !editing && <Button type="button" variant="outline" size="sm" onClick={() => {
      setDraft(project.parentProjectId ?? ""); setError(null); setEditing(true);
    }}>Edit parent project</Button>}
    {editing && <div className="space-y-2">
      <label htmlFor={id} className="text-sm">Parent project</label>
      {projects.isError ? <div role="alert" className="text-sm text-destructive">Could not load projects.
        <Button type="button" variant="outline" size="sm" onClick={() => void projects.refetch()}>Retry loading projects</Button>
      </div> : projects.isPending ? <p role="status">Loading projects…</p> : <select id={id} value={draft}
        disabled={saving} onChange={event => setDraft(event.target.value)} className="w-full min-w-0 rounded-md border bg-background p-2 text-sm">
        <option value="">No parent project</option>
        {draft && !options.some(option => option.id === draft) && <option value={draft} disabled>Current parent unavailable</option>}
        {options.map(option => <option key={option.id} value={option.id}>{option.label}</option>)}
      </select>}
      {error && <p role="alert" className="text-sm text-destructive">{error}</p>}
      <div className="flex gap-2">
        <Button type="button" size="sm" disabled={saving || projects.isPending || projects.isError} onClick={() => void save()}>{saving ? "Saving…" : "Save parent"}</Button>
        <Button type="button" size="sm" variant="ghost" disabled={saving} onClick={() => setEditing(false)}>Cancel</Button>
      </div>
    </div>}
  </div>;
}
