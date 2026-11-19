import { AgentAvatar } from "@/components/AgentAvatar";
import { useEffect, useRef, useState, useMemo, useCallback } from "react";
import { Link, useNavigate } from "@/lib/router";
import { useQuery } from "@tanstack/react-query";
import { agentsApi, type OrgNode } from "../api/agents";
import { useCompany } from "../context/CompanyContext";
import { useBreadcrumbs } from "../context/BreadcrumbContext";
import { queryKeys } from "../lib/queryKeys";
import { agentUrl, cn } from "../lib/utils";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { EmptyState } from "../components/EmptyState";
import { PageSkeleton } from "../components/PageSkeleton";
import { ChevronDown, Download, Maximize2, Minus, Network, Plus, Upload } from "lucide-react";
import { AGENT_ROLE_LABELS, type Agent } from "@paperclipai/shared";
import { useCloudInstance } from "@/hooks/useCloudInstance";
import { useHiddenSettings } from "@/hooks/useHiddenSettings";
import {
  allParentIds,
  defaultExpandedIds,
  descendantCount,
  pruneCollapsed,
  reconcileExpandedIds,
  toggleExpanded,
  type ExpandedIds,
} from "@/lib/org-collapse";

// Layout constants
const CARD_W = 200;
const CARD_H = 100;
const GAP_X = 32;
const GAP_Y = 80;
const PADDING = 60;
const MIN_ZOOM = 0.2;
const MAX_ZOOM = 2;
const FIT_PADDING = 40;
const TOUCH_MOVE_THRESHOLD = 6;

// ── Tree layout types ───────────────────────────────────────────────────

interface LayoutNode {
  id: string;
  name: string;
  role: string;
  status: string;
  x: number;
  y: number;
  children: LayoutNode[];
  /** Descendants folded away under this card, 0 when it is a leaf or expanded. */
  hiddenCount: number;
}

interface Point {
  x: number;
  y: number;
}

interface TouchGesture {
  mode: "pan" | "pinch" | null;
  startPoint: Point;
  startPan: Point;
  startZoom: number;
  startDistance: number;
  startCenter: Point;
  moved: boolean;
}

// ── Layout algorithm ────────────────────────────────────────────────────

/** Compute the width each subtree needs. */
function subtreeWidth(node: OrgNode): number {
  if (node.reports.length === 0) return CARD_W;
  const childrenW = node.reports.reduce((sum, c) => sum + subtreeWidth(c), 0);
  const gaps = (node.reports.length - 1) * GAP_X;
  return Math.max(CARD_W, childrenW + gaps);
}

/**
 * Recursively assign x,y positions.
 *
 * `hiddenCounts` maps a node id to the number of descendants collapse removed
 * from the tree being laid out. The layout itself only ever sees the pruned
 * tree, so the count has to be supplied from the unpruned one.
 */
function layoutTree(
  node: OrgNode,
  x: number,
  y: number,
  hiddenCounts: ReadonlyMap<string, number>,
): LayoutNode {
  const totalW = subtreeWidth(node);
  const layoutChildren: LayoutNode[] = [];

  if (node.reports.length > 0) {
    const childrenW = node.reports.reduce((sum, c) => sum + subtreeWidth(c), 0);
    const gaps = (node.reports.length - 1) * GAP_X;
    let cx = x + (totalW - childrenW - gaps) / 2;

    for (const child of node.reports) {
      const cw = subtreeWidth(child);
      layoutChildren.push(layoutTree(child, cx, y + CARD_H + GAP_Y, hiddenCounts));
      cx += cw + GAP_X;
    }
  }

  return {
    id: node.id,
    name: node.name,
    role: node.role,
    status: node.status,
    x: x + (totalW - CARD_W) / 2,
    y,
    children: layoutChildren,
    hiddenCount: hiddenCounts.get(node.id) ?? 0,
  };
}

/** Layout all root nodes side by side. */
function layoutForest(
  roots: OrgNode[],
  hiddenCounts: ReadonlyMap<string, number> = new Map(),
): LayoutNode[] {
  if (roots.length === 0) return [];

  let x = PADDING;
  const y = PADDING;

  const result: LayoutNode[] = [];
  for (const root of roots) {
    const w = subtreeWidth(root);
    result.push(layoutTree(root, x, y, hiddenCounts));
    x += w + GAP_X;
  }

  // Compute bounds and return
  return result;
}

