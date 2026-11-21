import { readFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import { resolve, dirname } from "node:path";
import { pathToFileURL } from "node:url";

export function validateVisual(html) {
  if (Buffer.byteLength(html) > 2 * 1024 * 1024) throw new Error("Visual exceeds 2 MiB");
  // Authoring lint, not a security parser. The opaque-origin CSP is authoritative.
  if (/(?:src|href)\s*=\s*["']\s*(?:https?:|\/\/)|@import\b|url\(\s*["']?\s*(?:https?:|\/\/)/i.test(html)) {
    throw new Error("Bundle resources inline; put external source links in Markdown");
  }
}

/** Save (optional), upload and bind. Repeat identical input safely after a lost response.
 * expectedRevisionId is mandatory: never guess an association from body links.
 */
export async function deliverReport(spec, { apply = false, request = fetch, env = process.env } = {}) {
  validateVisual(spec.html);
  const hash = createHash("sha256").update(spec.html).digest("hex");
  if (!spec.issueId || !spec.key || !spec.expectedRevisionId) throw new Error("Explicit issueId, key and expectedRevisionId required");
  if (!apply) return { dryRun: true, issueId: spec.issueId, key: spec.key, revisionId: spec.expectedRevisionId, sha256: hash };
  const base = env.PAPERCLIP_API_URL?.replace(/\/$/, "").replace(/\/api$/, "");
  if (!base || !env.PAPERCLIP_API_KEY) throw new Error("Paperclip API environment required");
  async function api(path, body, method = "GET") {
    const multipart = body instanceof FormData;
    const response = await request(`${base}/api${path}`, { method, headers: {
      Authorization: `Bearer ${env.PAPERCLIP_API_KEY}`, "X-Paperclip-Run-Id": env.PAPERCLIP_RUN_ID ?? "",
      ...(!multipart && body ? { "Content-Type": "application/json" } : {}),
    }, ...(body ? { body: multipart ? body : JSON.stringify(body) } : {}) });
    if (!response.ok) throw new Error(`Paperclip ${method} ${path}: ${response.status}`);
    return response.json();
  }
  const path = `/issues/${encodeURIComponent(spec.issueId)}/documents/${encodeURIComponent(spec.key)}`;
  let doc = await api(path);
  if (doc.latestRevisionId !== spec.expectedRevisionId) throw new Error("Document revision changed; refresh the explicit manifest before continuing");
  if (spec.markdown !== undefined && doc.body !== spec.markdown) {
    if (doc.latestRevisionId !== spec.expectedRevisionId) throw new Error("Markdown revision changed; reconcile before retrying");
    doc = await api(path, { title: spec.title ?? doc.title, body: spec.markdown, format: "markdown", baseRevisionId: spec.expectedRevisionId }, "PUT");
    if (doc.key !== spec.key) throw new Error("Document was redirected because it is locked; refusing to bind");
  } else if (spec.markdown === undefined && doc.latestRevisionId !== spec.expectedRevisionId) {
    throw new Error("Document revision changed; explicit migration manifest must be refreshed");
  }
  if (doc.presentation?.attachmentSha256 === hash) return { unchanged: true, presentation: doc.presentation };
  const attachments = await api(`/issues/${encodeURIComponent(spec.issueId)}/attachments`);
  let attachment = attachments.find((a) => a.sha256 === hash && a.contentType?.split(";")[0] === "text/html");
  if (!attachment) {
    const data = new FormData();
    data.append("file", new Blob([spec.html], { type: "text/html" }), spec.filename ?? `${spec.key}-visual.html`);
    attachment = await api(`/companies/${doc.companyId}/issues/${doc.issueId}/attachments`, data, "POST");
  }
  const presentation = await api(`${path}/presentation`, { documentRevisionId: doc.latestRevisionId,
    attachmentId: attachment.id, attachmentSha256: hash, baseVersion: doc.presentation?.version ?? null }, "PUT");
  return { documentRevisionId: doc.latestRevisionId, presentation };
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  const manifest = process.argv[2];
  if (!manifest) throw new Error("Usage: node scripts/document-presentations/deliver.mjs manifest.json [--apply]");
  const specs = JSON.parse(await readFile(manifest, "utf8"));
  for (const spec of specs) {
    const html = await readFile(resolve(dirname(manifest), spec.htmlPath), "utf8");
    const markdown = spec.markdownPath ? await readFile(resolve(dirname(manifest), spec.markdownPath), "utf8") : undefined;
    console.log(JSON.stringify(await deliverReport({ ...spec, html, markdown }, { apply: process.argv.includes("--apply") })));
  }
}
