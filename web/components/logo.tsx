/** App mark: three stacked slates. Source of truth is brand/*.svg; public/icon.svg is the tile. */
export function Logo({ className = 'size-9' }: { className?: string }) {
  // eslint-disable-next-line @next/next/no-img-element
  return <img src="/icon.svg" alt="" aria-hidden className={`${className} select-none`} draggable={false} />;
}
