'use server';
import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { supabaseServer } from '@/lib/supabase/server';
import { toSlatesError, type Caller } from '@/lib/slates';
import { notes, notePath } from '@/lib/notes';
import { uploadFiles } from '@/lib/files';

type Result = { ok: true } | { ok: false; error: string };

async function me(): Promise<Caller> {
  return { client: await supabaseServer(), token: null };
}

function refresh(id?: string) {
  for (const p of ['/notes', '/home', '/activity']) revalidatePath(p);
  if (id) revalidatePath(notePath(id));
  revalidatePath('/s/[slug]', 'page');
}

export async function newNote(title: string) {
  let id: string;
  try {
    id = (await notes.add(await me(), { title: title.trim().slice(0, 120) || 'Untitled', body: '' })).id;
  } catch (e) {
    return { ok: false, error: toSlatesError(e).message } as Result;
  }
  refresh(id);
  redirect(`${notePath(id)}?edit=1`);
}

/** Keep-style quick capture: add a note without leaving the list. */
export async function quickNote(title: string, body: string): Promise<Result> {
  const t = title.trim();
  const b = body.trim();
  if (!t && !b) return { ok: false, error: 'Write something first' };
  try {
    const id = (await notes.add(await me(), { title: (t || b.split('\n')[0]).slice(0, 120), body: t ? b : b.split('\n').slice(1).join('\n').trim() })).id;
    refresh(id);
    return { ok: true };
  } catch (e) {
    return { ok: false, error: toSlatesError(e).message };
  }
}

export async function saveNote(id: string, patch: { title?: string; body?: string; tags?: string[]; pinned?: boolean }): Promise<Result> {
  try {
    const title = patch.title?.trim();
    await notes.update(await me(), id, { ...patch, title: title === undefined ? undefined : title.slice(0, 120) || 'Untitled' });
    refresh(id);
    return { ok: true };
  } catch (e) {
    return { ok: false, error: toSlatesError(e).message };
  }
}

export async function deleteNote(id: string) {
  try {
    await notes.remove(await me(), id);
  } catch (e) {
    return { ok: false, error: toSlatesError(e).message } as Result;
  }
  refresh();
  redirect('/notes');
}

/** One image or voice clip for a note, already compressed on the device. Returns its storage path. */
export async function uploadNoteImage(form: FormData): Promise<{ ok: true; path: string } | { ok: false; error: string }> {
  try {
    const c = await me();
    const { data } = await c.client.auth.getUser();
    if (!data.user) return { ok: false, error: 'Sign in again' };
    const file = form.get('file');
    if (!(file instanceof File) || !/^(image|audio)\//.test(file.type)) return { ok: false, error: 'Pick an image or record a voice note' };
    const [ref] = await uploadFiles(c.client, data.user.id, [file]);
    return { ok: true, path: ref.path };
  } catch (e) {
    const msg = toSlatesError(e).message;
    // Storage refuses audio until the voice-notes migration has been run.
    return { ok: false, error: /mime type .* is not supported/i.test(msg) ? 'Voice notes are not switched on yet (the storage update has not been run).' : msg };
  }
}
