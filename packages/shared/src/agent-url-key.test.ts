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

  it("gives a Chinese-named agent a usable key instead of a bare UUID", () => {
    // The 28 agents this feature exists for: the name normalizes to nothing,
    // so before `shortName` they were addressable only by UUID.
    expect(resolveAgentUrlKey({ id: ID, name: "听澜" })).toBe(ID);
    expect(resolveAgentUrlKey({ id: ID, name: "听澜", shortName: "ting-lan" })).toBe("ting-lan");
  });

  it("keeps the key stable across a rename", () => {
    // The whole point of storing it: saved links and scripts keep working.
    const before = resolveAgentUrlKey({ id: ID, name: "听澜", shortName: "ting-lan" });
    const after = resolveAgentUrlKey({ id: ID, name: "Listening Wave", shortName: "ting-lan" });
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
    expect(resolveAgentUrlKey({ id: ID, name: "x", shortName: "  Ting Lan  " })).toBe("ting-lan");
  });

  it("falls back to the id when neither yields a key", () => {
    expect(resolveAgentUrlKey({ id: ID, name: "！！！", shortName: "---" })).toBe(ID);
    expect(resolveAgentUrlKey({ id: ID, name: null })).toBe(ID);
  });

  it("matches normalizeAgentUrlKey for every ASCII name", () => {
    // Guards the compatibility promise: nothing about an existing agent's key
    // changes just because the column now exists.
    for (const name of ["CEO", "Head of Paid Growth", "投手1号", "Dev One"]) {
      expect(resolveAgentUrlKey({ id: ID, name })).toBe(normalizeAgentUrlKey(name) ?? ID);
    }
  });
});

describe("isValidAgentShortName", () => {
  it("accepts keys that survive normalization unchanged", () => {
    for (const value of ["ting-lan", "hai-tang", "ceo", "a", "tou-shou-1", "x9"]) {
      expect(isValidAgentShortName(value)).toBe(true);
    }
  });

  it("rejects anything normalization would rewrite", () => {
    // Storing a value that differs from the key it resolves to would make the
    // stored short name and the reachable URL disagree.
    for (const value of ["Ting-Lan", "ting lan", "ting_lan", "听澜", "-ting", "ting-", "ting--lan", " ting"]) {
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

  it("accepts every proposed pinyin key for the Chinese-named agents", () => {
    const proposed = [
      "ting-lan", "hai-tang", "bai-lu", "song-xue", "shi-sui", "heng-wei", "shen-gao",
      "yun-fan", "yuan-fan", "bei-chen", "han-jiang", "xing-cha", "shi-quan", "yan-qiu",
      "li-feng", "qiu-shui", "mi-shu", "zhu-xi", "cang-ling", "yuan-shan", "qing-shi",
      "qing-he", "wen-shu", "die-dai-yuan", "tou-shou-1", "tou-shou-2", "tou-shou-3",
    ];
    for (const key of proposed) {
      expect(isValidAgentShortName(key), key).toBe(true);
    }
  });
});