/** Flatten layout tree to list of nodes. */
function flattenLayout(nodes: LayoutNode[]): LayoutNode[] {
  const result: LayoutNode[] = [];
  function walk(n: LayoutNode) {
    result.push(n);
    n.children.forEach(walk);
  }
  nodes.forEach(walk);
  return result;
}

/** Collect all parent→child edges. */
function collectEdges(nodes: LayoutNode[]): Array<{ parent: LayoutNode; child: LayoutNode }> {
  const edges: Array<{ parent: LayoutNode; child: LayoutNode }> = [];
  function walk(n: LayoutNode) {
    for (const c of n.children) {
      edges.push({ parent: n, child: c });
      walk(c);
    }
  }
  nodes.forEach(walk);
  return edges;
}

function clampZoom(value: number): number {
  return Math.min(Math.max(value, MIN_ZOOM), MAX_ZOOM);
}

function fitChartToViewport(
  containerWidth: number,
  containerHeight: number,
  bounds: { width: number; height: number },
): { zoom: number; pan: Point } | null {
  if (containerWidth <= FIT_PADDING || containerHeight <= FIT_PADDING) return null;

  const scaleX = (containerWidth - FIT_PADDING) / bounds.width;
  const scaleY = (containerHeight - FIT_PADDING) / bounds.height;
  const zoom = clampZoom(Math.min(scaleX, scaleY, 1));
  const chartWidth = bounds.width * zoom;
  const chartHeight = bounds.height * zoom;

  return {
    zoom,
    pan: {
      x: (containerWidth - chartWidth) / 2,
      y: (containerHeight - chartHeight) / 2,
    },
  };
}

function touchPoint(touch: React.Touch): Point {
  return { x: touch.clientX, y: touch.clientY };
}

function touchDistance(a: React.Touch, b: React.Touch): number {
  const dx = a.clientX - b.clientX;
  const dy = a.clientY - b.clientY;
  return Math.hypot(dx, dy);
}

function touchCenter(a: React.Touch, b: React.Touch, container: HTMLDivElement): Point {
  const rect = container.getBoundingClientRect();
  return {
    x: (a.clientX + b.clientX) / 2 - rect.left,
    y: (a.clientY + b.clientY) / 2 - rect.top,
  };
}

// ── Status dot colors (raw hex for SVG) ─────────────────────────────────

import { agentDisplayAdapterType, getAdapterLabel } from "../adapters/adapter-display-registry";

const statusDotColor: Record<string, string> = {
  running: "var(--hex-22d3ee)",
  active: "var(--hex-4ade80)",
  paused: "var(--hex-facc15)",
  idle: "var(--hex-facc15)",
  error: "var(--hex-f87171)",
  terminated: "var(--hex-a3a3a3)",
};
const defaultDotColor = "var(--hex-a3a3a3)";

// ── Main component ──────────────────────────────────────────────────────

export interface OrgChartProps {
  /** Pre-filtered tree for embedding the chart in another collection page. */
  orgTree?: OrgNode[];
  /** Agent records paired with a pre-filtered embedded tree. */
  agents?: Agent[];
  /** Hides page-level actions and breadcrumb ownership. */
  embedded?: boolean;
}

