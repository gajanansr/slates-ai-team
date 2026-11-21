const rtf = new Intl.RelativeTimeFormat('en', { numeric: 'auto', style: 'short' });
const UNITS: [Intl.RelativeTimeFormatUnit, number][] = [
  ['year', 31536000],
  ['month', 2592000],
  ['week', 604800],
  ['day', 86400],
  ['hour', 3600],
  ['minute', 60],
];

export function ago(iso: string, now = Date.now()) {
  const secs = Math.round((new Date(iso).getTime() - now) / 1000);
  for (const [unit, s] of UNITS) {
    if (Math.abs(secs) >= s) return rtf.format(Math.round(secs / s), unit);
  }
  return 'just now';
}

export function dayLabel(iso: string, now = new Date()) {
  const d = new Date(iso);
  const strip = (x: Date) => new Date(x.getFullYear(), x.getMonth(), x.getDate()).getTime();
  const diff = Math.round((strip(now) - strip(d)) / 86400000);
  if (diff === 0) return 'Today';
  if (diff === 1) return 'Yesterday';
  return d.toLocaleDateString('en', { weekday: 'short', day: 'numeric', month: 'short' });
}
