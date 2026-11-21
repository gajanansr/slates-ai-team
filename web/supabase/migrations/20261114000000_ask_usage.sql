-- Ask Slates fair use: count text-model questions per user per day (UTC). Simple actions
-- handled by the router (Jev) are free and not counted.
create table public.ask_usage (
  owner_id uuid not null references auth.users (id) on delete cascade,
  day      date not null default (now() at time zone 'utc')::date,
  n        int  not null default 0,
  primary key (owner_id, day)
);
alter table public.ask_usage enable row level security;
create policy "owner reads ask usage" on public.ask_usage for select to authenticated using (owner_id = (select auth.uid()));
revoke all on public.ask_usage from anon, authenticated;
grant select on public.ask_usage to authenticated;

-- Take one question from today's allowance. Returns what's left, or raises P0429 when used up.
create or replace function public.ask_take(p_limit int)
returns int
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_owner uuid := auth.uid();
  v_n int;
begin
  if v_owner is null then
    raise exception 'not authenticated' using errcode = 'P0401';
  end if;
  insert into public.ask_usage (owner_id, n) values (v_owner, 1)
  on conflict (owner_id, day) do update set n = public.ask_usage.n + 1
  returning n into v_n;
  if v_n > greatest(p_limit, 1) then
    update public.ask_usage set n = n - 1 where owner_id = v_owner and day = (now() at time zone 'utc')::date;
    raise exception 'daily limit reached' using errcode = 'P0429';
  end if;
  delete from public.ask_usage where owner_id = v_owner and day < (now() at time zone 'utc')::date - 7;
  return greatest(p_limit, 1) - v_n;
end;
$$;
revoke all on function public.ask_take(int) from public, anon;
grant execute on function public.ask_take(int) to authenticated;
