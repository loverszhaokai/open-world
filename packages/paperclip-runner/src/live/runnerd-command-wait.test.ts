import { expect, it } from "vitest";
import { defaultRunnerCommandWaitMs } from "./runnerd-codex-transport.js";

it("keeps the 30 s upstream default when PAPERCLIP_RUNNER_COMMAND_WAIT_MS is unset or invalid", () => {
  expect(defaultRunnerCommandWaitMs({})).toBe(30_000);
  expect(defaultRunnerCommandWaitMs({ PAPERCLIP_RUNNER_COMMAND_WAIT_MS: "" })).toBe(30_000);
  expect(defaultRunnerCommandWaitMs({ PAPERCLIP_RUNNER_COMMAND_WAIT_MS: "soon" })).toBe(30_000);
  expect(defaultRunnerCommandWaitMs({ PAPERCLIP_RUNNER_COMMAND_WAIT_MS: "500" })).toBe(30_000);
});

it("honors an operator override in milliseconds", () => {
  expect(defaultRunnerCommandWaitMs({ PAPERCLIP_RUNNER_COMMAND_WAIT_MS: "180000" })).toBe(180_000);
  expect(defaultRunnerCommandWaitMs({ PAPERCLIP_RUNNER_COMMAND_WAIT_MS: "90000.9" })).toBe(90_000);
});
