import { describe, expect, it } from "vitest";
import { updateAgentSchema } from "./agent.js";

describe("agent update schema", () => {
  it.each(["paused", "idle", "terminated"])("accepts lifecycle status request %s", status => {
    expect(updateAgentSchema.parse({ status })).toEqual({ status });
  });
  it.each(["active", "running", "error", "pending_approval"])("rejects direct status write %s", status => {
    const result = updateAgentSchema.safeParse({ name: "Renamed", status });
    expect(result.success).toBe(false);
    if (!result.success) expect(result.error.issues).toEqual(expect.arrayContaining([
      expect.objectContaining({ path: ["status"] }),
    ]));
  });
  it.each([{ spentMonthlyCents: 0 }, { name: "Renamed", spentMonthlyCents: 10 }])("rejects spend totals: %j", payload => {
    const result = updateAgentSchema.safeParse(payload);
    expect(result.success).toBe(false);
    if (!result.success) expect(result.error.issues).toEqual(expect.arrayContaining([
      expect.objectContaining({ path: ["spentMonthlyCents"] }),
    ]));
  });
  it("accepts profile and budget limit changes", () => {
    expect(updateAgentSchema.parse({ name: "Renamed", budgetMonthlyCents: 100 })).toEqual({ name: "Renamed", budgetMonthlyCents: 100 });
  });
});

describe("agent shortName validation", () => {
  it.each(["nihongo", "ni-hongo", "pitcher-1", "ceo"])("accepts %s", shortName => {
    expect(updateAgentSchema.parse({ shortName })).toEqual({ shortName });
  });

  it.each(["Nihongo", "ni hongo", "日本語", "ni_hongo", "-ni", "ni--hongo"])(
    "rejects %s, which would not survive normalization",
    shortName => {
      const result = updateAgentSchema.safeParse({ shortName });
      expect(result.success).toBe(false);
      if (!result.success) expect(result.error.issues).toEqual(expect.arrayContaining([
        expect.objectContaining({ path: ["shortName"] }),
      ]));
    },
  );

  it("rejects a UUID, which the resolver tries as an id first", () => {
    const result = updateAgentSchema.safeParse({ shortName: "11111111-2222-4333-8444-555555555555" });
    expect(result.success).toBe(false);
  });

  it("rejects an over-long short name", () => {
    expect(updateAgentSchema.safeParse({ shortName: "a".repeat(65) }).success).toBe(false);
  });

  it("treats a blank field as clearing the short name", () => {
    // A form can hand back an empty input without needing a separate delete.
    expect(updateAgentSchema.parse({ shortName: "" })).toEqual({ shortName: null });
    expect(updateAgentSchema.parse({ shortName: "   " })).toEqual({ shortName: null });
  });

  it("accepts an explicit null", () => {
    expect(updateAgentSchema.parse({ shortName: null })).toEqual({ shortName: null });
  });

  it("leaves shortName out when it is not supplied", () => {
    expect(updateAgentSchema.parse({ name: "Renamed" })).toEqual({ name: "Renamed" });
  });
});
