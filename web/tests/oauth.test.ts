import { describe, expect, it } from 'vitest';
import { authServerMetadata, parseScopes, protectedResourceMetadata } from '@/lib/oauth';
import { safePushUrl } from '@/lib/push';

describe('oauth metadata', () => {
  it('advertises PKCE-only public clients and the MCP resource', () => {
    const m = authServerMetadata('https://www.slates.space');
    expect(m.code_challenge_methods_supported).toEqual(['S256']);
    expect(m.token_endpoint_auth_methods_supported).toEqual(['none']);
    expect(protectedResourceMetadata('https://www.slates.space').resource).toBe('https://www.slates.space/mcp');
  });

  it('parses scopes, defaulting to read+write and implying read for write', () => {
    expect(parseScopes(undefined)).toEqual(['read', 'write']);
    expect(parseScopes('slates:read')).toEqual(['read']);
    expect(parseScopes('slates:write')).toEqual(['read', 'write']);
    expect(parseScopes('openid profile')).toEqual(['read', 'write']);
  });
});

describe('push urls', () => {
  it('only opens same-site paths', () => {
    expect(safePushUrl('/s/today')).toBe('/s/today');
    for (const u of ['https://evil.com', '//evil.com', '/\\evil.com', 'javascript:x', undefined]) {
      expect(safePushUrl(u)).toBe('/home');
    }
  });
});
