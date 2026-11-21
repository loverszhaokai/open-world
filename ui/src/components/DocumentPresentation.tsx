import { useEffect, useState } from "react";
import type { DocumentPresentation as Presentation } from "@paperclipai/shared";
import { requestResponse } from "@/api/client";
import { HtmlArtifactPreview } from "./HtmlArtifactPreview";
import { Button } from "@/components/ui/button";

export function DocumentPresentation({ presentation, stale, title, reportId }: {
  presentation?: Presentation | null; stale?: boolean; title: string; reportId: string;
}) {
  const [html, setHtml] = useState<string | null>(null);
  const [error, setError] = useState(false);
  const [expanded, setExpanded] = useState(false);
  const attachmentId = presentation?.attachmentId;
  const hash = presentation?.attachmentSha256;
  useEffect(() => {
    setHtml(null); setError(false);
    if (!attachmentId || !hash) return;
    const controller = new AbortController();
    void (async () => {
      const response = await requestResponse(`/attachments/${encodeURIComponent(attachmentId)}/content?expectedSha256=${hash}`, { signal: controller.signal });
      const bytes = await response.arrayBuffer();
      if (bytes.byteLength > 2 * 1024 * 1024) throw new Error("Presentation too large");
      if (!controller.signal.aborted) setHtml(new TextDecoder().decode(bytes));
    })().catch(() => { if (!controller.signal.aborted) setError(true); });
    return () => controller.abort();
  }, [attachmentId, hash, presentation?.version]);
  if (!attachmentId) return stale ? <p role="status" className="text-sm text-muted-foreground">Diagram awaiting update. The complete report is below.</p> : null;
  return <section aria-label="Interactive diagram" className="space-y-3 rounded-md border border-border p-3">
    <div className="flex flex-wrap items-center justify-between gap-2">
      <h3 className="text-sm font-medium">At a glance</h3>
      <div className="flex flex-wrap items-center gap-2">
        <a className="text-sm underline" href={`#${reportId}`}>Complete report</a>
        <a className="text-sm underline" href={`/api/attachments/${attachmentId}/content?download=1`}>Download diagram</a>
        <Button size="sm" variant="outline" aria-expanded={expanded} onClick={() => setExpanded(!expanded)}>{expanded ? "Collapse diagram" : "Expand diagram"}</Button>
      </div>
    </div>
    {error ? <p role="alert" className="text-sm text-muted-foreground">Diagram unavailable. Read the complete report below or download the diagram.</p>
      : html === null ? <p role="status" className="text-sm text-muted-foreground">Loading diagram…</p>
      : <div className={expanded ? "document-presentation-frame document-presentation-frame-expanded" : "document-presentation-frame"}>
        <HtmlArtifactPreview html={html} title={title} />
      </div>}
    <p className="text-xs text-muted-foreground">Diagram SHA-256: <code className="break-all">{hash}</code></p>
  </section>;
}
