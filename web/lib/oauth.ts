import 'server-only';

export const SCOPES = ['slates:read', 'slates:write'] as const;

export function authServerMetadata(origin: string) {
  return {
    issuer: origin,
    authorization_endpoint: `${origin}/oauth/authorize`,
    token_endpoint: `${origin}/oauth/token`,
    registration_endpoint: `${origin}/oauth/register`,
    response_types_supported: ['code'],
    grant_types_supported: ['authorization_code', 'refresh_token'],
    code_challenge_methods_supported: ['S256'],
    token_endpoint_auth_methods_supported: ['none'],
    scopes_supported: [...SCOPES],
    service_documentation: `${origin}/agents`,
  };
}

export function protectedResourceMetadata(origin: string) {
  return {
    resource: `${origin}/mcp`,
    authorization_servers: [origin],
    scopes_supported: [...SCOPES],
    bearer_methods_supported: ['header'],
    resource_name: 'Slates',
    resource_documentation: `${origin}/agents`,
  };
}

/** "slates:read slates:write" -> ['read','write'] (unknown scopes ignored; empty -> both). */
export function parseScopes(scope: string | null | undefined): ('read' | 'write')[] {
  const s = new Set((scope ?? '').split(/\s+/).filter(Boolean));
  const out: ('read' | 'write')[] = [];
  if (s.has('slates:read') || s.has('read')) out.push('read');
  if (s.has('slates:write') || s.has('write')) out.push('write');
  if (out.length === 0) return ['read', 'write'];
  if (out.includes('write') && !out.includes('read')) out.unshift('read');
  return out;
}

export function oauthJson(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      'Content-Type': 'application/json',
      'Cache-Control': 'no-store',
      Pragma: 'no-cache',
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Headers': 'Content-Type, Authorization, Mcp-Protocol-Version',
      'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
    },
  });
}

export const oauthPreflight = () => oauthJson(null, 204);
