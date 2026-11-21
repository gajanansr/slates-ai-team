-- History ("what changed" + undo), public read-only share links, board-scoped agent
-- tokens with expiry, "last seen" for Home, and automations (schedules + connectors).
-- Same model as before: tables are read-own via RLS; every write is a SECURITY DEFINER
-- function that resolves the caller first.

-- ---------------------------------------------------------------------------
-- History: a snapshot of every data/title change, newest 60 kept per board.
-- ---------------------------------------------------------------------------
create table public.slate_versions (
  id          bigint generated always as identity primary key,
  owner_id    uuid not null references auth.users (id) on delete cascade,
  slate_id    uuid not null references public.slates (id) on delete cascade,
  version     int not null,
  title       text not null,
  data        jsonb not null,
  agent_id    uuid references public.agents (id) on delete set null,
  agent_name  text,
  created_at  timestamptz not null default now(),
  unique (slate_id, version)
);
create index slate_versions_slate_idx on public.slate_versions (slate_id, version desc);

alter table public.slate_versions enable row level security;
create policy "owner reads versions" on public.slate_versions for select to authenticated using (owner_id = (select auth.uid()));
revoke all on public.slate_versions from anon, authenticated;
grant select on public.slate_versions to authenticated;

create or replace function public._snapshot_slate() returns trigger
language plpgsql security definer set search_path = public, pg_temp as $$
begin
  insert into public.slate_versions (owner_id, slate_id, version, title, data, agent_id, agent_name)
  values (new.owner_id, new.id, new.version, new.title, new.data, new.updated_by,
          (select name from public.agents where id = new.updated_by))
  on conflict (slate_id, version) do update set title = excluded.title, data = excluded.data;
  delete from public.slate_versions where slate_id = new.id and version <= new.version - 60;
  return null;
end;
$$;
revoke all on function public._snapshot_slate() from public, anon, authenticated;

create trigger slates_snapshot_insert after insert on public.slates
  for each row execute function public._snapshot_slate();
create trigger slates_snapshot_update after update of data, title on public.slates
  for each row when (old.data is distinct from new.data or old.title is distinct from new.title)
  execute function public._snapshot_slate();

-- Backfill: the current state of every board is its first recorded version.
insert into public.slate_versions (owner_id, slate_id, version, title, data, agent_id, agent_name, created_at)
select s.owner_id, s.id, s.version, s.title, s.data, s.updated_by, (select name from public.agents where id = s.updated_by), s.updated_at
  from public.slates s
on conflict do nothing;

-- ---------------------------------------------------------------------------
-- Board-scoped tokens and "last seen"
-- ---------------------------------------------------------------------------
alter table public.agents add column boards text[] check (boards is null or cardinality(boards) between 1 and 100);
grant select (id, owner_id, name, kind, scopes, token_prefix, last_used_at, revoked_at, created_at, expires_at, client_id, boards)
  on public.agents to authenticated;

alter table public.user_settings add column seen_at timestamptz;

-- Public read-only share link (a capability URL; revoke by clearing it).
alter table public.slates add column share_token text unique check (share_token is null or share_token ~ '^[A-Za-z0-9_-]{20,64}$');

-- ---------------------------------------------------------------------------
-- slates_exec: + board scopes for agent tokens.
-- ---------------------------------------------------------------------------
create or replace function public.slates_exec(p_op text, p_args jsonb default '{}'::jsonb, p_token text default null)
returns jsonb
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_owner  uuid;
  v_agent  uuid;
  v_scopes text[];
  v_boards text[];
  v_slate  public.slates;
  v_slug   text;
  v_base   text;
  v_n      int;
  v_result jsonb;
  v_args   jsonb := coalesce(p_args, '{}'::jsonb);
