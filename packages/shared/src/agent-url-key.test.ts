import { describe, expect, it } from "vitest";
import {
  AGENT_SHORT_NAME_MAX_LENGTH,
  isValidAgentShortName,
  normalizeAgentUrlKey,
  resolveAgentUrlKey,
} from "./agent-url-key.js";

const ID = "11111111-2222-4333-8444-555555555555";

describe("resolveAgentUrlKey", () => {
  it("prefers an explicit short name over the name", () => {
    expect(resolveAgentUrlKey({ id: ID, name: "Head of Paid Growth", shortName: "hopg" })).toBe("hopg");
  });

  it("gives a non-Latin-named agent a usable key instead of a bare UUID", () => {
    // The case this feature exists for: the name normalizes to nothing, so
    // before `shortName` such an agent was addressable only by UUID.
    expect(resolveAgentUrlKey({ id: ID, name: "日本語" })).toBe(ID);
    expect(resolveAgentUrlKey({ id: ID, name: "日本語", shortName: "nihongo" })).toBe("nihongo");
  });

  it("keeps the key stable across a rename", () => {
    // The whole point of storing it: saved links and scripts keep working.
    const before = resolveAgentUrlKey({ id: ID, name: "日本語", shortName: "nihongo" });
    const after = resolveAgentUrlKey({ id: ID, name: "Renamed Agent", shortName: "nihongo" });
    expect(after).toBe(before);
  });

  it("falls back to the derived name key when there is no short name", () => {
    // Unchanged behaviour for every agent that has not been given one.
    for (const shortName of [undefined, null, ""]) {
      expect(resolveAgentUrlKey({ id: ID, name: "Head of Paid Growth", shortName })).toBe(
        "head-of-paid-growth",
      );
    }
  });

  it("normalizes a short name that was stored unnormalized", () => {
    expect(resolveAgentUrlKey({ id: ID, name: "x", shortName: "  Ni Hongo  " })).toBe("ni-hongo");
  });

  it("falls back to the id when neither yields a key", () => {
    expect(resolveAgentUrlKey({ id: ID, name: "！！！", shortName: "---" })).toBe(ID);
    expect(resolveAgentUrlKey({ id: ID, name: null })).toBe(ID);
  });

  it("matches normalizeAgentUrlKey for every ASCII name", () => {
    // Guards the compatibility promise: nothing about an existing agent's key
    // changes just because the column now exists.
    for (const name of ["CEO", "Head of Paid Growth", "Pitcher 1", "Dev One"]) {
      expect(resolveAgentUrlKey({ id: ID, name })).toBe(normalizeAgentUrlKey(name) ?? ID);
    }
  });
});

describe("isValidAgentShortName", () => {
  it("accepts keys that survive normalization unchanged", () => {
    for (const value of ["nihongo", "ni-hongo", "ceo", "a", "pitcher-1", "x9"]) {
      expect(isValidAgentShortName(value)).toBe(true);
    }
  });

  it("rejects anything normalization would rewrite", () => {
    // Storing a value that differs from the key it resolves to would make the
    // stored short name and the reachable URL disagree.
    for (const value of ["Nihongo", "ni hongo", "ni_hongo", "日本語", "-ni", "ni-", "ni--hongo", " ni"]) {
      expect(isValidAgentShortName(value)).toBe(false);
    }
  });

  it("rejects an empty value", () => {
    expect(isValidAgentShortName("")).toBe(false);
  });

  it("rejects a UUID, which the resolver would never reach", () => {
    expect(isValidAgentShortName(ID)).toBe(false);
  });

  it("enforces the length limit", () => {
    expect(isValidAgentShortName("a".repeat(AGENT_SHORT_NAME_MAX_LENGTH))).toBe(true);
    expect(isValidAgentShortName("a".repeat(AGENT_SHORT_NAME_MAX_LENGTH + 1))).toBe(false);
  });

  it("accepts the transliterated key shapes a non-Latin roster produces", () => {
    // Keys for non-Latin names are typically transliterations: lowercase
    // words joined by single hyphens, sometimes with a trailing index.
    const proposed = [
      "nihongo", "ni-hongo", "editor", "analyst", "researcher", "reviewer",
      "secretary", "scheduler", "pitcher-1", "pitcher-2", "pitcher-3",
    ];
    for (const key of proposed) {
      expect(isValidAgentShortName(key), key).toBe(true);
    }
  });
});

/**
 * The server's `withUrlKey` sets `urlKey` from `resolveAgentUrlKey`, and
 * `resolveByReference` matches an incoming reference against that same
 * `urlKey`. These cases pin the lookup behaviour that depends on it.
 */
describe("agent reference lookup via urlKey", () => {
  const key = (agent: { id: string; name?: string | null; shortName?: string | null }) =>
    resolveAgentUrlKey(agent);

  it("makes a Chinese-named agent reachable by its short name", () => {
    const agent = { id: ID, name: "日本語", shortName: "nihongo" };
    expect(key(agent)).toBe(normalizeAgentUrlKey("nihongo"));
    // And the reference the user types normalizes to the same thing.
    expect(normalizeAgentUrlKey("Nihongo")).toBe(key(agent));
  });

  it("stops the old derived key resolving once a short name is set", () => {
    // 'head-of-paid-growth' must no longer hit this agent, or two keys would
    // reach one agent and a rename could not be relied on.
    const agent = { id: ID, name: "Head of Paid Growth", shortName: "hopg" };
    expect(key(agent)).not.toBe("head-of-paid-growth");
  });

  it("keeps two agents distinguishable when one takes a short name", () => {
    const a = { id: "id-a", name: "Analyst", shortName: "an-shi" };
    const b = { id: "id-b", name: "Analyst" };
    expect(key(a)).not.toBe(key(b));
  });

  it("would make two agents ambiguous if a short name duplicated a derived key", () => {
    // The uniqueness guard on the server exists precisely to prevent this.
    const a = { id: "id-a", name: "日本語", shortName: "analyst" };
    const b = { id: "id-b", name: "Analyst" };
    expect(key(a)).toBe(key(b));
  });
});
