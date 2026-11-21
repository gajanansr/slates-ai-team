/**
 * Turn what the rich note editor holds (HTML in a contentEditable) back into Markdown.
 * Blocks the editor cannot edit in place (charts, boards, images, voice clips, tables, code)
 * ride along untouched in a data-md attribute, so nothing an agent wrote is lost.
 */
const BLOCK = new Set(['P', 'DIV', 'H1', 'H2', 'H3', 'H4', 'H5', 'H6', 'UL', 'OL', 'BLOCKQUOTE', 'PRE', 'HR', 'TABLE']);

type El = { nodeType: number; nodeName: string; textContent: string | null; childNodes: ArrayLike<El>; getAttribute?: (n: string) => string | null };
const kids = (n: El) => Array.from(n.childNodes);
const attr = (n: El, name: string) => n.getAttribute?.(name) ?? null;

/** Keep the spaces outside the marks: "**word** " not "**word **". */
function mark(inner: string, m: string) {
  const r = /^(\s*)([\s\S]*?)(\s*)$/.exec(inner)!;
  return r[2] ? `${r[1]}${m}${r[2]}${m}${r[3]}` : inner;
}

export function inlineMd(n: El): string {
  if (n.nodeType === 3) return (n.textContent ?? '').replace(/ /g, ' ');
  if (n.nodeType !== 1) return '';
  const md = attr(n, 'data-md');
  if (md !== null) return md;
  const inner = () => kids(n).map(inlineMd).join('');
  switch (n.nodeName) {
    case 'BR':
      return '\n';
    case 'STRONG':
    case 'B':
      return mark(inner(), '**');
    case 'EM':
    case 'I':
      return mark(inner(), '_');
    case 'S':
    case 'DEL':
    case 'STRIKE':
      return mark(inner(), '~~');
    case 'CODE':
      return `\`${n.textContent ?? ''}\``;
    case 'A': {
      const href = attr(n, 'href') ?? '';
      const text = inner();
      return !href || text === href ? text : `[${text}](${href})`;
    }
    default:
      return inner();
  }
}

function listMd(list: El, depth: number): string[] {
  const lines: string[] = [];
  const ordered = list.nodeName === 'OL';
  let i = 1;
  for (const li of kids(list)) {
    if (li.nodeName !== 'LI') continue;
    const checked = attr(li, 'data-checked');
    const marker = checked !== null || attr(list, 'data-task') !== null ? `- [${checked === 'true' ? 'x' : ' '}] ` : ordered ? `${i}. ` : '- ';
    const own = kids(li).filter((c) => c.nodeName !== 'UL' && c.nodeName !== 'OL');
    const text = own.map(inlineMd).join('').replace(/\s*\n\s*/g, ' ').trim();
    const nested = kids(li).filter((c) => c.nodeName === 'UL' || c.nodeName === 'OL').flatMap((c) => listMd(c, depth + 1));
    // An item left empty (a stray Enter) is not worth keeping.
    if (!text && !nested.length) continue;
    lines.push(`${'  '.repeat(depth)}${marker}${text}`, ...nested);
    i++;
  }
  return lines;
}

function blocksMd(parent: El): string[] {
  const out: string[] = [];
  let run: El[] = [];
  const flush = () => {
    const text = run.map(inlineMd).join('').replace(/[ \t]+\n/g, '\n').trim();
    if (text) out.push(text);
    run = [];
  };
  for (const n of kids(parent)) {
    const isBlock = n.nodeType === 1 && (BLOCK.has(n.nodeName) || (attr(n, 'data-md') !== null && attr(n, 'data-block') !== null));
    if (!isBlock) {
      run.push(n);
      continue;
    }
    flush();
    const md = attr(n, 'data-md');
    if (md !== null) {
      out.push(md);
      continue;
    }
    const name = n.nodeName;
    if (/^H[1-6]$/.test(name) && kids(n).some((c) => c.nodeType === 1 && BLOCK.has(c.nodeName))) {
      // The browser wrapped a list in the heading: keep the list.
      out.push(...blocksMd(n));
    } else if (/^H[1-6]$/.test(name)) {
      const t = kids(n).map(inlineMd).join('').replace(/\n/g, ' ').trim();
      if (t) out.push(`${'#'.repeat(Math.min(3, Number(name[1])))} ${t}`);
    } else if (name === 'UL' || name === 'OL') {
      const lines = listMd(n, 0);
      if (lines.length) out.push(lines.join('\n'));
    } else if (name === 'BLOCKQUOTE') {
      const inner = blocksMd(n).join('\n\n');
      if (inner) out.push(inner.split('\n').map((l) => (l ? `> ${l}` : '>')).join('\n'));
    } else if (name === 'HR') {
      out.push('---');
    } else if (name === 'PRE') {
      out.push(`\`\`\`\n${(n.textContent ?? '').replace(/\n$/, '')}\n\`\`\``);
    } else {
      // P or DIV: a paragraph, or a wrapper the browser made around other blocks.
      out.push(...blocksMd(n));
    }
  }
  flush();
  return out;
}

export function htmlToMarkdown(root: El): string {
  return blocksMd(root).join('\n\n').replace(/\n{3,}/g, '\n\n').trim();
}
