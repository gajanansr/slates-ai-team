-- Slates v2: per-user slates, agent tokens, activity log.
--
-- Security model
--   * Every row carries owner_id. RLS lets a signed-in user SELECT only their own rows.
--   * No table accepts direct INSERT/UPDATE/DELETE from clients. All writes go through
--     public.slates_exec(), a SECURITY DEFINER function that resolves the caller to an
--     owner (auth.uid() for the signed-in user, or an agent token -> its owner) and
--     scopes every statement to that owner. Agents therefore need only the public
--     anon key plus their own token; the service-role key is never used by the app.
--   * Agent tokens are stored as sha256 hashes; the plaintext is shown once at creation.

-- ---------------------------------------------------------------------------
-- Types and tables
-- ---------------------------------------------------------------------------
create type public.slate_kind as enum ('brief', 'list', 'links', 'metrics', 'timeline', 'table', 'markdown');

create table public.agents (
  id            uuid primary key default gen_random_uuid(),
  owner_id      uuid not null references auth.users (id) on delete cascade,
  name          text not null check (char_length(name) between 1 and 60),
  kind          text not null default 'other' check (kind ~ '^[a-z0-9-]{1,30}$'),
  scopes        text[] not null default array['read', 'write'] check (scopes <@ array['read', 'write'] and cardinality(scopes) > 0),
  token_hash    text not null unique,
  token_prefix  text not null,
  last_used_at  timestamptz,
  revoked_at    timestamptz,
  created_at    timestamptz not null default now()
);
create index agents_owner_idx on public.agents (owner_id);

create table public.slates (
  id           uuid primary key default gen_random_uuid(),
  owner_id     uuid not null references auth.users (id) on delete cascade,
  slug         text not null check (slug ~ '^[a-z0-9][a-z0-9-]{0,62}$'),
  title        text not null check (char_length(title) between 1 and 120),
  kind         public.slate_kind not null,
  icon         text check (char_length(icon) <= 16),
  data         jsonb not null default '{}'::jsonb check (jsonb_typeof(data) = 'object' and pg_column_size(data) < 512000),
  position     int not null default 0,
  pinned       boolean not null default false,
  hidden       boolean not null default false,
  archived_at  timestamptz,
  version      int not null default 1,
  created_by   uuid references public.agents (id) on delete set null,
  updated_by   uuid references public.agents (id) on delete set null,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now(),
  unique (owner_id, slug)
);
create index slates_owner_position_idx on public.slates (owner_id, position);

create table public.activity (
  id          bigint generated always as identity primary key,
  owner_id    uuid not null references auth.users (id) on delete cascade,
  agent_id    uuid references public.agents (id) on delete set null,
  agent_name  text,
  slate_id    uuid references public.slates (id) on delete set null,
  slate_slug  text,
  action      text not null,
  summary     text check (char_length(summary) <= 500),
  created_at  timestamptz not null default now()
);
create index activity_owner_created_idx on public.activity (owner_id, created_at desc);

-- ---------------------------------------------------------------------------
-- RLS: read-own only. Writes go through functions below.
-- ---------------------------------------------------------------------------
alter table public.agents   enable row level security;
alter table public.slates   enable row level security;
alter table public.activity enable row level security;

create policy "owner reads slates"   on public.slates   for select to authenticated using (owner_id = (select auth.uid()));
create policy "owner reads activity" on public.activity for select to authenticated using (owner_id = (select auth.uid()));
create policy "owner reads agents"   on public.agents   for select to authenticated using (owner_id = (select auth.uid()));

revoke all on public.agents, public.slates, public.activity from anon, authenticated;
grant select on public.slates, public.activity to authenticated;
-- token_hash is never readable by clients
grant select (id, owner_id, name, kind, scopes, token_prefix, last_used_at, revoked_at, created_at) on public.agents to authenticated;

-- ---------------------------------------------------------------------------
-- Internal helpers (not callable by clients)
-- ---------------------------------------------------------------------------
create or replace function public._slugify(p text) returns text
language sql immutable as $$
  select coalesce(nullif(left(trim(both '-' from regexp_replace(lower(coalesce(p, '')), '[^a-z0-9]+', '-', 'g')), 60), ''), 'slate')
$$;

create or replace function public._slate_json(s public.slates) returns jsonb
language sql stable security definer set search_path = public, pg_temp as $$
  select (to_jsonb(s) - 'owner_id')
    || jsonb_build_object('updated_by_name', (select a.name from public.agents a where a.id = s.updated_by))
$$;

create or replace function public._log(p_owner uuid, p_agent uuid, p_slate public.slates, p_action text, p_summary text)
returns void language sql security definer set search_path = public, pg_temp as $$
  insert into public.activity (owner_id, agent_id, agent_name, slate_id, slate_slug, action, summary)
  values (p_owner, p_agent, (select name from public.agents where id = p_agent),
          (p_slate).id, (p_slate).slug, p_action, left(p_summary, 500))
