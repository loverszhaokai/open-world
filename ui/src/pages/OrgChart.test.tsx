// @vitest-environment jsdom

import { act } from "react";
import { createRoot } from "react-dom/client";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { queryKeys } from "@/lib/queryKeys";
import { OrgChart } from "./OrgChart";

const navigateMock = vi.fn();
const orgMock = vi.fn();
const listMock = vi.fn();

vi.mock("@/lib/router", () => ({
  Link: ({ to, children }: { to: string; children: React.ReactNode }) => <a href={to}>{children}</a>,
  useNavigate: () => navigateMock,
}));

vi.mock("../context/CompanyContext", () => ({
  useCompany: () => ({ selectedCompanyId: "company-1" }),
}));

vi.mock("../context/BreadcrumbContext", () => ({
  useBreadcrumbs: () => ({ setBreadcrumbs: vi.fn() }),
}));

vi.mock("../api/agents", () => ({
  agentsApi: {
    org: () => orgMock(),
    list: () => listMock(),
  },
}));

vi.mock("../components/AgentIconPicker", () => ({
  AgentIcon: () => <span data-testid="agent-icon" />,
}));

// eslint-disable-next-line @typescript-eslint/no-explicit-any
(globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;

const orgTree = [
  {
    id: "agent-1",
    name: "CEO",
    role: "ceo",
    status: "active",
    reports: [
      {
        id: "agent-2",
        name: "Engineer",
        role: "engineer",
        status: "active",
        reports: [],
      },
    ],
  },
];

const agents = [
  {
    id: "agent-1",
    companyId: "company-1",
    name: "CEO",
    role: "ceo",
    title: null,
    status: "active",
    reportsTo: null,
    capabilities: null,
    adapterType: "codex_local",
    adapterConfig: {},
    contextMode: "thin",
    budgetMonthlyCents: 0,
    spentMonthlyCents: 0,
    lastHeartbeatAt: null,
    icon: "briefcase",
    metadata: null,
    createdAt: new Date("2026-04-01T00:00:00.000Z"),
    updatedAt: new Date("2026-04-01T00:00:00.000Z"),
    urlKey: "ceo",
    pauseReason: null,
    pausedAt: null,
    permissions: null,
  },
  {
    id: "agent-2",
    companyId: "company-1",
    name: "Engineer",
    role: "engineer",
    title: null,
    status: "active",
    reportsTo: "agent-1",
    capabilities: null,
    adapterType: "codex_local",
    adapterConfig: {},
    contextMode: "thin",
    budgetMonthlyCents: 0,
    spentMonthlyCents: 0,
    lastHeartbeatAt: null,
    icon: "code",
    metadata: null,
    createdAt: new Date("2026-04-01T00:00:00.000Z"),
    updatedAt: new Date("2026-04-01T00:00:00.000Z"),
    urlKey: "engineer",
    pauseReason: null,
    pausedAt: null,
    permissions: null,
  },
];

function createTouchEvent(type: string, touches: Array<{ clientX: number; clientY: number }>) {
  const event = new Event(type, { bubbles: true, cancelable: true });
  Object.defineProperty(event, "touches", {
    value: touches,
  });
  Object.defineProperty(event, "changedTouches", {
    value: touches,
  });
  return event;
}

async function flushReact() {
  await act(async () => {
    await Promise.resolve();
    await new Promise((resolve) => window.setTimeout(resolve, 0));
  });
}

describe("OrgChart mobile gestures", () => {
  let container: HTMLDivElement;
  let root: ReturnType<typeof createRoot>;
  let queryClient: QueryClient;
  let viewportWidth: number;
  let viewportHeight: number;

  beforeEach(() => {
    container = document.createElement("div");
    document.body.appendChild(container);
    queryClient = new QueryClient({
      defaultOptions: { queries: { retry: false } },
    });
    viewportWidth = 360;
    viewportHeight = 520;
    orgMock.mockResolvedValue(orgTree);
    listMock.mockResolvedValue(agents);

    Object.defineProperty(HTMLElement.prototype, "clientWidth", {
      configurable: true,
      get() {
        return this.getAttribute("data-testid") === "org-chart-viewport" ? viewportWidth : 0;
      },
    });
    Object.defineProperty(HTMLElement.prototype, "clientHeight", {
      configurable: true,
      get() {
        return this.getAttribute("data-testid") === "org-chart-viewport" ? viewportHeight : 0;
      },
    });
    vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockImplementation(function getRect(this: HTMLElement) {
      if (this.getAttribute("data-testid") === "org-chart-viewport") {
        return {
          x: 0,
          y: 0,
          left: 0,
          top: 0,
          right: viewportWidth,
          bottom: viewportHeight,
          width: viewportWidth,
          height: viewportHeight,
          toJSON: () => ({}),
        };
      }
      return {
        x: 0,
        y: 0,
        left: 0,
        top: 0,
        right: 0,
        bottom: 0,
        width: 0,
        height: 0,
        toJSON: () => ({}),
      };
    });
  });

  afterEach(async () => {
    if (root) {
      await act(async () => {
        root.unmount();
      });
    }
    container.remove();
    document.body.innerHTML = "";
    vi.restoreAllMocks();
    vi.clearAllMocks();
  });

  async function renderOrgChart() {
    root = createRoot(container);
    await act(async () => {
      root.render(
        <QueryClientProvider client={queryClient}>
          <OrgChart />
        </QueryClientProvider>,
      );
    });
    await flushReact();
    await flushReact();
    return {
      viewport: container.querySelector('[data-testid="org-chart-viewport"]') as HTMLDivElement,
      layer: container.querySelector('[data-testid="org-chart-card-layer"]') as HTMLDivElement,
    };
  }

  it("pans the chart with one-finger touch drag", async () => {
    const { viewport, layer } = await renderOrgChart();

    await act(async () => {
      viewport.dispatchEvent(createTouchEvent("touchstart", [{ clientX: 100, clientY: 100 }]));
      viewport.dispatchEvent(createTouchEvent("touchmove", [{ clientX: 130, clientY: 145 }]));
      viewport.dispatchEvent(createTouchEvent("touchend", []));
    });

    expect(layer.style.transform).toBe("translate(50px, 105px) scale(1)");
  });

  it("suppresses card navigation after a touch pan", async () => {
    const { viewport } = await renderOrgChart();
    const card = container.querySelector("[data-org-card]") as HTMLDivElement;

    await act(async () => {
      viewport.dispatchEvent(createTouchEvent("touchstart", [{ clientX: 100, clientY: 100 }]));
      viewport.dispatchEvent(createTouchEvent("touchmove", [{ clientX: 130, clientY: 145 }]));
      viewport.dispatchEvent(createTouchEvent("touchend", []));
      card.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true }));
    });

    expect(navigateMock).not.toHaveBeenCalled();
  });

  it("allows card navigation after a touch tap without movement", async () => {
    const { viewport } = await renderOrgChart();
    const card = container.querySelector("[data-org-card]") as HTMLDivElement;

    await act(async () => {
      viewport.dispatchEvent(createTouchEvent("touchstart", [{ clientX: 100, clientY: 100 }]));
      viewport.dispatchEvent(createTouchEvent("touchend", []));
      card.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true }));
    });

    expect(navigateMock).toHaveBeenCalledWith("/agents/ceo");
  });
  it("pinch-zooms toward the touch center", async () => {
    const { viewport, layer } = await renderOrgChart();

    await act(async () => {
      viewport.dispatchEvent(createTouchEvent("touchstart", [
        { clientX: 100, clientY: 100 },
        { clientX: 200, clientY: 100 },
      ]));
      viewport.dispatchEvent(createTouchEvent("touchmove", [
        { clientX: 75, clientY: 100 },
        { clientX: 225, clientY: 100 },
      ]));
      viewport.dispatchEvent(createTouchEvent("touchend", []));
    });

    expect(layer.style.transform).toBe("translate(-45px, 40px) scale(1.5)");
  });

  it("does not produce a negative zoom while the viewport has no usable height", async () => {
    viewportHeight = 2;
    const { layer } = await renderOrgChart();

    expect(layer.style.transform).toBe("translate(0px, 0px) scale(1)");

    await act(async () => {
      (container.querySelector('[aria-label="Fit chart to screen"]') as HTMLButtonElement).click();
    });

    expect(layer.style.transform).toBe("translate(0px, 0px) scale(1)");
  });

  it("shows both portability buttons on self-hosted instances", async () => {
    await renderOrgChart();

    expect(container.textContent).toContain("Import organization");
    expect(container.textContent).toContain("Export organization");
  });

  it("hides the Import button but keeps Export on a Cloud-managed instance", async () => {
    queryClient.setQueryData(queryKeys.health, { status: "ok", cloud: { managed: true } });
    await renderOrgChart();

    expect(container.textContent).not.toContain("Import organization");
    expect(container.textContent).toContain("Export organization");
  });
});