export function OrgChart({ orgTree: providedOrgTree, agents: providedAgents, embedded = false }: OrgChartProps = {}) {
  const { selectedCompanyId } = useCompany();
  const { setBreadcrumbs } = useBreadcrumbs();
  const navigate = useNavigate();
  // Import is floored server-side on cloud-managed instances (403 cloud_managed), so the
  // button is hidden rather than dead-ending. Export stays available. Both
  // buttons also respect the operator-hidden settings registry.
  const isCloud = Boolean(useCloudInstance());
  const { hidden: hiddenSettings } = useHiddenSettings();
  const showImport = !isCloud && !hiddenSettings.has("company.import");
  const showExport = !hiddenSettings.has("company.export");

  const { data: queriedOrgTree, isLoading } = useQuery({
    queryKey: queryKeys.org(selectedCompanyId!),
    queryFn: () => agentsApi.org(selectedCompanyId!),
    enabled: !!selectedCompanyId && providedOrgTree === undefined,
  });

  const { data: queriedAgents } = useQuery({
    queryKey: queryKeys.agents.list(selectedCompanyId!),
    queryFn: () => agentsApi.list(selectedCompanyId!),
    enabled: !!selectedCompanyId && providedAgents === undefined,
  });
  const orgTree = providedOrgTree ?? queriedOrgTree;
  const agents = providedAgents ?? queriedAgents;

  const agentMap = useMemo(() => {
    const m = new Map<string, Agent>();
    for (const a of agents ?? []) m.set(a.id, a);
    return m;
  }, [agents]);

  useEffect(() => {
    if (!embedded) setBreadcrumbs([{ label: "Org Chart" }]);
  }, [embedded, setBreadcrumbs]);

  // ── Collapse state ───────────────────────────────────────────────────
  // A 50-agent org with two 15-report deputies cannot fit on screen, so the
  // chart opens at the top two levels and folds the rest behind per-card
  // toggles. `null` means "not chosen yet" and resolves to the default once a
  // tree arrives; after that the user's expansion survives refetches and
  // navigating away and back (React state in this component's lifetime).
  const [expandedIds, setExpandedIds] = useState<ExpandedIds | null>(null);

  // Reconciling on every tree keeps deleted or filtered-out agents from
  // holding stale ids, and seeds the default on first load.
  const expanded = useMemo(
    () => reconcileExpandedIds(orgTree ?? [], expandedIds),
    [orgTree, expandedIds],
  );

  const visibleTree = useMemo(() => pruneCollapsed(orgTree ?? [], expanded), [orgTree, expanded]);

  // Counts come from the unpruned tree: a collapsed card advertises how many
  // people it hides, which the pruned tree no longer knows.
  const hiddenCounts = useMemo(() => {
    const counts = new Map<string, number>();
    function walk(node: OrgNode) {
      if (!expanded.has(node.id)) counts.set(node.id, descendantCount(node));
      node.reports.forEach(walk);
    }
    (orgTree ?? []).forEach(walk);
    return counts;
  }, [orgTree, expanded]);

  const parentIds = useMemo(() => allParentIds(orgTree ?? []), [orgTree]);
  const allExpanded = parentIds.size > 0 && parentIds.size === expanded.size;

  // Toggling before the user has touched anything must build on the resolved
  // default, not on an empty set — otherwise the first click also folds away
  // the top level that the default had expanded.
  const toggleNode = useCallback(
    (id: string) => {
      setExpandedIds((current) =>
        toggleExpanded(current ? reconcileExpandedIds(orgTree ?? [], current) : expanded, id),
      );
    },
    [orgTree, expanded],
  );

  // Expand/collapse all restructures the whole chart, so it re-fits the
  // viewport afterwards — otherwise the user is left staring at whichever
  // corner they happened to be on. Per-node toggles deliberately do NOT
  // re-fit: those are local edits and moving the viewport under the user
  // loses their place. The new bounds only exist after the next render, so
  // the fit is deferred to the effect below via this flag.
  const refitAfterLayout = useRef(false);

  const expandAll = useCallback(() => {
    refitAfterLayout.current = true;
    setExpandedIds(parentIds);
  }, [parentIds]);

  const collapseToTop = useCallback(() => {
    refitAfterLayout.current = true;
    setExpandedIds(defaultExpandedIds(orgTree ?? []));
  }, [orgTree]);

  // Layout computation — over the pruned tree, so a collapsed subtree costs
  // no horizontal space and its siblings close ranks.
  const layout = useMemo(() => layoutForest(visibleTree, hiddenCounts), [visibleTree, hiddenCounts]);
  const allNodes = useMemo(() => flattenLayout(layout), [layout]);
  const edges = useMemo(() => collectEdges(layout), [layout]);

  // Compute SVG bounds
  const bounds = useMemo(() => {
    if (allNodes.length === 0) return { width: 800, height: 600 };
    let maxX = 0, maxY = 0;
    for (const n of allNodes) {
      maxX = Math.max(maxX, n.x + CARD_W);
      maxY = Math.max(maxY, n.y + CARD_H);
    }
    return { width: maxX + PADDING, height: maxY + PADDING };
  }, [allNodes]);

  // Pan & zoom state
  const containerRef = useRef<HTMLDivElement>(null);
  const [pan, setPan] = useState({ x: 0, y: 0 });
  const [zoom, setZoom] = useState(1);
  const [dragging, setDragging] = useState(false);
  const dragStart = useRef({ x: 0, y: 0, panX: 0, panY: 0 });
  const touchGesture = useRef<TouchGesture>({
    mode: null,
    startPoint: { x: 0, y: 0 },
    startPan: { x: 0, y: 0 },
    startZoom: 1,
    startDistance: 0,
    startCenter: { x: 0, y: 0 },
    moved: false,
  });
  const suppressNextCardClick = useRef(false);
  const suppressClickTimerRef = useRef<number | null>(null);

  useEffect(() => {
    return () => {
      if (suppressClickTimerRef.current !== null) {
        window.clearTimeout(suppressClickTimerRef.current);
      }
    };
  }, []);

  // Center the chart on first load
  const hasInitialized = useRef(false);
  useEffect(() => {
    hasInitialized.current = false;
  }, [orgTree]);

  useEffect(() => {
    const refitting = refitAfterLayout.current;
    if ((hasInitialized.current && !refitting) || allNodes.length === 0 || !containerRef.current) {
      return;
    }
    const container = containerRef.current;
    const fitted = fitChartToViewport(container.clientWidth, container.clientHeight, bounds);
    if (!fitted) return;

    refitAfterLayout.current = false;
    hasInitialized.current = true;
    setZoom(fitted.zoom);
    setPan(fitted.pan);
  }, [allNodes, bounds]);

  const handleMouseDown = useCallback((e: React.MouseEvent) => {
    if (e.button !== 0) return;
    // Don't drag if clicking a card
    const target = e.target as HTMLElement;
    if (target.closest("[data-org-card]")) return;
    setDragging(true);
    dragStart.current = { x: e.clientX, y: e.clientY, panX: pan.x, panY: pan.y };
  }, [pan]);

  const handleMouseMove = useCallback((e: React.MouseEvent) => {
    if (!dragging) return;
    const dx = e.clientX - dragStart.current.x;
    const dy = e.clientY - dragStart.current.y;
    setPan({ x: dragStart.current.panX + dx, y: dragStart.current.panY + dy });
  }, [dragging]);

  const handleMouseUp = useCallback(() => {
    setDragging(false);
  }, []);

  const handleWheel = useCallback((e: WheelEvent) => {
    e.preventDefault();
    const container = containerRef.current;
    if (!container) return;

    // Browser-standard wheel semantics: a bare wheel or two-finger trackpad
    // swipe moves the content, exactly like scrolling a page. Only a pinch
    // gesture zooms, and browsers signal a pinch by setting ctrlKey on a
    // synthetic wheel event (macOS trackpad pinch, and Ctrl+wheel). Treating
    // every deltaY as zoom made the chart impossible to scroll past.
    if (!e.ctrlKey) {
      // Deltas are already in viewport pixels, so they apply to the pan
      // offset directly — scaling them by the zoom level would make the
      // chart drift faster or slower than the fingers.
      setPan((current) => ({ x: current.x - e.deltaX, y: current.y - e.deltaY }));
      return;
    }

    const rect = container.getBoundingClientRect();
    const mouseX = e.clientX - rect.left;
    const mouseY = e.clientY - rect.top;

    const factor = e.deltaY < 0 ? 1.1 : 0.9;
    const newZoom = clampZoom(zoom * factor);

    // Zoom toward mouse position
    const scale = newZoom / zoom;
    setPan({
      x: mouseX - scale * (mouseX - pan.x),
      y: mouseY - scale * (mouseY - pan.y),
    });
    setZoom(newZoom);
  }, [zoom, pan]);

  // React binds onWheel passively, which silently drops preventDefault and
  // lets the page scroll along with the chart. Bind it natively instead so
  // both panning and pinch-zooming actually own the gesture.
  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;
    container.addEventListener("wheel", handleWheel, { passive: false });
    return () => container.removeEventListener("wheel", handleWheel);
  }, [handleWheel]);

  const zoomTowardPoint = useCallback((newZoom: number, point: Point) => {
    const clampedZoom = clampZoom(newZoom);
    const scale = clampedZoom / zoom;
    setPan({
      x: point.x - scale * (point.x - pan.x),
      y: point.y - scale * (point.y - pan.y),
    });
    setZoom(clampedZoom);
  }, [zoom, pan]);

  const fitToScreen = useCallback(() => {
    if (!containerRef.current) return;
    const fitted = fitChartToViewport(
      containerRef.current.clientWidth,
      containerRef.current.clientHeight,
      bounds,
    );
    if (!fitted) return;

    setZoom(fitted.zoom);
    setPan(fitted.pan);
  }, [bounds]);

  const handleTouchStart = useCallback((e: React.TouchEvent<HTMLDivElement>) => {
    if (e.touches.length >= 2 && containerRef.current) {
      const [first, second] = [e.touches[0]!, e.touches[1]!];
      touchGesture.current = {
        mode: "pinch",
        startPoint: { x: 0, y: 0 },
        startPan: pan,
        startZoom: zoom,
        startDistance: touchDistance(first, second),
        startCenter: touchCenter(first, second, containerRef.current),
        moved: false,
      };
      return;
    }

    const touch = e.touches[0];
    if (!touch) return;
    touchGesture.current = {
      mode: "pan",
      startPoint: touchPoint(touch),
      startPan: pan,
      startZoom: zoom,
      startDistance: 0,
      startCenter: { x: 0, y: 0 },
      moved: false,
    };
  }, [pan, zoom]);

  const handleTouchMove = useCallback((e: React.TouchEvent<HTMLDivElement>) => {
    const container = containerRef.current;
    if (!container || !touchGesture.current.mode) return;

    if (e.touches.length >= 2) {
      const [first, second] = [e.touches[0]!, e.touches[1]!];
      const distance = touchDistance(first, second);
      const center = touchCenter(first, second, container);

      if (touchGesture.current.mode !== "pinch" || touchGesture.current.startDistance === 0) {
        touchGesture.current = {
          mode: "pinch",
          startPoint: { x: 0, y: 0 },
          startPan: pan,
          startZoom: zoom,
          startDistance: distance,
          startCenter: center,
          moved: false,
        };
        return;
      }

      const gesture = touchGesture.current;
      const nextZoom = clampZoom(gesture.startZoom * (distance / gesture.startDistance));
      const scale = nextZoom / gesture.startZoom;
      const dx = center.x - gesture.startCenter.x;
      const dy = center.y - gesture.startCenter.y;
      gesture.moved =
        gesture.moved ||
        Math.abs(distance - gesture.startDistance) > TOUCH_MOVE_THRESHOLD ||
        Math.hypot(dx, dy) > TOUCH_MOVE_THRESHOLD;
      setZoom(nextZoom);
      setPan({
        x: center.x - scale * (gesture.startCenter.x - gesture.startPan.x),
        y: center.y - scale * (gesture.startCenter.y - gesture.startPan.y),
      });
      return;
    }

    const touch = e.touches[0];
    if (!touch || touchGesture.current.mode !== "pan") return;
    const dx = touch.clientX - touchGesture.current.startPoint.x;
    const dy = touch.clientY - touchGesture.current.startPoint.y;
    touchGesture.current.moved = touchGesture.current.moved || Math.hypot(dx, dy) > TOUCH_MOVE_THRESHOLD;
    setPan({
      x: touchGesture.current.startPan.x + dx,
      y: touchGesture.current.startPan.y + dy,
    });
  }, [pan, zoom]);

  const handleTouchEnd = useCallback(() => {
    if (touchGesture.current.moved) {
      suppressNextCardClick.current = true;
      if (suppressClickTimerRef.current !== null) {
        window.clearTimeout(suppressClickTimerRef.current);
      }
      suppressClickTimerRef.current = window.setTimeout(() => {
        suppressNextCardClick.current = false;
        suppressClickTimerRef.current = null;
      }, 400);
    }
    touchGesture.current = {
      mode: null,
      startPoint: { x: 0, y: 0 },
      startPan: pan,
      startZoom: zoom,
      startDistance: 0,
      startCenter: { x: 0, y: 0 },
      moved: false,
    };
  }, [pan, zoom]);

  if (!selectedCompanyId) {
    return <EmptyState icon={Network} message="Select an organization to view the org chart." />;
  }

  if (providedOrgTree === undefined && isLoading) {
    return <PageSkeleton variant="org-chart" />;
  }

  if (orgTree && orgTree.length === 0) {
    return <EmptyState icon={Network} message="No organizational hierarchy defined." />;
  }

  return (
    <div
      className={embedded
        ? "flex min-h-(--sz-420px) flex-1 flex-col md:min-h-0"
        : "flex h-(--sz-calc-38) min-h-(--sz-420px) flex-col md:h-full md:min-h-0"}
    >
      {!embedded && (showImport || showExport) ? (
        <div className="mb-2 flex shrink-0 flex-wrap items-center justify-start gap-2">
        {showImport ? (
          <Link to="/company/import">
            <Button variant="outline" size="sm">
              <Upload className="mr-1.5 h-3.5 w-3.5" />
              Import organization
            </Button>
          </Link>
        ) : null}
        {showExport ? (
          <Link to="/company/export">
            <Button variant="outline" size="sm">
              <Download className="mr-1.5 h-3.5 w-3.5" />
              Export organization
            </Button>
          </Link>
        ) : null}
        </div>
      ) : null}
      <div
        ref={containerRef}
        data-testid="org-chart-viewport"
        className="w-full flex-1 min-h-0 overflow-hidden relative bg-muted/20 border border-border rounded-lg"
        style={{
          cursor: dragging ? "grabbing" : "grab",
          touchAction: "none",
          overscrollBehavior: "contain",
        }}
        onMouseDown={handleMouseDown}
        onMouseMove={handleMouseMove}
        onMouseUp={handleMouseUp}
        onMouseLeave={handleMouseUp}
        onTouchStart={handleTouchStart}
        onTouchMove={handleTouchMove}
        onTouchEnd={handleTouchEnd}
        onTouchCancel={handleTouchEnd}
      >
        {/* Expand / collapse all — only earns its place once something is
            actually foldable. */}
        {parentIds.size > 0 && (
          <div className="absolute top-3 left-3 z-10">
            <button
              data-org-expand-all
              type="button"
              className="flex items-center gap-1.5 rounded border border-border bg-background px-2 py-1.5 text-xs transition-colors hover:bg-accent hover:text-accent-foreground focus-visible:ring-ring focus-visible:ring-[3px] focus-visible:outline-none sm:py-1"
              onClick={allExpanded ? collapseToTop : expandAll}
              title={allExpanded ? "Collapse to top level" : "Expand all levels"}
              aria-label={allExpanded ? "Collapse to top level" : "Expand all levels"}
            >
              <ChevronDown
                className={cn("h-3.5 w-3.5 transition-transform duration-150", allExpanded && "rotate-180")}
              />
              {allExpanded ? "Collapse all" : "Expand all"}
            </button>
          </div>
        )}

        {/* Zoom controls */}
        <div className="absolute top-3 right-3 z-10 flex flex-col gap-1.5">
          <button
            className="flex size-9 items-center justify-center rounded border border-border bg-background text-sm transition-colors hover:bg-accent sm:size-7"
            onClick={() => {
              const container = containerRef.current;
              if (container) {
                zoomTowardPoint(zoom * 1.2, {
                  x: container.clientWidth / 2,
                  y: container.clientHeight / 2,
                });
              }
            }}
            title="Zoom in"
            aria-label="Zoom in"
          >
            <Plus className="h-4 w-4 sm:h-3.5 sm:w-3.5" />
          </button>
          <button
            className="flex size-9 items-center justify-center rounded border border-border bg-background text-sm transition-colors hover:bg-accent sm:size-7"
            onClick={() => {
              const container = containerRef.current;
              if (container) {
                zoomTowardPoint(zoom * 0.8, {
                  x: container.clientWidth / 2,
                  y: container.clientHeight / 2,
                });
              }
            }}
            title="Zoom out"
            aria-label="Zoom out"
          >
            <Minus className="h-4 w-4 sm:h-3.5 sm:w-3.5" />
          </button>
          <button
            className="flex size-9 items-center justify-center rounded border border-border bg-background text-(length:--text-nano) transition-colors hover:bg-accent sm:size-7"
            onClick={fitToScreen}
            title="Fit to screen"
            aria-label="Fit chart to screen"
          >
            <Maximize2 className="h-4 w-4 sm:h-3.5 sm:w-3.5" />
          </button>
        </div>

        {/* SVG layer for edges */}
        <svg
          className="absolute inset-0 pointer-events-none"
          style={{
            width: "100%",
            height: "100%",
          }}
        >
          <g transform={`translate(${pan.x}, ${pan.y}) scale(${zoom})`}>
            {edges.map(({ parent, child }) => {
              const x1 = parent.x + CARD_W / 2;
              const y1 = parent.y + CARD_H;
              const x2 = child.x + CARD_W / 2;
              const y2 = child.y;
              const midY = (y1 + y2) / 2;

              return (
                <path
                  key={`${parent.id}-${child.id}`}
                  d={`M ${x1} ${y1} L ${x1} ${midY} L ${x2} ${midY} L ${x2} ${y2}`}
                  fill="none"
                  stroke="var(--border)"
                  strokeWidth={1.5}
                />
              );
            })}
          </g>
        </svg>

        {/* Card layer */}
        <div
          data-testid="org-chart-card-layer"
          className="absolute inset-0"
          style={{
            transform: `translate(${pan.x}px, ${pan.y}px) scale(${zoom})`,
            transformOrigin: "0 0",
          }}
        >
          {allNodes.map((node) => {
            const agent = agentMap.get(node.id);
            const dotColor = statusDotColor[node.status] ?? defaultDotColor;
            // A card is expandable when it still has reports in the full tree:
            // either they are drawn below it, or collapse is hiding them.
            const isExpanded = expanded.has(node.id);
            const expandable = isExpanded ? node.children.length > 0 : node.hiddenCount > 0;

            return (
              <Card
                key={node.id}
                data-org-card
                className="block absolute py-0 hover:shadow-md hover:border-foreground/20 transition-(--tp-box-shadow-border-color) duration-150 cursor-pointer select-none"
                style={{
                  left: node.x,
                  top: node.y,
                  width: CARD_W,
                  minHeight: CARD_H,
                }}
                onClick={() => navigate(agent ? agentUrl(agent) : `/agents/${node.id}`)}
                onClickCapture={(e) => {
                  if (!suppressNextCardClick.current) return;
                  suppressNextCardClick.current = false;
                  e.preventDefault();
                  e.stopPropagation();
                }}
              >
                {expandable && (
                  // Straddles the bottom edge, where the connector to the
                  // reports leaves the card, so it reads as "what is below".
                  <button
                    data-org-toggle
                    type="button"
                    aria-expanded={isExpanded}
                    aria-label={
                      isExpanded
                        ? `Collapse reports under ${node.name}`
                        : `Expand ${node.hiddenCount} reports under ${node.name}`
                    }
                    title={isExpanded ? "Collapse reports" : `Show ${node.hiddenCount} reports`}
                    className="absolute left-1/2 -bottom-3 z-10 flex -translate-x-1/2 items-center gap-1 rounded-full border border-border bg-background px-2 py-0.5 text-(length:--text-nano) font-medium text-muted-foreground shadow-xs transition-colors hover:bg-accent hover:text-accent-foreground focus-visible:ring-ring focus-visible:ring-[3px] focus-visible:outline-none"
                    onClick={(e) => {
                      // The card itself navigates to the agent; the toggle
                      // must only fold the subtree.
                      e.preventDefault();
                      e.stopPropagation();
                      toggleNode(node.id);
                    }}
                  >
                    <ChevronDown
                      className={cn(
                        "h-3 w-3 transition-transform duration-150",
                        isExpanded && "rotate-180",
                      )}
                    />
                    {!isExpanded && <span className="tabular-nums">{node.hiddenCount}</span>}
                  </button>
                )}
                <div className="flex items-center px-4 py-3 gap-3">
                  {/* Agent icon + status dot */}
                  <div className="relative shrink-0">
                    <div className="w-9 h-9 rounded-full bg-muted flex items-center justify-center">
                      <AgentAvatar agent={agent} size={16} className="h-4.5 w-4.5 text-foreground/70"/>
                    </div>
                    <span
                      className="absolute -bottom-0.5 -right-0.5 h-3 w-3 rounded-full border-2 border-card"
                      style={{ backgroundColor: dotColor }}
                    />
                  </div>
                  {/* Name + role + adapter type */}
                  <div className="flex flex-col items-start min-w-0 flex-1">
                    <span
                      data-org-card-name
                      className="text-sm font-semibold text-foreground leading-tight"
                    >
                      {node.name}
                    </span>
                    <span className="text-(length:--text-micro) text-muted-foreground leading-tight mt-0.5">
                      {agent?.title ?? roleLabel(node.role)}
                    </span>
                    {agent && (
                      <span className="text-(length:--text-nano) text-muted-foreground/60 font-mono leading-tight mt-1">
                        {getAdapterLabel(agentDisplayAdapterType(agent))}
                      </span>
                    )}
                    {agent && agent.capabilities && (
                      <span className="text-(length:--text-nano) text-muted-foreground/80 leading-tight mt-1 line-clamp-2">
                        {agent.capabilities}
                      </span>
                    )}
                  </div>
                </div>
              </Card>
            );
          })}
        </div>
      </div>
    </div>
  );
}

const roleLabels: Record<string, string> = AGENT_ROLE_LABELS;

function roleLabel(role: string): string {
  return roleLabels[role] ?? role;
}