begin
  if p_token is not null then
    select a.id, a.owner_id, a.scopes, a.boards into v_agent, v_owner, v_scopes, v_boards
      from public.agents a
     where a.token_hash = encode(sha256(convert_to(p_token, 'UTF8')), 'hex')
       and a.revoked_at is null
       and (a.expires_at is null or a.expires_at > now());
    if v_agent is null then
      raise exception 'invalid or revoked agent token' using errcode = 'P0401';
    end if;
    update public.agents set last_used_at = now()
     where id = v_agent and (last_used_at is null or last_used_at < now() - interval '1 minute');
  else
    v_owner := auth.uid();
    if v_owner is null then
      raise exception 'not authenticated' using errcode = 'P0401';
    end if;
    v_scopes := array['read', 'write'];
  end if;

  if p_op not in ('whoami', 'list', 'get', 'activity') and not ('write' = any (v_scopes)) then
    raise exception 'this token is read-only' using errcode = 'P0403';
  end if;

  -- Board-scoped tokens touch only their boards.
  if v_boards is not null then
    if p_op in ('reorder') then
      raise exception 'this token is limited to some boards and cannot reorder' using errcode = 'P0403';
    end if;
    if p_op in ('get', 'update', 'archive', 'restore', 'delete', 'create')
       and not (coalesce(v_args ->> 'slug', '') = any (v_boards)) then
      raise exception 'this token cannot access board "%"', coalesce(v_args ->> 'slug', '(new)') using errcode = 'P0403';
    end if;
    if p_op = 'log' and v_args ? 'slug' and not ((v_args ->> 'slug') = any (v_boards)) then
      raise exception 'this token cannot access board "%"', v_args ->> 'slug' using errcode = 'P0403';
    end if;
  end if;

  if p_op in ('get', 'update', 'archive', 'restore', 'delete') then
    select * into v_slate from public.slates
     where owner_id = v_owner and slug = v_args ->> 'slug'
     for update;
    if v_slate.id is null then
      raise exception 'slate "%" not found', v_args ->> 'slug' using errcode = 'P0404';
    end if;
  end if;

  case p_op
  when 'whoami' then
    return jsonb_build_object(
      'agent_id', v_agent,
      'agent_name', (select name from public.agents where id = v_agent),
      'scopes', to_jsonb(v_scopes),
      'boards', to_jsonb(v_boards));

  when 'list' then
    select coalesce(jsonb_agg(public._slate_json(s) order by s.position, s.created_at), '[]'::jsonb)
      into v_result
      from public.slates s
     where s.owner_id = v_owner
       and (v_boards is null or s.slug = any (v_boards))
       and (coalesce((v_args ->> 'include_archived')::boolean, false) or s.archived_at is null);
    return v_result;

  when 'get' then
    return public._slate_json(v_slate);

  when 'create' then
    if coalesce(v_args ->> 'title', '') = '' or coalesce(v_args ->> 'kind', '') = '' then
      raise exception 'title and kind are required' using errcode = 'P0422';
    end if;
    if v_args ? 'slug' and v_args ->> 'slug' is not null then
      v_slug := v_args ->> 'slug';
      if exists (select 1 from public.slates where owner_id = v_owner and slug = v_slug) then
        raise exception 'slug "%" already exists', v_slug using errcode = 'P0409';
      end if;
    else
      v_base := public._slugify(v_args ->> 'title');
      v_slug := v_base;
      v_n := 1;
      while exists (select 1 from public.slates where owner_id = v_owner and slug = v_slug) loop
        v_n := v_n + 1;
        v_slug := left(v_base, 58) || '-' || v_n;
      end loop;
    end if;
    insert into public.slates (owner_id, slug, title, kind, icon, category, data, position, pinned, created_by, updated_by)
    values (
      v_owner, v_slug, v_args ->> 'title', (v_args ->> 'kind')::public.slate_kind, v_args ->> 'icon',
      nullif(trim(v_args ->> 'category'), ''),
      coalesce(v_args -> 'data', '{}'::jsonb),
      coalesce((v_args ->> 'position')::int,
               (select coalesce(max(position), -1) + 1 from public.slates where owner_id = v_owner)),
      coalesce((v_args ->> 'pinned')::boolean, false),
      v_agent, v_agent)
    returning * into v_slate;
    perform public._log(v_owner, v_agent, v_slate, 'created', coalesce(v_args ->> 'note', 'Created ' || v_slate.title));
    return public._slate_json(v_slate);

  when 'update' then
    if v_args ? 'expected_version' and (v_args ->> 'expected_version')::int <> v_slate.version then
      raise exception 'version conflict: slate is at version %, you sent %', v_slate.version, v_args ->> 'expected_version'
        using errcode = 'P0409';
    end if;
    update public.slates set
      title      = coalesce(v_args ->> 'title', title),
      icon       = case when v_args ? 'icon' then v_args ->> 'icon' else icon end,
      category   = case when v_args ? 'category' then nullif(trim(v_args ->> 'category'), '') else category end,
      data       = coalesce(v_args -> 'data', data),
      pinned     = coalesce((v_args ->> 'pinned')::boolean, pinned),
      hidden     = coalesce((v_args ->> 'hidden')::boolean, hidden),
      version    = version + 1,
      updated_by = v_agent,
      updated_at = now()
     where id = v_slate.id
    returning * into v_slate;
    perform public._log(v_owner, v_agent, v_slate, 'updated',
      coalesce(v_args ->> 'note',
        'Updated ' || (select string_agg(k, ', ') from jsonb_object_keys(v_args - 'slug' - 'expected_version' - 'note') k)));
    return public._slate_json(v_slate);

  when 'archive' then
    update public.slates set archived_at = now(), version = version + 1, updated_by = v_agent, updated_at = now()
     where id = v_slate.id returning * into v_slate;
    perform public._log(v_owner, v_agent, v_slate, 'archived', v_args ->> 'note');
    return public._slate_json(v_slate);

  when 'restore' then
    update public.slates set archived_at = null, version = version + 1, updated_by = v_agent, updated_at = now()
     where id = v_slate.id returning * into v_slate;
    perform public._log(v_owner, v_agent, v_slate, 'restored', v_args ->> 'note');
    return public._slate_json(v_slate);

  when 'delete' then
    if v_agent is not null then
      raise exception 'agents can archive slates but not delete them' using errcode = 'P0403';
    end if;
    perform public._log(v_owner, null, v_slate, 'deleted', 'Deleted ' || v_slate.title);
    delete from public.slates where id = v_slate.id;
    return jsonb_build_object('deleted', v_slate.slug);

  when 'reorder' then
    if jsonb_typeof(v_args -> 'slugs') <> 'array' then
      raise exception 'slugs must be an array' using errcode = 'P0422';
    end if;
    update public.slates s set position = o.n - 1, updated_at = now()
      from jsonb_array_elements_text(v_args -> 'slugs') with ordinality o(slug, n)
     where s.owner_id = v_owner and s.slug = o.slug;
    perform public._log(v_owner, v_agent, null, 'reordered', null);
    return jsonb_build_object('ok', true);

  when 'log' then
    if coalesce(v_args ->> 'message', '') = '' then
      raise exception 'message is required' using errcode = 'P0422';
    end if;
    if v_args ? 'slug' then
      select * into v_slate from public.slates where owner_id = v_owner and slug = v_args ->> 'slug';
    end if;
    perform public._log(v_owner, v_agent, v_slate, 'note', v_args ->> 'message');
    return jsonb_build_object('ok', true);

  when 'activity' then
    select coalesce(jsonb_agg(to_jsonb(a) - 'owner_id' order by a.created_at desc), '[]'::jsonb) into v_result
      from (select * from public.activity
             where owner_id = v_owner
               and (v_boards is null or slate_slug = any (v_boards))
             order by created_at desc
             limit least(greatest(coalesce((v_args ->> 'limit')::int, 50), 1), 200)) a;
    return v_result;

  else
    raise exception 'unknown op "%"', p_op using errcode = 'P0422';
  end case;
