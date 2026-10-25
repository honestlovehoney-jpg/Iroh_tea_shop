import type { ReactNode } from 'react';

function inline(text: string): ReactNode[] {
  const tokens: ReactNode[] = [];
  const pattern =
    /(\*\*([^*]+)\*\*|\*([^*]+)\*|`([^`]+)`|\[([^\]]+)\]\(([^)]+)\))/g;
  let at = 0;
  for (const match of text.matchAll(pattern)) {
    const index = match.index ?? 0;
    if (index > at) tokens.push(text.slice(at, index));
    const key = index;
    if (match[2]) tokens.push(<strong key={key}>{match[2]}</strong>);
    else if (match[3]) tokens.push(<em key={key}>{match[3]}</em>);
    else if (match[4]) tokens.push(<code key={key}>{match[4]}</code>);
    else if (match[5]) {
      const href = match[6];
      tokens.push(
        /^https?:\/\//i.test(href) ? (
          <a key={key} href={href} target="_blank" rel="noopener noreferrer">
            {match[5]}
          </a>
        ) : (
          match[0]
        ),
      );
    }
    at = index + match[0].length;
  }
  if (at < text.length) tokens.push(text.slice(at));
  return tokens;
}

// Uncle's five section labels are shown in bold so a long answer is easy to scan.
const SECTION_LABEL =
  /^(Verdict|Evidence for|Evidence against|What would change this view|Data gaps):\s*(.*)$/;

function line(text: string): ReactNode[] {
  const label = text.match(SECTION_LABEL);
  if (!label) return inline(text);
  return [
    <strong key="label" className="iroh-label">
      {label[1]}:
    </strong>,
    ' ',
    ...inline(label[2]),
  ];
}

const isBullet = (text: string) => /^\s*[-*] /.test(text);
const isNumber = (text: string) => /^\s*\d+\. /.test(text);
const stripMarker = (text: string) => text.replace(/^\s*(?:[-*]|\d+\.) /, '');

function renderBlock(block: string, index: number): ReactNode[] {
  const lines = block.split('\n');
  // Answers often put a blank line between items, so each one is its own
  // block: keep counting from the block's first number.
  if (lines.every(isNumber)) {
    return [
      <ol key={`${index}`} start={parseInt(lines[0], 10)}>
        {lines.map((text, i) => (
          <li key={i}>{inline(stripMarker(text))}</li>
        ))}
      </ol>,
    ];
  }
  // A label line followed by hyphen bullets becomes a heading line plus a real list.
  const out: ReactNode[] = [];
  let at = 0;
  let key = 0;
  while (at < lines.length) {
    if (isBullet(lines[at])) {
      const items: string[] = [];
      while (at < lines.length && isBullet(lines[at])) items.push(lines[at++]);
      out.push(
        <ul key={`${index}-${key++}`}>
          {items.map((text, i) => (
            <li key={i}>{inline(stripMarker(text))}</li>
          ))}
        </ul>,
      );
    } else {
      const text: string[] = [];
      while (at < lines.length && !isBullet(lines[at])) text.push(lines[at++]);
      out.push(
        <p key={`${index}-${key++}`}>
          {text.map((item, i) => (
            <span key={i}>
              {i > 0 && <br />}
              {line(item)}
            </span>
          ))}
        </p>,
      );
    }
  }
  return out;
}

export function IrohMessage({ content }: { content: string }) {
  const blocks = content.trim().split(/\n\s*\n/);
  return (
    <div className="iroh-markdown">
      {blocks.flatMap((block, index) => renderBlock(block, index))}
    </div>
  );
}
