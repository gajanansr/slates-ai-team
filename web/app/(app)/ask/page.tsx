import { Suspense } from 'react';
import Link from 'next/link';
import { Phone } from 'lucide-react';
import { PageHeader } from '@/components/page-header';
import { AskChat } from '@/components/ask/ask-chat';
import { askReady } from '@/lib/assistant';

export const metadata = { title: 'Ask Slates' };

export default function AskPage() {
  return (
    <div className="ask-screen">
      <PageHeader
        title="Ask Slates"
        actions={
          <Link href="/call" aria-label="Call Slates" title="Call Slates" className="btn btn-glass btn-icon">
            <Phone className="size-[18px]" strokeWidth={1.75} />
          </Link>
        }
      />
      <Suspense>
        <AskChat ready={askReady()} />
      </Suspense>
    </div>
  );
}
