import { authServerMetadata, oauthJson, oauthPreflight } from '@/lib/oauth';

export function GET(req: Request) {
  return oauthJson(authServerMetadata(new URL(req.url).origin));
}
export const OPTIONS = oauthPreflight;
