import { ICONS } from '@/components/board-icon';
import { Sparkles } from 'lucide-react';
import type { IconName } from '@/lib/icons';

const SIZES = {
  sm: { box: 'size-9 rounded-xl', icon: 'size-[18px]' },
  md: { box: 'size-12 rounded-[18px]', icon: 'size-6' },
  lg: { box: 'size-16 rounded-[24px]', icon: 'size-8' },
  xl: { box: 'size-20 rounded-[28px] sm:size-24 sm:rounded-[32px]', icon: 'size-10 sm:size-12' },
} as const;

/** An agent's icon on a soft tile of its accent colour. Needs a [data-agent] ancestor. */
export function AgentMark({ icon, size = 'md' }: { icon: string; size?: keyof typeof SIZES }) {
  const Icon = ICONS[icon as IconName] ?? Sparkles;
  const s = SIZES[size];
  return (
    <span aria-hidden className={`relative grid flex-none place-items-center bg-[var(--agent-soft)] text-[var(--agent)] shadow-[inset_0_0_0_1px_var(--agent-line)] ${s.box}`}>
      <Icon className={s.icon} strokeWidth={1.6} />
    </span>
  );
}
