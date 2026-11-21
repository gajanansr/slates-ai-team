import 'server-only';
import { createClient } from '@supabase/supabase-js';
import { SUPABASE_URL } from '@/lib/env';
import { SlatesError } from '@/lib/slates';

/**
 * Service-role client. Used ONLY to send Supabase invites (auth admin API) and to
 * record their outcome. Everything else in the app runs under the user's session
 * or an agent token, behind RLS and SECURITY DEFINER checks.
 */
export function adminClient() {
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!key) throw new SlatesError('Invites are not configured on the server yet.', 503, 'unavailable');
  return createClient(SUPABASE_URL, key, { auth: { persistSession: false, autoRefreshToken: false } });
}
