import 'server-only';
import { cookies } from 'next/headers';

export type ViewMode = 'cards' | 'list';

/** The cards/list choice saved by the view toggle, so pages render it on the server. */
export async function viewMode(key: string): Promise<ViewMode> {
  const v = (await cookies()).get(`slates-view-${key}`)?.value;
  return v === 'list' ? 'list' : 'cards';
}
