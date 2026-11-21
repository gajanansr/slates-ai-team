-- Slates phase 2: MCP OAuth 2.1 (claude.ai / ChatGPT connectors) and web push.
-- Same model as v2: tables are private; every operation is a SECURITY DEFINER function
-- that proves who the caller is (session, agent token, OAuth code/refresh token, or the
-- cron secret) before touching rows. No service-role key is needed by the app.

-- ---------------------------------------------------------------------------
-- Helpers
-- ---------------------------------------------------------------------------
create or replace function public._sha256_hex(p text) returns text
language sql immutable as $$ select encode(sha256(convert_to(p, 'UTF8')), 'hex') $$;

create or replace function public._b64url_sha256(p text) returns text
language sql immutable as $$
  select rtrim(translate(encode(sha256(convert_to(p, 'UTF8')), 'base64'), E'+/\n', '-_'), '=')
$$;

create or replace function public._random_token(p_prefix text) returns text
language sql volatile as $$
  select p_prefix || replace(gen_random_uuid()::text, '-', '') || replace(gen_random_uuid()::text, '-', '')
$$;

-- Private key/value config (cron secret hash). No client grants at all.
create table public.app_config (key text primary key, value text not null);
alter table public.app_config enable row level security;
revoke all on public.app_config from anon, authenticated;

-- ---------------------------------------------------------------------------
-- OAuth 2.1
-- ---------------------------------------------------------------------------
create table public.oauth_clients (
  id             text primary key,
  name           text not null check (char_length(name) between 1 and 80),
  redirect_uris  text[] not null check (cardinality(redirect_uris) between 1 and 10),
  created_at     timestamptz not null default now()
);

create table public.oauth_codes (
  code_hash      text primary key,
  client_id      text not null references public.oauth_clients (id) on delete cascade,
  owner_id       uuid not null references auth.users (id) on delete cascade,
  redirect_uri   text not null,
  challenge      text not null,
  scopes         text[] not null,
  expires_at     timestamptz not null,
  used_at        timestamptz
);

alter table public.agents add column expires_at timestamptz;
alter table public.agents add column client_id text references public.oauth_clients (id) on delete set null;

create table public.oauth_refresh (
  token_hash     text primary key,
  agent_id       uuid not null references public.agents (id) on delete cascade,
  client_id      text not null references public.oauth_clients (id) on delete cascade,
  expires_at     timestamptz not null,
  created_at     timestamptz not null default now()
);
create index oauth_refresh_agent_idx on public.oauth_refresh (agent_id);

alter table public.oauth_clients enable row level security;
alter table public.oauth_codes   enable row level security;
alter table public.oauth_refresh enable row level security;
revoke all on public.oauth_clients, public.oauth_codes, public.oauth_refresh from anon, authenticated;
grant select (id, owner_id, name, kind, scopes, token_prefix, last_used_at, revoked_at, created_at, expires_at, client_id)
  on public.agents to authenticated;

-- Dynamic client registration (RFC 7591). Public clients only (PKCE, no secret).
create or replace function public.oauth_register_client(p_name text, p_redirect_uris text[])
returns jsonb
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_id text;
  u text;
begin
  if (select count(*) from public.oauth_clients where created_at > now() - interval '1 hour') >= 100 then
    raise exception 'registration rate limit' using errcode = 'P0429';
  end if;
  if p_redirect_uris is null or cardinality(p_redirect_uris) = 0 then
    raise exception 'redirect_uris required' using errcode = 'P0422';
  end if;
  foreach u in array p_redirect_uris loop
    if not (u ~ '^https://[^/?#\s]+' or u ~ '^http://(localhost|127\.0\.0\.1|\[::1\])(:[0-9]+)?(/|$)')
       or u ~ '#' or char_length(u) > 500 then
      raise exception 'redirect_uri must be https (or http on localhost): %', u using errcode = 'P0422';
    end if;
  end loop;
  v_id := 'slc_' || replace(gen_random_uuid()::text, '-', '');
  insert into public.oauth_clients (id, name, redirect_uris)
  values (v_id, left(coalesce(nullif(trim(p_name), ''), 'MCP client'), 80), p_redirect_uris);
  return jsonb_build_object('client_id', v_id, 'client_name', left(coalesce(nullif(trim(p_name), ''), 'MCP client'), 80),
                            'redirect_uris', to_jsonb(p_redirect_uris));
