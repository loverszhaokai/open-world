import type { ReactNode } from "react";
import remarkGfm from "remark-gfm";
import ReactMarkdown from "react-markdown";
import { decodeString } from "micromark-util-decode-string";
import type { HighlightedTextProps } from "./HighlightedText";

type Node = {
  type: string;
  value?: string;
  children?: Node[];
  position?: { start: { offset?: number }; end: { offset?: number } };
  data?: unknown;
};

const markClass = "rounded-sm bg-yellow-200/60 px-0.5 text-foreground dark:bg-yellow-300/30";

/** Map rendered UTF-16 units back to source offsets, including escaped punctuation and entities. */
function textOffsets(raw: string, offset: number, value: string, code: boolean) {
  const units: Array<{ start: number; end: number }> = [];
  let decoded = "";
  const tokens = code
    ? /\r\n|[\s\S]/g
    : /\\[!"#$%&'()*+,\-./:;<=>?@[\\\]^_`{|}~]|&(?:#[xX][0-9a-fA-F]{1,6}|#[0-9]{1,7}|[a-zA-Z][a-zA-Z0-9]+);|\r\n|[\s\S]/g;
  for (const match of raw.matchAll(tokens)) {
    const token = match[0];
    const rendered = code ? token.replace(/\r\n/g, "\n") : decodeString(token).replace(/\r\n/g, "\n");
    decoded += rendered;
    for (let i = 0; i < rendered.length; i++) {
      units.push({ start: offset + match.index!, end: offset + match.index! + token.length });
    }
  }
  // Unsupported normalization must never shift a highlight onto the wrong word.
  if (decoded !== value) return null;
  return units;
}

function highlightMarkdown(text: string, highlights: HighlightedTextProps["highlights"]) {
  return () => (tree: Node) => {
    const visit = (node: Node) => {
      if (node.children) node.children.forEach(visit);
      if (!["text", "inlineCode", "code"].includes(node.type) || !node.value) return;
      const start = node.position?.start.offset;
      const end = node.position?.end.offset;
      if (start === undefined || end === undefined) return;
      let raw = text.slice(start, end);
      let offset = start;
      const code = node.type !== "text";
      if (code) {
        const contentStart = node.type === "inlineCode" ? (raw.match(/^`+/)?.[0].length ?? 0)
          : /^\s*(`{3,}|~{3,})/.test(raw) ? raw.indexOf("\n") + 1 : 0;
        const index = raw.indexOf(node.value, contentStart);
        if (index < 0) return;
        offset += index;
        raw = node.value;
      }
      const units = textOffsets(raw, offset, node.value, code);
      if (!units) return;
      const flags = units.map(unit => (highlights ?? []).some(range =>
        Number.isFinite(range.start) && Number.isFinite(range.end)
        && range.end > range.start && range.start < unit.end && range.end > unit.start));
      if (!flags.some(Boolean)) return;
      const children: Node[] = [];
      for (let from = 0; from < flags.length;) {
        let to = from + 1;
        while (to < flags.length && flags[to] === flags[from]) to++;
        const leaf: Node = { type: "text", value: node.value.slice(from, to) };
        children.push(flags[from]
          ? { type: "searchHighlight", data: { hName: "mark", hProperties: { className: markClass } }, children: [leaf] }
          : leaf);
        from = to;
      }
      node.type = "searchText";
      node.data = { hName: "span" };
      node.children = children;
      delete node.value;
    };
    visit(tree);
  };
}

const inlineBlock = ({ children }: { children?: ReactNode }) => <span>{children} </span>;

/** Search offsets refer to the original Markdown, not the rendered summary. */
export function MarkdownSnippet({ text, highlights, className }: HighlightedTextProps) {
  return <span className={className}>
    <ReactMarkdown
      skipHtml
      remarkPlugins={[remarkGfm, highlightMarkdown(text, highlights)]}
      allowedElements={["p", "strong", "em", "del", "code", "a", "span", "mark", "h1", "h2", "h3", "h4", "h5", "h6", "td", "th", "br"]}
      unwrapDisallowed
      components={{
        p: inlineBlock,
        h1: inlineBlock, h2: inlineBlock, h3: inlineBlock, h4: inlineBlock, h5: inlineBlock, h6: inlineBlock,
        td: inlineBlock, th: inlineBlock, br: () => <span> </span>,
        a: ({ children }) => <span>{children}</span>,
        code: ({ children }) => <span>{children}</span>,
      }}
    >{text}</ReactMarkdown>
  </span>;
}
