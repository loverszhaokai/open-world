import { randomUUID } from "node:crypto";
import { and, eq, inArray, sql } from "drizzle-orm";
import { assets, documentPresentations, documents, issueAttachments, issueDocuments, issues, issueThreadInteractions, type Db } from "@paperclipai/db";
import type { DocumentPresentation } from "@paperclipai/shared";
import { conflict, notFound, unprocessable } from "../errors.js";
import { logActivity, type LogActivityInput } from "./activity-log.js";

export function presentationMetadata(row: typeof documentPresentations.$inferSelect): DocumentPresentation {
  return { documentRevisionId: row.documentRevisionId, attachmentId: row.attachmentId,
    attachmentSha256: row.attachmentSha256, version: row.version, kind: "html" };
}

export function documentPresentationService(db: Db) {
  return {
    // One bounded query for a document list, including tombstones and historical bindings.
    list: async (documentIds: string[]) => documentIds.length ? db.select().from(documentPresentations)
      .where(inArray(documentPresentations.documentId, documentIds)) : [],
    set: async (input: {
      issueId: string; companyId: string; key: string; documentRevisionId: string;
      attachmentId: string | null; attachmentSha256: string | null; baseVersion: string | null;
      actor: Pick<LogActivityInput, "actorType" | "actorId" | "agentId" | "runId" | "agentApiKeyId">;
    }) => db.transaction(async (tx) => {
      // Match interaction creation's issue -> document lock order.
      const [issue] = await tx.select().from(issues).where(and(eq(issues.id, input.issueId), eq(issues.companyId, input.companyId))).for("update");
      if (!issue) throw notFound("Issue not found");
      const [doc] = await tx.select({ id: documents.id, revision: documents.latestRevisionId, lockedAt: documents.lockedAt })
        .from(issueDocuments).innerJoin(documents, eq(documents.id, issueDocuments.documentId))
        .where(and(eq(issueDocuments.issueId, issue.id), eq(issueDocuments.key, input.key), eq(documents.companyId, input.companyId)))
        .for("update", { of: documents });
      if (!doc) throw notFound("Document not found");
      if (doc.lockedAt) throw conflict("Document is locked");
      if (doc.revision !== input.documentRevisionId) throw conflict("Presentation must reference the current document revision");
      // Once a revision has been offered for review its visual evidence is frozen,
      // including rejected/expired requests. Save a new Markdown revision to revise it.
      const [review] = await tx.select({ id: issueThreadInteractions.id }).from(issueThreadInteractions)
        .where(and(eq(issueThreadInteractions.companyId, input.companyId),
          sql`${issueThreadInteractions.payload}->'target'->>'type' = 'issue_document'`,
          sql`${issueThreadInteractions.payload}->'target'->>'revisionId' = ${input.documentRevisionId}`)).limit(1);
      if (review) throw conflict("This revision has review evidence; save a new document revision before changing its presentation");
      const [previous] = await tx.select().from(documentPresentations).where(and(
        eq(documentPresentations.documentId, doc.id), eq(documentPresentations.documentRevisionId, input.documentRevisionId)));
      if ((previous?.version ?? null) !== input.baseVersion) throw conflict("Presentation changed", { currentVersion: previous?.version ?? null });
      if (input.attachmentId) {
        const [attachment] = await tx.select({ companyId: issueAttachments.companyId, issueId: issueAttachments.issueId,
          assetCompanyId: assets.companyId, hash: assets.sha256, type: assets.contentType, size: assets.byteSize })
          .from(issueAttachments).innerJoin(assets, eq(assets.id, issueAttachments.assetId))
          .where(eq(issueAttachments.id, input.attachmentId)).for("update", { of: issueAttachments });
        // Same-task attachments inherit exactly the document's read audience. Cross-task
        // sharing is deliberately unsupported, even when the current writer can read both.
        if (!attachment || attachment.companyId !== input.companyId || attachment.assetCompanyId !== input.companyId || attachment.issueId !== issue.id)
          throw notFound("Attachment not found on this issue");
        if (attachment.type.split(";")[0].trim().toLowerCase() !== "text/html" || attachment.size > 2 * 1024 * 1024)
          throw unprocessable("Presentation must be text/html and at most 2 MiB");
        if (attachment.hash !== input.attachmentSha256) throw conflict("Attachment SHA-256 does not match");
      } else if (input.attachmentSha256 !== null) throw unprocessable("Unbound presentation cannot have a hash");
      const values = { companyId: input.companyId, documentId: doc.id, documentRevisionId: input.documentRevisionId,
        attachmentId: input.attachmentId, attachmentSha256: input.attachmentSha256, version: randomUUID(), updatedAt: new Date(),
        createdByAgentId: input.actor.agentId ?? null, createdByUserId: input.actor.actorType === "user" ? input.actor.actorId : null };
      const [saved] = previous
        ? await tx.update(documentPresentations).set(values).where(eq(documentPresentations.id, previous.id)).returning()
        : await tx.insert(documentPresentations).values(values).returning();
      await logActivity(tx as unknown as Db, { ...input.actor, companyId: input.companyId, entityType: "issue", entityId: issue.id,
        action: "issue.document_presentation_updated", details: { key: input.key, documentId: doc.id,
          before: previous ? presentationMetadata(previous) : null, after: presentationMetadata(saved) } });
      return presentationMetadata(saved);
    }),
  };
}