end;
$$;

-- Public facts about a client, for the consent screen and redirect validation.
create or replace function public.oauth_client_info(p_client_id text)
returns jsonb
language sql stable security definer set search_path = public, pg_temp as $$
  select jsonb_build_object('client_id', id, 'name', name, 'redirect_uris', to_jsonb(redirect_uris))
    from public.oauth_clients where id = p_client_id
$$;

-- The signed-in user approves a client: mint a one-time, 2-minute authorization code.
create or replace function public.oauth_issue_code(
  p_client_id text, p_redirect_uri text, p_challenge text, p_scopes text[])
returns text
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_owner uuid := auth.uid();
  v_code text;
begin
  if v_owner is null then
    raise exception 'not authenticated' using errcode = 'P0401';
  end if;
  if not exists (select 1 from public.oauth_clients where id = p_client_id and p_redirect_uri = any (redirect_uris)) then
    raise exception 'unknown client or redirect_uri' using errcode = 'P0422';
  end if;
  if p_challenge !~ '^[A-Za-z0-9_-]{43,128}$' then
    raise exception 'invalid code_challenge' using errcode = 'P0422';
  end if;
  if p_scopes is null or cardinality(p_scopes) = 0 or not (p_scopes <@ array['read', 'write']) then
    raise exception 'invalid scopes' using errcode = 'P0422';
  end if;
  v_code := public._random_token('slo_');
  insert into public.oauth_codes (code_hash, client_id, owner_id, redirect_uri, challenge, scopes, expires_at)
  values (public._sha256_hex(v_code), p_client_id, v_owner, p_redirect_uri, p_challenge, p_scopes, now() + interval '2 minutes');
  return v_code;
end;
$$;

-- Issue (or rotate) the agent token + refresh token for (owner, client).
create or replace function public._oauth_grant(p_owner uuid, p_client_id text, p_scopes text[], p_agent uuid)
returns jsonb
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_access  text := public._random_token('slt_');
  v_refresh text := public._random_token('slr_');
  v_agent   uuid := p_agent;
  v_name    text;
begin
  select name into v_name from public.oauth_clients where id = p_client_id;
  if v_agent is null then
    select id into v_agent from public.agents
     where owner_id = p_owner and client_id = p_client_id and revoked_at is null
     order by created_at desc limit 1;
  end if;
  if v_agent is null then
    insert into public.agents (owner_id, name, kind, scopes, token_hash, token_prefix, client_id, expires_at)
    values (p_owner, left(v_name, 60), 'oauth', p_scopes, public._sha256_hex(v_access), left(v_access, 12), p_client_id,
            now() + interval '30 days')
    returning id into v_agent;
    perform public._log(p_owner, null, null, 'agent_connected', 'Connected ' || v_name || ' via OAuth');
  else
    update public.agents
       set token_hash = public._sha256_hex(v_access), token_prefix = left(v_access, 12),
           scopes = coalesce(p_scopes, scopes), expires_at = now() + interval '30 days'
     where id = v_agent;
    delete from public.oauth_refresh where agent_id = v_agent;
  end if;
  insert into public.oauth_refresh (token_hash, agent_id, client_id, expires_at)
  values (public._sha256_hex(v_refresh), v_agent, p_client_id, now() + interval '90 days');
  return jsonb_build_object(
    'access_token', v_access, 'token_type', 'Bearer', 'expires_in', 2592000,
    'refresh_token', v_refresh,
    'scope', (select array_to_string(array(select 'slates:' || s from unnest(scopes) s), ' ') from public.agents where id = v_agent));
