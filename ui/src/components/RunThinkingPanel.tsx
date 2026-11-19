import { useCallback, useEffect, useRef, useState } from "react";
import { ChevronDown, ChevronRight, Loader2 } from "lucide-react";
import type { HeartbeatRun } from "@paperclipai/shared";
import { heartbeatsApi } from "../api/heartbeats";
import { MarkdownBody } from "./MarkdownBody";
import { cn } from "../lib/utils";

/**
 * Per-run "what the agent was thinking" disclosure for the task run ledger.
 *
 * The ledger's list endpoint (`GET /issues/:id/runs`) deliberately projects
 * `resultJson` through an allowlist, so the adapter-authored `summary`,
 * `usage` and `requestedModel` fields never appear in it. The single-run read
 * (`GET /heartbeat-runs/:runId`) returns the stored `resultJson` unabridged
 * behind the same per-run read guards, so this panel calls that endpoint
 * lazily — only once the reader actually expands a run, and only once per run.
 *
 * Fetching is deliberately plain `useState`/`useEffect` rather than
 * react-query: the ledger renders in tests and storybook without a
 * `QueryClientProvider`, and a disclosure nobody has opened should not force
 * one into those trees.
 */

export type RunThinkingFetcher = (runId: string) => Promise<HeartbeatRun>;

type RunThinkingPanelProps = {
  runId: string;
  /** Terminal failure text already surfaced by the ledger row, if any. */
  error?: string | null;
  errorCode?: string | null;
  /** Injectable for tests and storybook; defaults to the real API call. */
  fetchRun?: RunThinkingFetcher;
  /** Render expanded on first paint (storybook / tests). */
  defaultOpen?: boolean;
};

type RunThinking = {
  summary: string | null;
  model: string | null;
  thinkingEffort: string | null;
  mode: string | null;
  permissionMode: string | null;
  stopReason: string | null;
  costUsd: number | null;
  observedEventCount: number | null;
  usage: {
    inputTokens: number | null;
    outputTokens: number | null;
    totalTokens: number | null;
    cachedReadTokens: number | null;
    cachedWriteTokens: number | null;
  };
};

function asRecord(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  return value as Record<string, unknown>;
}

function readString(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

function readNumber(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string" && value.trim().length > 0) {
    const parsed = Number(value);
    if (Number.isFinite(parsed)) return parsed;
  }
  return null;
}

/** Pull the thinking-relevant fields out of a run's stored `resultJson`. */
export function readRunThinking(
  run: HeartbeatRun | null | undefined,
): RunThinking | null {
  const result = asRecord(run?.resultJson);
  if (!result) return null;
  const usageJson = asRecord(run?.usageJson);
  const usage = asRecord(result.usage) ?? usageJson ?? {};
  return {
    summary: readString(result.summary),
    model: readString(result.requestedModel),
    thinkingEffort: readString(result.requestedThinkingEffort),
    mode: readString(result.mode),
    permissionMode: readString(result.permissionMode),
    stopReason: readString(result.stopReason),
    costUsd:
      readNumber(result.cumulativeCostUsd) ??
      readNumber(result.costUsd) ??
      readNumber(usageJson?.costUsd),
    observedEventCount: readNumber(result.acpObservedEventCount),
    usage: {
      inputTokens:
        readNumber(usage.inputTokens) ?? readNumber(usage.input_tokens),
      outputTokens:
        readNumber(usage.outputTokens) ?? readNumber(usage.output_tokens),
      totalTokens:
        readNumber(usage.totalTokens) ?? readNumber(usage.total_tokens),
      cachedReadTokens:
        readNumber(usage.cachedReadTokens) ??
        readNumber(usage.cachedInputTokens) ??
        readNumber(usage.cache_read_input_tokens),
      cachedWriteTokens:
        readNumber(usage.cachedWriteTokens) ??
        readNumber(usage.cache_creation_input_tokens),
    },
  };
}

function formatTokens(value: number | null) {
  if (value === null) return null;
  if (value < 1000) return String(value);
  if (value < 1_000_000)
    return `${(value / 1000).toFixed(value < 10_000 ? 1 : 0)}K`;
  return `${(value / 1_000_000).toFixed(2)}M`;
}

function formatCost(value: number | null) {
  if (value === null) return null;
  return value > 0 && value < 0.01 ? "<$0.01" : `$${value.toFixed(2)}`;
}

function Fact({ label, value }: { label: string; value: string | null }) {
  if (!value) return null;
  return (
    <span className="inline-flex min-w-0 items-baseline gap-1">
      <span className="text-muted-foreground">{label}</span>
      <span className="min-w-0 truncate font-medium text-foreground">
        {value}
      </span>
    </span>
  );
}

