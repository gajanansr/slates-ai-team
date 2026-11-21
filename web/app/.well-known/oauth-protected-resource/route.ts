import { oauthJson, oauthPreflight, protectedResourceMetadata } from '@/lib/oauth';

export function GET(req: Request) {
  return oauthJson(protectedResourceMetadata(new URL(req.url).origin));
}
export const OPTIONS = oauthPreflight;