$$;

-- ---------------------------------------------------------------------------
-- slates_exec: the single entry point for every read/write by UI and agents.
--   p_token null  -> caller is the signed-in user (auth.uid()).
--   p_token given -> caller is the agent owning that token.
-- Errors use custom SQLSTATEs mapped to HTTP codes by the app:
--   P0401 unauthenticated, P0403 forbidden, P0404 not found, P0409 conflict, P0422 invalid.
-- ---------------------------------------------------------------------------
create or replace function public.slates_exec(p_op text, p_args jsonb default '{}'::jsonb, p_token text default null)
returns jsonb
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_owner  uuid;
  v_agent  uuid;
  v_scopes text[];
  v_slate  public.slates;
  v_slug   text;
  v_base   text;
  v_n      int;
  v_result jsonb;
  v_args   jsonb := coalesce(p_args, '{}'::jsonb);
begin
  -- Resolve caller
  if p_token is not null then
    select a.id, a.owner_id, a.scopes into v_agent, v_owner, v_scopes
      from public.agents a
     where a.token_hash = encode(sha256(convert_to(p_token, 'UTF8')), 'hex')
       and a.revoked_at is null;
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

  -- Ops that address one existing slate
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
      'scopes', to_jsonb(v_scopes));

  when 'list' then
    select coalesce(jsonb_agg(public._slate_json(s) order by s.position, s.created_at), '[]'::jsonb)
      into v_result
      from public.slates s
     where s.owner_id = v_owner
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
    insert into public.slates (owner_id, slug, title, kind, icon, data, position, pinned, created_by, updated_by)
    values (
      v_owner, v_slug, v_args ->> 'title', (v_args ->> 'kind')::public.slate_kind, v_args ->> 'icon',
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
             order by created_at desc
             limit least(greatest(coalesce((v_args ->> 'limit')::int, 50), 1), 200)) a;
    return v_result;

  else
    raise exception 'unknown op "%"', p_op using errcode = 'P0422';
  end case;
end;
$$;

-- ---------------------------------------------------------------------------
-- Agent token management (signed-in user only)
-- ---------------------------------------------------------------------------
create or replace function public.create_agent(p_name text, p_kind text default 'other', p_scopes text[] default array['read', 'write'])
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
  v_token := 'slt_' || replace(gen_random_uuid()::text, '-', '') || replace(gen_random_uuid()::text, '-', '');
  insert into public.agents (owner_id, name, kind, scopes, token_hash, token_prefix)
  values (v_owner, p_name, coalesce(nullif(p_kind, ''), 'other'), p_scopes,
          encode(sha256(convert_to(v_token, 'UTF8')), 'hex'), left(v_token, 12))
  returning * into v_agent;
  perform public._log(v_owner, null, null, 'agent_connected', 'Connected agent ' || p_name);
  return jsonb_build_object('agent', to_jsonb(v_agent) - 'token_hash' - 'owner_id', 'token', v_token);
end;
$$;

create or replace function public.revoke_agent(p_id uuid)
returns void
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_owner uuid := auth.uid();
  v_name  text;
begin
  if v_owner is null then
    raise exception 'not authenticated' using errcode = 'P0401';
  end if;
  update public.agents set revoked_at = now()
   where id = p_id and owner_id = v_owner and revoked_at is null
  returning name into v_name;
  if v_name is null then
    raise exception 'agent not found' using errcode = 'P0404';
  end if;
  perform public._log(v_owner, null, null, 'agent_revoked', 'Revoked agent ' || v_name);
end;
$$;

-- ---------------------------------------------------------------------------
-- Function privileges
-- ---------------------------------------------------------------------------
revoke all on function public._slugify(text) from public, anon, authenticated;
revoke all on function public._slate_json(public.slates) from public, anon, authenticated;
revoke all on function public._log(uuid, uuid, public.slates, text, text) from public, anon, authenticated;
revoke all on function public.slates_exec(text, jsonb, text) from public;
revoke all on function public.create_agent(text, text, text[]) from public, anon;
revoke all on function public.revoke_agent(uuid) from public, anon;
grant execute on function public.slates_exec(text, jsonb, text) to anon, authenticated;
grant execute on function public.create_agent(text, text, text[]) to authenticated;
grant execute on function public.revoke_agent(uuid) to authenticated;

-- ---------------------------------------------------------------------------
-- Realtime: the app refreshes live when an agent writes.
-- ---------------------------------------------------------------------------
alter publication supabase_realtime add table public.slates, public.activity;

-- ---------------------------------------------------------------------------
-- Close the legacy hole now: the old single-row table was readable by every
-- signed-in account. Data is kept (for the one-time import) but unreadable.
-- ---------------------------------------------------------------------------
do $$
begin
  if to_regclass('public.money') is not null then
    execute 'drop policy if exists "owner reads money" on public.money';
    execute 'revoke all on public.money from anon, authenticated';
  end if;
end;
$$;
