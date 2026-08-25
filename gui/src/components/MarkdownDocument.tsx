import { Fragment, type ReactNode } from "react";

function inlineMarkdown(source: string, keyPrefix: string): ReactNode[] {
  const tokens = source.split(/(`[^`\n]+`|\*\*[^*\n]+\*\*|\*[^*\n]+\*|\[[^\]\n]+\]\(https?:\/\/[^\s)]+\))/g);
  return tokens.filter(Boolean).map((token, index) => {
    const key = `${keyPrefix}-${index}`;
    if (token.startsWith("`") && token.endsWith("`")) {
      return <code key={key}>{token.slice(1, -1)}</code>;
    }
    if (token.startsWith("**") && token.endsWith("**")) {
      return <strong key={key}>{token.slice(2, -2)}</strong>;
    }
    if (token.startsWith("*") && token.endsWith("*")) {
      return <em key={key}>{token.slice(1, -1)}</em>;
    }
    const link = /^\[([^\]]+)\]\((https?:\/\/[^\s)]+)\)$/.exec(token);
    if (link) {
      return <a key={key} href={link[2]} target="_blank" rel="noreferrer">{link[1]}</a>;
    }
    return <Fragment key={key}>{token}</Fragment>;
  });
}

function isBlockStart(lines: string[], index: number): boolean {
  const line = lines[index] ?? "";
  return /^```/.test(line)
    || /^#{1,6}\s+/.test(line)
    || /^\s*([-*+] |\d+\. )/.test(line)
    || /^>\s?/.test(line)
    || /^\s*((-{3,})|(\*{3,})|(_{3,}))\s*$/.test(line)
    || (index + 1 < lines.length && /^\s*\|?\s*:?-{3,}/.test(lines[index + 1] ?? ""));
}

function tableCells(line: string): string[] {
  return line.trim().replace(/^\||\|$/g, "").split("|").map(cell => cell.trim());
}

/**
 * Small, dependency-free Markdown renderer for local Codex thread exports.
 * Raw HTML is intentionally rendered as text; thread content never enters the DOM as HTML.
 */
export function MarkdownDocument({ source }: { source: string }) {
  const lines = source.replace(/\r\n?/g, "\n").split("\n");
  const blocks: ReactNode[] = [];
  let index = 0;

  while (index < lines.length) {
    const line = lines[index] ?? "";
    if (!line.trim()) {
      index += 1;
      continue;
    }

    const fence = /^```\s*([^\s`]*)\s*$/.exec(line);
    if (fence) {
      const body: string[] = [];
      index += 1;
      while (index < lines.length && !/^```\s*$/.test(lines[index] ?? "")) {
        body.push(lines[index] ?? "");
        index += 1;
      }
      if (index < lines.length) index += 1;
      blocks.push(
        <pre key={`code-${blocks.length}`}><code data-language={fence[1] || undefined}>{body.join("\n")}</code></pre>,
      );
      continue;
    }

    const heading = /^(#{1,6})\s+(.+)$/.exec(line);
    if (heading) {
      const level = heading[1].length;
      const children = inlineMarkdown(heading[2], `heading-${blocks.length}`);
      if (level === 1) blocks.push(<h1 key={`heading-${blocks.length}`}>{children}</h1>);
      else if (level === 2) blocks.push(<h2 key={`heading-${blocks.length}`}>{children}</h2>);
      else if (level === 3) blocks.push(<h3 key={`heading-${blocks.length}`}>{children}</h3>);
      else if (level === 4) blocks.push(<h4 key={`heading-${blocks.length}`}>{children}</h4>);
      else if (level === 5) blocks.push(<h5 key={`heading-${blocks.length}`}>{children}</h5>);
      else blocks.push(<h6 key={`heading-${blocks.length}`}>{children}</h6>);
      index += 1;
      continue;
    }

    if (/^\s*((-{3,})|(\*{3,})|(_{3,}))\s*$/.test(line)) {
      blocks.push(<hr key={`rule-${blocks.length}`} />);
      index += 1;
      continue;
    }

    if (index + 1 < lines.length && /^\s*\|?\s*:?-{3,}/.test(lines[index + 1] ?? "")) {
      const header = tableCells(line);
      index += 2;
      const rows: string[][] = [];
      while (index < lines.length && (lines[index] ?? "").includes("|") && (lines[index] ?? "").trim()) {
        rows.push(tableCells(lines[index] ?? ""));
        index += 1;
      }
      blocks.push(
        <div className="desktop-markdown__table-wrap" key={`table-${blocks.length}`}>
          <table>
            <thead><tr>{header.map((cell, cellIndex) => <th key={cellIndex}>{inlineMarkdown(cell, `th-${blocks.length}-${cellIndex}`)}</th>)}</tr></thead>
            <tbody>{rows.map((row, rowIndex) => (
              <tr key={rowIndex}>{row.map((cell, cellIndex) => <td key={cellIndex}>{inlineMarkdown(cell, `td-${blocks.length}-${rowIndex}-${cellIndex}`)}</td>)}</tr>
            ))}</tbody>
          </table>
        </div>,
      );
      continue;
    }

    const unordered = /^\s*[-*+]\s+(.+)$/.exec(line);
    const ordered = /^\s*\d+\.\s+(.+)$/.exec(line);
    if (unordered || ordered) {
      const items: string[] = [];
      const matcher = unordered ? /^\s*[-*+]\s+(.+)$/ : /^\s*\d+\.\s+(.+)$/;
      while (index < lines.length) {
        const match = matcher.exec(lines[index] ?? "");
        if (!match) break;
        items.push(match[1]);
        index += 1;
      }
      const children = items.map((item, itemIndex) => <li key={itemIndex}>{inlineMarkdown(item, `li-${blocks.length}-${itemIndex}`)}</li>);
      blocks.push(unordered
        ? <ul key={`list-${blocks.length}`}>{children}</ul>
        : <ol key={`list-${blocks.length}`}>{children}</ol>);
      continue;
    }

    if (/^>\s?/.test(line)) {
      const quote: string[] = [];
      while (index < lines.length && /^>\s?/.test(lines[index] ?? "")) {
        quote.push((lines[index] ?? "").replace(/^>\s?/, ""));
        index += 1;
      }
      blocks.push(<blockquote key={`quote-${blocks.length}`}>{inlineMarkdown(quote.join("\n"), `quote-${blocks.length}`)}</blockquote>);
      continue;
    }

    const paragraph: string[] = [];
    while (index < lines.length && (lines[index] ?? "").trim() && !isBlockStart(lines, index)) {
      paragraph.push(lines[index] ?? "");
      index += 1;
    }
    if (paragraph.length === 0) {
      paragraph.push(line);
      index += 1;
    }
    blocks.push(<p key={`paragraph-${blocks.length}`}>{inlineMarkdown(paragraph.join("\n"), `paragraph-${blocks.length}`)}</p>);
  }

  return <div className="desktop-markdown">{blocks}</div>;
}
