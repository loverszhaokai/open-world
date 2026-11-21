import type { Meta, StoryObj } from "@storybook/react-vite";
import { IssueDocumentsSection } from "@/components/IssueDocumentsSection";
import { storybookIssues, storybookIssueDocuments } from "../../../fixtures/paperclipData";
import { prepareFixtureApi } from "../../../support/capability-gaps/api";
const html = '<h1>Decision diagram</h1><button onclick="this.textContent=\'Scenario B\'">Scenario A</button>';
const meta = {
  id: "html-artifacts-04-document",
  title: "Tasks and conversations/Documents, attachments, and work products/HTML artifacts/04 Document presentation",
  component: IssueDocumentsSection,
  args: { issue: storybookIssues[0], canDeleteDocuments: true },
  parameters: { layout: "padded", paperclip: { capabilities: ["documents-artifacts/documents"], implementation: "production", boundary: "fixtures" } },
  beforeEach: ({ parameters }) => {
    const presentation = { documentRevisionId: "revision-2", attachmentId: "visual", attachmentSha256: "a".repeat(64), version: "visual-version", kind: "html" as const };
    const doc = { ...storybookIssueDocuments[0], body: "# Complete report\n\nFull evidence and sources remain readable.\n\n## Sources\n\nCanonical source text.",
      latestRevisionId: "revision-2", latestRevisionNumber: 2,
      presentation: parameters.stale || parameters.absent ? null : presentation, presentationStale: parameters.stale };
    const history = [2, 1].map((n) => ({ ...doc, id: `revision-${n}`, documentId: doc.id, revisionNumber: n,
      body: n === 1 ? "# Historical report\n\nHistorical evidence." : doc.body,
      presentation: { ...presentation, documentRevisionId: `revision-${n}` }, changeSummary: "Report" }));
    return prepareFixtureApi([
      { path: `/api/issues/${doc.issueId}/documents`, read: () => [doc] },
      { path: `/api/issues/${doc.issueId}/documents/${doc.key}`, read: () => doc },
      { path: `/api/issues/${doc.issueId}/documents/${doc.key}/revisions`, read: () => history },
      { path: "/api/attachments/visual/content", read: () => parameters.failed
        ? Response.json({ error: "Missing visual" }, { status: 404 }) : new Response(html) },
    ]).cleanup;
  },
} satisfies Meta<typeof IssueDocumentsSection>;
export default meta;
type Story = StoryObj<typeof meta>;
export const Current: Story = {};
export const Stale: Story = { parameters: { stale: true } };
export const Missing: Story = { parameters: { failed: true } };
export const WithoutDiagram: Story = { parameters: { absent: true } };
