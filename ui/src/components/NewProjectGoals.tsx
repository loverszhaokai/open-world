import { useId, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { goalsApi } from "../api/goals";
import { queryKeys } from "../lib/queryKeys";
import { goalPath, sortGoalSiblings } from "../lib/goal-order";
import { Button } from "./ui/button";
import { Input } from "./ui/input";

export function NewProjectGoals({ companyId, selected, onChange, disabled }: {
  companyId: string;
  selected: string[];
  onChange: (ids: string[]) => void;
  disabled: boolean;
}) {
  const id = useId();
  const [expanded, setExpanded] = useState(false);
  const [search, setSearch] = useState("");
  const goals = useQuery({ queryKey: queryKeys.goals.list(companyId),
    queryFn: () => goalsApi.list(companyId), enabled: expanded });
  const available = (goals.data ?? []).filter(goal => goal.companyId === companyId);
  const byId = new Map(available.map(goal => [goal.id, goal]));
  const options = sortGoalSiblings(available).map(goal => ({ id: goal.id, label: goalPath(goal, byId) }));
  const visible = options.filter(goal => goal.label.toLocaleLowerCase().includes(search.trim().toLocaleLowerCase()));
  return <section aria-label="Project goals" className="space-y-2 border-t py-4">
    <Button type="button" variant="ghost" size="sm" disabled={disabled} aria-expanded={expanded}
      aria-controls={id} onClick={() => setExpanded(value => !value)}>
      Goals (optional){selected.length > 0 ? ` · ${selected.length} selected` : ""}
    </Button>
    {expanded && <div id={id} className="space-y-3">
      <Input aria-label="Search goals" placeholder="Search by goal or parent" value={search}
        disabled={disabled} onChange={event => setSearch(event.target.value)} />
      {goals.isPending ? <p role="status" className="text-sm text-muted-foreground">Loading goals…</p>
        : goals.isError ? <div role="alert" className="space-y-2 text-sm text-destructive">
          <p>Could not load goals.</p>
          <Button type="button" size="sm" variant="outline" disabled={disabled} onClick={() => void goals.refetch()}>Retry loading goals</Button>
        </div> : <div className="max-h-48 space-y-2 overflow-y-auto">
          {visible.length === 0 && <p className="text-sm text-muted-foreground">{options.length ? "No matching goals" : "No goals yet"}</p>}
          {visible.map(goal => <label key={goal.id} className="flex items-start gap-2 text-sm">
            <input type="checkbox" className="mt-1 shrink-0" disabled={disabled} checked={selected.includes(goal.id)}
              onChange={event => onChange(event.target.checked ? [...selected, goal.id] : selected.filter(id => id !== goal.id))} />
            <span className="min-w-0 break-words">{goal.label}</span>
          </label>)}
        </div>}
      {selected.length > 0 && <Button type="button" size="sm" variant="ghost" disabled={disabled}
        onClick={() => onChange([])}>Clear goals</Button>}
    </div>}
  </section>;
}
