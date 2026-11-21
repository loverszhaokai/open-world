import { expect, test } from "@playwright/test";

test("interactive reports work and rendered/raw controls preserve the original download", async ({ page }) => {
  await page.goto("/iframe.html?id=html-artifacts-01-preview--interactive-report&viewMode=story");
  const report = page.frameLocator('iframe[title="repository-usage.html rendered HTML"]').frameLocator('iframe');
  await expect(report.getByRole("cell", { name: "juspay/hyperswitch", exact: true })).toBeVisible();
  await report.getByPlaceholder("Search repositories").fill("storybook");
  await expect(report.getByText("1 qualifying repositories")).toBeVisible();
  await expect(report.getByRole("cell", { name: "juspay/hyperswitch", exact: true })).toHaveCount(0);
  const original = await page.getByRole("link", { name: "Download repository-usage.html" }).getAttribute("href");
  await page.getByRole("button", { name: "Raw", exact: true }).click();
  await expect(page.locator("iframe[title$='rendered HTML']")).toHaveCount(0);
  await expect(page.getByLabel("repository-usage.html raw text")).toContainText("<script>");
  expect(await page.getByRole("link", { name: "Download repository-usage.html" }).getAttribute("href")).toBe(original);
  await page.getByRole("button", { name: "Rendered", exact: true }).click();
  await expect(report.getByText("6 qualifying repositories")).toBeVisible();
});

test("artifact JavaScript cannot read cookies, host DOM or storage, submit forms, escape or load resources", async ({ page, context }) => {
  await context.addCookies([{ name: "html-preview-cookie", value: "host-secret", url: "http://127.0.0.1:6189" }]);
  const attempts: string[] = [];
  await context.route("**/*", async route => {
    const url = route.request().url();
    if (url.includes("html-preview-attacker.invalid") || url.includes("/api/html-preview-probe")) {
      attempts.push(url);
      return route.abort();
    }
    return route.continue();
  });
  await page.goto("/iframe.html?id=html-artifacts-01-preview--security-checks&viewMode=story");
  const report = page.frameLocator('iframe[title="isolation-checks.html rendered HTML"]').frameLocator('iframe');
  for (const probe of ["Cookies", "Parent document", "Parent cookies", "Local storage", "Session storage", "Top navigation", "Popups", "API request", "Remote request"]) {
    await expect(report.getByText(`${probe}: blocked`, { exact: true })).toBeVisible();
  }
  await expect(report.getByText(/UNEXPECTED ACCESS/)).toHaveCount(0);
  expect(attempts).toEqual([]);
  expect(context.pages()).toHaveLength(1);
  expect(page.url()).toContain("security-checks");
  expect(await page.evaluate(() => document.cookie)).toContain("host-secret");
});

test("workspace panel and file sheet use the same renderer and adjacent view controls", async ({ page }) => {
  for (const story of ["task-panel", "file-sheet"]) {
    await page.goto(`/iframe.html?id=html-artifacts-02-workspace--${story}&viewMode=story`);
    const report = page.frameLocator('iframe[title="repository-usage.html rendered HTML"]').frameLocator('iframe');
    await expect(report.getByText("6 qualifying repositories")).toBeVisible();
    await page.getByRole("button", { name: "Raw", exact: true }).click();
    await expect(page.locator("iframe[title$='rendered HTML']")).toHaveCount(0);
    await expect(page.getByRole("region", { name: "repository-usage.html source" })).toContainText("<script>");
    await page.getByRole("button", { name: "Rendered", exact: true }).click();
    await expect(report.getByText("6 qualifying repositories")).toBeVisible();
  }
});

test("opening an HTML artifact from a task shows its interactive report", async ({ page }) => {
  await page.goto("/iframe.html?id=html-artifacts-03-task-journey--open-from-task&viewMode=story");
  await page.getByRole("button", { name: "Open in tab: Interactive repository usage report" }).click();
  const report = page.frameLocator('iframe[title="repository-usage.html rendered HTML"]').frameLocator('iframe');
  await expect(report.getByText("6 qualifying repositories")).toBeVisible();
  await report.getByPlaceholder("Search repositories").fill("storybook");
  await expect(report.getByText("1 qualifying repositories")).toBeVisible();
  await page.getByRole("button", { name: "Raw", exact: true }).click();
  await expect(page.getByLabel("repository-usage.html raw text")).toContainText("<script>");
  await expect(page.getByRole("link", { name: "Download repository-usage.html" })).toHaveAttribute("href", /report\.html/);
});

