'use server';
import { revalidatePath } from 'next/cache';
import { supabaseServer } from '@/lib/supabase/server';
import { isAvatarStyle } from '@/components/avatar';

export async function saveProfile(input: { name?: string; avatar?: string }) {
  const data: Record<string, string> = {};
  if (input.name !== undefined) data.full_name = input.name.replace(/\s+/g, ' ').trim().slice(0, 60);
  if (input.avatar !== undefined) {
    if (!isAvatarStyle(input.avatar)) return { ok: false as const, error: 'Unknown avatar' };
    data.avatar = input.avatar;
  }
  const { error } = await (await supabaseServer()).auth.updateUser({ data });
  if (error) return { ok: false as const, error: error.message };
  revalidatePath('/', 'layout');
  return { ok: true as const };
}
