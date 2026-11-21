import { categoryOf, categorySlug } from '@/lib/summary';
import type { MarkdownData, Note, Slate } from '@/lib/kinds';
import { SlateBody } from '@/components/slate/slate-body';
import { SlateMeta } from '@/components/slate/slate-card';
import { SlateActions } from '@/components/slate/slate-actions';
import { TitleEditor } from '@/components/slate/title-editor';
import { QuickAdd } from '@/components/slate/quick-add';
import { MarkdownEditor } from '@/components/slate/markdown-editor';
import { NavBar } from '@/components/slate/nav-bar';
import { PageTransition } from '@/components/page-transition';
import { IllustrationPanel, KIND_ILLUSTRATION } from '@/components/illustrations';
import { CopyBlock } from '@/components/copy';
import { TellAgents, type Told } from '@/components/desk/tell-agents';
import { Attachments } from '@/components/slate/attachments';
import { CustomizeDashboard } from '@/components/slate/customize-dashboard';

export function SlateDetailView({ slate, categories = [], notes, templatePrompt, told, shortcut }: { slate: Slate; categories?: string[]; notes?: Note[]; templatePrompt?: string; told?: Told[]; shortcut?: boolean }) {
  const files = slate.kind === 'list' ? ((slate.data as any).items ?? []).flatMap((i: any) => i.files ?? []) : [];
  return (
    <PageTransition>
      <NavBar
        title={slate.title}
        actions={
          <>
            {slate.kind === 'dashboard' && !slate.archived_at && <CustomizeDashboard slug={slate.slug} compact widgets={((slate.data as any).widgets ?? []).map((w: any) => ({ id: w.id, title: w.title, kind: w.kind, size: w.size, view: w.view, hidden: w.hidden, section: w.section }))} look={(slate.data as any).look} />}
            <SlateActions slate={slate} categories={categories} shortcut={shortcut} />
          </>
        }
        backHref={slate.kind === 'brief' || slate.slug === 'inbox' ? '/home' : slate.kind === 'notes' ? '/notes' : `/spaces/${categorySlug(categoryOf(slate))}`}
        backLabel={slate.kind === 'brief' ? 'Back to Today' : 'Back to space'}
      >
        <IllustrationPanel name={KIND_ILLUSTRATION[slate.kind]} className="mb-5 h-[132px] md:h-[160px]" />
        <header className="mb-5">
          <p className="kicker mb-2">
            {categoryOf(slate)}
            {slate.archived_at ? ' · archived' : slate.hidden ? ' · hidden' : ''}
          </p>
          <TitleEditor slug={slate.slug} title={slate.title} />
          <p className="mt-1.5">
            <SlateMeta slate={slate} />
          </p>
        </header>
      </NavBar>

      {templatePrompt && (
        <section className="sage-card rise mb-4 p-4">
          <p className="text-[15px] font-medium">Board created. Hand it to an agent</p>
          <p className="mb-3 mt-1 text-sm text-fg-3">Paste this into Claude, Instinct or any connected agent (or Ask Slates) so it keeps the board filled.</p>
          <CopyBlock text={templatePrompt} />
        </section>
      )}
      {slate.kind === 'dashboard' || slate.kind === 'tracker' ? (
        // These lay out their own panels (widgets, kanban columns) edge to edge: no wrapping card.
        <SlateBody slate={slate} mode="full" notes={notes} />
      ) : (
      <section className="card p-4 sm:p-6">
        {slate.kind === 'markdown' ? (
          <MarkdownEditor slug={slate.slug} body={(slate.data as MarkdownData).body ?? ''} version={slate.version}>
            <SlateBody slate={slate} mode="full" />
          </MarkdownEditor>
        ) : (
          <SlateBody slate={slate} mode="full" />
        )}
        {(slate.kind === 'list' || slate.kind === 'brief') && <QuickAdd slug={slate.slug} />}
        {files.length > 0 && <Attachments files={files} />}
      </section>
      )}
      {told && !slate.archived_at && <TellAgents target={{ type: 'slate', id: slate.slug, title: slate.title }} path={`/s/${slate.slug}`} told={told} />}
    </PageTransition>
  );
}
