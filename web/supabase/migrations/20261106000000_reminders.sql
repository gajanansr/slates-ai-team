-- Reminders: timed tasks that push a notification when due. Created by the user or
-- by agents ("remind me at 6pm to call the bank"). A minute scheduler (pg_cron +
-- pg_net, set up outside migrations because it holds the cron secret; see HANDOFF)
-- calls /api/cron/reminders, which claims due rows via cron_due_reminders().

-- ---------------------------------------------------------------------------
-- Per-user settings (timezone for "today" and repeat arithmetic)
-- ---------------------------------------------------------------------------
create table public.user_settings (
  owner_id   uuid primary key references auth.users (id) on delete cascade,
  timezone   text not null default 'Asia/Kolkata',
  updated_at timestamptz not null default now()
);
alter table public.user_settings enable row level security;
create policy "owner reads settings" on public.user_settings for select to authenticated using (owner_id = (select auth.uid()));
revoke all on public.user_settings from anon, authenticated;
grant select on public.user_settings to authenticated;

create table public.reminders (
  id          uuid primary key default gen_random_uuid(),
  owner_id    uuid not null references auth.users (id) on delete cascade,
  text        text not null check (char_length(text) between 1 and 200),
  due_at      timestamptz not null,
  tz          text not null default 'Asia/Kolkata',
  repeat      text check (repeat in ('daily', 'weekdays', 'weekly', 'monthly')),
  slate_slug  text,
  notify_at   timestamptz,          -- next push; null when nothing is pending
  sent_at     timestamptz,          -- last push
  done_at     timestamptz,
  created_by  uuid references public.agents (id) on delete set null,
  created_at  timestamptz not null default now()
);
create index reminders_owner_due_idx on public.reminders (owner_id, due_at) where done_at is null;
create index reminders_notify_idx on public.reminders (notify_at) where notify_at is not null;

alter table public.reminders enable row level security;
create policy "owner reads reminders" on public.reminders for select to authenticated using (owner_id = (select auth.uid()));
revoke all on public.reminders from anon, authenticated;
grant select on public.reminders to authenticated;

-- ---------------------------------------------------------------------------
-- Helpers
-- ---------------------------------------------------------------------------
-- Same caller resolution as slates_exec: session user, or a live agent token.
create or replace function public._resolve_caller(p_token text, out owner_id uuid, out agent_id uuid, out scopes text[])
language plpgsql stable security definer set search_path = public, pg_temp as $$
begin
  if p_token is not null then
    select a.owner_id, a.id, a.scopes into owner_id, agent_id, scopes
      from public.agents a
     where a.token_hash = public._sha256_hex(p_token)
       and a.revoked_at is null and (a.expires_at is null or a.expires_at > now());
    if agent_id is null then
      raise exception 'invalid or revoked agent token' using errcode = 'P0401';
    end if;
  else
    owner_id := auth.uid();
    if owner_id is null then
      raise exception 'not authenticated' using errcode = 'P0401';
    end if;
    scopes := array['read', 'write'];
  end if;
end;
$$;

-- Next occurrence strictly after now(), computed in the reminder's local timezone.
create or replace function public._next_due(p_due timestamptz, p_tz text, p_repeat text)
returns timestamptz
language plpgsql stable as $$
declare
  t timestamp := p_due at time zone p_tz;
begin
  loop
    t := t + case p_repeat
                when 'weekly'  then interval '7 days'
                when 'monthly' then interval '1 month'
                else interval '1 day'
              end;
    if p_repeat = 'weekdays' then
      while extract(isodow from t) > 5 loop
        t := t + interval '1 day';
      end loop;
    end if;
    exit when (t at time zone p_tz) > now();
  end loop;
  return t at time zone p_tz;
end;
$$;

create or replace function public._reminder_json(r public.reminders) returns jsonb
language sql stable security definer set search_path = public, pg_temp as $$
  select (to_jsonb(r) - 'owner_id')
    || jsonb_build_object('created_by_name', (select name from public.agents where id = r.created_by))
$$;

-- ---------------------------------------------------------------------------
-- reminders_exec: list / create / complete / snooze / cancel (user or agent)
-- ---------------------------------------------------------------------------
create or replace function public.reminders_exec(p_op text, p_args jsonb default '{}'::jsonb, p_token text default null)
returns jsonb
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  c        record;
  v_args   jsonb := coalesce(p_args, '{}'::jsonb);
  v_tz     text;
  v_due    timestamptz;
  r        public.reminders;
  v_result jsonb;
