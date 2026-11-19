// @vitest-environment jsdom

import { act } from "react";
import type { ReactNode } from "react";
import { createRoot, type Root } from "react-dom/client";
import type { HeartbeatRun } from "@paperclipai/shared";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { RunThinkingPanel, readRunThinking } from "./RunThinkingPanel";

vi.mock("./MarkdownBody", () => ({
  MarkdownBody: ({ children }: { children: string }) => (
    <div data-testid="markdown">{children}</div>
  ),
}));

// eslint-disable-next-line @typescript-eslint/no-explicit-any
(globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;

let container: HTMLDivElement;
let root: Root;

beforeEach(() => {
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
});

function render(ui: ReactNode) {
  act(() => {
    root.render(ui);
  });
}

async function flush() {
  await act(async () => {
    await Promise.resolve();
    await Promise.resolve();
  });
}

function createRun(
  resultJson: Record<string, unknown> | null,
  usageJson: Record<string, unknown> | null = null,
): HeartbeatRun {
  return { id: "run-1", resultJson, usageJson } as unknown as HeartbeatRun;
}

describe("readRunThinking", () => {
  it("reads the summary, model and nested usage out of resultJson", () => {
    const thinking = readRunThinking(
      createRun({
        summary: "Checked the mailbox, then wrote the brief.",
        requestedModel: "claude-opus-5",
        requestedThinkingEffort: "high",
        cumulativeCostUsd: 1.1313412,
        acpObservedEventCount: 42,
        usage: {
          inputTokens: 22,
          outputTokens: 7831,
          totalTokens: 512830,
          cachedReadTokens: 441806,
          cachedWriteTokens: 63171,
        },
      }),
    );
    expect(thinking?.summary).toBe("Checked the mailbox, then wrote the brief.");
    expect(thinking?.model).toBe("claude-opus-5");
    expect(thinking?.thinkingEffort).toBe("high");
    expect(thinking?.costUsd).toBeCloseTo(1.1313412);
    expect(thinking?.observedEventCount).toBe(42);
    expect(thinking?.usage.totalTokens).toBe(512830);
    expect(thinking?.usage.cachedReadTokens).toBe(441806);
  });

  it("falls back to snake_case usageJson when resultJson has no usage block", () => {
    const thinking = readRunThinking(
      createRun({ stopReason: "end_turn" }, {
        input_tokens: 63193,
        output_tokens: 7831,
        cache_read_input_tokens: 441806,
        costUsd: 0.5,
      }),
    );
    expect(thinking?.usage.inputTokens).toBe(63193);
    expect(thinking?.usage.cachedReadTokens).toBe(441806);
    expect(thinking?.costUsd).toBe(0.5);
  });

  it("returns null when the run has no resultJson", () => {
    expect(readRunThinking(createRun(null))).toBeNull();
    expect(readRunThinking(null)).toBeNull();
  });

  it("treats a blank summary as absent", () => {
    expect(readRunThinking(createRun({ summary: "   " }))?.summary).toBeNull();
  });
});

describe("RunThinkingPanel", () => {
  it("does not read the run record until the reader expands it", async () => {
    const fetchRun = vi.fn().mockResolvedValue(createRun({ summary: "hi" }));
    render(<RunThinkingPanel runId="run-1" fetchRun={fetchRun} />);
    expect(fetchRun).not.toHaveBeenCalled();
    expect(
      container.querySelector("[data-testid='run-thinking-summary']"),
    ).toBeNull();

    const toggle = container.querySelector<HTMLButtonElement>(
      "[data-testid='run-thinking-toggle']",
    );
    expect(toggle?.getAttribute("aria-expanded")).toBe("false");
    act(() => toggle?.click());
    await flush();

    expect(fetchRun).toHaveBeenCalledWith("run-1");
    expect(
      container.querySelector("[data-testid='run-thinking-summary']")
        ?.textContent,
    ).toContain("hi");
  });

  it("renders the summary as markdown along with model and token facts", async () => {
    const fetchRun = vi.fn().mockResolvedValue(
      createRun({
        summary: "## Findings\n\nThe vendor replied.",
        requestedModel: "claude-opus-5",
        stopReason: "end_turn",
        usage: { totalTokens: 512830, outputTokens: 7831 },
      }),
    );
    render(
      <RunThinkingPanel runId="run-1" fetchRun={fetchRun} defaultOpen />,
    );
    await flush();

    expect(container.querySelector("[data-testid='markdown']")?.textContent).toContain(
      "The vendor replied.",
    );
    const meta = container.querySelector(
      "[data-testid='run-thinking-meta']",
    )?.textContent;
    expect(meta).toContain("claude-opus-5");
    expect(meta).toContain("end_turn");
    const usage = container.querySelector(
      "[data-testid='run-thinking-usage']",
    )?.textContent;
    expect(usage).toContain("513K");
  });

  it("shows the failure reason for a failed run", async () => {
    const fetchRun = vi.fn().mockResolvedValue(createRun({ summary: null }));
    render(
      <RunThinkingPanel
        runId="run-1"
        error="model rejected the request"
        errorCode="native_provider_model_rejected"
        fetchRun={fetchRun}
        defaultOpen
      />,
    );
    await flush();

    const failure = container.querySelector(
      "[data-testid='run-thinking-failure']",
    )?.textContent;
    expect(failure).toContain("native_provider_model_rejected");
    expect(failure).toContain("model rejected the request");
  });

  it("says so when the run recorded no written account", async () => {
    const fetchRun = vi.fn().mockResolvedValue(createRun({ stopReason: "end_turn" }));
    render(<RunThinkingPanel runId="run-1" fetchRun={fetchRun} defaultOpen />);
    await flush();

    expect(
      container.querySelector("[data-testid='run-thinking-empty']"),
    ).not.toBeNull();
  });

  it("reports a read failure instead of rendering an empty account", async () => {
    const fetchRun = vi.fn().mockRejectedValue(new Error("403"));
    render(<RunThinkingPanel runId="run-1" fetchRun={fetchRun} defaultOpen />);
    await flush();

    expect(
      container.querySelector("[data-testid='run-thinking-error']"),
    ).not.toBeNull();
    expect(
      container.querySelector("[data-testid='run-thinking-empty']"),
    ).toBeNull();
  });

  it("reads the run record only once across repeated toggles", async () => {
    const fetchRun = vi.fn().mockResolvedValue(createRun({ summary: "once" }));
    render(<RunThinkingPanel runId="run-1" fetchRun={fetchRun} defaultOpen />);
    await flush();

    const toggle = container.querySelector<HTMLButtonElement>(
      "[data-testid='run-thinking-toggle']",
    );
    act(() => toggle?.click());
    await flush();
    act(() => toggle?.click());
    await flush();

    expect(fetchRun).toHaveBeenCalledTimes(1);
  });
});
