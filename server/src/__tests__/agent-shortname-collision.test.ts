import { describe, expect, it } from "vitest";
import { hasAgentShortnameCollision, hasAgentShortNameConflict, deduplicateAgentName } from "../services/agents.ts";

describe("hasAgentShortnameCollision", () => {
  it("detects collisions by normalized shortname", () => {
    const collision = hasAgentShortnameCollision("Codex Coder", [
      { id: "a1", name: "codex-coder", status: "idle" },
    ]);
    expect(collision).toBe(true);
  });

  it("ignores terminated agents", () => {
    const collision = hasAgentShortnameCollision("Codex Coder", [
      { id: "a1", name: "codex-coder", status: "terminated" },
    ]);
    expect(collision).toBe(false);
  });

  it("ignores the excluded agent id", () => {
    const collision = hasAgentShortnameCollision(
      "Codex Coder",
      [
        { id: "a1", name: "codex-coder", status: "idle" },
        { id: "a2", name: "other-agent", status: "idle" },
      ],
      { excludeAgentId: "a1" },
    );
    expect(collision).toBe(false);
  });

  it("does not collide when candidate has no shortname", () => {
    const collision = hasAgentShortnameCollision("!!!", [
      { id: "a1", name: "codex-coder", status: "idle" },
    ]);
    expect(collision).toBe(false);
  });
});

describe("deduplicateAgentName", () => {
  it("returns original name when no collision", () => {
    const name = deduplicateAgentName("OpenClaw", [
      { id: "a1", name: "other-agent", status: "idle" },
    ]);
    expect(name).toBe("OpenClaw");
  });

  it("appends suffix when name collides", () => {
    const name = deduplicateAgentName("OpenClaw", [
      { id: "a1", name: "openclaw", status: "idle" },
    ]);
    expect(name).toBe("OpenClaw 2");
  });

  it("increments suffix until unique", () => {
    const name = deduplicateAgentName("OpenClaw", [
      { id: "a1", name: "openclaw", status: "idle" },
      { id: "a2", name: "openclaw-2", status: "idle" },
      { id: "a3", name: "openclaw-3", status: "idle" },
    ]);
    expect(name).toBe("OpenClaw 4");
  });

  it("ignores terminated agents for collision", () => {
    const name = deduplicateAgentName("OpenClaw", [
      { id: "a1", name: "openclaw", status: "terminated" },
    ]);
    expect(name).toBe("OpenClaw");
  });
});

describe("hasAgentShortnameCollision with explicit short names", () => {
  it("collides with another agent's explicit short name", () => {
    // The other agent answers to 'ting-lan', so a new agent whose name derives
    // to the same key would make the reference ambiguous.
    const collision = hasAgentShortnameCollision("Ting Lan", [
      { id: "a1", name: "听澜", shortName: "ting-lan", status: "idle" },
    ]);
    expect(collision).toBe(true);
  });

  it("frees the derived key of an agent that has a short name", () => {
    // 'codex-coder' answers to 'cc' now, so its old derived key is unreachable
    // and must not stay reserved against a new agent that wants it.
    const collision = hasAgentShortnameCollision("Codex Coder", [
      { id: "a1", name: "codex-coder", shortName: "cc", status: "idle" },
    ]);
    expect(collision).toBe(false);
  });

  it("still uses the derived key when short name is null", () => {
    const collision = hasAgentShortnameCollision("Codex Coder", [
      { id: "a1", name: "codex-coder", shortName: null, status: "idle" },
    ]);
    expect(collision).toBe(true);
  });
});

describe("hasAgentShortNameConflict", () => {
  it("rejects a short name another agent already uses", () => {
    const conflict = hasAgentShortNameConflict("ting-lan", [
      { id: "a1", name: "听澜", shortName: "ting-lan", status: "idle" },
    ]);
    expect(conflict).toBe(true);
  });

  it("rejects a short name that shadows another agent's derived key", () => {
    // Nothing may answer to two agents: 'analyst' is already reachable because
    // that agent's name derives to it.
    const conflict = hasAgentShortNameConflict("analyst", [
      { id: "a1", name: "Analyst", status: "idle" },
    ]);
    expect(conflict).toBe(true);
  });

  it("accepts a free short name", () => {
    const conflict = hasAgentShortNameConflict("hai-tang", [
      { id: "a1", name: "听澜", shortName: "ting-lan", status: "idle" },
      { id: "a2", name: "Analyst", status: "idle" },
    ]);
    expect(conflict).toBe(false);
  });

  it("lets an agent keep its own short name", () => {
    const conflict = hasAgentShortNameConflict(
      "ting-lan",
      [{ id: "a1", name: "听澜", shortName: "ting-lan", status: "idle" }],
      { excludeAgentId: "a1" },
    );
    expect(conflict).toBe(false);
  });

  it("ignores terminated agents", () => {
    const conflict = hasAgentShortNameConflict("ting-lan", [
      { id: "a1", name: "听澜", shortName: "ting-lan", status: "terminated" },
    ]);
    expect(conflict).toBe(false);
  });

  it("does not reserve anything for a Chinese-named agent with no short name", () => {
    // These are the 28 agents that currently fall back to a bare UUID: they
    // occupy no key at all, so every short name is still free.
    const conflict = hasAgentShortNameConflict("ting-lan", [
      { id: "a1", name: "听澜", status: "idle" },
      { id: "a2", name: "海棠", status: "idle" },
    ]);
    expect(conflict).toBe(false);
  });
});

describe("deduplicateAgentName with explicit short names", () => {
  it("does not suffix against an agent whose derived key is unreachable", () => {
    const name = deduplicateAgentName("OpenClaw", [
      { id: "a1", name: "openclaw", shortName: "oc", status: "idle" },
    ]);
    expect(name).toBe("OpenClaw");
  });
});
