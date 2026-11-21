/** Spinner-free loading state: skeleton blocks with a visible edge. */
export function PageLoader({ label = 'Loading' }: { label?: string }) {
  return (
    <div aria-busy="true" role="status" aria-label={label} className="animate-pulse">
      <div className="mb-3 h-3 w-28 rounded-full bg-sage" />
      <div className="mb-6 h-8 w-52 rounded-full bg-sage" />
      <div className="mb-4 h-11 rounded-[18px] border border-line bg-surface" />
      <div className="grid grid-cols-2 gap-3">
        {[0, 1, 2, 3].map((i) => (
          <div key={i} className="h-24 rounded-[22px] border border-line bg-surface" />
        ))}
      </div>
    </div>
  );
}