begin
  select * into c from public._resolve_caller(p_token);
  if p_op not in ('list', 'context') and not ('write' = any (c.scopes)) then
    raise exception 'this token is read-only' using errcode = 'P0403';
  end if;
  if p_op in ('complete', 'snooze', 'cancel') then
    select * into r from public.reminders
     where id = nullif(v_args ->> 'id', '')::uuid and owner_id = c.owner_id
     for update;
    if r.id is null then
      raise exception 'reminder not found' using errcode = 'P0404';
    end if;
  end if;

  case p_op
  when 'context' then
    return jsonb_build_object(
      'now', now(),
      'timezone', coalesce((select timezone from public.user_settings where owner_id = c.owner_id), 'Asia/Kolkata'));

  when 'list' then
    select coalesce(jsonb_agg(public._reminder_json(x) order by x.due_at), '[]'::jsonb) into v_result
      from (select * from public.reminders
             where owner_id = c.owner_id
               and (coalesce((v_args ->> 'include_done')::boolean, false) or done_at is null)
             order by due_at
             limit least(greatest(coalesce((v_args ->> 'limit')::int, 100), 1), 300)) x;
    return v_result;

  when 'create' then
    if coalesce(trim(v_args ->> 'text'), '') = '' then
      raise exception 'text is required' using errcode = 'P0422';
    end if;
    begin
      v_due := (v_args ->> 'at')::timestamptz;
    exception when others then
      raise exception 'at must be an ISO 8601 date-time, e.g. 2026-11-04T18:00:00+05:30' using errcode = 'P0422';
    end;
    if v_due is null then
      raise exception 'at is required' using errcode = 'P0422';
    end if;
    if v_due > now() + interval '2 years' then
      raise exception 'at is too far in the future' using errcode = 'P0422';
    end if;
    v_tz := coalesce(nullif(v_args ->> 'timezone', ''),
                     (select timezone from public.user_settings where owner_id = c.owner_id), 'Asia/Kolkata');
    perform now() at time zone v_tz;  -- raises on an unknown timezone
    if (select count(*) from public.reminders where owner_id = c.owner_id and done_at is null) >= 500 then
      raise exception 'too many open reminders (500)' using errcode = 'P0422';
    end if;
    insert into public.reminders (owner_id, text, due_at, tz, repeat, slate_slug, notify_at, created_by)
    values (c.owner_id, left(trim(v_args ->> 'text'), 200), v_due, v_tz, nullif(v_args ->> 'repeat', ''),
            nullif(v_args ->> 'slug', ''), v_due, c.agent_id)
    returning * into r;
    perform public._log(c.owner_id, c.agent_id, null, 'reminder_set',
      r.text || ' · ' || to_char(r.due_at at time zone r.tz, 'Dy DD Mon HH24:MI') || coalesce(' · ' || r.repeat, ''));
    return public._reminder_json(r);

  when 'complete' then
    if r.repeat is not null then
      update public.reminders
         set due_at = public._next_due(due_at, tz, repeat), notify_at = public._next_due(due_at, tz, repeat)
       where id = r.id returning * into r;
    else
      update public.reminders set done_at = now(), notify_at = null where id = r.id returning * into r;
    end if;
    perform public._log(c.owner_id, c.agent_id, null, 'reminder_done', r.text);
    return public._reminder_json(r);

  when 'snooze' then
    update public.reminders
       set due_at = now() + make_interval(mins => least(greatest(coalesce((v_args ->> 'minutes')::int, 10), 1), 10080)),
           notify_at = now() + make_interval(mins => least(greatest(coalesce((v_args ->> 'minutes')::int, 10), 1), 10080)),
           done_at = null
     where id = r.id returning * into r;
    return public._reminder_json(r);

  when 'cancel' then
    delete from public.reminders where id = r.id;
    perform public._log(c.owner_id, c.agent_id, null, 'reminder_cancelled', r.text);
    return jsonb_build_object('cancelled', r.id);

  else
    raise exception 'unknown op "%"', p_op using errcode = 'P0422';
  end case;
end;
$$;

-- Signed-in user's timezone (the app sends the browser's zone).
create or replace function public.set_timezone(p_tz text)
returns void
language plpgsql security definer set search_path = public, pg_temp as $$
begin
  if auth.uid() is null then
    raise exception 'not authenticated' using errcode = 'P0401';
  end if;
  perform now() at time zone p_tz;  -- validates
  insert into public.user_settings (owner_id, timezone) values (auth.uid(), p_tz)
  on conflict (owner_id) do update set timezone = excluded.timezone, updated_at = now();
end;
$$;

-- Scheduler: claim due reminders (skip-locked so overlapping runs never double-send),
-- advance repeats, and return what to push. Gated by the cron secret.
create or replace function public.cron_due_reminders(p_secret text)
returns jsonb
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  r   public.reminders;
  out jsonb := '[]'::jsonb;
begin
  if p_secret is null or public._sha256_hex(p_secret) is distinct from (select value from public.app_config where key = 'cron_secret_hash') then
    raise exception 'forbidden' using errcode = 'P0403';
  end if;
  for r in
    select * from public.reminders
     where notify_at <= now() and done_at is null
     order by notify_at
     limit 200
     for update skip locked
  loop
    out := out || jsonb_build_object(
      'id', r.id, 'owner_id', r.owner_id, 'text', r.text, 'slug', r.slate_slug, 'repeat', r.repeat,
      'due_local', to_char(r.due_at at time zone r.tz, 'HH24:MI'),
      'subscriptions', coalesce((
        select jsonb_agg(jsonb_build_object('endpoint', s.endpoint, 'keys', jsonb_build_object('p256dh', s.p256dh, 'auth', s.auth)))
          from public.push_subscriptions s where s.owner_id = r.owner_id), '[]'::jsonb));
    if r.repeat is not null then
      update public.reminders
         set sent_at = now(), due_at = public._next_due(r.due_at, r.tz, r.repeat), notify_at = public._next_due(r.due_at, r.tz, r.repeat)
       where id = r.id;
    else
      update public.reminders set sent_at = now(), notify_at = null where id = r.id;
    end if;
    perform public._log(r.owner_id, r.created_by, null, 'reminded', r.text);
  end loop;
  return out;
end;
$$;

-- ---------------------------------------------------------------------------
-- Privileges
-- ---------------------------------------------------------------------------
revoke all on function public._resolve_caller(text) from public, anon, authenticated;
revoke all on function public._next_due(timestamptz, text, text) from public, anon, authenticated;
revoke all on function public._reminder_json(public.reminders) from public, anon, authenticated;
revoke all on function public.reminders_exec(text, jsonb, text) from public;
revoke all on function public.set_timezone(text) from public, anon;
revoke all on function public.cron_due_reminders(text) from public;
grant execute on function public.reminders_exec(text, jsonb, text) to anon, authenticated;
grant execute on function public.set_timezone(text) to authenticated;
grant execute on function public.cron_due_reminders(text) to anon, authenticated;

alter publication supabase_realtime add table public.reminders;
