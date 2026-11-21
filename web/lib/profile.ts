import type { User } from '@supabase/supabase-js';
import { isAvatarStyle, type AvatarStyle } from '@/components/avatar';

export type Profile = { name: string | null; avatar: AvatarStyle; email: string };

/** Display name and avatar live in the auth user's metadata. */
export function profileOf(user: User | null | undefined): Profile {
  const m = (user?.user_metadata ?? {}) as Record<string, unknown>;
  const name = typeof m.full_name === 'string' && m.full_name.trim() ? m.full_name.trim().slice(0, 60) : null;
  return { name, avatar: isAvatarStyle(m.avatar) ? m.avatar : 'maker', email: user?.email ?? '' };
}
