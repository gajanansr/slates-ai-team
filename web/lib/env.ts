/**
 * Public Supabase config. The anon/publishable key is public by design: it can only
 * do what RLS and the granted functions allow. Override per environment via env vars.
 */
export const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL ?? 'https://xpvcppqaaizbwzyjaedu.supabase.co';
export const SUPABASE_ANON_KEY =
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ?? 'sb_publishable_VbstHM-4CC1VJ5jgyG0u9g_zr70j65C';

export const SITE_URL = process.env.NEXT_PUBLIC_SITE_URL ?? 'https://www.slates.space';

/** Web push: the public VAPID key is safe to ship; the private key lives only in Vercel env. */
export const VAPID_PUBLIC_KEY =
  process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY ??
  'BOHFP_1wQ9ZXx7igLRczWzu_TKMoQ0bacuye0p9MXR1ZL3jT6wxr55M1_JhVOc-SW8WG0wZzuI-DNJe_B2dnKck';