test("document diagram is above complete native Markdown, expands and survives history/mobile", async ({ page, context }) => {
  await context.grantPermissions(["clipboard-read", "clipboard-write"]);
  await page.goto("/iframe.html?id=html-artifacts-04-document--current&viewMode=story");
  const diagram = page.frameLocator('iframe[title$="rendered HTML"]').frameLocator('iframe');
  await expect(diagram.getByRole("heading", { name: "Decision diagram" })).toBeVisible();
  await diagram.getByRole("button", { name: "Scenario A" }).click();
  await expect(diagram.getByRole("button", { name: "Scenario B" })).toBeVisible();
  await expect(page.getByText("Full evidence and sources remain readable.")).toBeVisible();
  await page.getByTitle("Copy document", { exact: true }).click();
  expect(await page.evaluate(() => navigator.clipboard.readText())).toContain("Canonical source text.");
  await page.reload();
  await expect(diagram.getByRole("heading", { name: "Decision diagram" })).toBeVisible();
  const frame = page.locator('iframe[title$="rendered HTML"]');
  const before = await frame.boundingBox();
  await page.getByRole("button", { name: "Expand diagram" }).click();
  expect((await frame.boundingBox())!.height).toBeGreaterThan(before!.height);
  await page.getByRole("link", { name: "Complete report", exact: true }).click();
  await expect(page.getByText("Canonical source text.")).toBeVisible();
  await page.setViewportSize({ width: 375, height: 812 });
  expect((await frame.boundingBox())!.width).toBeLessThanOrEqual(375);
  await page.getByRole("button", { name: /rev 2/ }).click();
  await page.getByRole("menuitemradio", { name: /rev 1/ }).click();
  await expect(page.getByText("Historical evidence.")).toBeVisible();
  await expect(diagram.getByRole("heading", { name: "Decision diagram" })).toBeVisible();
});

for (const state of ["stale", "missing", "without-diagram"]) {
  test(`complete report remains accessible when diagram is ${state}`, async ({ page }) => {
    await page.goto(`/iframe.html?id=html-artifacts-04-document--${state}&viewMode=story`);
    await expect(page.getByText("Full evidence and sources remain readable.")).toBeVisible();
    if (state === "stale") await expect(page.getByText(/Diagram awaiting update/)).toBeVisible();
    if (state === "missing") await expect(page.getByText(/Diagram unavailable/)).toBeVisible();
    await expect(page.locator('iframe[title$="rendered HTML"]')).toHaveCount(0);
  });
}

// CSP on the artifact itself does not restrict its own navigation. The trusted
// outer frame must block this network path while preserving inline interaction.
test("artifact scripts cannot exfiltrate through frame navigation", async ({ page }) => {
  const requests: string[] = [];
  await page.route("https://example.invalid/**", async (route) => {
    requests.push(route.request().url());
    await route.abort();
  });
  await page.goto("/iframe.html?id=html-artifacts-01-preview--interactive-report&viewMode=story");
  const inner = page.frameLocator('iframe[title$="rendered HTML"]').frameLocator('iframe');
  await expect(inner.locator("body")).toBeVisible();
  await inner.locator("body").evaluate(() => {
    location.replace("https://example.invalid/location-leak");
    const meta = document.createElement("meta");
    meta.httpEquiv = "refresh"; meta.content = "0;url=https://example.invalid/meta-leak";
    document.head.append(meta);
    const a = document.createElement("a");
    a.href = "https://example.invalid/link-leak"; document.body.append(a); a.click();
  });
  await page.waitForTimeout(500);
  expect(requests).toEqual([]);
  await expect(inner.locator("body")).toBeVisible();
});
