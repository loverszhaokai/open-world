import { test } from "node:test";
import assert from "node:assert/strict";
import { deliverReport, validateVisual } from "./deliver.mjs";
test("dry run has no network side effects and needs explicit revision", async () => {
  const result = await deliverReport({ issueId: "PEN-134", key: "report", expectedRevisionId: "explicit", html: "<h1>Diagram</h1>" }, { request: () => { throw new Error("network"); } });
  assert.equal(result.dryRun, true); assert.equal(result.sha256.length, 64);
  await assert.rejects(deliverReport({ html: "ok" }), /Explicit/);
});
test("visual lint rejects external dependencies", () => {
  assert.throws(() => validateVisual('<script src="https://cdn.invalid/chart.js"></script>'), /Bundle/);
  assert.doesNotThrow(() => validateVisual('<button onclick="this.textContent=2">1</button>'));
});
test("reentrant binding with identical hash does not upload or mutate", async () => {
  const spec = { issueId: "PEN-134", key: "report", expectedRevisionId: "rev", html: "ok" };
  const dry = await deliverReport(spec); let calls = 0;
  const result = await deliverReport(spec, { apply: true, env: { PAPERCLIP_API_URL: "http://localhost/api", PAPERCLIP_API_KEY: "test" }, request: async (_, init) => {
    calls++; assert.equal(init.method, "GET"); return Response.json({ latestRevisionId: "rev", presentation: { attachmentSha256: dry.sha256 } });
  } });
  assert.equal(calls, 1); assert.equal(result.unchanged, true);
});
