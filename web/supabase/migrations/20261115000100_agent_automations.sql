-- BUG-15: agents can list, create, update, run and delete automations with their token.
-- The list/save/run_now/delete logic moves into one internal function used by both the app
-- (session) and agents (token). The built-in assistant-token ops stay session-only.

create or replace function public._automations_op(p_owner uuid, p_op text, p_args jsonb)
returns jsonb
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_args jsonb := coalesce(p_args, '{}'::jsonb);
  v_tz   text := coalesce((select timezone from public.user_settings where owner_id = p_owner), 'Asia/Kolkata');
  v_row  public.automations;
begin
  case p_op
  when 'list' then
    return coalesce((select jsonb_agg(to_jsonb(a) - 'owner_id' order by a.created_at) from public.automations a where a.owner_id = p_owner), '[]'::jsonb);

  when 'save' then
    if (select count(*) from public.automations where owner_id = p_owner) >= 30 and not (v_args ? 'id') then
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
       where id = (v_args ->> 'id')::uuid and owner_id = p_owner
      returning * into v_row;
      if v_row.id is null then
        raise exception 'automation not found' using errcode = 'P0404';
      end if;
    else
      insert into public.automations (owner_id, kind, title, config, every, at_hour, at_weekday)
      values (p_owner, v_args ->> 'kind', v_args ->> 'title', coalesce(v_args -> 'config', '{}'::jsonb),
              v_args ->> 'every', (v_args ->> 'at_hour')::int, (v_args ->> 'at_weekday')::int)
      returning * into v_row;
    end if;
    update public.automations
       set next_run_at = case when enabled then public._next_run(every, at_hour, at_weekday, v_tz) else null end
     where id = v_row.id returning * into v_row;
    return to_jsonb(v_row) - 'owner_id';

  when 'run_now' then
    update public.automations set next_run_at = now(), enabled = true
     where id = (v_args ->> 'id')::uuid and owner_id = p_owner returning * into v_row;
    if v_row.id is null then
      raise exception 'automation not found' using errcode = 'P0404';
    end if;
    return to_jsonb(v_row) - 'owner_id';

  when 'delete' then
    delete from public.automations where id = (v_args ->> 'id')::uuid and owner_id = p_owner;
    return jsonb_build_object('ok', true);

  else
    raise exception 'unknown op "%"', p_op using errcode = 'P0422';
  end case;
end;
$$;
revoke all on function public._automations_op(uuid, text, jsonb) from public, anon, authenticated;

-- The app (signed-in session): same ops as before, plus the assistant-token ops.
create or replace function public.automations_exec(p_op text, p_args jsonb default '{}'::jsonb)
returns jsonb
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_owner uuid := auth.uid();
  v_args  jsonb := coalesce(p_args, '{}'::jsonb);
begin
  if v_owner is null then
    raise exception 'not authenticated' using errcode = 'P0401';
  end if;

  case p_op
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
    return public._automations_op(v_owner, p_op, v_args);
  end case;
end;
$$;
revoke all on function public.automations_exec(text, jsonb) from public, anon;
grant execute on function public.automations_exec(text, jsonb) to authenticated;

-- Agents (token): list needs read; changes need write, a token not limited to some boards, and
-- not the built-in Slates agent (it runs automations; it doesn't manage them).
create or replace function public.agent_automations_exec(p_op text, p_args jsonb default '{}'::jsonb, p_token text default null)
returns jsonb
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_owner  uuid;
  v_agent  uuid;
  v_scopes text[];
  v_kind   text;
  v_boards text[];
begin
  select c.owner_id, c.agent_id, c.scopes into v_owner, v_agent, v_scopes from public._resolve_caller(p_token) c;
  if v_owner is null then
    raise exception 'not authenticated' using errcode = 'P0401';
  end if;
  if p_op not in ('list', 'save', 'run_now', 'delete') then
    raise exception 'unknown op "%"', p_op using errcode = 'P0422';
  end if;
  if v_agent is not null then
    select kind, boards into v_kind, v_boards from public.agents where id = v_agent;
    if p_op <> 'list' then
      if not ('write' = any (v_scopes)) then
        raise exception 'this token is read-only' using errcode = 'P0403';
      end if;
      if v_boards is not null then
        raise exception 'tokens limited to some boards cannot manage automations' using errcode = 'P0403';
      end if;
      if v_kind = 'slates' then
        raise exception 'the built-in Slates agent cannot manage automations' using errcode = 'P0403';
      end if;
    end if;
    -- Automations run as the user's built-in Slates agent, which only the app can create.
    if p_op = 'save' and not (coalesce(p_args, '{}'::jsonb) ? 'id') and not exists (
      select 1 from public.assistant_tokens t join public.agents a on a.id = t.agent_id
       where t.owner_id = v_owner and a.revoked_at is null) then
      raise exception 'Automations are not set up yet. Ask the user to turn on any automation once in Slates (You > Automations); then agents can add more.' using errcode = 'P0409';
    end if;
  end if;
  return public._automations_op(v_owner, p_op, p_args);
end;
$$;
revoke all on function public.agent_automations_exec(text, jsonb, text) from public;
grant execute on function public.agent_automations_exec(text, jsonb, text) to anon, authenticated;
