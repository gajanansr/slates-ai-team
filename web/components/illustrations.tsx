/**
 * Slates illustration set: monoline ink drawings made for lime panels.
 * Stroke = currentColor (set to the panel's ink), fills use the panel colour to
 * occlude lines behind shapes, and a single paper-white fill for highlights.
 * The lime panel is the same in light and dark themes, so drawings never need
 * a dark variant.
 */
import type { SlateKind } from '@/lib/kinds';

const PAPER = '#fbfbf8';
const PANEL = 'var(--accent)';

type P = { className?: string };
const Svg = ({ className, children, label }: P & { children: React.ReactNode; label?: string }) => (
  <svg
    viewBox="0 0 160 120"
    className={className}
    fill="none"
    stroke="currentColor"
    strokeWidth={2}
    strokeLinecap="round"
    strokeLinejoin="round"
    role={label ? 'img' : undefined}
    aria-label={label}
    aria-hidden={label ? undefined : true}
  >
    {children}
  </svg>
);

const Spark = ({ x, y, s = 6 }: { x: number; y: number; s?: number }) => (
  <path d={`M${x} ${y - s}V${y + s}M${x - s} ${y}H${x + s}M${x - s * 0.55} ${y - s * 0.55}l${s * 1.1} ${s * 1.1}M${x + s * 0.55} ${y - s * 0.55}l${-s * 1.1} ${s * 1.1}`} strokeWidth={1.6} />
);

/** Isometric slab, used by Stack and Orbit. */
function Slab({ cx, cy, hw = 44, hh = 20, t = 7, top = PANEL }: { cx: number; cy: number; hw?: number; hh?: number; t?: number; top?: string }) {
  const L = cx - hw;
  const R = cx + hw;
  return (
    <g>
      <path d={`M${L} ${cy}L${cx} ${cy + hh}L${R} ${cy}V${cy + t}L${cx} ${cy + hh + t}L${L} ${cy + t}Z`} fill={PANEL} />
      <path d={`M${cx} ${cy + hh}V${cy + hh + t}`} />
      <path d={`M${L} ${cy}L${cx} ${cy - hh}L${R} ${cy}L${cx} ${cy + hh}Z`} fill={top} />
    </g>
  );
}

export function Stack({ className }: P) {
  return (
    <Svg className={className}>
      <Slab cx={80} cy={78} />
      <Slab cx={80} cy={62} />
      <Slab cx={80} cy={46} top={PAPER} />
      <path d="M62 46h14M70 40h20" strokeWidth={1.6} />
      <Spark x={130} y={26} />
    </Svg>
  );
}

export function Orbit({ className }: P) {
  return (
    <Svg className={className}>
      <ellipse cx={80} cy={64} rx={68} ry={30} strokeDasharray="3 6" strokeWidth={1.6} />
      <g transform="translate(80 58) scale(0.62) translate(-80 -58)">
        <Slab cx={80} cy={74} />
        <Slab cx={80} cy={58} />
        <Slab cx={80} cy={42} top={PAPER} />
      </g>
      <circle cx={18} cy={58} r={8} fill={PAPER} />
      <circle cx={136} cy={84} r={8} fill={PAPER} />
      <circle cx={122} cy={38} r={6} fill="currentColor" />
      <path d="M15 58h6M133 84h6" strokeWidth={1.6} />
      <Spark x={40} y={22} s={5} />
    </Svg>
  );
}

export function Connect({ className }: P) {
  return (
    <Svg className={className}>
      <rect x={18} y={42} width={40} height={40} rx={11} fill={PAPER} />
      <path d="M28 54h20M28 62h14M28 70h8" />
      <circle cx={126} cy={62} r={20} fill={PAPER} />
      <circle cx={119} cy={60} r={2} fill="currentColor" stroke="none" />
      <circle cx={133} cy={60} r={2} fill="currentColor" stroke="none" />
      <path d="M120 69q6 4 12 0" />
      <path d="M126 42v-8" />
      <circle cx={126} cy={31} r={3} fill="currentColor" stroke="none" />
      <path d="M60 62C76 32 90 92 104 62" strokeDasharray="2 6" />
      <path d="M98 58l7 4-3 7" />
      <Spark x={80} y={26} s={5} />
    </Svg>
  );
}

