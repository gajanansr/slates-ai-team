import { IllustrationPanel } from '@/components/illustrations';

export const metadata = { title: 'Offline' };

export default function Offline() {
  return (
    <main className="mx-auto grid min-h-dvh max-w-sm place-items-center px-5 text-center">
      <div className="rise w-full">
        <IllustrationPanel name="cloud" className="mb-6 h-[180px]" />
        <h1 className="text-[28px] font-medium tracking-[-0.04em]">You&apos;re offline.</h1>
        <p className="mt-2 text-sm text-fg-3">Slates will reconnect when you&apos;re back online.</p>
      </div>
    </main>
  );
}
