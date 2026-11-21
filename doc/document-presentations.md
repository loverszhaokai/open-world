# Revision-bound report diagrams

Markdown remains the complete, authoritative report. A self-contained HTML attachment
on the **same task** supplies the visual layer. Save the Markdown, upload the HTML,
then PUT `/api/issues/:id/documents/:key/presentation` with:

```json
{"documentRevisionId":"exact-current-uuid","attachmentId":"attachment-uuid","attachmentSha256":"64-lowercase-hex","baseVersion":null}
```

Use the version returned by a document GET for replacement. To unbind, send null
attachmentId/hash and the current version. Unbinding preserves a version token;
old writers cannot overwrite it. Wrong revisions/hashes/versions return 409;
foreign-task attachments return 404. Only text/html up to 2 MiB is supported.
The existing read, mutation and run-context permission gates apply. No external URL
or cross-task attachment can be bound. Source trust remains on the canonical document.

The document service owns association lifetime. New body revisions and restore operations
never copy visual bindings: they show the complete report with “diagram awaiting update”.
Historical revisions retain their diagrams. Locked documents reject presentation changes.
Once a revision has been submitted as a review target, its diagram is frozen, including
when that review was rejected/expired. Save a new body revision before revising evidence.
Review creation captures the diagram hash under the document lock. Referenced attachments
cannot be deleted; deleting the document removes its presentation references. Attachment
metadata deletion commits before object deletion, so a rejected deletion cannot destroy
referenced bytes. Restoring a body creates a new revision with a recorded source revision.

UI uses the existing opaque-origin iframe, restrictive CSP and native Markdown below.
A trusted opaque outer frame also blocks navigation of the untrusted inner frame;
CSP inside an artifact alone cannot prevent its own location navigation. Both frames
remain sandboxed without same-origin privileges.
Height is bounded, with a user-operated expansion; there is no resize message bridge.
Verified content requests hash actual bytes server-side, including on HTTP installations.
Failed/missing/mismatched visual files leave full Markdown accessible. Copy report still
copies Markdown. Current bound visual attachments/work products are omitted from the
aggregate card list; original attachments remain available on the task and by download.

## Producer helper and explicit sample migration

`node scripts/document-presentations/deliver.mjs manifest.json` validates a manifest
without network writes. Add `--apply` only in an authorized migration/release run.
The exported `deliverReport` accepts optional Markdown and performs save/upload/bind.
It stops on conflicting revisions; never automatically retries a 409. Repeated identical
content reuses an existing binding or attachment hash, including recovery after upload.
If a Markdown save succeeded but its receipt was lost, read and reconcile the new revision
and update the manifest explicitly before resuming; matching text never substitutes for
revision identity.

```json
[
  {"issueId":"PEN-134","key":"report","expectedRevisionId":"REPLACE_AFTER_READING_CURRENT_DOCUMENT","htmlPath":"acquisition-visual.html"},
  {"issueId":"PEN-46","key":"plan","expectedRevisionId":"REPLACE_AFTER_READING_CURRENT_DOCUMENT","htmlPath":"push-visual.html"}
]
```

The parent task supplies current sample bodies and re-authored **visual-only** HTML.
Do not extract or truncate old HTML, guess a binding from its first link, or rewrite
business approval states. Use 3–5 labeled visual units, keyboard controls, data provenance
labels, and bundled dependencies. Keep sources and all detailed prose in Markdown.
A locked/reviewed Push revision requires an explicitly authorized new document revision;
this helper does not unlock it or change business approval.

## Release and rollback

Apply generated migration 0377 using normal release migration procedures. No backfill
runs. Deploy API and UI together. First run the manifest without --apply; then migrate
only after parent-owned release conditions are met. Verify both actual document deep links
and aggregate entry points, mobile layout, interaction, history, download and full copy.
These live checks are separate from local test evidence.

Before rollback, stop presentation writes. Older code can ignore the additive table;
retain it, attachments and historical evidence. Do not drop data or undo review records.
If reverting presentation content, use the versioned API on an editable revision. Pending
or completed review evidence requires a new document revision, not an in-place rollback.
