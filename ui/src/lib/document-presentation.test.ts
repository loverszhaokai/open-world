import { describe, expect, it } from "vitest";
import { setDocumentPresentationSchema } from "@paperclipai/shared";

describe("presentation contract", () => {
  const revision = "1c42a134-c9ab-4d7c-9df6-829af8dc0011";
  const attachment = "2c42a134-c9ab-4d7c-9df6-829af8dc0011";
  it("requires explicit CAS and a paired attachment/hash, never a URL", () => {
    expect(setDocumentPresentationSchema.safeParse({ documentRevisionId: revision, attachmentId: attachment, attachmentSha256: "a".repeat(64), baseVersion: null }).success).toBe(true);
    expect(setDocumentPresentationSchema.safeParse({ documentRevisionId: revision, attachmentId: null, attachmentSha256: null, baseVersion: null }).success).toBe(true);
    expect(setDocumentPresentationSchema.safeParse({ documentRevisionId: revision, attachmentId: attachment, attachmentSha256: null, baseVersion: null }).success).toBe(false);
    expect(setDocumentPresentationSchema.safeParse({ documentRevisionId: revision, attachmentId: attachment, attachmentSha256: "a".repeat(64) }).success).toBe(false);
    expect(setDocumentPresentationSchema.safeParse({ documentRevisionId: revision, attachmentId: "https://example.com/report", attachmentSha256: "a".repeat(64), baseVersion: null }).success).toBe(false);
  });
});