end;
$$;

-- Token endpoint, authorization_code grant (PKCE S256 required).
create or replace function public.oauth_exchange_code(p_code text, p_verifier text, p_client_id text, p_redirect_uri text)
returns jsonb
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  c public.oauth_codes;
begin
  update public.oauth_codes set used_at = now()
   where code_hash = public._sha256_hex(coalesce(p_code, '')) and used_at is null
  returning * into c;
  if c.code_hash is null or c.expires_at < now() then
    raise exception 'invalid_grant' using errcode = 'P0400';
  end if;
  if c.client_id <> p_client_id or c.redirect_uri <> p_redirect_uri then
    raise exception 'invalid_grant' using errcode = 'P0400';
  end if;
  if p_verifier is null or p_verifier !~ '^[A-Za-z0-9._~-]{43,128}$' or public._b64url_sha256(p_verifier) <> c.challenge then
    raise exception 'invalid_grant' using errcode = 'P0400';
  end if;
  return public._oauth_grant(c.owner_id, c.client_id, c.scopes, null);
end;
$$;

-- Token endpoint, refresh_token grant (rotating refresh tokens).
create or replace function public.oauth_refresh_token(p_refresh text, p_client_id text)
returns jsonb
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  r public.oauth_refresh;
  a public.agents;
begin
  delete from public.oauth_refresh
   where token_hash = public._sha256_hex(coalesce(p_refresh, '')) and client_id = p_client_id
  returning * into r;
  if r.token_hash is null or r.expires_at < now() then
    raise exception 'invalid_grant' using errcode = 'P0400';
  end if;
  select * into a from public.agents where id = r.agent_id;
  if a.id is null or a.revoked_at is not null then
    raise exception 'invalid_grant' using errcode = 'P0400';
  end if;
  return public._oauth_grant(a.owner_id, r.client_id, a.scopes, a.id);
end;
$$;

-- Token expiry is now honoured for every agent token.
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
-- Web push
-- ---------------------------------------------------------------------------
create table public.push_subscriptions (
  endpoint    text primary key check (endpoint ~ '^https://'),
  owner_id    uuid not null references auth.users (id) on delete cascade,
  p256dh      text not null,
  auth        text not null,
  user_agent  text,
  created_at  timestamptz not null default now()
);
create index push_subscriptions_owner_idx on public.push_subscriptions (owner_id);

create table public.notification_prefs (
  owner_id   uuid primary key references auth.users (id) on delete cascade,
  on_agent   boolean not null default true,
  on_brief   boolean not null default true,
  on_digest  boolean not null default true,
  updated_at timestamptz not null default now()
);

alter table public.push_subscriptions enable row level security;
alter table public.notification_prefs enable row level security;
create policy "owner reads subscriptions" on public.push_subscriptions for select to authenticated using (owner_id = (select auth.uid()));
create policy "owner reads prefs" on public.notification_prefs for select to authenticated using (owner_id = (select auth.uid()));
revoke all on public.push_subscriptions, public.notification_prefs from anon, authenticated;
grant select (endpoint, owner_id, user_agent, created_at) on public.push_subscriptions to authenticated;
grant select on public.notification_prefs to authenticated;

-- Signed-in user registers this device. Re-subscribing a browser moves it to the current user.
create or replace function public.push_subscribe(p_endpoint text, p_p256dh text, p_auth text, p_user_agent text default null)
returns void
language plpgsql security definer set search_path = public, pg_temp as $$
begin
  if auth.uid() is null then
    raise exception 'not authenticated' using errcode = 'P0401';
  end if;
  insert into public.push_subscriptions (endpoint, owner_id, p256dh, auth, user_agent)
  values (p_endpoint, auth.uid(), p_p256dh, p_auth, left(p_user_agent, 200))
  on conflict (endpoint) do update
    set owner_id = excluded.owner_id, p256dh = excluded.p256dh, auth = excluded.auth,
        user_agent = excluded.user_agent, created_at = now();
