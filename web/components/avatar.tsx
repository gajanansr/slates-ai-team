/**
 * Profile avatars: flat, outline-free characters in the unDraw manner (no facial
 * features, one accent), drawn for Slates' lime + charcoal palette. Fixed colours,
 * so they read the same in light and dark themes. "initials" falls back to letters.
 */

export const AVATARS = ['maker', 'reader', 'builder', 'dreamer'] as const;
export type AvatarStyle = (typeof AVATARS)[number] | 'initials';
export const AVATAR_LABEL: Record<AvatarStyle, string> = {
  maker: 'Maker',
  reader: 'Reader',
  builder: 'Builder',
  dreamer: 'Dreamer',
  initials: 'Initials',
};

export const isAvatarStyle = (v: unknown): v is AvatarStyle => v === 'initials' || (AVATARS as readonly string[]).includes(v as string);

/** "Gajanan Rathod" -> GR, "Gajanan" -> G; no name -> first letter of the email. */
export function initials(name?: string | null, email?: string | null) {
  const parts = (name ?? '').trim().split(/\s+/).filter(Boolean);
  if (parts.length) return ((parts[0][0] ?? '') + (parts.length > 1 ? parts[parts.length - 1][0] : '')).toUpperCase();
  return (email?.match(/[a-z0-9]/i)?.[0] ?? '?').toUpperCase();
}

const INK = '#1d1c1a';
const LIME = '#e1f48a';
const LIME_DEEP = '#c5dc5c';

type Look = { bg: string; ring: string; skin: string; shade: string; hair: string; top: string; draw: (c: Look) => React.ReactNode; back?: (c: Look) => React.ReactNode };

const head = (c: Look) => (
  <>
    <rect x="27" y="35" width="10" height="12" rx="4" fill={c.shade} />
    <circle cx="20.8" cy="29.5" r="2.7" fill={c.shade} />
    <circle cx="43.2" cy="29.5" r="2.7" fill={c.shade} />
    <ellipse cx="32" cy="28.5" rx="11" ry="12.5" fill={c.skin} />
  </>
);
const shoulders = (fill: string) => <path d="M8 66c1.5-13 11-20 24-20s22.5 7 24 20z" fill={fill} />;

