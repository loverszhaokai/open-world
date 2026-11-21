import { issueThreadInteractionService } from "../services/issue-thread-interactions.js";
import { companyArtifactsService } from "../services/company-artifacts.js";
import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createDb, companies, agents, issues, assets, issueAttachments, documentPresentations, documents } from "@paperclipai/db";
import { eq } from "drizzle-orm";
import { startEmbeddedPostgresTestDatabase } from "./helpers/embedded-postgres.js";
import { documentService } from "../services/documents.js";
import { documentPresentationService } from "../services/document-presentations.js";

// Real PostgreSQL is required: mocks cannot prove FK, row-lock or CAS behavior.
describe("revision-bound document presentations", () => {
  let temp: Awaited<ReturnType<typeof startEmbeddedPostgresTestDatabase>>;
  let db: ReturnType<typeof createDb>;
  beforeAll(async () => { temp = await startEmbeddedPostgresTestDatabase("presentations-"); db = createDb(temp.connectionString); }, 120_000);
  afterAll(async () => { await temp?.cleanup(); });
  async function fixture() {
    const companyId = randomUUID(), issueId = randomUUID(), attachmentId = randomUUID(), assetId = randomUUID();
    await db.insert(companies).values({ id: companyId, name: "Visual reports", issuePrefix: `P${companyId.slice(0, 7)}` });
    const agentId = randomUUID();
    await db.insert(agents).values({ id: agentId, companyId, name: "Report author", role: "engineer", adapterType: "process" });
    await db.insert(issues).values({ id: issueId, companyId, title: "Report", status: "in_progress" });
    await db.insert(assets).values({ id: assetId, companyId, createdByAgentId: agentId, provider: "local_disk", objectKey: assetId, contentType: "text/html", byteSize: 12, sha256: "a".repeat(64) });
    await db.insert(issueAttachments).values({ id: attachmentId, companyId, issueId, assetId });
    const docs = documentService(db), svc = documentPresentationService(db);
    const { document } = await docs.upsertIssueDocument({ issueId, createdByAgentId: agentId, key: "report", format: "markdown", body: "# Complete report\n\nSources and conclusions." });
    const input = { companyId, issueId, key: "report", documentRevisionId: document.latestRevisionId!, attachmentId,
      attachmentSha256: "a".repeat(64), baseVersion: null as string | null, actor: { actorType: "user" as const, actorId: "local-board" } };
    return { companyId, issueId, attachmentId, docs, svc, document, input };
  }
  it("preserves full Markdown, fences concurrent binds and prevents referenced attachment deletion", async () => {
    const f = await fixture();
    const results = await Promise.allSettled([f.svc.set(f.input), f.svc.set(f.input)]);
    expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(1);
    const read = await f.docs.getIssueDocumentByKey(f.issueId, "report");
    expect(read?.body).toBe(f.document.body);
    expect(read?.presentation?.attachmentSha256).toBe(f.input.attachmentSha256);
    await expect(db.delete(issueAttachments).where(eq(issueAttachments.id, f.attachmentId))).rejects.toThrow();
    const unbound = await f.svc.set({ ...f.input, attachmentId: null, attachmentSha256: null, baseVersion: read!.presentation!.version });
    await expect(f.svc.set(f.input)).rejects.toMatchObject({ status: 409 });
    await f.svc.set({ ...f.input, baseVersion: unbound.version });
  });
  it("aggregates a bound diagram with its document and restores the raw card when stale", async () => {
    const f = await fixture();
    await f.svc.set(f.input);
    // A diagram can be added to a human-authored document. Dedupe must not
    // remove the attachment while also hiding its canonical report.
    await db.update(documents).set({ createdByAgentId: null, updatedByAgentId: null }).where(eq(documents.id, f.document.id));
    const artifacts = companyArtifactsService(db);
    const bound = await artifacts.list(f.companyId);
    expect(bound.artifacts.filter((a) => a.source === "document")).toHaveLength(1);
    expect(bound.artifacts.filter((a) => a.source === "attachment")).toHaveLength(0);
    await f.docs.upsertIssueDocument({ issueId: f.issueId, key: "report", format: "markdown", body: "Changed", baseRevisionId: f.document.latestRevisionId });
    const stale = await artifacts.list(f.companyId);
    expect(stale.artifacts.filter((a) => a.source === "attachment")).toHaveLength(1);
  });
  it("keeps history while updates and restores require a new visual binding", async () => {
    const f = await fixture(); await f.svc.set(f.input);
    await f.docs.upsertIssueDocument({ issueId: f.issueId, key: "report", format: "markdown", body: "New report", baseRevisionId: f.document.latestRevisionId });
    const current = await f.docs.getIssueDocumentByKey(f.issueId, "report");
    expect(current?.presentation).toBeNull(); expect(current?.presentationStale).toBe(true);
    const history = await f.docs.listIssueDocumentRevisions(f.issueId, "report");
    expect(history.find((r) => r.id === f.document.latestRevisionId)?.presentation?.attachmentId).toBe(f.attachmentId);
    await expect(f.svc.set(f.input)).rejects.toMatchObject({ status: 409 });
    await f.docs.restoreIssueDocumentRevision({ issueId: f.issueId, key: "report", revisionId: f.document.latestRevisionId! });
    const restored = await f.docs.getIssueDocumentByKey(f.issueId, "report");
    expect(restored?.body).toBe(f.document.body); expect(restored?.presentation).toBeNull();
  });
  it("rejects cross-company and cross-task attachments, wrong hashes and locked documents", async () => {
    const f = await fixture(), other = await fixture();
    await expect(f.svc.set({ ...f.input, attachmentId: other.attachmentId })).rejects.toMatchObject({ status: 404 });
    await expect(f.svc.set({ ...f.input, attachmentSha256: "b".repeat(64) })).rejects.toMatchObject({ status: 409 });
    const otherIssue = randomUUID(); await db.insert(issues).values({ id: otherIssue, companyId: f.companyId, title: "Private" });
    await db.update(issueAttachments).set({ issueId: otherIssue }).where(eq(issueAttachments.id, f.attachmentId));
    await expect(f.svc.set(f.input)).rejects.toMatchObject({ status: 404 });
    await f.docs.lockIssueDocument({ issueId: f.issueId, key: "report", lockedByUserId: "local-board" });
    await expect(f.svc.set(f.input)).rejects.toMatchObject({ status: 409 });
  });
  it("freezes review evidence including unbind and clears references on document deletion", async () => {
    const f = await fixture(); const bound = await f.svc.set(f.input);
    const review = await issueThreadInteractionService(db).create({ id: f.issueId, companyId: f.companyId }, {
      kind: "request_confirmation", continuationPolicy: "none",
      payload: { version: 1, prompt: "Review", target: { type: "issue_document", key: "report", revisionId: f.document.latestRevisionId! } },
    }, { userId: "local-board" });
    expect((review.payload as { target?: { presentationSha256?: string } }).target?.presentationSha256).toBe(f.input.attachmentSha256);
    await expect(f.svc.set({ ...f.input, attachmentId: null, attachmentSha256: null, baseVersion: bound.version })).rejects.toMatchObject({ status: 409 });
    await f.docs.deleteIssueDocument(f.issueId, "report");
    expect(await db.select().from(documentPresentations).where(eq(documentPresentations.documentId, f.document.id))).toEqual([]);
  });
});