export function Pulse({ className }: P) {
  return (
    <Svg className={className}>
      <rect x={24} y={22} width={112} height={76} rx={16} fill={PAPER} />
      <path d="M36 64h22l8-22 12 40 10-28 6 10h30" strokeWidth={2.2} />
      <circle cx={124} cy={64} r={4} fill="currentColor" stroke="none" />
      <path d="M40 38h18" strokeWidth={1.6} />
    </Svg>
  );
}

export function Bell({ className }: P) {
  return (
    <Svg className={className}>
      <path d="M62 78V60a18 18 0 0 1 36 0v18l7 8H55z" fill={PAPER} />
      <path d="M74 92a6 6 0 0 0 12 0M80 38v4" />
      <path d="M46 48q-8 14 0 28M36 42q-13 20 0 40M114 48q8 14 0 28M124 42q13 20 0 40" strokeWidth={1.6} />
    </Svg>
  );
}

export function Sunrise({ className }: P) {
  const rays = [160, 130, 105, 75, 50, 20].map((deg) => {
    const r = (deg * Math.PI) / 180;
    return `M${80 + Math.cos(r) * 36} ${78 - Math.sin(r) * 36}L${80 + Math.cos(r) * 46} ${78 - Math.sin(r) * 46}`;
  });
  return (
    <Svg className={className}>
      <path d="M52 78a28 28 0 0 1 56 0" fill={PAPER} />
      <path d={rays.join('')} />
      <path d="M22 78h116M42 90h76M62 102h36" />
    </Svg>
  );
}

export function Checklist({ className }: P) {
  return (
    <Svg className={className}>
      <rect x={46} y={18} width={68} height={86} rx={10} fill={PAPER} transform="rotate(-4 80 61)" />
      <g transform="rotate(-4 80 61)">
        <circle cx={60} cy={40} r={5} fill="currentColor" />
        <path d="M58 40l1.6 1.6 3-3.4" stroke={PANEL} strokeWidth={1.6} />
        <path d="M72 40h28" />
        <circle cx={60} cy={60} r={5} fill="currentColor" />
        <path d="M58 60l1.6 1.6 3-3.4" stroke={PANEL} strokeWidth={1.6} />
        <path d="M72 60h22" />
        <circle cx={60} cy={80} r={5} />
        <path d="M72 80h26" />
      </g>
      <Spark x={126} y={30} s={5} />
    </Svg>
  );
}

export function Chain({ className }: P) {
  return (
    <Svg className={className}>
      <rect x={30} y={48} width={58} height={26} rx={13} transform="rotate(-28 59 61)" fill={PAPER} />
      <rect x={64} y={48} width={58} height={26} rx={13} transform="rotate(-28 93 61)" />
      <path d="M118 22h14v14M132 22l-16 16" />
    </Svg>
  );
}

export function Target({ className }: P) {
  return (
    <Svg className={className}>
      <circle cx={74} cy={64} r={40} fill={PAPER} />
      <circle cx={74} cy={64} r={27} />
      <circle cx={74} cy={64} r={14} />
      <circle cx={74} cy={64} r={3} fill="currentColor" />
      <path d="M74 64l44-44" />
      <path d="M102 20h16v16" />
    </Svg>
  );
}

export function Bars({ className }: P) {
  return (
    <Svg className={className}>
      <path d="M28 98h104" />
      <path d="M38 98V70a4 4 0 0 1 4-4h8a4 4 0 0 1 4 4v28" fill={PAPER} />
      <path d="M62 98V50a4 4 0 0 1 4-4h8a4 4 0 0 1 4 4v48" fill={PAPER} />
      <path d="M86 98V60a4 4 0 0 1 4-4h8a4 4 0 0 1 4 4v38" fill={PAPER} />
      <path d="M110 98V34a4 4 0 0 1 4-4h8a4 4 0 0 1 4 4v64" fill="currentColor" />
      <path d="M36 44l24-12 22 8 30-22" strokeDasharray="2 5" />
      <Spark x={132} y={18} s={5} />
    </Svg>
  );
}

export function Panels({ className }: P) {
  return (
    <Svg className={className}>
      <rect x={24} y={20} width={112} height={80} rx={12} fill={PAPER} />
      <path d="M24 38h112" />
      <circle cx={34} cy={29} r={2} fill="currentColor" stroke="none" />
      <circle cx={42} cy={29} r={2} fill="currentColor" stroke="none" />
      <rect x={34} y={46} width={40} height={20} rx={5} fill="currentColor" />
      <rect x={82} y={46} width={44} height={20} rx={5} />
      <path d="M36 90V82M46 90V76M56 90V80M66 90V72" strokeWidth={4} strokeLinecap="round" />
      <path d="M82 76h44M82 84h30" />
      <Spark x={142} y={16} s={5} />
    </Svg>
  );
}

