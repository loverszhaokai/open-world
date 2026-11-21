/** HTML previews are documents, never nodes in the Paperclip DOM. */
export function isHtmlPreview(contentType: string | null | undefined, filename: string | null | undefined) {
  const type = contentType?.toLowerCase().split(";")[0].trim();
  return type === "text/html" || type === "application/xhtml+xml" || /\.html?$/i.test(filename ?? "");
}

// Inline scripts support self-contained reports/charts. No origin privileges,
// external scripts, API calls, forms, embeds, or remote subresources are granted.
// Multiple CSPs intersect; artifact markup cannot loosen this first policy.
export const HTML_PREVIEW_CSP = [
  "default-src 'none'",
  "script-src 'unsafe-inline'",
  "style-src 'unsafe-inline'",
  "img-src data:",
  "font-src data:",
  "media-src data:",
  "connect-src 'none'",
  "frame-src 'none'",
  "object-src 'none'",
  "base-uri 'none'",
  "form-action 'none'",
].join("; ");

export function htmlPreviewDocument(html: string) {
  // Install the policy before ANY untrusted markup is parsed. Do not parse the
  // artifact in the host document (even detached DOMs can load resources).
  return `<!doctype html><html><head><meta charset="utf-8"><meta http-equiv="Content-Security-Policy" content="${HTML_PREVIEW_CSP}"><meta name="referrer" content="no-referrer"></head><body>${html}</body></html>`;
}

/** A trusted outer document constrains navigation of the untrusted inner frame.
 * CSP on the artifact alone does not block location.replace() on its own frame.
 * srcdoc is permitted with frame-src 'none', but remote frame navigations are not.
 * Both frames have opaque origins, so the artifact cannot change the wrapper.
 */
export function htmlPreviewSandboxDocument(html: string) {
  const inner = htmlPreviewDocument(html)
    .replaceAll("&", "&amp;").replaceAll('"', "&quot;").replaceAll("<", "&lt;");
  return `<!doctype html><html><head><meta charset="utf-8"><meta http-equiv="Content-Security-Policy" content="${HTML_PREVIEW_CSP}"><meta name="referrer" content="no-referrer"><style>html,body{margin:0;height:100%;overflow:hidden}iframe{display:block;width:100%;height:100%;border:0}</style></head><body><iframe title="Interactive HTML content" sandbox="allow-scripts" referrerpolicy="no-referrer" srcdoc="${inner}"></iframe></body></html>`;
}
