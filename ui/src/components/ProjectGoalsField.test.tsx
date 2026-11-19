// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Goal } from "@paperclipai/shared";
import { ProjectGoalsField } from "./ProjectGoalsField";

const list = vi.fn();
vi.mock("@/api/goals", () => ({ goalsApi: { list: (companyId: string) => list(companyId) } }));
(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
const goal = (id: string, title: string, parentId: string | null = null): Goal => ({
  id, title, parentId, companyId: "company-a", description: null, level: "team", status: "active",
  ownerAgentId: null, createdAt: new Date(), updatedAt: new Date(),
});
let host: HTMLDivElement;
let root: Root;
let client: QueryClient;
const project = { companyId: "company-a", goalId: "o", goalIds: ["o"], goals: [{ id: "o", title: "Growth" }] };
async function mount(onSave?: (ids: string[]) => void | Promise<unknown>, value = project) {
  await act(async () => root.render(<QueryClientProvider client={client}>
    <ProjectGoalsField project={value} onSave={onSave} />
  </QueryClientProvider>));
}
async function click(text: string) {
  const button = Array.from(host.querySelectorAll("button")).find((el) => el.textContent === text);
  expect(button, text).toBeDefined();
  await act(async () => button!.click());
  await act(async () => { await new Promise((resolve) => setTimeout(resolve, 10)); });
}
function checkbox(label: string) {
  return Array.from(host.querySelectorAll("label")).find((el) => el.textContent === label)!.querySelector("input")!;
}
beforeEach(() => {
  host = document.createElement("div"); document.body.appendChild(host); root = createRoot(host);
  client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  list.mockReset().mockResolvedValue([goal("o", "Growth"), goal("kr", "Retention", "o")]);
});
afterEach(async () => { await act(async () => root.unmount()); client.clear(); host.remove(); });

describe("project goals editing", () => {
  it("loads the project's company, shows ancestor labels and preserves existing links when adding", async () => {
    const save = vi.fn(); await mount(save); expect(list).not.toHaveBeenCalled();
    await click("Edit goals"); expect(list).toHaveBeenCalledWith("company-a");
    await act(async () => checkbox("Growth / Retention").click());
    expect(save).not.toHaveBeenCalled();
    await click("Save goals"); expect(save).toHaveBeenCalledWith(["o", "kr"]);
  });
  it("clears every link explicitly and cancels without saving", async () => {
    const save = vi.fn(); await mount(save); await click("Edit goals");
    await click("Clear selection"); await click("Cancel"); expect(save).not.toHaveBeenCalled();
    await click("Edit goals"); expect(checkbox("Growth").checked).toBe(true);
    await click("Clear selection"); await click("Save goals"); expect(save).toHaveBeenCalledWith([]);
  });
  it("retains the draft after save failure and allows retry", async () => {
    const save = vi.fn().mockRejectedValueOnce(new Error("offline")).mockResolvedValueOnce(undefined);
    await mount(save); await click("Edit goals"); await act(async () => checkbox("Growth / Retention").click());
    await click("Save goals"); expect(host.textContent).toContain("Your selection is kept");
    expect(checkbox("Growth / Retention").checked).toBe(true);
    await click("Save goals"); expect(save).toHaveBeenLastCalledWith(["o", "kr"]);
    expect(host.textContent).not.toContain("Save goals");
  });
  it("disables saving when the list cannot be loaded and offers retry", async () => {
    list.mockRejectedValueOnce(new Error("offline"));
    const save = vi.fn(); await mount(save); await click("Edit goals");
    expect(host.textContent).toContain("Could not load goals");
    const button = Array.from(host.querySelectorAll("button")).find((el) => el.textContent === "Save goals")!;
    expect(button.disabled).toBe(true);
    await click("Retry loading goals"); expect(host.textContent).toContain("Growth / Retention");
  });
  it("preserves unavailable links, filters other companies and handles parent cycles", async () => {
    list.mockResolvedValue([goal("kr", "Retention", "cycle"), goal("cycle", "Cycle", "kr"),
      { ...goal("foreign", "Foreign"), companyId: "company-b" }]);
    const save = vi.fn(); await mount(save); await click("Edit goals");
    expect(host.textContent).not.toContain("Foreign");
    expect(checkbox("Growth").checked).toBe(true);
    await click("Save goals"); expect(save).toHaveBeenCalledWith(["o"]);
  });
  it("shows linked goals without editing for read-only consumers", async () => {
    await mount(); expect(host.textContent).toContain("Growth");
    expect(host.querySelector("button")).toBeNull(); expect(list).not.toHaveBeenCalled();
  });
  it("supports legacy goalId and an empty company goal list", async () => {
    const save = vi.fn();
    await mount(save, { ...project, goalIds: undefined } as unknown as typeof project);
    await click("Edit goals"); expect(checkbox("Growth").checked).toBe(true);
    await click("Cancel"); list.mockResolvedValue([]); client.clear();
    await mount(save, { ...project, goalId: null, goalIds: [], goals: [] } as unknown as typeof project);
    await click("Edit goals"); expect(host.textContent).toContain("No goals yet");
  });
});
