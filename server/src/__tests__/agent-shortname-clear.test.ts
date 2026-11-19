import { describe, expect, it, vi } from "vitest";
import type { Db } from "@paperclipai/db";
import type { AgentConfigurationRecord } from "../lib/agent-records.js";
import { prepareAgentConfiguration } from "../services/agent-configuration.js";

const existing = {
  id: "a1", companyId: "company-1", name: "Analyst", shortName: "research",
  status: "idle",
} as AgentConfigurationRecord;

function databaseWithKeys(rows: Array<{ id: string; name: string; shortName: string | null; status: string }>) {
  return { select: vi.fn(() => ({ from: () => ({ where: async () => rows }) })) } as unknown as Db;
}

describe("clearing an agent shortName", () => {
  it.each([{ shortName: null }, { shortName: null, name: "Analyst" }])(
    "rejects a restored derived key occupied by another agent (%j)",
    async (patch) => {
      const db = databaseWithKeys([{ id: "a2", name: "Other", shortName: "analyst", status: "idle" }]);
      await expect(prepareAgentConfiguration(db, existing, patch)).rejects.toMatchObject({ status: 409 });
    },
  );
  it("allows clearing when the restored key is free", async () => {
    await expect(prepareAgentConfiguration(databaseWithKeys([]), existing, { shortName: null }))
      .resolves.toEqual({ shortName: null });
  });
});