const LOOKS: Record<(typeof AVATARS)[number], Look> = {
  // Headphones, hoodie with lime drawstrings.
  maker: {
    bg: '#d9e6f6',
    ring: '#c3d6ee',
    skin: '#c98b62',
    shade: '#ad7350',
    hair: INK,
    top: '#2c2b28',
    draw: (c) => (
      <>
        {shoulders(c.top)}
        <path d="M24 46.6c2.4 4 5 6 8 6s5.6-2 8-6" fill="#3a3935" />
        <path d="M29 50.5v6M35 50.5v6" stroke={LIME} strokeWidth="1.6" strokeLinecap="round" />
        {head(c)}
        <path d="M20.4 28.5c-1.6-9.8 3-16.6 11.4-16.6 4.2 0 6.6 1.2 8.4 2.6 3 .4 4.6 3.6 3.6 6.8-.4 2.4-.6 4.4-.6 7.2-1.4-4.8-4.6-7.4-9.6-7.8-1.6 2.4-5.2 3.2-9 3.4-2.2.6-3.4 2.2-4.2 4.4z" fill={c.hair} />
        {/* Worn headphones, seen from the front: the band arcs over the hair and each cup sits
            edge-on against the side of the head (a "D" curving outward), not facing the viewer. */}
        <path d="M19.4 25.5C17.6 2.6 46.4 2.6 44.6 25.5" fill="none" stroke="#4a4944" strokeWidth="3.2" strokeLinecap="round" />
        <path d="M22.4 13.2c2.7-2.6 6.1-3.8 9.6-3.8s6.9 1.2 9.6 3.8" fill="none" stroke={LIME} strokeWidth="1.1" strokeLinecap="round" opacity=".9" />
        <path d="M19.8 22.8c-6.6 0-6.6 13.4 0 13.4z" fill={INK} />
        <path d="M44.2 22.8c6.6 0 6.6 13.4 0 13.4z" fill={INK} />
        <path d="M16.4 25.6c-1.2 2.4-1.2 5.4 0 7.8" fill="none" stroke={LIME} strokeWidth="1.2" strokeLinecap="round" />
        <path d="M47.6 25.6c1.2 2.4 1.2 5.4 0 7.8" fill="none" stroke={LIME} strokeWidth="1.2" strokeLinecap="round" />
        <rect x="19.4" y="22.4" width="2.8" height="14.2" rx="1.4" fill="#4a4944" />
        <rect x="41.8" y="22.4" width="2.8" height="14.2" rx="1.4" fill="#4a4944" />
      </>
    ),
  },
  // Bun, round glasses, olive sweater.
  reader: {
    bg: '#dfe8c9',
    ring: '#cbd8ad',
    skin: '#8d5a3b',
    shade: '#774a30',
    hair: '#2a1d16',
    top: '#4a7a20',
    draw: (c) => (
      <>
        {shoulders(c.top)}
        <path d="M25.5 46.4c1.8 2.6 4 3.9 6.5 3.9s4.7-1.3 6.5-3.9" fill="none" stroke={LIME} strokeWidth="1.8" strokeLinecap="round" />
        {head(c)}
        <circle cx="32" cy="12.6" r="5.4" fill={c.hair} />
        <path d="M20.8 28c-.6-9.4 4.6-14 11.2-14 6.8 0 11.8 4.6 11.2 14-1.6-4.8-5-7.2-11.2-7.2S22.4 23.2 20.8 28z" fill={c.hair} />
        <g fill="none" stroke={INK} strokeWidth="1.5">
          <circle cx="27.4" cy="29.6" r="3.6" fill="#ffffff" fillOpacity=".25" />
          <circle cx="36.6" cy="29.6" r="3.6" fill="#ffffff" fillOpacity=".25" />
          <path d="M31 29.4h2" />
        </g>
      </>
    ),
  },
  // Lime beanie, beard, charcoal jacket.
  builder: {
    bg: '#2c2b28',
    ring: '#3a3935',
    skin: '#e3a882',
    shade: '#c98d68',
    hair: '#4a2f22',
    top: '#d0691f',
    draw: (c) => (
      <>
        {shoulders(c.top)}
        <path d="M32 46v20" stroke="#a9521a" strokeWidth="1.6" />
        <path d="M24.5 46.8 32 54l7.5-7.2" fill="none" stroke="#f3efe6" strokeWidth="2" strokeLinejoin="round" />
        {head(c)}
        <path d="M21.2 29.5c.4 9.4 5 12.8 10.8 12.8s10.4-3.4 10.8-12.8c-2.2 4.4-5.4 5.8-10.8 5.8s-8.6-1.4-10.8-5.8z" fill={c.hair} />
        <path d="M20.2 25.5c-.4-9.2 5-13.6 11.8-13.6s12.2 4.4 11.8 13.6z" fill={LIME} />
        <rect x="19.4" y="22.6" width="25.2" height="5" rx="2.5" fill={LIME_DEEP} />
        <circle cx="32" cy="10.8" r="3" fill={LIME_DEEP} />
      </>
    ),
  },
  // Long hair, lime top, earring.
  dreamer: {
    bg: '#f3d9c4',
    ring: '#ebc7aa',
    skin: '#f0c4a2',
    shade: '#d9a684',
    hair: '#3b2418',
    top: LIME,
    back: (c) => <path d="M19 27c-1-11 5.2-15.8 13-15.8S46 16 45 27l1.8 21c-4.6 1.6-24.6 1.6-29.6 0z" fill={c.hair} />,
    draw: (c) => (
      <>
        {shoulders(c.top)}
        <path d="M26 46.2c1.6 2.8 3.6 4.2 6 4.2s4.4-1.4 6-4.2" fill={c.shade} />
        {head(c)}
        <path d="M20.6 27.8c0-9 5-13.6 11.4-13.6 6.8 0 11.6 4.4 11.4 12.6-4-1.2-8.6-4-11-8.2-2.2 4.8-6.6 8-11.8 9.2z" fill={c.hair} />
        <circle cx="20.6" cy="34" r="1.6" fill={LIME_DEEP} />
        <circle cx="43.4" cy="34" r="1.6" fill={LIME_DEEP} />
      </>
    ),
  },
};

export function Avatar({
  style,
  name,
  email,
  className = 'size-11',
  label,
}: {
  style?: string | null;
  name?: string | null;
  email?: string | null;
  className?: string;
  label?: string;
}) {
  const s: AvatarStyle = isAvatarStyle(style) ? style : 'maker';
  if (s === 'initials') {
    const text = initials(name, email);
    return (
      <span className={`grid place-items-center rounded-full bg-btn font-semibold text-on-btn ${className}`} role={label ? 'img' : undefined} aria-label={label} aria-hidden={label ? undefined : true}>
        <svg viewBox="0 0 64 64" className="size-full">
          <text x="32" y="32" dy=".35em" textAnchor="middle" fontSize={text.length > 1 ? 23 : 27} fontWeight={600} letterSpacing="-0.5" fill="currentColor">
            {text}
          </text>
        </svg>
      </span>
    );
  }
  const c = LOOKS[s];
  const id = `av-${s}`;
  return (
    <svg viewBox="0 0 64 64" className={`rounded-full ${className}`} role={label ? 'img' : undefined} aria-label={label} aria-hidden={label ? undefined : true}>
      <defs>
        <clipPath id={id}>
          <circle cx="32" cy="32" r="32" />
        </clipPath>
      </defs>
      <g clipPath={`url(#${id})`}>
        <rect width="64" height="64" fill={c.bg} />
        <circle cx="52" cy="12" r="16" fill="none" stroke={c.ring} strokeWidth="4" />
        <circle cx="9" cy="20" r="2" fill={c.ring} />
        {c.back?.(c)}
        {c.draw(c)}
      </g>
    </svg>
  );
}
