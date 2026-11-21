/**
 * Parse everyday reminder times ("at 6pm", "in 20 minutes", "tomorrow at 9", "tonight",
 * "on friday at 5:30pm") in the user's timezone, without an AI model. Returns null when unsure,
 * so the caller can hand the request to the assistant instead.
 */

const WEEKDAYS = ['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday'];

/** Wall-clock parts of an instant in a timezone. */
function partsIn(d: Date, tz: string) {
  const p = Object.fromEntries(
    new Intl.DateTimeFormat('en-US', { timeZone: tz, hourCycle: 'h23', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit', weekday: 'long' })
      .formatToParts(d)
      .map((x) => [x.type, x.value]),
  );
  return { y: +p.year, m: +p.month, d: +p.day, h: +p.hour, mi: +p.minute, dow: WEEKDAYS.indexOf(String(p.weekday).toLowerCase()) };
}

/** The instant when the wall clock in `tz` reads y-m-d h:mi. */
export function zoned(y: number, m: number, d: number, h: number, mi: number, tz: string): Date {
  let t = Date.UTC(y, m - 1, d, h, mi);
  for (let i = 0; i < 2; i++) {
    const p = partsIn(new Date(t), tz);
    const shown = Date.UTC(p.y, p.m - 1, p.d, p.h, p.mi);
    t += Date.UTC(y, m - 1, d, h, mi) - shown;
  }
  return new Date(t);
}

/** ISO 8601 with the timezone's offset, e.g. 2026-11-04T18:00:00+05:30. */
export function isoInZone(at: Date, tz: string) {
  const p = partsIn(at, tz);
  const off = Math.round((Date.UTC(p.y, p.m - 1, p.d, p.h, p.mi) - Math.floor(at.getTime() / 60000) * 60000) / 60000);
  const sign = off >= 0 ? '+' : '-';
  const pad = (n: number) => String(Math.abs(n)).padStart(2, '0');
  return `${p.y}-${pad(p.m)}-${pad(p.d)}T${pad(p.h)}:${pad(p.mi)}:00${sign}${pad(Math.trunc(Math.abs(off) / 60))}:${pad(Math.abs(off) % 60)}`;
}


export type Parsed = { at: Date; text: string };

export function parseReminder(input: string, tz: string, now = new Date()): Parsed | null {
  let s = ` ${input.trim().replace(/[.!?]+$/, '')} `;
  const today = partsIn(now, tz);
  let day: { y: number; m: number; d: number } | null = null;
  let hour: number | null = null;
  let minute = 0;
  let at: Date | null = null;

  const cut = (re: RegExp) => {
    const m = s.match(re);
    if (m) s = s.replace(m[0], ' ');
    return m;
  };

  // Relative: "in 20 minutes", "in 2 hours", "in an hour"
  const rel = cut(/\bin\s+(an?|\d+(?:\.\d+)?)\s*(min|mins|minute|minutes|hr|hrs|hour|hours)\b/i);
  if (rel) {
    const n = /^an?$/i.test(rel[1]) ? 1 : Number(rel[1]);
    at = new Date(now.getTime() + n * (/^h/i.test(rel[2]) ? 3_600_000 : 60_000));
  } else {
    const shift = (n: number) => {
      const t = new Date(Date.UTC(today.y, today.m - 1, today.d + n));
      return { y: t.getUTCFullYear(), m: t.getUTCMonth() + 1, d: t.getUTCDate() };
    };
    if (cut(/\btomorrow\b/i)) day = shift(1);
    else if (cut(/\btoday\b/i)) day = shift(0);
    const wd = cut(/\b(?:on\s+)?(?:next\s+)?(sunday|monday|tuesday|wednesday|thursday|friday|saturday)\b/i);
    if (wd) {
      const target = WEEKDAYS.indexOf(wd[1].toLowerCase());
      day = shift(((target - today.dow + 7) % 7) || 7);
    }
    const part = cut(/\b(?:this\s+|in\s+the\s+)?(tonight|morning|afternoon|evening|noon|midnight)\b/i);
    const t =
      cut(/\bat\s+(\d{1,2})(?::(\d{2}))?\s*(am|pm|a\.m\.|p\.m\.)?(?=\s|$)/i) ??
      cut(/\b(\d{1,2})(?::(\d{2}))?\s*(am|pm|a\.m\.|p\.m\.)(?=\s|$)/i) ??
      cut(/\b(\d{1,2}):(\d{2})()\b/);
    if (t) {
      hour = Number(t[1]);
      minute = Number(t[2] ?? 0);
      const ap = t[3]?.toLowerCase().replace(/\./g, '');
      if (hour > 23 || minute > 59) return null;
      if (ap === 'pm' && hour < 12) hour += 12;
      if (ap === 'am' && hour === 12) hour = 0;
      // "at 6" with no am/pm: assume the next occurrence within 12h (6 -> 6pm if 6am passed)
      if (!ap && hour <= 12 && part?.[1]) {
        if (/evening|tonight|afternoon/i.test(part[1]) && hour < 12) hour += 12;
      } else if (!ap && hour < 12 && !day) {
        const nowMin = today.h * 60 + today.mi;
        if (hour * 60 + minute <= nowMin && (hour + 12) * 60 + minute > nowMin) hour += 12;
      }
    } else if (part) {
      hour = { tonight: 20, morning: 9, afternoon: 14, evening: 18, noon: 12, midnight: 0 }[part[1].toLowerCase()]!;
    }
    if (hour === null && day) hour = 9;
    if (hour === null) return null;
    const base = day ?? { y: today.y, m: today.m, d: today.d };
    at = zoned(base.y, base.m, base.d, hour, minute, tz);
    if (!day && at <= now) {
      const t2 = new Date(Date.UTC(base.y, base.m - 1, base.d + 1));
      at = zoned(t2.getUTCFullYear(), t2.getUTCMonth() + 1, t2.getUTCDate(), hour, minute, tz);
    }
  }
  if (!at || at <= now) return null;

  const text = s
    .replace(/^\s*(?:please\s+)?(?:can you\s+|could you\s+)?(?:set (?:a|an) (?:reminder|alarm)\s*(?:for|to)?|remind me|reminder|ping me|notify me|alert me)\b/i, ' ')
    .replace(/^\s*(?:to|that|about|for)\b/i, ' ')
    .replace(/\s+(?:to|that|about)\s*$/i, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  if (!text || text.length > 200) return null;
  return { at, text: text[0].toUpperCase() + text.slice(1) };
}
