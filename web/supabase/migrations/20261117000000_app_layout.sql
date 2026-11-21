-- App-wide layout: which tabs, what sits on home, palette and density. One JSON document per
-- person, validated by the app. Readable and writable by the signed-in user and by agent tokens
-- with write access (so "set my home up like a fitness app" works), every change logged.

alter table public.user_settings add column if not exists app_layout jsonb;

create or replace function public.layout_get(p_token text default null)
returns jsonb
language plpgsql stable security definer set search_path = public, pg_temp as $$
declare
  c record;
begin
  select * into c from public._resolve_caller(p_token);
  return (select app_layout from public.user_settings where owner_id = c.owner_id);
end;
$$;

create or replace function public.layout_set(p_layout jsonb, p_token text default null)
returns void
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  c record;
begin
  select * into c from public._resolve_caller(p_token);
  if not ('write' = any (c.scopes)) then
    raise exception 'this token is read-only' using errcode = 'P0403';
  end if;
  if c.agent_id is not null and (select boards from public.agents where id = c.agent_id) is not null then
    raise exception 'tokens limited to some boards cannot change the app layout' using errcode = 'P0403';
  end if;
  if p_layout is not null and (jsonb_typeof(p_layout) <> 'object' or length(p_layout::text) > 20000) then
    raise exception 'layout must be a JSON object under 20 KB' using errcode = 'P0422';
  end if;
  insert into public.user_settings (owner_id, app_layout) values (c.owner_id, p_layout)
  on conflict (owner_id) do update set app_layout = excluded.app_layout, updated_at = now();
  perform public._log(c.owner_id, c.agent_id, null, 'layout_changed', 'Changed the app layout');
end;
$$;

revoke all on function public.layout_get(text) from public;
revoke all on function public.layout_set(jsonb, text) from public;
grant execute on function public.layout_get(text) to anon, authenticated;
grant execute on function public.layout_set(jsonb, text) to anon, authenticated;
