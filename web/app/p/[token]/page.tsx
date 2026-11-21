import { notFound } from 'next/navigation';
import { supabaseAnon } from '@/lib/supabase/server';
import { Logo } from '@/components/logo';
import { PublicBoard, asSlate } from '@/components/public/public-board';
import type { Note, SlateKind } from '@/lib/kinds';

export const dynamic = 'force-dynamic';
export const metadata = { title: 'Shared board', robots: { index: false, follow: false } };

type Shared = { slug: string; title: string; kind: SlateKind; icon: string | null; category: string | null; data: Record<string, unknown>; updated_at: string; notes: Note[] | null };

export default async function SharedBoard({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  if (!/^[A-Za-z0-9_-]{20,64}$/.test(token)) notFound();
  const { data } = await supabaseAnon().rpc('shared_slate', { p_token: token });
  const s = data as Shared | null;
  if (!s) notFound();
  return (
    <main className="mx-auto w-full max-w-3xl px-4 pb-16 pt-[calc(24px+var(--safe-top))] sm:px-6 lg:max-w-5xl">
      <div className="mb-6 flex items-center justify-between">
        <a href="/" className="flex items-center gap-2">
          <Logo className="size-7" />
          <span className="text-[18px] font-semibold tracking-[-0.05em]">slates</span>
        </a>
        <span className="pill">Read only · updated {new Date(s.updated_at).toLocaleDateString('en', { day: 'numeric', month: 'short' })}</span>
      </div>
      <PublicBoard slate={asSlate({ ...s, updated_at: s.updated_at })} notes={s.notes ?? undefined} />
    </main>
  );
}
