// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { ProjectParentField } from "./ProjectParentField";
const list = vi.hoisted(() => vi.fn());
vi.mock("@/api/projects", () => ({ projectsApi: { list } }));
let host: HTMLDivElement, root: Root, client: QueryClient;
const project = { id: "child", companyId: "company", parentProjectId: "parent" };
beforeEach(() => {
  host = document.createElement("div"); document.body.appendChild(host); root = createRoot(host);
  client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  list.mockReset().mockResolvedValue([
    { id: "parent", companyId: "company", name: "Parent" },
    { ...project, name: "Child" },
    { id: "leaf", companyId: "company", parentProjectId: "child", name: "Leaf" },
    { id: "other", companyId: "company", name: "Other" },
    { id: "foreign", companyId: "elsewhere", name: "Foreign" },
  ]);
});
afterEach(async () => { await act(async () => root.unmount()); client.clear(); host.remove(); });
async function flush() { await act(async () => { await new Promise(resolve => setTimeout(resolve, 10)); }); }
async function mount(save = vi.fn()) {
  await act(async () => root.render(<QueryClientProvider client={client}><ProjectParentField project={project} onSave={save} /></QueryClientProvider>));
  await flush(); return save;
}
async function click(label: string) {
  await act(async () => Array.from(host.querySelectorAll("button")).find(button => button.textContent === label)!.click());
  await flush();
}
async function select(value: string) {
  await act(async () => { const select = host.querySelector("select")!; select.value = value;
    select.dispatchEvent(new Event("change", { bubbles: true })); });
}
it("shows only valid same-company parents and saves an explicit move", async () => {
  const save = await mount(); await click("Edit parent project");
  expect(list).toHaveBeenCalledWith("company");
  expect(Array.from(host.querySelectorAll("option")).map(option => option.textContent)).toEqual(["No parent project", "Other", "Parent"]);
  await select("other"); await click("Save parent"); expect(save).toHaveBeenCalledWith("other");
});
it("keeps failed edits for retry and can explicitly detach", async () => {
  const save = vi.fn().mockRejectedValueOnce(new Error("offline")).mockResolvedValueOnce(undefined);
  await mount(save); await click("Edit parent project"); await select(""); await click("Save parent");
  expect(host.textContent).toContain("Your selection is kept"); expect(host.querySelector("select")!.value).toBe("");
  await click("Save parent"); expect(save).toHaveBeenLastCalledWith(null);
});
it("cancels without writing and blocks save until failed loading is retried", async () => {
  list.mockRejectedValue(new Error("offline")); const save = await mount();
  await click("Edit parent project");
  const saveButton = Array.from(host.querySelectorAll("button")).find(button => button.textContent === "Save parent")!;
  expect(saveButton.disabled).toBe(true);
  list.mockResolvedValue([{ id: "other", companyId: "company", name: "Other" }]);
  await click("Retry loading projects");
  await select("other"); await click("Cancel"); expect(save).not.toHaveBeenCalled();
});
