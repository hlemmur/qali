const GENERATED_COMMENT = /^<!-- qali:generated[\s\S]*?-->\s*/;

export function stripGeneratedMarker(markdown: string): string {
  return markdown.replace(GENERATED_COMMENT, '').trim();
}

function bulletsAfterHeading(markdown: string, heading: RegExp): string[] {
  const match = heading.exec(markdown);
  if (!match || match.index === undefined) return [];
  const rest = markdown.slice(match.index + match[0].length);
  const next = rest.search(/^## /m);
  const section = next >= 0 ? rest.slice(0, next) : rest;
  return [...section.matchAll(/^(?:[-*]|\d+\.)\s+\*?\*?(.+?)\*?\*?\s*$/gm)]
    .map((entry) => entry[1]!.replace(/\*\*/g, '').trim())
    .filter(Boolean);
}

function tableRowsAfterHeading(markdown: string, heading: RegExp): string[] {
  const match = heading.exec(markdown);
  if (!match || match.index === undefined) return [];
  const rest = markdown.slice(match.index + match[0].length);
  const next = rest.search(/^## /m);
  const section = next >= 0 ? rest.slice(0, next) : rest;
  return [...section.matchAll(/^\| ([^|]+) \| ([^|]+) \|/gm)]
    .map((entry) => `${entry[1]!.trim()}: ${entry[2]!.trim()}`)
    .filter(
      (row) => !row.startsWith('---') && !/^id\s*:/i.test(row) && !/^question\s*:/i.test(row)
    );
}

export function parseExplorationDebrief(markdown: string): {
  debriefMarkdown: string;
  truncated: boolean;
  verdict?: string;
  findings: string[];
  questions: string[];
  nextActions: string[];
} {
  const debriefMarkdown = stripGeneratedMarker(markdown);
  const truncated = /\btruncated\b/i.test(debriefMarkdown.slice(0, 2_000));
  const paragraphs = debriefMarkdown
    .split(/\n\s*\n/)
    .map((block) =>
      block
        .replace(/^#+\s+/, '')
        .replace(/\s+/g, ' ')
        .trim()
    )
    .filter((block) => block.length > 40 && !block.startsWith('|') && !block.startsWith('- '));
  const verdict = paragraphs[1] ?? paragraphs[0];
  const findings = bulletsAfterHeading(debriefMarkdown, /^## Findings\b/m).slice(0, 12);
  const questions = tableRowsAfterHeading(debriefMarkdown, /^## Open questions\b/m).slice(0, 8);
  const nextActions = bulletsAfterHeading(debriefMarkdown, /^## Next actions\b/m).slice(0, 6);
  return {
    debriefMarkdown,
    truncated,
    ...(verdict ? { verdict } : {}),
    findings,
    questions,
    nextActions
  };
}

function inlineMarkdown(value: string): string {
  return escapeHtml(value)
    .replaceAll(/`([^`]+)`/g, '<code>$1</code>')
    .replaceAll(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>');
}

function escapeHtml(value: string): string {
  return value
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;');
}

export function renderMarkdownToHtml(markdown: string): string {
  const lines = stripGeneratedMarker(markdown).split('\n');
  const html: string[] = [];
  let paragraph: string[] = [];
  let list: string[] = [];
  let table: string[][] = [];
  const flushParagraph = () => {
    if (!paragraph.length) return;
    html.push(`<p>${inlineMarkdown(paragraph.join(' '))}</p>`);
    paragraph = [];
  };
  const flushList = () => {
    if (!list.length) return;
    html.push(`<ul>${list.map((item) => `<li>${inlineMarkdown(item)}</li>`).join('')}</ul>`);
    list = [];
  };
  const flushTable = () => {
    if (!table.length) return;
    const rows = table.filter((row) => !row.every((cell) => /^:?-+:?$/.test(cell)));
    table = [];
    if (rows.length === 0) return;
    const [header, ...body] = rows;
    html.push(
      `<table><thead><tr>${header!.map((cell) => `<th>${inlineMarkdown(cell)}</th>`).join('')}</tr></thead>${
        body.length
          ? `<tbody>${body
              .map(
                (row) =>
                  `<tr>${row.map((cell) => `<td>${inlineMarkdown(cell)}</td>`).join('')}</tr>`
              )
              .join('')}</tbody>`
          : ''
      }</table>`
    );
  };
  for (const line of lines) {
    const heading = line.match(/^(#{1,3})\s+(.+)$/);
    if (heading) {
      flushParagraph();
      flushList();
      flushTable();
      const level = heading[1]!.length;
      html.push(`<h${level}>${inlineMarkdown(heading[2]!)}</h${level}>`);
      continue;
    }
    const tableRow = line.match(/^\|(.+)\|$/);
    if (tableRow) {
      flushParagraph();
      flushList();
      table.push(tableRow[1]!.split('|').map((cell) => cell.trim()));
      continue;
    }
    const bullet = line.match(/^[-*]\s+(.+)$/) ?? line.match(/^\d+\.\s+(.+)$/);
    if (bullet) {
      flushParagraph();
      flushTable();
      list.push(bullet[1]!);
      continue;
    }
    if (!line.trim()) {
      flushParagraph();
      flushList();
      flushTable();
      continue;
    }
    flushList();
    flushTable();
    paragraph.push(line.trim());
  }
  flushParagraph();
  flushList();
  flushTable();
  return html.join('\n');
}
