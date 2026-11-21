'use server';
import { revalidatePath } from 'next/cache';
import { supabaseServer } from '@/lib/supabase/server';
import { reminders, type Repeat } from '@/lib/reminders';
import { toSlatesError } from '@/lib/slates';

const me = async () => ({ client: await supabaseServer(), token: null });
const PATHS = ['/home', '/reminders', '/activity'];

async function run(fn: () => Promise<unknown>) {
  try {
    await fn();
    for (const p of PATHS) revalidatePath(p);
    return { ok: true } as const;
  } catch (e) {
    return { ok: false, error: toSlatesError(e).message } as const;
  }
}

/** `at` is an ISO instant computed in the browser from the user's local date/time. */
export async function addReminder(text: string, at: string, repeat: Repeat | '') {
  if (!text.trim()) return { ok: false, error: 'Write what to be reminded about' } as const;
  if (Number.isNaN(Date.parse(at))) return { ok: false, error: 'Pick a date and time' } as const;
  return run(async () => reminders.create(await me(), { text: text.trim(), at, repeat: repeat || undefined }));
}

export async function completeReminder(id: string) {
  return run(async () => reminders.complete(await me(), id));
}

export async function snoozeReminder(id: string, minutes: number) {
  return run(async () => reminders.snooze(await me(), id, minutes));
}

export async function cancelReminder(id: string) {
  return run(async () => reminders.cancel(await me(), id));
}

export async function syncTimezone(tz: string) {
  const sb = await supabaseServer();
  await sb.rpc('set_timezone', { p_tz: tz.slice(0, 64) });
}
