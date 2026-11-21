'use server';
import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { supabaseServer } from '@/lib/supabase/server';
import { toSlatesError, type Caller } from '@/lib/slates';
import { desk, tagsIn, type DeskTarget } from '@/lib/desk';
import { about, ABOUT_ID } from '@/lib/about';
import { notePath, notes } from '@/lib/notes';

type Result = { ok: true } | { ok: false; error: string };

async function me(): Promise<Caller> {
  return { client: await supabaseServer(), token: null };
}

async function run(fn: (c: Caller) => Promise<unknown>, paths: string[] = []): Promise<Result> {
  try {
    await fn(await me());
  } catch (e) {
    return { ok: false, error: toSlatesError(e).message };
  }
  for (const p of ['/home', ...paths]) revalidatePath(p);
  return { ok: true };
}

export const answerQuestion = async (id: string, answer: string) => (answer.trim() ? run((c) => desk.answer(c, id, answer)) : ({ ok: false, error: 'Write an answer first' } as Result));

export const decideApproval = async (id: string, approve: boolean) => run((c) => desk.decide(c, id, approve), ['/spaces', '/boards', '/notes']);

export const removeDeskItem = async (id: string, path?: string) => run((c) => desk.remove(c, id), path ? [path] : []);

/** Leave a task for your agents. Tag one or more with @claude or @instinct; untagged goes to whichever agent connects next. */
export const tellAgents = async (text: string, target?: DeskTarget, path?: string) => {
  const t = text.slice(0, 500);
  const tags = tagsIn(t);
  return run((c) => desk.add(c, 'instruction', { text: t, target, to: tags.length ? tags.join(',') : undefined }), path ? [path] : []);
};

/** Names of your connected agents, for the @ suggestions. */
export async function agentNames(): Promise<string[]> {
  try {
    const sb = await supabaseServer();
    const { data } = await sb.from('agents').select('name').is('revoked_at', null).order('created_at', { ascending: false }).limit(12);
    return [...new Set((data ?? []).map((a: { name: string }) => a.name))];
  } catch {
    return [];
  }
}

/** Open the shared memory note, creating it the first time. */
export async function openAboutMe() {
  await about.ensure(await me());
  redirect(notePath(ABOUT_ID));
}

/** Start a playbook: a note tagged "playbook" that every agent checks before a recurring job. */
export async function newPlaybook() {
  const n = await notes.add(await me(), {
    title: 'New playbook',
    tags: ['playbook'],
    body: '## When to use this\n\n## Steps\n- [ ] \n\n## What good looks like\n',
  });
  revalidatePath('/agents');
  redirect(`${notePath(n.id)}?edit=1`);
}