export function Path({ className }: P) {
  return (
    <Svg className={className}>
      <path d="M52 22v80" strokeDasharray="2 6" />
      <circle cx={52} cy={32} r={7} fill="currentColor" />
      <circle cx={52} cy={62} r={7} fill={PAPER} />
      <circle cx={52} cy={92} r={7} fill={PAPER} />
      <path d="M68 30h44M68 38h28M68 60h36M68 68h22M68 90h40" />
      <Spark x={128} y={30} s={5} />
    </Svg>
  );
}

export function Grid({ className }: P) {
  return (
    <Svg className={className}>
      <rect x={30} y={26} width={100} height={70} rx={10} fill={PAPER} />
      <path d="M30 44h100M30 61h100M30 78h100M66 26v70" />
      <path d="M40 35h16M76 35h30" strokeWidth={2.6} />
      <rect x={76} y={66} width={34} height={7} rx={3.5} fill="currentColor" />
    </Svg>
  );
}

export function Page({ className }: P) {
  return (
    <Svg className={className}>
      <path d="M50 18h44l18 18v66a4 4 0 0 1-4 4H50a4 4 0 0 1-4-4V22a4 4 0 0 1 4-4z" fill={PAPER} />
      <path d="M94 18v18h18M58 50h40M58 62h44M58 74h28" />
      <path d="M104 96l22-34 7 4.5-22 34-8 4z" fill={PANEL} />
    </Svg>
  );
}

export function Cloud({ className }: P) {
  return (
    <Svg className={className}>
      <path d="M50 86h62a20 20 0 0 0 0-40 28 28 0 0 0-52-6 22 22 0 0 0-10 46z" fill={PAPER} />
      <path d="M44 28l76 72" strokeWidth={2.4} />
    </Svg>
  );
}

export function Compass({ className }: P) {
  return (
    <Svg className={className}>
      <circle cx={80} cy={60} r={42} fill={PAPER} />
      <circle cx={80} cy={60} r={33} strokeDasharray="1 7" />
      <path d="M80 26l9 34H71z" fill="currentColor" />
      <path d="M71 60h18l-9 34z" fill={PANEL} />
      <circle cx={80} cy={60} r={3} fill={PAPER} />
    </Svg>
  );
}

export function Shield({ className }: P) {
  return (
    <Svg className={className}>
      <path d="M80 16l36 13v28c0 24-16 40-36 48-20-8-36-24-36-48V29z" fill={PAPER} />
      <path d="M64 60l11 11 22-24" strokeWidth={2.6} />
      <Spark x={128} y={28} s={5} />
    </Svg>
  );
}

const DRAWINGS = {
  stack: Stack,
  orbit: Orbit,
  connect: Connect,
  pulse: Pulse,
  bell: Bell,
  sunrise: Sunrise,
  checklist: Checklist,
  chain: Chain,
  target: Target,
  bars: Bars,
  panels: Panels,
  path: Path,
  grid: Grid,
  page: Page,
  cloud: Cloud,
  compass: Compass,
  shield: Shield,
} as const;
export type IllustrationName = keyof typeof DRAWINGS;

export const KIND_ILLUSTRATION: Record<SlateKind, IllustrationName> = {
  brief: 'sunrise',
  list: 'checklist',
  links: 'chain',
  metrics: 'target',
  timeline: 'path',
  table: 'grid',
  markdown: 'page',
  notes: 'page',
  chart: 'bars',
  dashboard: 'panels',
  tracker: 'panels',
  habits: 'checklist',
  goals: 'target',
  countdown: 'path',
};

/** A lime panel holding one drawing. Same in light and dark. */
export function IllustrationPanel({
  name,
  className = 'h-[150px]',
  drawing = 'h-[78%]',
  children,
}: {
  name: IllustrationName;
  className?: string;
  drawing?: string;
  children?: React.ReactNode;
}) {
  const Drawing = DRAWINGS[name];
  return (
    <div className={`relative grid place-items-center overflow-hidden rounded-[24px] bg-accent text-on-accent ${className}`}>
      <Drawing className={`${drawing} w-auto`} />
      {children}
    </div>
  );
}
