import Link from 'next/link';
import { IllustrationPanel } from '@/components/illustrations';

export default function NotFound() {
  return (
    <main className="mx-auto grid min-h-[80dvh] max-w-sm place-items-center px-5 text-center">
      <div className="rise w-full">
        <IllustrationPanel name="compass" className="mb-6 h-[180px]" />
        <p className="kicker mb-2">404</p>
        <h1 className="text-[28px] font-medium tracking-[-0.04em]">Nothing on this slate.</h1>
        <p className="mt-2 text-sm text-fg-3">It may have been archived or deleted.</p>
        <Link href="/home" className="btn btn-primary mt-6 w-full">
          Back home
        </Link>
      </div>
    </main>
  );
}
