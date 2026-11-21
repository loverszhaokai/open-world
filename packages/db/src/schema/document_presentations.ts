import { pgTable, uuid, text, timestamp, uniqueIndex, index } from "drizzle-orm/pg-core";
import { companies } from "./companies.js";
import { documents } from "./documents.js";
import { documentRevisions } from "./document_revisions.js";
import { issueAttachments } from "./issue_attachments.js";
import { agents } from "./agents.js";

// A null attachment is an unbound tombstone: its token still fences stale writers.
export const documentPresentations = pgTable("document_presentations", {
  id: uuid("id").primaryKey().defaultRandom(),
  companyId: uuid("company_id").notNull().references(() => companies.id),
  documentId: uuid("document_id").notNull().references(() => documents.id, { onDelete: "cascade" }),
  documentRevisionId: uuid("document_revision_id").notNull().references(() => documentRevisions.id, { onDelete: "cascade" }),
  attachmentId: uuid("attachment_id").references(() => issueAttachments.id, { onDelete: "restrict" }),
  attachmentSha256: text("attachment_sha256"),
  kind: text("kind").notNull().default("html"),
  version: uuid("version").notNull().defaultRandom(),
  createdByAgentId: uuid("created_by_agent_id").references(() => agents.id, { onDelete: "set null" }),
  createdByUserId: text("created_by_user_id"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => ({
  revisionUq: uniqueIndex("document_presentations_revision_uq").on(t.documentId, t.documentRevisionId),
  attachmentIdx: index("document_presentations_attachment_idx").on(t.attachmentId),
  companyIdx: index("document_presentations_company_idx").on(t.companyId),
}));