describe("OrgChart collapsing", () => {
  let container: HTMLDivElement;
  let root: ReturnType<typeof createRoot>;
  let queryClient: QueryClient;

  /**
   * A CEO over two deputies that each carry a team — the shape that makes the
   * all-levels chart unusable and the reason it now opens collapsed.
   */
  const deepOrg = [
    {
      id: "ceo",
      name: "CEO",
      role: "ceo",
      status: "active",
      reports: [
        {
          id: "cao",
          name: "CAO",
          role: "manager",
          status: "active",
          reports: [
            { id: "dev-1", name: "Dev One", role: "engineer", status: "active", reports: [] },
            {
              id: "lead",
              name: "Lead",
              role: "manager",
              status: "active",
              reports: [
                { id: "dev-2", name: "Dev Two", role: "engineer", status: "active", reports: [] },
              ],
            },
          ],
        },
        {
          id: "coo",
          name: "COO",
          role: "manager",
          status: "active",
          reports: [{ id: "ops-1", name: "Ops One", role: "engineer", status: "active", reports: [] }],
        },
      ],
    },
  ];

  beforeEach(() => {
    container = document.createElement("div");
    document.body.appendChild(container);
    queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    orgMock.mockResolvedValue(deepOrg);
    listMock.mockResolvedValue([]);
  });

  afterEach(async () => {
    if (root) {
      await act(async () => {
        root.unmount();
      });
    }
    container.remove();
    document.body.innerHTML = "";
    vi.clearAllMocks();
  });

  async function render() {
    root = createRoot(container);
    await act(async () => {
      root.render(
        <QueryClientProvider client={queryClient}>
          <OrgChart />
        </QueryClientProvider>,
      );
    });
    await flushReact();
    await flushReact();
  }

  function cardNames() {
    return Array.from(container.querySelectorAll("[data-org-card]")).map(
      (card) => card.querySelector("[data-org-card-name]")?.textContent,
    );
  }

  /**
   * Cards are absolutely positioned siblings, so a card's own name element is
   * the only reliable way to pick one out — its `textContent` says nothing
   * about its reports.
   */
  function cardFor(name: string) {
    return Array.from(container.querySelectorAll("[data-org-card]")).find(
      (card) => card.querySelector("[data-org-card-name]")?.textContent === name,
    );
  }

  function toggleFor(name: string) {
    return (cardFor(name)?.querySelector("[data-org-toggle]") ?? null) as HTMLButtonElement | null;
  }

  it("renders only the top two levels by default", async () => {
    await render();

    expect(cardNames()).toEqual(["CEO", "CAO", "COO"]);
  });

  it("does not render collapsed descendants at all", async () => {
    await render();

    // Not merely hidden — a collapsed subtree is pruned before layout so it
    // costs no horizontal space.
    expect(container.textContent).not.toContain("Dev One");
    expect(container.textContent).not.toContain("Ops One");
  });

  it("labels a collapsed toggle with the number of hidden descendants", async () => {
    await render();

    // CAO hides dev-1, lead and dev-2.
    expect(toggleFor("CAO")?.textContent).toContain("3");
    expect(toggleFor("COO")?.textContent).toContain("1");
  });

  it("gives the collapsed toggle an accessible expand label", async () => {
    await render();

    expect(toggleFor("CAO")?.getAttribute("aria-label")).toBe("Expand 3 reports under CAO");
    expect(toggleFor("CAO")?.getAttribute("aria-expanded")).toBe("false");
  });

  it("reveals one more level when a collapsed node is clicked", async () => {
    await render();

    await act(async () => {
      toggleFor("CAO")!.click();
    });

    expect(cardNames()).toContain("Dev One");
    expect(cardNames()).toContain("Lead");
    // Still one level at a time: Lead's own report stays folded.
    expect(cardNames()).not.toContain("Dev Two");
  });

  it("collapses an expanded node back down", async () => {
    await render();

    await act(async () => {
      toggleFor("CAO")!.click();
    });
    expect(cardNames()).toContain("Dev One");

    await act(async () => {
      toggleFor("CAO")!.click();
    });
    expect(cardNames()).not.toContain("Dev One");
  });

  it("does not navigate when the toggle is clicked", async () => {
    await render();

    await act(async () => {
      toggleFor("CAO")!.click();
    });

    // The toggle lives inside a card whose click navigates to the agent.
    expect(navigateMock).not.toHaveBeenCalled();
  });

  it("still navigates when the card body is clicked", async () => {
    await render();
    const card = container.querySelector("[data-org-card]") as HTMLDivElement;

    await act(async () => {
      card.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true }));
    });

    expect(navigateMock).toHaveBeenCalledWith("/agents/ceo");
  });

  it("omits the toggle on a leaf card", async () => {
    await render();

    await act(async () => {
      toggleFor("CAO")!.click();
    });

    expect(cardFor("Dev One")).toBeDefined();
    expect(toggleFor("Dev One")).toBeNull();
  });

  it("expands every level through the Expand all control", async () => {
    await render();

    await act(async () => {
      (container.querySelector("[data-org-expand-all]") as HTMLButtonElement).click();
    });

    expect(cardNames()).toEqual(["CEO", "CAO", "Dev One", "Lead", "Dev Two", "COO", "Ops One"]);
  });

  it("offers Collapse all once everything is expanded, and returns to the top level", async () => {
    await render();
    const control = () => container.querySelector("[data-org-expand-all]") as HTMLButtonElement;

    await act(async () => {
      control().click();
    });
    expect(control().textContent).toContain("Collapse all");

    await act(async () => {
      control().click();
    });
    expect(cardNames()).toEqual(["CEO", "CAO", "COO"]);
  });

  it("keeps the expansion when the chart refetches the same tree", async () => {
    await render();

    await act(async () => {
      toggleFor("CAO")!.click();
    });
    expect(cardNames()).toContain("Dev One");

    // A refetch hands back an equal-but-new tree object; the user's open
    // branch must survive it rather than snapping back to the top level.
    await act(async () => {
      await queryClient.refetchQueries();
    });
    await flushReact();

    expect(cardNames()).toContain("Dev One");
  });

  it("re-fits the viewport after Expand all so the new chart is visible", async () => {
    await render();
    const layer = container.querySelector('[data-testid="org-chart-card-layer"]') as HTMLDivElement;
    const before = layer.style.transform;

    await act(async () => {
      (container.querySelector("[data-org-expand-all]") as HTMLButtonElement).click();
    });

    // Expanding everything makes the chart much wider; leaving the viewport
    // where it was would strand the user on an empty corner.
    expect(layer.style.transform).not.toBe(before);
  });

  it("leaves the viewport alone when a single node is toggled", async () => {
    await render();
    const layer = container.querySelector('[data-testid="org-chart-card-layer"]') as HTMLDivElement;
    const before = layer.style.transform;

    await act(async () => {
      toggleFor("CAO")!.click();
    });

    // A local edit must not move the chart under the user's cursor.
    expect(layer.style.transform).toBe(before);
  });

  it("shows an expanded node's toggle without a count", async () => {
    await render();

    // The root is expanded by default, so its toggle is a plain collapse
    // affordance rather than a promise of N hidden people.
    const ceoToggle = toggleFor("CEO")!;
    expect(ceoToggle.getAttribute("aria-expanded")).toBe("true");
    expect(ceoToggle.textContent).toBe("");
  });
});

