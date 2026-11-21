'use server';
import { redirect } from 'next/navigation';
import { supabaseServer } from '@/lib/supabase/server';

/** Approve or deny an agent's pairing code. Everything is re-validated in the database. */
export async function decidePair(form: FormData) {
  const code = String(form.get('code') ?? '').toUpperCase().trim();
  const allow = String(form.get('decision')) === 'allow';
  const access = String(form.get('access') ?? 'write');
  const d = Number(form.get('days') ?? 0);
  const days = Number.isInteger(d) && d > 0 ? d : null;
  const boards = form.getAll('boards').map(String).filter(Boolean).slice(0, 100);
  const sb = await supabaseServer();
  const { error } = await sb.rpc('pair_decide', {
    p_user_code: code,
    p_allow: allow,
    p_scopes: access === 'read' ? ['read'] : ['read', 'write'],
    p_days: days,
    p_boards: boards.length ? boards : null,
  });
  if (error) redirect(`/pair?code=${encodeURIComponent(code)}&error=${encodeURIComponent(error.message)}`);
  redirect(`/pair?code=${encodeURIComponent(code)}&done=${allow ? 'allowed' : 'denied'}`);
}

export async function lookup(form: FormData) {
  const code = String(form.get('code') ?? '').toUpperCase().replace(/[^A-Z0-9]/g, '');
  redirect(`/pair?code=${code.length === 8 ? `${code.slice(0, 4)}-${code.slice(4)}` : code}`);
}
