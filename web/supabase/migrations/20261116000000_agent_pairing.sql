-- Agent-led pairing (device-code style). An agent asks for a code, the signed-in owner approves
-- it on /pair, and the agent then claims its own token. Plaintext tokens are never stored: the
-- token is minted at claim time, inside the same statement that returns it, exactly once.

create table public.agent_pairings (
  id            uuid primary key default gen_random_uuid(),
  secret_hash   text not null unique,          -- sha256 of the agent's device secret (slp_...)
  user_code     text not null unique,          -- short code the human types, e.g. K7QM-4TXD
  agent_name    text not null check (char_length(agent_name) between 1 and 60),
  agent_kind    text not null default 'other' check (agent_kind ~ '^[a-z0-9-]{1,30}$'),
  ip_hash       text,
  status        text not null default 'pending' check (status in ('pending', 'approved', 'denied', 'claimed')),
  owner_id      uuid references auth.users (id) on delete cascade,
  scopes        text[],
  days          int,
  boards        text[],
  created_at    timestamptz not null default now(),
  expires_at    timestamptz not null default now() + interval '10 minutes'
);
create index agent_pairings_created_idx on public.agent_pairings (created_at);
alter table public.agent_pairings enable row level security;
revoke all on public.agent_pairings from anon, authenticated;

-- Agent side: start. Callable without a session; rate limited globally and per network.
create or replace function public.pair_start(p_name text, p_kind text default 'other', p_ip_hash text default null)
returns jsonb
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_secret text := public._random_token('slp_');
  v_alpha  text := 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';
  v_code   text;
  v_try    int := 0;
  v_name   text := left(btrim(coalesce(nullif(p_name, ''), 'Agent')), 60);
  v_kind   text := coalesce(nullif(regexp_replace(lower(coalesce(p_kind, '')), '[^a-z0-9-]', '', 'g'), ''), 'other');
begin
  if (select count(*) from public.agent_pairings where created_at > now() - interval '1 hour') >= 300 then
    raise exception 'Too many pairing requests right now. Try again soon.' using errcode = 'P0429';
  end if;
  if p_ip_hash is not null and (select count(*) from public.agent_pairings where ip_hash = p_ip_hash and created_at > now() - interval '1 hour') >= 20 then
    raise exception 'Too many pairing requests from this network. Try again later.' using errcode = 'P0429';
  end if;
  delete from public.agent_pairings where expires_at < now() - interval '1 day';
  loop
    v_code := '';
    for i in 1..8 loop
      v_code := v_code || substr(v_alpha, 1 + floor(random() * length(v_alpha))::int, 1);
      if i = 4 then v_code := v_code || '-'; end if;
    end loop;
    begin
      insert into public.agent_pairings (secret_hash, user_code, agent_name, agent_kind, ip_hash)
      values (public._sha256_hex(v_secret), v_code, v_name, left(v_kind, 30), p_ip_hash);
      exit;
    exception when unique_violation then
      v_try := v_try + 1;
      if v_try > 5 then raise; end if;
    end;
  end loop;
  return jsonb_build_object('device_secret', v_secret, 'user_code', v_code, 'expires_in', 600, 'interval', 3);
end;
$$;

-- Human side: look up the request behind a code (signed in).
create or replace function public.pair_info(p_user_code text)
returns jsonb
language plpgsql security definer set search_path = public, pg_temp as $$
declare p public.agent_pairings;
begin
  if auth.uid() is null then raise exception 'not authenticated' using errcode = 'P0401'; end if;
  select * into p from public.agent_pairings where user_code = upper(btrim(coalesce(p_user_code, '')));
  if not found then return null; end if;
  return jsonb_build_object('name', p.agent_name, 'kind', p.agent_kind, 'status',
    case when p.status = 'pending' and p.expires_at < now() then 'expired' else p.status end);
end;
$$;

-- Human side: approve or deny, choosing access, expiry and boards.
create or replace function public.pair_decide(p_user_code text, p_allow boolean, p_scopes text[] default array['read', 'write'],
                                              p_days int default null, p_boards text[] default null)
returns void
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_owner uuid := auth.uid();
  p public.agent_pairings;
begin
  if v_owner is null then raise exception 'not authenticated' using errcode = 'P0401'; end if;
  select * into p from public.agent_pairings where user_code = upper(btrim(coalesce(p_user_code, ''))) for update;
  if not found or p.status <> 'pending' or p.expires_at < now() then
    raise exception 'This code is not valid any more. Ask the agent for a new one.' using errcode = 'P0404';
  end if;
  if not p_allow then
    update public.agent_pairings set status = 'denied', owner_id = v_owner where id = p.id;
    return;
  end if;
  if p_scopes is null or cardinality(p_scopes) = 0 or not (p_scopes <@ array['read', 'write']) then
    raise exception 'invalid access' using errcode = 'P0422';
  end if;
  if p_days is not null and (p_days < 1 or p_days > 3650) then
    raise exception 'expiry must be 1-3650 days' using errcode = 'P0422';
  end if;
  if p_boards is not null and cardinality(p_boards) = 0 then p_boards := null; end if;
  update public.agent_pairings
     set status = 'approved', owner_id = v_owner, scopes = p_scopes, days = p_days, boards = p_boards,
         expires_at = greatest(expires_at, now() + interval '5 minutes')
   where id = p.id;
end;
$$;

-- Agent side: poll. When approved, mint the token and hand it over once.
create or replace function public.pair_poll(p_device_secret text)
returns jsonb
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  p public.agent_pairings;
  v_token text;
  v_agent uuid;
begin
  select * into p from public.agent_pairings
   where secret_hash = public._sha256_hex(coalesce(p_device_secret, '')) for update;
  if not found then return jsonb_build_object('status', 'invalid'); end if;
  if p.status = 'claimed' then return jsonb_build_object('status', 'claimed'); end if;
  if p.status = 'denied' then return jsonb_build_object('status', 'denied'); end if;
  if p.expires_at < now() then return jsonb_build_object('status', 'expired'); end if;
  if p.status = 'pending' then return jsonb_build_object('status', 'pending'); end if;

  if (select count(*) from public.agents where owner_id = p.owner_id and revoked_at is null) >= 50 then
    return jsonb_build_object('status', 'error', 'message', 'Agent limit reached. Revoke an agent in Slates first.');
  end if;
  v_token := public._random_token('slt_');
  insert into public.agents (owner_id, name, kind, scopes, token_hash, token_prefix, expires_at, boards)
  values (p.owner_id, p.agent_name, p.agent_kind, p.scopes, public._sha256_hex(v_token), left(v_token, 12),
          case when p.days is null then null else now() + make_interval(days => p.days) end, p.boards)
  returning id into v_agent;
  update public.agent_pairings set status = 'claimed' where id = p.id;
  perform public._log(p.owner_id, null, null, 'agent_connected', 'Connected agent ' || p.agent_name || ' (pairing)');
  return jsonb_build_object('status', 'approved', 'token', v_token, 'agent_name', p.agent_name,
    'scopes', to_jsonb(p.scopes), 'mcp_url', null);
end;
$$;

revoke all on function public.pair_start(text, text, text) from public;
revoke all on function public.pair_info(text) from public, anon;
revoke all on function public.pair_decide(text, boolean, text[], int, text[]) from public, anon;
revoke all on function public.pair_poll(text) from public;
grant execute on function public.pair_start(text, text, text) to anon, authenticated;
grant execute on function public.pair_info(text) to authenticated;
grant execute on function public.pair_decide(text, boolean, text[], int, text[]) to authenticated;
grant execute on function public.pair_poll(text) to anon, authenticated;
