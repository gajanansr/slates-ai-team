import { supabaseAnon } from '@/lib/supabase/server';
import { oauthJson, oauthPreflight } from '@/lib/oauth';

/** Token endpoint: authorization_code (PKCE S256) and refresh_token grants. */
export async function POST(req: Request) {
  const type = req.headers.get('content-type') ?? '';
  let p: Record<string, string>;
  try {
    p = type.includes('application/json')
      ? await req.json()
      : Object.fromEntries(new URLSearchParams(await req.text()));
  } catch {
    return oauthJson({ error: 'invalid_request' }, 400);
  }
  const sb = supabaseAnon();
  let result;
  if (p.grant_type === 'authorization_code') {
    if (!p.code || !p.code_verifier || !p.client_id || !p.redirect_uri) {
      return oauthJson({ error: 'invalid_request', error_description: 'code, code_verifier, client_id and redirect_uri are required' }, 400);
    }
    result = await sb.rpc('oauth_exchange_code', {
      p_code: p.code,
      p_verifier: p.code_verifier,
      p_client_id: p.client_id,
      p_redirect_uri: p.redirect_uri,
    });
  } else if (p.grant_type === 'refresh_token') {
    if (!p.refresh_token || !p.client_id) {
      return oauthJson({ error: 'invalid_request', error_description: 'refresh_token and client_id are required' }, 400);
    }
    result = await sb.rpc('oauth_refresh_token', { p_refresh: p.refresh_token, p_client_id: p.client_id });
  } else {
    return oauthJson({ error: 'unsupported_grant_type' }, 400);
  }
  if (result.error) {
    if (result.error.code === 'P0400') return oauthJson({ error: 'invalid_grant' }, 400);
    console.error('[oauth/token]', result.error);
    return oauthJson({ error: 'server_error' }, 500);
  }
  return oauthJson(result.data);
}
export const OPTIONS = oauthPreflight;