end;
$$;

-- ---------------------------------------------------------------------------
-- create_agent: + expiry (days) and board scope.
-- ---------------------------------------------------------------------------
drop function if exists public.create_agent(text, text, text[]);
create or replace function public.create_agent(
  p_name text, p_kind text default 'other', p_scopes text[] default array['read', 'write'],
  p_days int default null, p_boards text[] default null)
returns jsonb
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_owner uuid := auth.uid();
  v_token text;
  v_agent public.agents;
begin
  if v_owner is null then
    raise exception 'not authenticated' using errcode = 'P0401';
  end if;
  if (select count(*) from public.agents where owner_id = v_owner and revoked_at is null) >= 50 then
    raise exception 'agent limit reached' using errcode = 'P0422';
  end if;
  if p_days is not null and (p_days < 1 or p_days > 3650) then
    raise exception 'expiry must be 1-3650 days' using errcode = 'P0422';
  end if;
  if p_boards is not null and cardinality(p_boards) = 0 then
    p_boards := null;
  end if;
  v_token := 'slt_' || replace(gen_random_uuid()::text, '-', '') || replace(gen_random_uuid()::text, '-', '');
  insert into public.agents (owner_id, name, kind, scopes, token_hash, token_prefix, expires_at, boards)
  values (v_owner, p_name, coalesce(nullif(p_kind, ''), 'other'), p_scopes,
          encode(sha256(convert_to(v_token, 'UTF8')), 'hex'), left(v_token, 12),
          case when p_days is null then null else now() + make_interval(days => p_days) end, p_boards)
  returning * into v_agent;
  perform public._log(v_owner, null, null, 'agent_connected', 'Connected agent ' || p_name);
  return jsonb_build_object('agent', to_jsonb(v_agent) - 'token_hash' - 'owner_id', 'token', v_token);
