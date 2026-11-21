import type { SupabaseClient } from '@supabase/supabase-js';
import { NOTES_SLUG, patchCollection, validateData, ValidationError, type Slate, type SlateKind } from '@/lib/kinds';

/**
 * The one service layer for reads and writes. Every call goes through the
 * `slates_exec` Postgres function, which resolves the caller (signed-in user or
 * agent token) to an owner and scopes everything to that owner.
 */
export type Caller = { client: SupabaseClient; token: string | null };

export class SlatesError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly code: string,
  ) {
    super(message);
  }
}

const STATUS: Record<string, [number, string]> = {
  P0401: [401, 'unauthorized'],
  P0403: [403, 'forbidden'],
  P0404: [404, 'not_found'],
  P0409: [409, 'conflict'],
  P0422: [422, 'invalid'],
  P0400: [400, 'invalid_grant'],
  P0429: [429, 'rate_limited'],
  '22P02': [422, 'invalid'], // invalid enum / cast
  '23505': [409, 'conflict'],
  '23514': [422, 'invalid'], // check constraint
};

export function toSlatesError(e: unknown): SlatesError {
  if (e instanceof SlatesError) return e;
  if (e instanceof ValidationError) return new SlatesError(e.message, 422, 'invalid');
  return new SlatesError(e instanceof Error ? e.message : 'Unexpected error', 500, 'internal');
}

export async function exec<T>(caller: Caller, op: string, args: Record<string, unknown> = {}, fn = 'slates_exec'): Promise<T> {
  const { data, error } = await caller.client.rpc(fn, {
    p_op: op,
    p_args: args,
    p_token: caller.token,
  });
  if (error) {
    const [status, code] = STATUS[error.code ?? ''] ?? [500, 'internal'];
    throw new SlatesError(status === 500 ? 'Database error' : error.message, status, code);
  }
  return data as T;
}

export type Activity = {
  id: number;
  agent_id: string | null;
  agent_name: string | null;
  slate_id: string | null;
  slate_slug: string | null;
  action: string;
  summary: string | null;
  created_at: string;
};

export type Whoami = { agent_id: string | null; agent_name: string | null; scopes: string[] };

const SLUG_RE = /^[a-z0-9][a-z0-9-]{0,62}$/;
function checkSlug(slug: unknown): string {
  if (typeof slug !== 'string' || !SLUG_RE.test(slug)) {
    throw new SlatesError('slug must be lowercase letters, digits and dashes (max 63)', 422, 'invalid');
  }
  return slug;
}

export const slates = {
  whoami: (c: Caller) => exec<Whoami>(c, 'whoami'),

  list: (c: Caller, opts: { include_archived?: boolean } = {}) => exec<Slate[]>(c, 'list', opts),

  get: (c: Caller, slug: string) => exec<Slate>(c, 'get', { slug: checkSlug(slug) }),

  async create(
    c: Caller,
    input: { title: string; kind: SlateKind; data: unknown; slug?: string; icon?: string; category?: string; pinned?: boolean; note?: string },
  ) {
    if (input.kind === 'notes' && input.slug !== NOTES_SLUG) {
      throw new SlatesError('There is one Notes board. Use add_note to write a note.', 422, 'invalid');
    }
    const data = validateData(input.kind, input.data);
    return exec<Slate>(c, 'create', {
      ...input,
      slug: input.slug === undefined ? undefined : checkSlug(input.slug),
      data,
    });
  },

  async update(
    c: Caller,
    slug: string,
    input: { title?: string; data?: unknown; icon?: string | null; category?: string | null; pinned?: boolean; hidden?: boolean; expected_version?: number; note?: string },
  ) {
    const args: Record<string, unknown> = { ...input, slug: checkSlug(slug) };
    if (input.data !== undefined) {
      const current = await slates.get(c, slug);
      args.data = validateData(current.kind, input.data);
    }
    return exec<Slate>(c, 'update', args);
  },

  /** Read-modify-write with optimistic concurrency; retries on concurrent edits. */
  async patchItems(
    c: Caller,
    slug: string,
    patch: { upsert?: Record<string, unknown>[]; remove?: string[]; prepend?: boolean; note?: string; expected_version?: number },
  ) {
    for (let attempt = 0; ; attempt++) {
      const current = await slates.get(c, slug);
      if (patch.expected_version !== undefined && current.version !== patch.expected_version) {
        throw new SlatesError(`version conflict: slate is at version ${current.version}, you sent ${patch.expected_version}. Re-read and retry.`, 409, 'conflict');
      }
      const next = validateData(current.kind, patchCollection(current.kind, current.data, patch));
      try {
        return await exec<Slate>(c, 'update', {
          slug,
          data: next,
          expected_version: current.version,
          note: patch.note ?? summarizePatch(patch),
        });
      } catch (e) {
        if (e instanceof SlatesError && e.status === 409 && attempt < 3 && patch.expected_version === undefined) continue;
        throw e;
      }
    }
  },

  archive: (c: Caller, slug: string, note?: string) => exec<Slate>(c, 'archive', { slug: checkSlug(slug), note }),
  restore: (c: Caller, slug: string) => exec<Slate>(c, 'restore', { slug: checkSlug(slug) }),
  remove: (c: Caller, slug: string) => exec<{ deleted: string }>(c, 'delete', { slug: checkSlug(slug) }),
  reorder: (c: Caller, slugs: string[]) => exec<{ ok: true }>(c, 'reorder', { slugs: slugs.map(checkSlug) }),
  log: (c: Caller, message: string, slug?: string) => exec<{ ok: true }>(c, 'log', { message, slug }),
  activity: (c: Caller, limit = 50) => exec<Activity[]>(c, 'activity', { limit }),
};

function summarizePatch(p: { upsert?: unknown[]; remove?: unknown[] }) {
  const parts = [];
  if (p.upsert?.length) parts.push(`upserted ${p.upsert.length} item${p.upsert.length === 1 ? '' : 's'}`);
  if (p.remove?.length) parts.push(`removed ${p.remove.length}`);
  return parts.length ? parts.join(', ') : 'No changes';
}