export function RunThinkingPanel({
  runId,
  error,
  errorCode,
  fetchRun,
  defaultOpen = false,
}: RunThinkingPanelProps) {
  const [open, setOpen] = useState(defaultOpen);
  const [run, setRun] = useState<HeartbeatRun | null>(null);
  const [state, setState] = useState<"idle" | "loading" | "loaded" | "error">(
    "idle",
  );
  // A run record is immutable once the run is terminal, so one read per run id
  // is enough no matter how often the reader toggles the disclosure.
  const requestedRunId = useRef<string | null>(null);

  const load = useCallback(async () => {
    if (requestedRunId.current === runId) return;
    requestedRunId.current = runId;
    setState("loading");
    try {
      const loaded = await (fetchRun ? fetchRun(runId) : heartbeatsApi.get(runId));
      setRun(loaded);
      setState("loaded");
    } catch {
      setRun(null);
      setState("error");
      // Allow a retry on the next expand.
      requestedRunId.current = null;
    }
  }, [fetchRun, runId]);

  useEffect(() => {
    if (open) void load();
  }, [load, open]);

  const thinking = readRunThinking(run);
  const tokenFacts = thinking
    ? (
        [
          ["total", formatTokens(thinking.usage.totalTokens)],
          ["in", formatTokens(thinking.usage.inputTokens)],
          ["out", formatTokens(thinking.usage.outputTokens)],
          ["cache read", formatTokens(thinking.usage.cachedReadTokens)],
          ["cache write", formatTokens(thinking.usage.cachedWriteTokens)],
        ] as Array<[string, string | null]>
      ).filter((entry): entry is [string, string] => entry[1] !== null)
    : [];
  const hasMeta = Boolean(
    thinking &&
      (thinking.model ||
        thinking.stopReason ||
        thinking.mode ||
        thinking.permissionMode ||
        thinking.thinkingEffort ||
        thinking.costUsd !== null ||
        thinking.observedEventCount !== null),
  );

  return (
    <div
      className="rounded-md border border-border/60 bg-accent/10"
      data-testid="run-thinking"
    >
      <button
        type="button"
        aria-expanded={open}
        data-testid="run-thinking-toggle"
        onClick={() => setOpen((previous) => !previous)}
        className="flex w-full items-center gap-1.5 rounded-md px-2 py-1.5 text-left text-xs text-foreground hover:bg-accent/30 focus-visible:ring-ring focus-visible:ring-[3px]"
      >
        {open ? (
          <ChevronDown className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
        ) : (
          <ChevronRight className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
        )}
        <span className="font-medium">Thinking</span>
        <span className="min-w-0 truncate text-muted-foreground">
          {open
            ? "What the agent did, where it looked, what it concluded"
            : "Show the agent's own account of this run"}
        </span>
        {open && state === "loading" ? (
          <Loader2
            className="ml-auto h-3.5 w-3.5 shrink-0 animate-spin text-muted-foreground"
            aria-label="Loading run detail"
          />
        ) : null}
      </button>

      {open ? (
        <div className="space-y-2 border-t border-border/60 px-2 py-2">
          {state === "loading" || state === "idle" ? (
            <p className="text-xs text-muted-foreground">
              Loading the run record…
            </p>
          ) : state === "error" ? (
            <p
              className="text-xs text-muted-foreground"
              data-testid="run-thinking-error"
            >
              Paperclip could not read this run's detail record.
            </p>
          ) : (
            <>
              {hasMeta && thinking ? (
                <div
                  className="flex flex-wrap items-baseline gap-x-3 gap-y-1 text-(length:--text-micro)"
                  data-testid="run-thinking-meta"
                >
                  <Fact label="Model" value={thinking.model} />
                  <Fact label="Effort" value={thinking.thinkingEffort} />
                  <Fact label="Mode" value={thinking.mode} />
                  <Fact label="Permissions" value={thinking.permissionMode} />
                  <Fact label="Stop" value={thinking.stopReason} />
                  <Fact label="Cost" value={formatCost(thinking.costUsd)} />
                  <Fact
                    label="Tool calls"
                    value={
                      thinking.observedEventCount !== null
                        ? String(thinking.observedEventCount)
                        : null
                    }
                  />
                </div>
              ) : null}

              {tokenFacts.length > 0 ? (
                <div
                  className="flex flex-wrap items-baseline gap-x-3 gap-y-1 text-(length:--text-micro)"
                  data-testid="run-thinking-usage"
                >
                  <span className="text-muted-foreground">Tokens</span>
                  {tokenFacts.map(([label, value]) => (
                    <Fact key={label} label={label} value={value} />
                  ))}
                </div>
              ) : null}

              {error || errorCode ? (
                <div
                  className="rounded-md border border-red-500/30 bg-red-500/10 px-2 py-1.5 text-xs leading-5"
                  data-testid="run-thinking-failure"
                >
                  <span className="font-medium text-red-700 dark:text-red-300">
                    {errorCode ? `Failed (${errorCode})` : "Failed"}
                  </span>
                  {error ? (
                    <p className="mt-0.5 break-words text-muted-foreground">
                      {error}
                    </p>
                  ) : null}
                </div>
              ) : null}

              {thinking?.summary ? (
                <div data-testid="run-thinking-summary" className="min-w-0">
                  <MarkdownBody className={cn("max-w-none text-xs leading-5")}>
                    {thinking.summary}
                  </MarkdownBody>
                </div>
              ) : (
                <p
                  className="text-xs text-muted-foreground"
                  data-testid="run-thinking-empty"
                >
                  This run did not record a written account of its work.
                </p>
              )}
            </>
          )}
        </div>
      ) : null}
    </div>
  );
}
