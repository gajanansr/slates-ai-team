import 'server-only';
import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';
import { SlatesError } from '@/lib/slates';

/**
 * AES-256-GCM for secrets the server must reuse later (the built-in assistant's agent
 * token, Google refresh tokens). The key (SLATES_ENC_KEY, 32 bytes base64) lives only in
 * the server env, so a database leak alone never exposes these secrets.
 */
function key() {
  const raw = process.env.SLATES_ENC_KEY;
  const k = raw ? Buffer.from(raw, 'base64') : null;
  if (!k || k.length !== 32) throw new SlatesError('Automations are not configured on the server yet (SLATES_ENC_KEY).', 503, 'unavailable');
  return k;
}

export const encryptionReady = () => {
  try {
    key();
    return true;
  } catch {
    return false;
  }
};

export function encrypt(plain: string) {
  const iv = randomBytes(12);
  const c = createCipheriv('aes-256-gcm', key(), iv);
  const body = Buffer.concat([c.update(plain, 'utf8'), c.final()]);
  return `v1.${iv.toString('base64url')}.${body.toString('base64url')}.${c.getAuthTag().toString('base64url')}`;
}

export function decrypt(token: string) {
  const [v, iv, body, tag] = token.split('.');
  if (v !== 'v1' || !iv || !body || !tag) throw new Error('bad ciphertext');
  const d = createDecipheriv('aes-256-gcm', key(), Buffer.from(iv, 'base64url'));
  d.setAuthTag(Buffer.from(tag, 'base64url'));
  return Buffer.concat([d.update(Buffer.from(body, 'base64url')), d.final()]).toString('utf8');
}
