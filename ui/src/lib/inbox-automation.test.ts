import { describe, expect, it } from "vitest";
import type { Issue } from "@paperclipai/shared";
import { AUTOMATION_SCAN_LABEL, filterInboxAutomationScans } from "./inbox-automation";

const issue = (overrides: Partial<Issue> = {}): Issue => ({
  id: "scan", title: "Whatever the producer calls this task", status: "todo", priority: "medium",
  labels: [{ name: AUTOMATION_SCAN_LABEL }], ...overrides,
} as Issue);

describe("Inbox automation scans", () => {
  it("collapses only explicitly labeled scans, never tasks inferred from their title or creator", () => {
    const scan = issue();
    const manual = issue({ id: "manual", title: "Scan the inbox for new messages", labels: [], createdByUserId: "ceo" });
    const agent = issue({ id: "agent", labels: [], createdByAgentId: "agent" });
    expect(filterInboxAutomationScans([scan, manual, agent], { showScans: false })).toEqual([manual, agent]);
  });
  it.each([
    { status: "blocked" }, { status: "in_review" }, { priority: "critical" },
    { priority: "high" }, { assigneeUserId: "me" },
  ] as Partial<Issue>[])("keeps scans needing attention visible: %j", (overrides) => {
    const scan = issue(overrides);
    expect(filterInboxAutomationScans([scan], { showScans: false, currentUserId: "me" })).toEqual([scan]);
  });
  it("restores scans through the toggle or explicit search without mutating data", () => {
    const rows = [issue()];
    expect(filterInboxAutomationScans(rows, { showScans: true })).toBe(rows);
    expect(filterInboxAutomationScans(rows, { showScans: false, searching: true })).toBe(rows);
    expect(filterInboxAutomationScans(rows, { showScans: false })).toEqual([]);
    expect(rows).toHaveLength(1);
  });
});
