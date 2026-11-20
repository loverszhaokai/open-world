// @vitest-environment jsdom
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { MarkdownSnippet } from "./MarkdownSnippet";

function render(text: string, needle: string) {
  const container = document.createElement("div");
  const start = text.indexOf(needle);
  container.innerHTML = renderToStaticMarkup(<a href="/task"><MarkdownSnippet
    text={text} highlights={[{ start, end: start + needle.length }]} /></a>);
  return container;
}

describe("Markdown search snippets", () => {
  it("removes formatting and link destinations while keeping source-offset highlights", () => {
    const el = render("## Plan\n\n**Launch** the [needle](https://example.com) now.", "needle");
    expect(el.textContent).toContain("Launch the needle now.");
    expect(el.textContent).not.toContain("https://");
    expect(el.textContent).not.toContain("**");
    expect(el.querySelector("mark")?.textContent).toBe("needle");
    expect(el.querySelector("a a")).toBeNull();
  });
  it("maps decoded entities and escaped punctuation without shifting later matches", () => {
    const text = "A &amp; B \\*literal\\* 中文😀 needle";
    const el = render(text, "needle");
    expect(el.textContent).toContain("A & B *literal* 中文😀 needle");
    expect(el.querySelector("mark")?.textContent).toBe("needle");
    expect(render(text, "&amp;").querySelector("mark")?.textContent).toBe("&");
  });
  it("retains code text and highlights matches inside inline and fenced code", () => {
    expect(render("Use `needle()` here", "needle").querySelector("mark")?.textContent).toBe("needle");
    expect(render("```js\nneedle()\n```", "needle").querySelector("mark")?.textContent).toBe("needle");
  });
  it("does not expose raw HTML, images, or active links", () => {
    const el = render('**needle** <img src=x onerror=alert(1)> [bad](javascript:alert%281%29)', "needle");
    expect(el.querySelector("img,script")).toBeNull();
    expect(el.querySelector("a a")).toBeNull();
    expect(el.querySelector("mark")?.textContent).toBe("needle");
  });
  it("separates headings and table cells in an inline summary", () => {
    const el = render("## Plan\n\n| Item | Result |\n| --- | --- |\n| needle | done |", "needle");
    expect(el.textContent?.replace(/\s+/g, " ")).toContain("Plan Item Result needle done");
    expect(el.textContent).not.toContain("|");
    expect(el.querySelector("mark")?.textContent).toBe("needle");
  });
  it("merges overlapping marks and ignores invalid ranges", () => {
    const html = renderToStaticMarkup(<MarkdownSnippet text="**needle**" highlights={[
      {start: 2, end: 5}, {start: 4, end: 8}, {start: 50, end: 90},
      {start: NaN, end: 8}, {start: 7, end: 3},
    ]} />);
    const el = document.createElement("div");
    el.innerHTML = html;
    expect(el.querySelectorAll("mark")).toHaveLength(1);
    expect(el.querySelector("mark")?.textContent).toBe("needle");
  });
});