end;
$$;

create or replace function public.push_unsubscribe(p_endpoint text)
returns void
language sql security definer set search_path = public, pg_temp as $$
  delete from public.push_subscriptions where endpoint = p_endpoint and owner_id = auth.uid()
$$;

create or replace function public.set_notification_prefs(p_agent boolean, p_brief boolean, p_digest boolean)
returns void
language plpgsql security definer set search_path = public, pg_temp as $$
begin
  if auth.uid() is null then
    raise exception 'not authenticated' using errcode = 'P0401';
  end if;
  insert into public.notification_prefs (owner_id, on_agent, on_brief, on_digest)
  values (auth.uid(), p_agent, p_brief, p_digest)
  on conflict (owner_id) do update
    set on_agent = excluded.on_agent, on_brief = excluded.on_brief, on_digest = excluded.on_digest, updated_at = now();
end;
$$;

-- An agent (by token) asks to notify its owner. Checks scope, prefs and a rate limit,
-- logs the notification, and returns the owner's device subscriptions to send to.
create or replace function public.push_targets(p_token text, p_kind text, p_summary text)
returns jsonb
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_agent uuid; v_owner uuid; v_scopes text[]; v_on boolean;
begin
  select a.id, a.owner_id, a.scopes into v_agent, v_owner, v_scopes
    from public.agents a
   where a.token_hash = public._sha256_hex(coalesce(p_token, ''))
     and a.revoked_at is null and (a.expires_at is null or a.expires_at > now());
  if v_agent is null then
    raise exception 'invalid or revoked agent token' using errcode = 'P0401';
  end if;
  if not ('write' = any (v_scopes)) then
    raise exception 'this token is read-only' using errcode = 'P0403';
  end if;
  select case p_kind when 'brief' then coalesce(p.on_brief, true) else coalesce(p.on_agent, true) end
    into v_on from (select 1) one left join public.notification_prefs p on p.owner_id = v_owner;
  if not v_on then
    return jsonb_build_object('sent', false, 'reason', 'disabled', 'subscriptions', '[]'::jsonb);
  end if;
  if (select count(*) from public.activity
       where owner_id = v_owner and action = 'notified' and created_at > now() - interval '1 hour') >= 20 then
    raise exception 'notification rate limit (20/hour)' using errcode = 'P0429';
  end if;
  perform public._log(v_owner, v_agent, null, 'notified', p_summary);
  return jsonb_build_object('sent', true, 'subscriptions', coalesce((
    select jsonb_agg(jsonb_build_object('endpoint', endpoint, 'keys', jsonb_build_object('p256dh', p256dh, 'auth', auth)))
      from public.push_subscriptions where owner_id = v_owner), '[]'::jsonb));
end;
$$;

-- Drop a dead subscription (push service said 404/410). Requires a valid agent token
-- for the same owner, or the cron secret.
create or replace function public.push_prune(p_endpoint text, p_token text default null, p_secret text default null)
returns void
language plpgsql security definer set search_path = public, pg_temp as $$
begin
  if p_secret is not null and public._sha256_hex(p_secret) = (select value from public.app_config where key = 'cron_secret_hash') then
    delete from public.push_subscriptions where endpoint = p_endpoint;
  elsif p_token is not null then
    delete from public.push_subscriptions s using public.agents a
     where s.endpoint = p_endpoint and a.token_hash = public._sha256_hex(p_token)
       and a.revoked_at is null and s.owner_id = a.owner_id;
  else
    raise exception 'forbidden' using errcode = 'P0403';
  end if;
end;
$$;

