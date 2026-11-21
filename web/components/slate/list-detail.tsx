'use client';
import { useState } from 'react';

/** Long item details clamp to 2 lines with an explicit More/Less toggle. */
export function ListDetail({ text }: { text: string }) {
  const [open, setOpen] = useState(false);
  const long = text.length > 140;
  return (
    <span className="mt-0.5 block text-[13px] leading-snug text-fg-3">
      <span className={open || !long ? '' : 'line-clamp-2'}>{text}</span>
      {long && (
        <button type="button" onClick={() => setOpen((o) => !o)} className="mt-1 text-[12.5px] font-medium text-fg-2 underline decoration-fg-4 underline-offset-2">
          {open ? 'Less' : 'More'}
        </button>
      )}
    </span>
  );
}
