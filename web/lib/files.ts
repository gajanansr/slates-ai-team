import 'server-only';
import type { SupabaseClient } from '@supabase/supabase-js';
import type { FileRefT } from '@/lib/kinds';
import { SlatesError } from '@/lib/slates';

/** Private attachments bucket: one folder per user (Storage RLS enforces it). */
export const BUCKET = 'attachments';
const OK = /^(image\/(png|jpeg|webp|gif|heic)|application\/pdf|audio\/(webm|mp4|ogg|mpeg|aac|x-m4a))$/;
export const MAX_BYTES = 10 * 1024 * 1024;

export async function uploadFiles(client: SupabaseClient, userId: string, files: File[]): Promise<FileRefT[]> {
  const out: FileRefT[] = [];
  for (const f of files.slice(0, 10)) {
    if (!OK.test(f.type)) throw new SlatesError(`${f.name}: only images, PDFs and voice clips can be attached`, 422, 'invalid');
    if (f.size > MAX_BYTES) throw new SlatesError(`${f.name} is over 10 MB`, 422, 'invalid');
    const safe = f.name.replace(/[^\w.-]+/g, '_').slice(-80) || 'file';
    const path = `${userId}/${crypto.randomUUID()}-${safe}`;
    const { error } = await client.storage.from(BUCKET).upload(path, f, { contentType: f.type, upsert: false });
    if (error) throw new SlatesError(`Upload failed: ${error.message}`, 500, 'internal');
    out.push({ path, name: f.name.slice(0, 200), type: f.type, size: f.size });
  }
  return out;
}

/** Short-lived signed URLs for the signed-in owner (RLS denies anyone else). */
export async function signedUrls(client: SupabaseClient, paths: string[], seconds = 3600): Promise<Record<string, string>> {
  if (!paths.length) return {};
  const { data } = await client.storage.from(BUCKET).createSignedUrls(paths, seconds);
  return Object.fromEntries((data ?? []).filter((d) => d.signedUrl && d.path).map((d) => [d.path!, d.signedUrl as string]));
}
