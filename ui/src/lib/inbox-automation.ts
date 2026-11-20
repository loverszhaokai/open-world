import type { Issue } from "@paperclipai/shared";

/** Producers explicitly label housekeeping scans; titles never determine visibility. */
export const AUTOMATION_SCAN_LABEL = "automation:scan";

export function filterInboxAutomationScans(
  issues: Issue[],
  options: { showScans: boolean; currentUserId?: string | null; searching?: boolean },
): Issue[] {
  if (options.showScans || options.searching) return issues;
  return issues.filter((issue) => {
    if (!issue.labels?.some((label) => label.name === AUTOMATION_SCAN_LABEL)) return true;
    // An automation task that requires attention must remain visible.
    return issue.status === "blocked" || issue.status === "in_review"
      || issue.priority === "critical" || issue.priority === "high"
      || Boolean(options.currentUserId && issue.assigneeUserId === options.currentUserId);
  });
}
