-- Board categories: agents (and the user) group boards, e.g. Money, Work, Health.
-- Shown as sections on the Boards page. Null = grouped by kind in the UI.

alter table public.slates add column category text check (category is null or char_length(category) between 1 and 40);
create index slates_owner_category_idx on public.slates (owner_id, category);

-- slates_exec: create/update accept "category".
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
             order by created_at desc
             limit least(greatest(coalesce((v_args ->> 'limit')::int, 50), 1), 200)) a;
    return v_result;

  else
    raise exception 'unknown op "%"', p_op using errcode = 'P0422';
  end case;
end;
$$;