-- Daily digest: for each owner with devices, digest enabled and agent activity in the
-- last 24h, return what to send. Gated by the cron secret.
create or replace function public.cron_digest(p_secret text)
returns jsonb
language plpgsql security definer set search_path = public, pg_temp as $$
begin
  if p_secret is null or public._sha256_hex(p_secret) is distinct from (select value from public.app_config where key = 'cron_secret_hash') then
    raise exception 'forbidden' using errcode = 'P0403';
  end if;
  return coalesce((
    select jsonb_agg(to_jsonb(d))
      from (
        select a.owner_id,
               count(*)::int as changes,
               array_agg(distinct a.agent_name) filter (where a.agent_name is not null) as agents,
               (array_agg(distinct a.slate_slug) filter (where a.slate_slug is not null))[1:3] as slates,
               (select jsonb_agg(jsonb_build_object('endpoint', s.endpoint, 'keys', jsonb_build_object('p256dh', s.p256dh, 'auth', s.auth)))
                  from public.push_subscriptions s where s.owner_id = a.owner_id) as subscriptions
          from public.activity a
          left join public.notification_prefs p on p.owner_id = a.owner_id
         where a.created_at > now() - interval '24 hours'
           and a.agent_id is not null and a.action <> 'notified'
           and coalesce(p.on_digest, true)
           and exists (select 1 from public.push_subscriptions s where s.owner_id = a.owner_id)
         group by a.owner_id
      ) d), '[]'::jsonb);
end;
$$;

-- The signed-in user's own devices (for "send a test notification").
create or replace function public.push_self_targets()
returns jsonb
language plpgsql security definer set search_path = public, pg_temp as $$
begin
  if auth.uid() is null then
    raise exception 'not authenticated' using errcode = 'P0401';
  end if;
  return coalesce((
    select jsonb_agg(jsonb_build_object('endpoint', endpoint, 'keys', jsonb_build_object('p256dh', p256dh, 'auth', auth)))
      from public.push_subscriptions where owner_id = auth.uid()), '[]'::jsonb);
end;
$$;

-- ---------------------------------------------------------------------------
-- Privileges
-- ---------------------------------------------------------------------------
revoke all on function public._sha256_hex(text) from public, anon, authenticated;
revoke all on function public._b64url_sha256(text) from public, anon, authenticated;
revoke all on function public._random_token(text) from public, anon, authenticated;
revoke all on function public._oauth_grant(uuid, text, text[], uuid) from public, anon, authenticated;
revoke all on function public.oauth_register_client(text, text[]) from public;
revoke all on function public.oauth_client_info(text) from public;
revoke all on function public.oauth_issue_code(text, text, text, text[]) from public, anon;
revoke all on function public.oauth_exchange_code(text, text, text, text) from public;
revoke all on function public.oauth_refresh_token(text, text) from public;
revoke all on function public.push_subscribe(text, text, text, text) from public, anon;
revoke all on function public.push_unsubscribe(text) from public, anon;
revoke all on function public.set_notification_prefs(boolean, boolean, boolean) from public, anon;
revoke all on function public.push_targets(text, text, text) from public;
revoke all on function public.push_prune(text, text, text) from public;
revoke all on function public.cron_digest(text) from public;
revoke all on function public.push_self_targets() from public, anon;

grant execute on function public.oauth_register_client(text, text[]) to anon, authenticated;
grant execute on function public.oauth_client_info(text) to anon, authenticated;
grant execute on function public.oauth_issue_code(text, text, text, text[]) to authenticated;
grant execute on function public.oauth_exchange_code(text, text, text, text) to anon, authenticated;
grant execute on function public.oauth_refresh_token(text, text) to anon, authenticated;
grant execute on function public.push_subscribe(text, text, text, text) to authenticated;
grant execute on function public.push_unsubscribe(text) to authenticated;
grant execute on function public.set_notification_prefs(boolean, boolean, boolean) to authenticated;
grant execute on function public.push_targets(text, text, text) to anon, authenticated;
grant execute on function public.push_prune(text, text, text) to anon, authenticated;
grant execute on function public.cron_digest(text) to anon, authenticated;
grant execute on function public.push_self_targets() to authenticated;