describe("OrgChart wheel interaction", () => {
  let container: HTMLDivElement;
  let root: ReturnType<typeof createRoot>;
  let queryClient: QueryClient;
  const viewportWidth = 800;
  const viewportHeight = 600;

  beforeEach(() => {
    container = document.createElement("div");
    document.body.appendChild(container);
    queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    orgMock.mockResolvedValue(orgTree);
    listMock.mockResolvedValue(agents);

    Object.defineProperty(HTMLElement.prototype, "clientWidth", {
      configurable: true,
      get() {
        return this.getAttribute("data-testid") === "org-chart-viewport" ? viewportWidth : 0;
      },
    });
    Object.defineProperty(HTMLElement.prototype, "clientHeight", {
      configurable: true,
      get() {
        return this.getAttribute("data-testid") === "org-chart-viewport" ? viewportHeight : 0;
      },
    });
    vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockImplementation(function getRect(this: HTMLElement) {
      const isViewport = this.getAttribute("data-testid") === "org-chart-viewport";
      const width = isViewport ? viewportWidth : 0;
      const height = isViewport ? viewportHeight : 0;
      return {
        x: 0, y: 0, left: 0, top: 0, right: width, bottom: height, width, height,
        toJSON: () => ({}),
      };
    });
  });

  afterEach(async () => {
    if (root) {
      await act(async () => {
        root.unmount();
      });
    }
    container.remove();
    document.body.innerHTML = "";
    vi.restoreAllMocks();
    vi.clearAllMocks();
  });

  async function renderChart() {
    root = createRoot(container);
    await act(async () => {
      root.render(
        <QueryClientProvider client={queryClient}>
          <OrgChart />
        </QueryClientProvider>,
      );
    });
    await flushReact();
    await flushReact();
    return {
      viewport: container.querySelector('[data-testid="org-chart-viewport"]') as HTMLDivElement,
      layer: container.querySelector('[data-testid="org-chart-card-layer"]') as HTMLDivElement,
    };
  }

  /** Parse the card layer's transform into pan + zoom. */
  function readTransform(layer: HTMLDivElement) {
    const match = /translate\((-?[\d.]+)px, (-?[\d.]+)px\) scale\(([\d.]+)\)/.exec(
      layer.style.transform,
    );
    if (!match) throw new Error(`unexpected transform: ${layer.style.transform}`);
    return { x: Number(match[1]), y: Number(match[2]), zoom: Number(match[3]) };
  }

  function wheel(viewport: HTMLDivElement, init: WheelEventInit) {
    viewport.dispatchEvent(
      new WheelEvent("wheel", { bubbles: true, cancelable: true, ...init }),
    );
  }

  it("pans the content on a plain wheel, leaving zoom untouched", async () => {
    const { viewport, layer } = await renderChart();
    const before = readTransform(layer);

    await act(async () => {
      wheel(viewport, { deltaY: 120 });
    });

    const after = readTransform(layer);
    // Scrolling down moves the content up, like a scrolling page.
    expect(after.y).toBe(before.y - 120);
    expect(after.zoom).toBe(before.zoom);
  });

  it("pans horizontally on a two-finger sideways swipe", async () => {
    const { viewport, layer } = await renderChart();
    const before = readTransform(layer);

    await act(async () => {
      wheel(viewport, { deltaX: 40 });
    });

    const after = readTransform(layer);
    expect(after.x).toBe(before.x - 40);
    expect(after.y).toBe(before.y);
    expect(after.zoom).toBe(before.zoom);
  });

  it("accumulates the fractional deltas a trackpad emits", async () => {
    const { viewport, layer } = await renderChart();
    const before = readTransform(layer);

    // A trackpad swipe arrives as a burst of small continuous deltas.
    await act(async () => {
      wheel(viewport, { deltaY: 3.5 });
      wheel(viewport, { deltaY: 3.5 });
      wheel(viewport, { deltaY: 3 });
    });

    expect(readTransform(layer).y).toBe(before.y - 10);
  });

  it("zooms only when ctrlKey marks the event as a pinch", async () => {
    const { viewport, layer } = await renderChart();
    const before = readTransform(layer);

    await act(async () => {
      wheel(viewport, { deltaY: -100, ctrlKey: true, clientX: 400, clientY: 300 });
    });

    expect(readTransform(layer).zoom).toBeGreaterThan(before.zoom);
  });

  it("zooms out on a pinch-in", async () => {
    const { viewport, layer } = await renderChart();
    const before = readTransform(layer);

    await act(async () => {
      wheel(viewport, { deltaY: 100, ctrlKey: true, clientX: 400, clientY: 300 });
    });

    expect(readTransform(layer).zoom).toBeLessThan(before.zoom);
  });

  it("zooms toward the pointer, not the viewport origin", async () => {
    const { viewport, layer } = await renderChart();
    const before = readTransform(layer);
    const pointer = { clientX: 200, clientY: 150 };

    await act(async () => {
      wheel(viewport, { deltaY: -100, ctrlKey: true, ...pointer });
    });

    const after = readTransform(layer);
    const scale = after.zoom / before.zoom;
    // The point under the cursor stays put across the zoom.
    expect(after.x).toBeCloseTo(pointer.clientX - scale * (pointer.clientX - before.x), 5);
    expect(after.y).toBeCloseTo(pointer.clientY - scale * (pointer.clientY - before.y), 5);
  });

  it("prevents the page from scrolling in both modes", async () => {
    const { viewport } = await renderChart();

    const pan = new WheelEvent("wheel", { bubbles: true, cancelable: true, deltaY: 120 });
    const pinch = new WheelEvent("wheel", { bubbles: true, cancelable: true, deltaY: 120, ctrlKey: true });

    await act(async () => {
      viewport.dispatchEvent(pan);
      viewport.dispatchEvent(pinch);
    });

    expect(pan.defaultPrevented).toBe(true);
    expect(pinch.defaultPrevented).toBe(true);
  });
});
