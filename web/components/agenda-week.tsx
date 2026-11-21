import Link from 'next/link';
import type { AgendaItem } from '@/lib/agenda';

/** A compact week: one row per day that has something on it. */
export function AgendaWeek({ days, today }: { days: { day: string; items: AgendaItem[] }[]; today: string }) {
  if (!days.length) return null;
  const label = (d: string) => {
    if (d === today) return 'Today';
    const t = new Date(`${d}T00:00:00Z`);
    return t.toLocaleDateString('en', { weekday: 'short', day: 'numeric', month: 'short', timeZone: 'UTC' });
  };
  return (
    <section className="mb-6" aria-labelledby="week-h">
      <h2 id="week-h" className="kicker mb-2 px-1">
        This week
      </h2>
      <ol className="card divide-y divide-line">
        {days.map((d) => (
          <li key={d.day} className="flex gap-3 px-4 py-3">
            <p className={`w-16 flex-none pt-0.5 text-[13px] ${d.day === today ? 'font-semibold' : 'text-fg-3'}`}>{label(d.day)}</p>
            <ul className="min-w-0 flex-1 space-y-1.5">
              {d.items.map((it) => (
                <li key={it.key}>
                  <Link href={it.href} className="block">
                    <span className="block truncate text-[14.5px]">
                      {it.time && <span className="tabular mr-1.5 text-fg-3">{it.time}</span>}
                      {it.title}
                    </span>
                    <span className="block truncate text-[12px] text-fg-4">{it.where}</span>
                  </Link>
                </li>
              ))}
            </ul>
          </li>
        ))}
      </ol>
    </section>
  );
}
