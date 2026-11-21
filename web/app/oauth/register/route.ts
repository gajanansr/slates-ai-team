import { supabaseAnon } from '@/lib/supabase/server';
import { oauthJson, oauthPreflight } from '@/lib/oauth';

/** RFC 7591 dynamic client registration (public clients, PKCE). */
export async function POST(req: Request) {
  let body: any;
  try {
    body = await req.json();
  } catch {
    return oauthJson({ error: 'invalid_client_metadata', error_description: 'Body must be JSON' }, 400);
  }
  const uris = Array.isArray(body?.redirect_uris) ? body.redirect_uris.filter((u: unknown) => typeof u === 'string') : [];
  if (uris.length === 0) return oauthJson({ error: 'invalid_redirect_uri', error_description: 'redirect_uris is required' }, 400);
  const { data, error } = await supabaseAnon().rpc('oauth_register_client', {
    p_name: typeof body.client_name === 'string' ? body.client_name : 'MCP client',
    p_redirect_uris: uris,
  });
  if (error) {
    const limited = error.code === 'P0429';
    return oauthJson({ error: limited ? 'temporarily_unavailable' : 'invalid_redirect_uri', error_description: error.message }, limited ? 429 : 400);
  }
  return oauthJson(
    {
      ...data,
      client_id_issued_at: Math.floor(Date.now() / 1000),
      grant_types: ['authorization_code', 'refresh_token'],
      response_types: ['code'],
      token_endpoint_auth_method: 'none',
    },
    201,
  );
}
export const OPTIONS = oauthPreflight;
