'use server';
import { redirect } from 'next/navigation';
import { supabaseServer } from '@/lib/supabase/server';

type ClientInfo = { client_id: string; name: string; redirect_uris: string[] };

function back(redirectUri: string, params: Record<string, string | undefined>) {
  const u = new URL(redirectUri);
  for (const [k, v] of Object.entries(params)) if (v) u.searchParams.set(k, v);
  return u.toString();
}

/**
 * Approve or deny. Every value is re-validated server-side; the form is not trusted.
 * Returns where to send the person back instead of redirecting, so the page can show a clear
 * "you're connected" state even when the browser hands off to an app and this tab stays open.
 */
export async function decide(form: FormData): Promise<{ url: string; allowed: boolean }> {
  const clientId = String(form.get('client_id') ?? '');
  const redirectUri = String(form.get('redirect_uri') ?? '');
  const state = form.get('state') ? String(form.get('state')) : undefined;
  const challenge = String(form.get('code_challenge') ?? '');
  const access = String(form.get('access') ?? 'write');
  const decision = String(form.get('decision') ?? 'deny');

  const sb = await supabaseServer();
  const { data: client } = await sb.rpc('oauth_client_info', { p_client_id: clientId });
  const info = client as ClientInfo | null;
  if (!info || !info.redirect_uris.includes(redirectUri)) redirect('/oauth/authorize?error=invalid_client');

  if (decision !== 'allow') return { url: back(redirectUri, { error: 'access_denied', state }), allowed: false };

  const { data: code, error } = await sb.rpc('oauth_issue_code', {
    p_client_id: clientId,
    p_redirect_uri: redirectUri,
    p_challenge: challenge,
    p_scopes: access === 'read' ? ['read'] : ['read', 'write'],
  });
  if (error || !code) return { url: back(redirectUri, { error: 'server_error', state }), allowed: false };
  return { url: back(redirectUri, { code: code as string, state }), allowed: true };
}