end;
$$;
revoke all on function public.create_agent(text, text, text[], int, text[]) from public, anon;
grant execute on function public.create_agent(text, text, text[], int, text[]) to authenticated;

-- ---------------------------------------------------------------------------
-- history_exec: versions, restore source, metric series, changes since, seen.
-- ---------------------------------------------------------------------------
create or replace function public.history_exec(p_op text, p_args jsonb default '{}'::jsonb, p_token text default null)
returns jsonb
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_owner  uuid;
  v_agent  uuid;
  v_scopes text[];
  v_boards text[];
  v_slate  public.slates;
  v_args   jsonb := coalesce(p_args, '{}'::jsonb);
  v_limit  int := least(greatest(coalesce((v_args ->> 'limit')::int, 30), 1), 60);
  v_prev   timestamptz;
begin
  select c.owner_id, c.agent_id, c.scopes into v_owner, v_agent, v_scopes from public._resolve_caller(p_token) c;
  if v_agent is not null then
    select boards into v_boards from public.agents where id = v_agent;
  end if;

  if p_op in ('versions', 'version', 'series') then
    if v_boards is not null and not ((v_args ->> 'slug') = any (v_boards)) then
      raise exception 'this token cannot access board "%"', v_args ->> 'slug' using errcode = 'P0403';
    end if;
    select * into v_slate from public.slates where owner_id = v_owner and slug = v_args ->> 'slug';
    if v_slate.id is null then
      raise exception 'slate "%" not found', v_args ->> 'slug' using errcode = 'P0404';
    end if;
  end if;

  case p_op
  when 'versions' then
    return coalesce((
      select jsonb_agg(jsonb_build_object(
               'version', v.version, 'title', v.title, 'created_at', v.created_at,
               'by', coalesce(v.agent_name, case when v.agent_id is null then 'You' else 'Agent' end),
               'current', v.version = v_slate.version) order by v.version desc)
        from (select * from public.slate_versions where slate_id = v_slate.id order by version desc limit v_limit) v), '[]'::jsonb);

  when 'version' then
    return (select jsonb_build_object('version', v.version, 'title', v.title, 'data', v.data, 'created_at', v.created_at,
                                      'by', coalesce(v.agent_name, case when v.agent_id is null then 'You' else 'Agent' end),
                                      'kind', v_slate.kind, 'current_version', v_slate.version)
              from public.slate_versions v where v.slate_id = v_slate.id and v.version = (v_args ->> 'version')::int);

  when 'series' then
    return coalesce((
      select jsonb_agg(jsonb_build_object('version', v.version, 'at', v.created_at, 'data', v.data) order by v.version)
        from (select * from public.slate_versions where slate_id = v_slate.id order by version desc limit v_limit) v), '[]'::jsonb);

  when 'changes' then
    -- Boards changed since a time (default: the user's last visit), with who changed them.
    v_prev := coalesce((v_args ->> 'since')::timestamptz,
                       (select seen_at from public.user_settings where owner_id = v_owner),
                       now() - interval '1 day');
    return jsonb_build_object('since', v_prev, 'boards', coalesce((
      select jsonb_agg(to_jsonb(d) order by d.last_at desc)
        from (select a.slate_slug as slug, max(s.title) as title, count(*)::int as changes, max(a.created_at) as last_at,
                     array_agg(distinct coalesce(a.agent_name, 'You')) as by
                from public.activity a
                join public.slates s on s.id = a.slate_id
               where a.owner_id = v_owner and a.created_at > v_prev and a.slate_slug is not null
                 and a.action in ('created', 'updated', 'restored')
                 and (v_boards is null or a.slate_slug = any (v_boards))
                 and (v_agent is not null or a.agent_id is not null)
               group by a.slate_slug) d), '[]'::jsonb));

  when 'seen' then
    if v_agent is not null then
      raise exception 'only the user can mark seen' using errcode = 'P0403';
    end if;
    select seen_at into v_prev from public.user_settings where owner_id = v_owner;
    insert into public.user_settings (owner_id, seen_at) values (v_owner, now())
    on conflict (owner_id) do update set seen_at = now();
    return jsonb_build_object('previous', v_prev);

  else
    raise exception 'unknown op "%"', p_op using errcode = 'P0422';
  end case;
end;
$$;
revoke all on function public.history_exec(text, jsonb, text) from public;
grant execute on function public.history_exec(text, jsonb, text) to anon, authenticated;

-- ---------------------------------------------------------------------------
-- Share links
-- ---------------------------------------------------------------------------
create or replace function public.share_set(p_slug text, p_on boolean)
returns jsonb
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_slate public.slates;
begin
  if auth.uid() is null then
    raise exception 'not authenticated' using errcode = 'P0401';
  end if;
  update public.slates
     set share_token = case when p_on then coalesce(share_token, left(replace(gen_random_uuid()::text, '-', '') || replace(gen_random_uuid()::text, '-', ''), 40)) else null end
   where owner_id = auth.uid() and slug = p_slug
  returning * into v_slate;
  if v_slate.id is null then
    raise exception 'slate "%" not found', p_slug using errcode = 'P0404';
  end if;
  perform public._log(auth.uid(), null, v_slate, 'updated', case when p_on then 'Turned on the public link' else 'Turned off the public link' end);
  return jsonb_build_object('share_token', v_slate.share_token);
end;
$$;

-- Anyone with the link: title, kind and data only (no owner, no history). Notes linked
-- from a shared dashboard come along as titles and bodies so their cards render.
create or replace function public.shared_slate(p_token text)
returns jsonb
language plpgsql stable security definer set search_path = public, pg_temp as $$
declare
  v_slate public.slates;
begin
  if p_token is null or p_token !~ '^[A-Za-z0-9_-]{20,64}$' then
    return null;
  end if;
  select * into v_slate from public.slates where share_token = p_token and archived_at is null;
  if v_slate.id is null then
    return null;
  end if;
  return jsonb_build_object(
    'slug', v_slate.slug, 'title', v_slate.title, 'kind', v_slate.kind, 'icon', v_slate.icon,
    'category', v_slate.category, 'data', v_slate.data, 'updated_at', v_slate.updated_at,
    'notes', case when v_slate.kind = 'dashboard' then (
      select coalesce(jsonb_agg(n), '[]'::jsonb)
        from public.slates nb, jsonb_array_elements(nb.data -> 'items') n
       where nb.owner_id = v_slate.owner_id and nb.slug = 'notes'
         and n ->> 'id' in (select w -> 'data' ->> 'note' from jsonb_array_elements(v_slate.data -> 'widgets') w where w ->> 'kind' = 'note'))
    else null end);
end;
$$;
revoke all on function public.share_set(text, boolean) from public, anon;
revoke all on function public.shared_slate(text) from public;
grant execute on function public.share_set(text, boolean) to authenticated;
grant execute on function public.shared_slate(text) to anon, authenticated;

-- ---------------------------------------------------------------------------
-- Automations: schedules (morning brief, weekly recap, inbox filing) and RSS feeds.
-- They run as the user's built-in "Slates" agent, whose token is stored encrypted
-- with a server-only key (never in the DB in plaintext).
-- ---------------------------------------------------------------------------
create table public.assistant_tokens (
  owner_id   uuid primary key references auth.users (id) on delete cascade,
  agent_id   uuid not null references public.agents (id) on delete cascade,
  token_enc  text not null,
  created_at timestamptz not null default now()
);

create table public.automations (
  id           uuid primary key default gen_random_uuid(),
  owner_id     uuid not null references auth.users (id) on delete cascade,
  kind         text not null check (kind in ('brief', 'recap', 'inbox', 'rss')),
  title        text not null check (char_length(title) between 1 and 80),
  config       jsonb not null default '{}'::jsonb check (pg_column_size(config) < 8000),
  every        text not null check (every in ('hourly', 'daily', 'weekly')),
  at_hour      int check (at_hour between 0 and 23),
  at_weekday   int check (at_weekday between 0 and 6),   -- 0 = Sunday
  enabled      boolean not null default true,
  next_run_at  timestamptz,
  last_run_at  timestamptz,
  last_status  text check (last_status in ('ok', 'error', 'skipped')),
  last_error   text check (char_length(last_error) <= 500),
  created_at   timestamptz not null default now()
);
create index automations_due_idx on public.automations (next_run_at) where enabled;
create index automations_owner_idx on public.automations (owner_id);

alter table public.assistant_tokens enable row level security;
alter table public.automations enable row level security;
create policy "owner reads automations" on public.automations for select to authenticated using (owner_id = (select auth.uid()));
revoke all on public.assistant_tokens, public.automations from anon, authenticated;
grant select on public.automations to authenticated;

-- Next run strictly after now(), in the user's timezone.
create or replace function public._next_run(p_every text, p_hour int, p_weekday int, p_tz text)
returns timestamptz
language plpgsql stable set search_path = public, pg_temp as $$
declare
  v_local timestamp := now() at time zone p_tz;
  v_next  timestamp;
begin
  if p_every = 'hourly' then
    return date_trunc('hour', now()) + interval '1 hour';
  end if;
  v_next := date_trunc('day', v_local) + make_interval(hours => coalesce(p_hour, 7));
  if p_every = 'weekly' then
    v_next := v_next + make_interval(days => ((coalesce(p_weekday, 0) - extract(dow from v_local)::int + 7) % 7));
    if v_next <= v_local then v_next := v_next + interval '7 days'; end if;
  elsif v_next <= v_local then
    v_next := v_next + interval '1 day';
  end if;
  return v_next at time zone p_tz;
end;
$$;
revoke all on function public._next_run(text, int, int, text) from public, anon, authenticated;

create or replace function public.automations_exec(p_op text, p_args jsonb default '{}'::jsonb)
returns jsonb
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_owner uuid := auth.uid();
  v_args  jsonb := coalesce(p_args, '{}'::jsonb);
  v_tz    text;
  v_row   public.automations;
begin
  if v_owner is null then
    raise exception 'not authenticated' using errcode = 'P0401';
  end if;
  v_tz := coalesce((select timezone from public.user_settings where owner_id = v_owner), 'Asia/Kolkata');

  case p_op
  when 'list' then
    return coalesce((select jsonb_agg(to_jsonb(a) - 'owner_id' order by a.created_at) from public.automations a where a.owner_id = v_owner), '[]'::jsonb);

  when 'save' then
    if (select count(*) from public.automations where owner_id = v_owner) >= 30 and not (v_args ? 'id') then
      raise exception 'automation limit reached' using errcode = 'P0422';
    end if;
    if v_args ? 'id' then
      update public.automations set
        title = coalesce(v_args ->> 'title', title),
        config = coalesce(v_args -> 'config', config),
        every = coalesce(v_args ->> 'every', every),
        at_hour = case when v_args ? 'at_hour' then (v_args ->> 'at_hour')::int else at_hour end,
        at_weekday = case when v_args ? 'at_weekday' then (v_args ->> 'at_weekday')::int else at_weekday end,
        enabled = coalesce((v_args ->> 'enabled')::boolean, enabled)
       where id = (v_args ->> 'id')::uuid and owner_id = v_owner
      returning * into v_row;
      if v_row.id is null then
        raise exception 'automation not found' using errcode = 'P0404';
      end if;
    else
      insert into public.automations (owner_id, kind, title, config, every, at_hour, at_weekday)
      values (v_owner, v_args ->> 'kind', v_args ->> 'title', coalesce(v_args -> 'config', '{}'::jsonb),
              v_args ->> 'every', (v_args ->> 'at_hour')::int, (v_args ->> 'at_weekday')::int)
      returning * into v_row;
    end if;
    update public.automations
       set next_run_at = case when enabled then public._next_run(every, at_hour, at_weekday, v_tz) else null end
     where id = v_row.id returning * into v_row;
    return to_jsonb(v_row) - 'owner_id';

  when 'run_now' then
    update public.automations set next_run_at = now(), enabled = true
     where id = (v_args ->> 'id')::uuid and owner_id = v_owner returning * into v_row;
    if v_row.id is null then
      raise exception 'automation not found' using errcode = 'P0404';
    end if;
    return to_jsonb(v_row) - 'owner_id';

  when 'delete' then
    delete from public.automations where id = (v_args ->> 'id')::uuid and owner_id = v_owner;
    return jsonb_build_object('ok', true);

  when 'set_assistant' then
    -- The app minted a "Slates" agent token and encrypted it; keep only the ciphertext.
    if not exists (select 1 from public.agents where id = (v_args ->> 'agent_id')::uuid and owner_id = v_owner and revoked_at is null) then
      raise exception 'agent not found' using errcode = 'P0404';
    end if;
    insert into public.assistant_tokens (owner_id, agent_id, token_enc)
    values (v_owner, (v_args ->> 'agent_id')::uuid, v_args ->> 'token_enc')
    on conflict (owner_id) do update set agent_id = excluded.agent_id, token_enc = excluded.token_enc, created_at = now();
    return jsonb_build_object('ok', true);

  when 'assistant' then
    return (select jsonb_build_object('agent_id', t.agent_id, 'token_enc', t.token_enc)
              from public.assistant_tokens t join public.agents a on a.id = t.agent_id
             where t.owner_id = v_owner and a.revoked_at is null);

  else
    raise exception 'unknown op "%"', p_op using errcode = 'P0422';
  end case;
end;
$$;
revoke all on function public.automations_exec(text, jsonb) from public, anon;
grant execute on function public.automations_exec(text, jsonb) to authenticated;

-- Scheduler: claim due automations (skip-locked), push their next run forward, and
-- hand back what the worker needs (the encrypted assistant token).
create or replace function public.cron_due_automations(p_secret text)
returns jsonb
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  r   public.automations;
  out jsonb := '[]'::jsonb;
  v_tz text;
begin
  if p_secret is null or public._sha256_hex(p_secret) is distinct from (select value from public.app_config where key = 'cron_secret_hash') then
    raise exception 'forbidden' using errcode = 'P0403';
  end if;
  for r in
    select * from public.automations where enabled and next_run_at <= now()
     order by next_run_at limit 25 for update skip locked
  loop
    v_tz := coalesce((select timezone from public.user_settings where owner_id = r.owner_id), 'Asia/Kolkata');
    update public.automations set next_run_at = public._next_run(every, at_hour, at_weekday, v_tz), last_run_at = now()
     where id = r.id;
    out := out || jsonb_build_object(
      'id', r.id, 'owner_id', r.owner_id, 'kind', r.kind, 'title', r.title, 'config', r.config, 'timezone', v_tz,
      'last_run_at', r.last_run_at,
      'token_enc', (select t.token_enc from public.assistant_tokens t join public.agents a on a.id = t.agent_id
                     where t.owner_id = r.owner_id and a.revoked_at is null),
      'subscriptions', coalesce((
        select jsonb_agg(jsonb_build_object('endpoint', s.endpoint, 'keys', jsonb_build_object('p256dh', s.p256dh, 'auth', s.auth)))
          from public.push_subscriptions s where s.owner_id = r.owner_id), '[]'::jsonb));
  end loop;
  return out;
end;
$$;

create or replace function public.cron_automation_done(p_secret text, p_id uuid, p_status text, p_error text default null)
returns void
language plpgsql security definer set search_path = public, pg_temp as $$
begin
  if p_secret is null or public._sha256_hex(p_secret) is distinct from (select value from public.app_config where key = 'cron_secret_hash') then
    raise exception 'forbidden' using errcode = 'P0403';
  end if;
  update public.automations set last_status = p_status, last_error = left(p_error, 500) where id = p_id;
end;
$$;
revoke all on function public.cron_due_automations(text) from public;
revoke all on function public.cron_automation_done(text, uuid, text, text) from public;
grant execute on function public.cron_due_automations(text) to anon, authenticated;
grant execute on function public.cron_automation_done(text, uuid, text, text) to anon, authenticated;

-- ---------------------------------------------------------------------------
-- Attachments: private Storage bucket, one folder per user (skipped where Storage
-- isn't installed, e.g. the test database).
-- ---------------------------------------------------------------------------
do $$
begin
  if to_regclass('storage.buckets') is not null then
    insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
    values ('attachments', 'attachments', false, 10485760,
            array['image/png', 'image/jpeg', 'image/webp', 'image/gif', 'image/heic', 'application/pdf'])
    on conflict (id) do nothing;
    execute $p$create policy "own attachments read" on storage.objects for select to authenticated
      using (bucket_id = 'attachments' and (storage.foldername(name))[1] = (select auth.uid())::text)$p$;
    execute $p$create policy "own attachments write" on storage.objects for insert to authenticated
      with check (bucket_id = 'attachments' and (storage.foldername(name))[1] = (select auth.uid())::text)$p$;
    execute $p$create policy "own attachments delete" on storage.objects for delete to authenticated
      using (bucket_id = 'attachments' and (storage.foldername(name))[1] = (select auth.uid())::text)$p$;
  end if;
end;
$$;

alter publication supabase_realtime add table public.automations;
