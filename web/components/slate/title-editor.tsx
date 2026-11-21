'use client';
import { useState, useTransition } from 'react';
import { renameSlate } from '@/app/(app)/actions';

export function TitleEditor({ slug, title }: { slug: string; title: string }) {
  const [value, setValue] = useState(title);
  const [, start] = useTransition();
  const commit = () => {
    const v = value.trim();
    if (!v) return setValue(title);
    if (v !== title) start(() => void renameSlate(slug, v));
  };
  return (
    <input
      aria-label="Slate title"
      value={value}
      onChange={(e) => setValue(e.target.value)}
      onBlur={commit}
      onKeyDown={(e) => e.key === 'Enter' && (e.currentTarget as HTMLInputElement).blur()}
      maxLength={120}
      className="w-full truncate bg-transparent text-[32px] font-medium leading-[1.1] tracking-[-0.045em] outline-none md:text-[36px]"
    />
  );
}
