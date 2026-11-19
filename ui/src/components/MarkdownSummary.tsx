import ReactMarkdown from "react-markdown";

/** Non-interactive, inline summary for rows that are already links. */
export function MarkdownSummary({ children }: { children: string }) {
  return <ReactMarkdown
    skipHtml
    allowedElements={["p", "strong", "em", "del", "code", "a"]}
    unwrapDisallowed
    components={{
      p: ({ children }) => <span>{children} </span>,
      a: ({ children }) => <span>{children}</span>,
      code: ({ children }) => <span>{children}</span>,
    }}
  >{children}</ReactMarkdown>;
}
