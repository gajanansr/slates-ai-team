'use client';
import { useState } from 'react';
import { BarChart3, Bold, Heading2, ImagePlus, Italic, LayoutGrid, List, ListChecks, ListOrdered, MoreHorizontal, Plus, Quote, X } from 'lucide-react';

export type Edit = { value: string; start: number; end: number };
type Sel = { value: string; start: number; end: number };

/** Wrap the selection (or a placeholder) in marks, e.g. **bold**. */
export function wrap({ value, start, end }: Sel, mark: string, placeholder: string): Edit {
  const picked = value.slice(start, end) || placeholder;
  const next = `${value.slice(0, start)}${mark}${picked}${mark}${value.slice(end)}`;
  return { value: next, start: start + mark.length, end: start + mark.length + picked.length };
}

/** Put a prefix on every selected line ("- ", "## ", "> "); tapping again takes it off. */
export function prefixLines({ value, start, end }: Sel, prefix: string | ((i: number) => string)): Edit {
  const from = value.lastIndexOf('\n', start - 1) + 1;
  const toRaw = value.indexOf('\n', end);
  const to = toRaw < 0 ? value.length : toRaw;
  const lines = value.slice(from, to).split('\n');
  const pre = (i: number) => (typeof prefix === 'string' ? prefix : prefix(i));
  const strip = /^(#{1,3} |> |- \[[ xX]\] |- |\d+\. )/;
  const all = lines.every((l, i) => l.startsWith(pre(i)));
  const out = lines.map((l, i) => (all ? l.slice(pre(i).length) : `${pre(i)}${l.replace(strip, '')}`)).join('\n');
  return { value: `${value.slice(0, from)}${out}${value.slice(to)}`, start: from + out.length, end: from + out.length };
}

/** Insert a block on its own lines at the cursor. */
export function insertBlock({ value, start }: Sel, block: string): Edit {
  const before = value.slice(0, start).replace(/\n*$/, start ? '\n\n' : '');
  const after = value.slice(start).replace(/^\n*/, '');
  const at = before.length + block.length + 2;
  return { value: `${before}${block}\n\n${after}`, start: at, end: at };
}

/** Enter inside a list starts the next item; Enter on an empty item ends the list. */
export function continueList({ value, start, end }: Sel): Edit | null {
  if (start !== end) return null;
  const from = value.lastIndexOf('\n', start - 1) + 1;
  const line = value.slice(from, start);
  const m = /^(\s*)(- \[[ xX]\] |- |(\d+)\. )(.*)$/.exec(line);
  if (!m) return null;
  if (!m[4].trim()) return { value: `${value.slice(0, from)}${value.slice(start)}`, start: from, end: from };
  const next = m[3] ? `${Number(m[3]) + 1}. ` : m[2].startsWith('- [') ? '- [ ] ' : '- ';
  const ins = `\n${m[1]}${next}`;
  return { value: `${value.slice(0, start)}${ins}${value.slice(start)}`, start: start + ins.length, end: start + ins.length };
}

const TYPES = [
  { id: 'bar', label: 'Bars' },
  { id: 'line', label: 'Line' },
  { id: 'parts', label: 'Shares' },
] as const;

type Cmd = 'h2' | 'bold' | 'italic' | 'task' | 'ul' | 'ol' | 'quote';
const FORMATS: { cmd: Cmd; label: string; Icon: typeof Bold }[] = [
  { cmd: 'bold', label: 'Bold', Icon: Bold },
  { cmd: 'italic', label: 'Italic', Icon: Italic },
  { cmd: 'h2', label: 'Heading', Icon: Heading2 },
  { cmd: 'task', label: 'Checklist', Icon: ListChecks },
  { cmd: 'ul', label: 'Bullet list', Icon: List },
];

/**
 * One bar for the note editor, sitting just above the keyboard: formats that light up when
 * they are on, the mic, and a + for photos, charts and live boards.
 */
export function NoteToolbar({
  run,
  active = {},
  onInsert,
  onPhoto,
  voice,
  busy = false,
  boards,
}: {
  run: (cmd: Cmd) => void;
  active?: Partial<Record<Cmd, boolean>>;
  onInsert: (block: string) => void;
  onPhoto: () => void;
  voice: React.ReactNode;
  busy?: boolean;
  boards: { slug: string; title: string }[];
}) {
  const [panel, setPanel] = useState<'more' | 'chart' | 'board' | null>(null);
  const [type, setType] = useState<(typeof TYPES)[number]['id']>('bar');
  const [name, setName] = useState('');
  const [rows, setRows] = useState([{ label: '', value: '' }, { label: '', value: '' }, { label: '', value: '' }]);
  const filled = rows.filter((r) => r.label.trim() && r.value.trim() !== '' && Number.isFinite(Number(r.value)));
  const tool = 'grid h-10 min-w-0 flex-1 place-items-center rounded-xl text-fg-2 active:bg-muted';
  const item = 'flex h-11 w-full items-center gap-3 rounded-xl px-3 text-left text-[15px] active:bg-muted';

  const addChart = () => {
    if (!filled.length) return;
    const data = { type, labels: filled.map((r) => r.label.trim().slice(0, 24)), series: [{ id: 's1', name: name.trim().slice(0, 40) || 'Value', values: filled.map((r) => Number(r.value)) }] };
    onInsert(`\`\`\`chart\n${JSON.stringify(data)}\n\`\`\``);
    setPanel(null);
    setRows([{ label: '', value: '' }, { label: '', value: '' }, { label: '', value: '' }]);
    setName('');
  };

  return (
    <div className="relative">
      {/* Menus float above the bar, so opening one never moves the bar or the note. */}
      {panel && (
        <div className="launcher-panel glass-strong absolute inset-x-0 bottom-full mb-2 rounded-[22px] p-1.5 shadow-[var(--shadow-float)]">
      {panel === 'more' && (
        <div className="p-0.5">
          <button type="button" className={item} onPointerDown={(e) => e.preventDefault()} onClick={() => { setPanel(null); run('ol'); }}><ListOrdered className="size-[18px] text-fg-3" strokeWidth={1.7} /> Numbered list</button>
          <button type="button" className={item} onPointerDown={(e) => e.preventDefault()} onClick={() => { setPanel(null); run('quote'); }}><Quote className="size-[18px] text-fg-3" strokeWidth={1.7} /> Quote</button>
          {boards.length > 0 && <button type="button" className={item} onClick={() => setPanel('board')}><LayoutGrid className="size-[18px] text-fg-3" strokeWidth={1.7} /> Live board</button>}
        </div>
      )}

      {panel === 'chart' && (
        <div className="p-1.5">
          <div className="mb-2 flex items-center gap-2">
            <div className="flex flex-1 gap-1 rounded-full bg-muted p-1">
              {TYPES.map((t) => (
                <button key={t.id} type="button" onClick={() => setType(t.id)} aria-pressed={type === t.id} className={`h-8 flex-1 rounded-full text-[13px] ${type === t.id ? 'bg-btn text-on-btn' : 'text-fg-2'}`}>{t.label}</button>
              ))}
            </div>
            <button type="button" aria-label="Close" onClick={() => setPanel(null)} className="grid size-8 flex-none place-items-center rounded-full text-fg-3"><X className="size-4" /></button>
          </div>
          <input value={name} onChange={(e) => setName(e.target.value)} maxLength={40} placeholder="What the numbers are, e.g. Spend" aria-label="Chart name" className="field mb-2 h-10 text-[15px]" />
          <div className="max-h-[26dvh] space-y-1.5 overflow-y-auto">
            {rows.map((r, i) => (
              <div key={i} className="flex gap-1.5">
                <input value={r.label} onChange={(e) => setRows((x) => x.map((y, n) => (n === i ? { ...y, label: e.target.value } : y)))} maxLength={24} placeholder={['Jan', 'Feb', 'Mar'][i] ?? 'Label'} aria-label={`Label ${i + 1}`} className="field h-10 min-w-0 flex-1 text-[15px]" />
                <input value={r.value} onChange={(e) => setRows((x) => x.map((y, n) => (n === i ? { ...y, value: e.target.value } : y)))} inputMode="decimal" placeholder="0" aria-label={`Value ${i + 1}`} className="field h-10 w-24 flex-none text-[15px]" />
              </div>
            ))}
          </div>
          <div className="mt-2 flex gap-2">
            {rows.length < (type === 'parts' ? 5 : 24) && (
              <button type="button" onClick={() => setRows((x) => [...x, { label: '', value: '' }])} className="btn btn-glass h-10 px-3 text-[13.5px]"><Plus className="size-4" /> Row</button>
            )}
            <button type="button" onClick={addChart} disabled={!filled.length} className="btn btn-primary h-10 flex-1 text-[14px] disabled:opacity-50">Add chart</button>
          </div>
        </div>
      )}

      {panel === 'board' && (
        <div className="p-0.5">
          <p className="px-3 pb-1 pt-1 text-[12.5px] text-fg-3">Show a board inside this note. It stays up to date.</p>
          <ul className="max-h-[30dvh] overflow-y-auto">
            {boards.map((b) => (
              <li key={b.slug}>
                <button type="button" onClick={() => { onInsert(`\`\`\`board\n${b.slug}\n\`\`\``); setPanel(null); }} className={item}>
                  <span className="truncate">{b.title}</span>
                </button>
              </li>
            ))}
          </ul>
        </div>
      )}
        </div>
      )}
      <div role="toolbar" aria-label="Formatting" className="flex items-center">
        {FORMATS.map(({ cmd, label, Icon }) => (
          <button
            key={cmd}
            type="button"
            aria-label={label}
            aria-pressed={!!active[cmd]}
            // Keep the cursor in the note: a button must not steal focus (and close the keyboard).
            onPointerDown={(e) => e.preventDefault()}
            onClick={() => run(cmd)}
            className={`grid h-10 min-w-0 flex-1 place-items-center rounded-xl transition-colors ${active[cmd] ? 'bg-accent text-on-accent' : 'text-fg-2 active:bg-muted'}`}
          >
            <Icon className="size-[18px]" strokeWidth={active[cmd] ? 2.4 : 1.9} />
          </button>
        ))}
        <span aria-hidden className="mx-1 h-5 w-px flex-none bg-line" />
        <button type="button" aria-label="Add a photo" onClick={onPhoto} className={`${tool} ${busy ? 'animate-pulse' : ''}`}><ImagePlus className="size-[18px]" strokeWidth={1.9} /></button>
        {voice}
        <button type="button" aria-label="Add a chart" aria-expanded={panel === 'chart'} onClick={() => setPanel(panel === 'chart' ? null : 'chart')} className={`${tool} ${panel === 'chart' ? 'bg-muted text-fg' : ''}`}><BarChart3 className="size-[18px]" strokeWidth={1.9} /></button>
        <button type="button" aria-label="More: numbered list, quote, live board" onPointerDown={(e) => e.preventDefault()} aria-expanded={panel === 'more' || panel === 'board'} onClick={() => setPanel(panel === 'more' || panel === 'board' ? null : 'more')} className={`${tool} ${panel === 'more' || panel === 'board' ? 'bg-muted text-fg' : ''}`}>
          {panel === 'more' || panel === 'board' ? <X className="size-[18px]" /> : <MoreHorizontal className="size-[18px]" />}
        </button>
      </div>
    </div>
  );
}
