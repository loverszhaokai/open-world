import { useEffect } from "react";
import { useQuery } from "@tanstack/react-query";
import { goalsApi } from "../api/goals";
import { useCompany } from "../context/CompanyContext";
import { useDialogActions } from "../context/DialogContext";
import { useBreadcrumbs } from "../context/BreadcrumbContext";
import { queryKeys } from "../lib/queryKeys";
import { GoalTree } from "../components/GoalTree";
import { groupGoalsByRoot, splitGoalTitle } from "../lib/goal-order";
import { StatusBadge } from "../components/StatusBadge";
import { EmptyState } from "../components/EmptyState";
import { PageSkeleton } from "../components/PageSkeleton";
import { Button } from "@/components/ui/button";
import { Target, Plus } from "lucide-react";
import { Link } from "@/lib/router";

export function Goals() {
  const { selectedCompanyId } = useCompany();
  const { openNewGoal } = useDialogActions();
  const { setBreadcrumbs } = useBreadcrumbs();

  useEffect(() => {
    setBreadcrumbs([{ label: "Goals" }]);
  }, [setBreadcrumbs]);

  const { data: goals, isLoading, error } = useQuery({
    queryKey: queryKeys.goals.list(selectedCompanyId!),
    queryFn: () => goalsApi.list(selectedCompanyId!),
    enabled: !!selectedCompanyId,
  });

  if (!selectedCompanyId) {
    return <EmptyState icon={Target} message="Select an organization to view goals." />;
  }

  if (isLoading) {
    return <PageSkeleton variant="list" />;
  }

  return (
    <div className="space-y-4">
      {error && <p className="text-sm text-destructive">{error.message}</p>}

      {goals && goals.length === 0 && (
        <EmptyState
          icon={Target}
          message="No goals yet."
          action="Add Goal"
          onAction={() => openNewGoal()}
        />
      )}

      {goals && goals.length > 0 && (
        <>
          <div className="flex items-center justify-start">
            <Button size="sm" variant="outline" onClick={() => openNewGoal()}>
              <Plus className="h-3.5 w-3.5 mr-1.5" />
              New Goal
            </Button>
          </div>
          {/* One block per top-level objective: two unrelated company goals in a
              single flat list was the main thing that made this page unreadable. */}
          <div className="space-y-6">
            {groupGoalsByRoot(goals).map(({ root, descendants }) => {
              const { label, detail } = splitGoalTitle(root.title);
              return (
                <section key={root.id} className="border border-border">
                  <header className="flex items-start gap-2 border-b border-border bg-muted/40 px-3 py-2">
                    <div className="min-w-0 flex-1">
                      <Link
                        to={`/goals/${root.id}`}
                        className="text-sm font-semibold no-underline text-inherit hover:underline"
                        title={root.title}
                      >
                        {label}
                      </Link>
                      {detail ? (
                        <p className="mt-0.5 text-xs text-muted-foreground">{detail}</p>
                      ) : null}
                    </div>
                    <span className="text-xs text-muted-foreground capitalize shrink-0">
                      {root.level}
                    </span>
                    <StatusBadge status={root.status} />
                  </header>
                  {descendants.length > 0 ? (
                    <GoalTree
                      goals={descendants}
                      goalLink={(goal) => `/goals/${goal.id}`}
                      bare
                    />
                  ) : (
                    <p className="px-3 py-2 text-sm text-muted-foreground">No sub-goals.</p>
                  )}
                </section>
              );
            })}
          </div>
        </>
      )}
    </div>
  );
}
