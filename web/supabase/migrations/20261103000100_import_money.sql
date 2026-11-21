-- One-time import of the legacy single-row payload (public.money, id = 1) into typed
-- slates owned by one user, then lock the legacy table so no other account can read it.
--
-- Run once in the SQL editor after the v2 migration, e.g.:
--   select public._import_money((select id from auth.users where email = '<owner email>'));
-- It is idempotent: it does nothing if that owner already has slates.

create or replace function public._tone(t text) returns text
language sql immutable as $$
  select case lower(coalesce(t, ''))
    when 'red' then 'bad' when 'amber' then 'warn' when 'orange' then 'warn'
    when 'green' then 'good' else 'neutral' end
$$;

create or replace function public._import_money(p_owner uuid) returns int
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  p  jsonb;
  hq jsonb;
  n  int := 0;
  rec record;
begin
  if p_owner is null then
    raise exception 'owner not found';
  end if;
  if exists (select 1 from public.slates where owner_id = p_owner) then
    return 0;
  end if;
  if to_regclass('public.money') is null then
    return 0;
  end if;
  execute 'select payload from public.money where id = 1' into p;
  if p is null then
    return 0;
  end if;
  hq := coalesce(p -> 'hq', '{}'::jsonb);

  -- Today brief
  if p ? 'today' then
    insert into public.slates (owner_id, slug, title, kind, data, position, pinned) values (
      p_owner, 'today', 'Today', 'brief',
      jsonb_strip_nulls(jsonb_build_object(
        'date', p -> 'today' ->> 'date',
        'items', (select coalesce(jsonb_agg(jsonb_strip_nulls(jsonb_build_object(
                    'id', 'i' || o, 'text', e ->> 'text', 'tone', public._tone(e ->> 'tone'))) order by o), '[]'::jsonb)
                  from jsonb_array_elements(coalesce(p -> 'today' -> 'items', '[]'::jsonb)) with ordinality t(e, o)))),
      0, true);
    n := n + 1;
  end if;

  -- Money overview
  if p ? 'summary' then
    insert into public.slates (owner_id, slug, title, kind, data, position, pinned) values (
      p_owner, 'money', 'Money', 'metrics',
      jsonb_strip_nulls(jsonb_build_object('asOf', p ->> 'asOf')) || jsonb_build_object('items', jsonb_build_array(
        jsonb_build_object('id', 'salary',    'label', 'Salary',    'value', coalesce(p -> 'summary' ->> 'salary', '')),
        jsonb_build_object('id', 'committed', 'label', 'Committed', 'value', coalesce(p -> 'summary' ->> 'committed', ''), 'sub', 'this month'),
        jsonb_build_object('id', 'gap',       'label', 'Gap',       'value', coalesce(p -> 'summary' ->> 'gap', ''), 'tone', 'bad'),
        jsonb_build_object('id', 'oncards',   'label', 'On cards',  'value', coalesce(p -> 'summary' ->> 'onCards', '')))),
      1, true);
    n := n + 1;
  end if;

  if p ? 'nextUp' then
    insert into public.slates (owner_id, slug, title, kind, data, position) values (
      p_owner, 'next-up', 'Next up', 'metrics',
      jsonb_build_object('items', (select coalesce(jsonb_agg(jsonb_strip_nulls(jsonb_build_object(
          'id', 'n' || o, 'label', e ->> 'name', 'value', coalesce(e ->> 'amount', ''), 'sub', e ->> 'when',
          'tone', public._tone(e ->> 'tone'))) order by o), '[]'::jsonb)
        from jsonb_array_elements(p -> 'nextUp') with ordinality t(e, o))),
      2);
    n := n + 1;
  end if;

  if p ? 'obligations' then
    insert into public.slates (owner_id, slug, title, kind, data, position) values (
      p_owner, 'obligations', 'In vs committed', 'metrics',
      jsonb_build_object('items', (select coalesce(jsonb_agg(jsonb_strip_nulls(jsonb_build_object(
          'id', 'o' || o, 'label', e ->> 'label', 'value', coalesce(e ->> 'display', ''), 'sub', e ->> 'meta',
          'progress', least(greatest(coalesce((e ->> 'pct')::numeric, 0), 0), 100))) order by o), '[]'::jsonb)
        from jsonb_array_elements(p -> 'obligations') with ordinality t(e, o))),
      3);
    n := n + 1;
  end if;

  -- Tables
  for rec in
    select * from (values
      ('cards', 'Cards', 4, p -> 'cards',
        '[{"key":"product","label":"Card"},{"key":"bank","label":"Bank"},{"key":"main","label":"Balance"},{"key":"min","label":"Minimum","align":"end"},{"key":"due","label":"Due"},{"key":"status","label":"Status"},{"key":"note","label":"Note"}]'::jsonb),
      ('bills', 'Bills & EMIs', 5, p -> 'bills',
        '[{"key":"name","label":"Item"},{"key":"sub","label":"Detail"},{"key":"amount","label":"Amount","align":"end"}]'::jsonb),
      ('payments', 'Payments log', 6, p -> 'payments',
        '[{"key":"date","label":"Date"},{"key":"card","label":"Card"},{"key":"amount","label":"Amount","align":"end"},{"key":"kind","label":"Type"},{"key":"via","label":"Via"}]'::jsonb)
    ) v(slug, title, pos, arr, cols)
  loop
    if rec.arr is not null and jsonb_typeof(rec.arr) = 'array' then
      insert into public.slates (owner_id, slug, title, kind, data, position) values (
        p_owner, rec.slug, rec.title, 'table',
        jsonb_build_object('columns', rec.cols, 'rows', (
          select coalesce(jsonb_agg(jsonb_build_object('id', 'r' || o, 'cells', (
              select coalesce(jsonb_object_agg(c ->> 'key', coalesce(e ->> (c ->> 'key'), '')), '{}'::jsonb)
                from jsonb_array_elements(rec.cols) c)) order by o), '[]'::jsonb)
            from jsonb_array_elements(rec.arr) with ordinality t(e, o))),
        rec.pos);
      n := n + 1;
    end if;
  end loop;

  if p ? 'limit' then
    insert into public.slates (owner_id, slug, title, kind, data, position) values (
      p_owner, 'spend-limit', 'Spend limit', 'metrics',
      jsonb_build_object('items', jsonb_build_array(
        jsonb_strip_nulls(jsonb_build_object('id', 'regular', 'label', 'A normal month',
          'value', trim(coalesce(p -> 'limit' ->> 'regularLimit', '') || ' ' || coalesce(p -> 'limit' ->> 'regularPer', '')),
          'sub', p -> 'limit' ->> 'regularLine')),
        jsonb_strip_nulls(jsonb_build_object('id', 'month', 'label', 'This month',
          'value', coalesce(p -> 'limit' ->> 'monthLimit', ''), 'sub', p -> 'limit' ->> 'monthLine', 'tone', 'bad')))),
      7);
    n := n + 1;
  end if;

  -- Link lists
  for rec in
    select * from (values
      ('dashboards', 'Dashboards', 8), ('docs', 'Files & docs', 9),
      ('folders', 'Drive folders', 10), ('launchreel', 'Launchreel', 11)) v(slug, title, pos)
  loop
    if jsonb_typeof(hq -> rec.slug) = 'array' then
      insert into public.slates (owner_id, slug, title, kind, data, position) values (
        p_owner, rec.slug, rec.title, 'links',
        jsonb_build_object('items', (select coalesce(jsonb_agg(jsonb_strip_nulls(jsonb_build_object(
            'id', 'l' || o, 'title', coalesce(e ->> 'name', e ->> 'href'), 'url', e ->> 'href', 'detail', e ->> 'detail'))
            order by o), '[]'::jsonb)
          from jsonb_array_elements(hq -> rec.slug) with ordinality t(e, o))),
        rec.pos);
      n := n + 1;
    end if;
  end loop;

  if jsonb_typeof(hq -> 'history') = 'array' then
    insert into public.slates (owner_id, slug, title, kind, data, position) values (
      p_owner, 'history', 'Work history', 'timeline',
      jsonb_build_object('entries', (select coalesce(jsonb_agg(jsonb_build_object(
          'id', 'd' || o, 'date', coalesce(e ->> 'date', ''),
          'items', coalesce((select jsonb_agg(x #>> '{}') from jsonb_array_elements(coalesce(e -> 'items', '[]'::jsonb)) x), '[]'::jsonb))
          order by o), '[]'::jsonb)
        from jsonb_array_elements(hq -> 'history') with ordinality t(e, o))),
      12);
    n := n + 1;
  end if;

  if coalesce(p ->> 'caveat', '') <> '' then
    insert into public.slates (owner_id, slug, title, kind, data, position) values (
      p_owner, 'notes', 'Notes', 'markdown', jsonb_build_object('body', p ->> 'caveat'), 13);
    n := n + 1;
  end if;

  -- Close the legacy hole: no signed-in account can read the shared row any more.
  execute 'drop policy if exists "owner reads money" on public.money';
  execute 'revoke all on public.money from anon, authenticated';

  insert into public.activity (owner_id, action, summary)
  values (p_owner, 'imported', 'Imported ' || n || ' slates from the legacy payload');
  return n;
end;
$$;

revoke all on function public._tone(text) from public, anon, authenticated;
revoke all on function public._import_money(uuid) from public, anon, authenticated;
