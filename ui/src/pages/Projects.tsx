import { useEffect, useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import type { Project } from "@paperclipai/shared";
import { projectsApi } from "../api/projects";
import { useCompany } from "../context/CompanyContext";
import { useDialogActions } from "../context/DialogContext";
import { useBreadcrumbs } from "../context/BreadcrumbContext";
import { queryKeys } from "../lib/queryKeys";
import { EntityRow } from "../components/EntityRow";
import { MarkdownSummary } from "../components/MarkdownSummary";
import { ProjectTile } from "../components/ProjectTile";
import { StatusBadge } from "../components/StatusBadge";
import { MembershipAction } from "../components/MembershipAction";
import { StarToggle } from "../components/StarToggle";
import { EmptyState } from "../components/EmptyState";
import { PageSkeleton } from "../components/PageSkeleton";
import { formatDate, formatNumber, formatProjectBudget, projectUrl } from "../lib/utils";
import {
  isStarred,
  resourceMembershipState,
  useResourceMembershipMutation,
  useResourceMemberships,
} from "../hooks/useResourceMemberships";
import { ProjectsToolbar, type ProjectSortField, type ProjectSortDir } from "@/components/ProjectsToolbar";
import { Hexagon } from "lucide-react";
import { Lock } from "lucide-react";
import { Card } from "@/components/ui/card";
import { ChevronDown, ChevronRight } from "lucide-react";
import { projectAncestorPath, projectHierarchyRows } from "../lib/project-hierarchy";

function compareProjectNames(left: Project, right: Project) {
  const nameDiff = left.name.localeCompare(right.name, undefined, { sensitivity: "base" });
  return nameDiff !== 0 ? nameDiff : left.id.localeCompare(right.id);
}

function projectTime(value: Date | string | null | undefined): number | null {
  if (!value) return null;
  const time = new Date(value).getTime();
  return Number.isFinite(time) ? time : null;
}

function compareOptionalTime(
  left: Date | string | null | undefined,
  right: Date | string | null | undefined,
  sortDir: ProjectSortDir,
) {
  const leftTime = projectTime(left);
  const rightTime = projectTime(right);
  if (leftTime === null && rightTime === null) return 0;
  if (leftTime === null) return 1;
  if (rightTime === null) return -1;
  return sortDir === "asc" ? leftTime - rightTime : rightTime - leftTime;
}

function sortProjects(projects: Project[], sortField: ProjectSortField, sortDir: ProjectSortDir) {
  return [...projects].sort((left, right) => {
    let comparison = 0;
    if (sortField === "name") {
      comparison = compareProjectNames(left, right);
      return sortDir === "asc" ? comparison : -comparison;
    }

    if (sortField === "updated") comparison = compareOptionalTime(left.updatedAt, right.updatedAt, sortDir);
    else if (sortField === "created") comparison = compareOptionalTime(left.createdAt, right.createdAt, sortDir);
    else comparison = compareOptionalTime(left.targetDate, right.targetDate, sortDir);

    if (comparison === 0) comparison = compareProjectNames(left, right);
    return comparison;
  });
}

export function Projects() {
  const { selectedCompanyId } = useCompany();
  const { openNewProject } = useDialogActions();
  const { setBreadcrumbs } = useBreadcrumbs();
  const [query, setQuery] = useState("");
  const [sortField, setSortField] = useState<ProjectSortField>("name");
  const [sortDir, setSortDir] = useState<ProjectSortDir>("asc");
  const [collapsed, setCollapsed] = useState(new Set<string>());

  useEffect(() => {
    setBreadcrumbs([{ label: "Projects" }]);
  }, [setBreadcrumbs]);

  const { data: allProjects, isLoading, error } = useQuery({
    queryKey: queryKeys.projects.list(selectedCompanyId!),
    queryFn: () => projectsApi.list(selectedCompanyId!),
    enabled: !!selectedCompanyId,
  });
  const membershipsQuery = useResourceMemberships(selectedCompanyId);
  const membershipMutation = useResourceMembershipMutation(selectedCompanyId);
  const projects = useMemo(
    () => allProjects ?? [],
    [allProjects],
  );
  const projectsById = useMemo(() => new Map(projects.map(project => [project.id, project])), [projects]);
  const sortedProjects = useMemo(
    () => {
      const words = query.trim().toLocaleLowerCase().split(/\s+/).filter(Boolean);
      const matching = projects.filter(project => {
        const text = `${project.name} ${project.description ?? ""}`.toLocaleLowerCase();
        return words.every(word => text.includes(word));
      });
      return sortProjects(matching, sortField, sortDir);
    },
    [projects, query, sortDir, sortField],
  );
  const groupedProjects = useMemo(() => {
    const groups = {
      mine: [] as typeof sortedProjects,
      other: [] as typeof sortedProjects,
    };

    for (const project of sortedProjects) {
      const state = resourceMembershipState(membershipsQuery.data, "project", project.id);
      if (state === "left") groups.other.push(project);
      else groups.mine.push(project);
    }

    return groups;
  }, [membershipsQuery.data, sortedProjects]);

  if (!selectedCompanyId) {
    return <EmptyState icon={Hexagon} message="Select an organization to view projects." />;
  }

  if (isLoading) {
    return <PageSkeleton variant="list" />;
  }

  return (
    <div className="space-y-4">
      <ProjectsToolbar query={query} onQueryChange={setQuery} sortField={sortField} sortDir={sortDir}
        onSortChange={(field, direction) => { setSortField(field); setSortDir(direction); }} onNewProject={openNewProject} />

      {error && <p className="text-sm text-destructive">{error.message}</p>}

      {!isLoading && projects.length === 0 && (
        <EmptyState
          icon={Hexagon}
          message="No projects yet."
          action="Add Project"
          onAction={openNewProject}
        />
      )}

      {projects.length > 0 && sortedProjects.length === 0 && <p className="text-sm text-muted-foreground">No projects match your search.</p>}

      {sortedProjects.length > 0 && (
        <div className="space-y-6">
          {([
            ["My Projects", groupedProjects.mine],
            ["Other Projects", groupedProjects.other],
          ] as const).map(([label, sectionProjects]) => {
            if (sectionProjects.length === 0) return null;

            return (
              <section key={label} className="space-y-2">
                <div className="flex items-center justify-between">
                  <h2 className="text-sm font-medium">{label}</h2>
                  <span className="text-xs text-muted-foreground">
                    {sectionProjects.length} project{sectionProjects.length === 1 ? "" : "s"}
                  </span>
                </div>
                <Card className="block py-0 overflow-hidden divide-y divide-border">
                  {projectHierarchyRows(sectionProjects, query.trim() ? new Set<string>() : collapsed).map(({ project, depth, hasChildren }) => {
                    const state = resourceMembershipState(membershipsQuery.data, "project", project.id);
                    const pending = membershipMutation.isPending &&
                      membershipMutation.variables?.resourceType === "project" &&
                      membershipMutation.variables.resourceId === project.id;
                    const starPending = pending && membershipMutation.variables?.starred !== undefined;
                    const joinLeavePending = pending && membershipMutation.variables?.starred === undefined;
                    const starred = isStarred(membershipsQuery.data, "project", project.id);
                    return (
                      <div key={project.id} className="flex min-w-0 items-center" style={{ paddingInlineStart: Math.min(depth, 4) * 16 }}>
                        {hasChildren ? <button type="button" className="shrink-0 p-2 text-muted-foreground"
                          aria-label={`${collapsed.has(project.id) && !query.trim() ? "Expand" : "Collapse"} ${project.name}`}
                          aria-expanded={!collapsed.has(project.id) || !!query.trim()}
                          disabled={!!query.trim()}
                          onClick={() => setCollapsed(previous => {
                            const next = new Set(previous);
                            if (next.has(project.id)) next.delete(project.id); else next.add(project.id);
                            return next;
                          })}>
                          {collapsed.has(project.id) && !query.trim() ? <ChevronRight className="size-4" /> : <ChevronDown className="size-4" />}
                        </button> : <span className="w-8 shrink-0" />}
                      <div className="min-w-0 flex-1 sm:flex sm:items-center">
                        <EntityRow
                          leading={<ProjectTile color={project.color ?? null} icon={project.icon ?? null} size="sm" />}
                          title={project.name}
                          titleAccessory={depth === 0 && projectAncestorPath(project, projectsById)
                            ? <span className="truncate text-xs text-muted-foreground">in {projectAncestorPath(project, projectsById)}</span> : undefined}
                          subtitle={project.description ? <MarkdownSummary>{project.description}</MarkdownSummary> : undefined}
                          reserveSubtitleSpace
                          to={projectUrl(project)}
                          className={`group min-w-0 flex-1 border-b-0 ${state === "left" ? "text-foreground/55" : ""}`}
                        />
                        <div className="flex flex-wrap items-center gap-3 px-4 pb-2 sm:shrink-0 sm:pb-0">
                          {project.visibility === "private" ? <Lock className="size-4 shrink-0 text-muted-foreground" aria-label="Private project" /> : null}
                          <span
                            className="hidden text-xs text-muted-foreground tabular-nums sm:inline"
                            title={`${formatNumber(project.taskCount ?? 0)} task${(project.taskCount ?? 0) === 1 ? "" : "s"}`}
                          >
                            {formatNumber(project.taskCount ?? 0)} task{(project.taskCount ?? 0) === 1 ? "" : "s"}
                          </span>
                          {project.budget && (
                            <span className="hidden text-xs text-muted-foreground tabular-nums sm:inline">
                              {formatProjectBudget(project.budget)}
                            </span>
                          )}
                          {project.targetDate && (
                            <span className="hidden text-xs text-muted-foreground md:inline">
                              {formatDate(project.targetDate)}
                            </span>
                          )}
                          <StatusBadge status={project.status} />
                          <MembershipAction
                            state={state}
                            pending={joinLeavePending}
                            pendingState={joinLeavePending ? membershipMutation.variables?.state : null}
                            resourceName={project.name}
                            onJoin={() => membershipMutation.mutate({
                              resourceType: "project",
                              resourceId: project.id,
                              resourceName: project.name,
                              state: "joined",
                            })}
                            onLeave={() => membershipMutation.mutate({
                              resourceType: "project",
                              resourceId: project.id,
                              resourceName: project.name,
                              state: "left",
                            })}
                          />
                          <StarToggle
                            size="row"
                            starred={starred}
                            pending={starPending}
                            resourceName={project.name}
                            onToggle={(next) => membershipMutation.mutate({
                              resourceType: "project",
                              resourceId: project.id,
                              resourceName: project.name,
                              starred: next,
                            })}
                          />
                        </div>
                      </div>
                      </div>
                    );
                  })}
                </Card>
              </section>
            );
          })}
        </div>
      )}
    </div>
  );
}
