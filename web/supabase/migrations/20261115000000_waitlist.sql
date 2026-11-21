-- Waitlist: people without an invite leave their email; admins let them in (which sends the
-- normal invite email). Only reachable through the functions below (RLS on, no policies).

create table if not exists public.waitlist (
  id          uuid primary key default gen_random_uuid(),
  email       text not null unique check (email = lower(email) and char_length(email) <= 254),
  name        text check (char_length(name) <= 80),
  note        text check (char_length(note) <= 280),
  status      text not null default 'waiting' check (status in ('waiting', 'invited')),
  ip_hash     text,
  created_at  timestamptz not null default now(),
  invited_at  timestamptz
);
alter table public.waitlist enable row level security;
create index if not exists waitlist_status_idx on public.waitlist (status, created_at);

-- Public: join the waitlist. Says whether you were added, were already on it, or already have
-- an account, plus your place in line. Rate limited per network.
create or replace function public.waitlist_join(p_email text, p_name text default null, p_note text default null, p_ip_hash text default null)
returns jsonb
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_email text := lower(trim(coalesce(p_email, '')));
  v_row public.waitlist;
begin
  if v_email !~* '^[^@\s]+@[^@\s]+\.[^@\s]+$' or char_length(v_email) > 254 then
    raise exception 'Enter a valid email' using errcode = 'P0422';
  end if;
  if p_ip_hash is not null and (select count(*) from public.waitlist where ip_hash = p_ip_hash and created_at > now() - interval '1 hour') >= 5 then
    raise exception 'Too many sign-ups from here. Try again in an hour.' using errcode = 'P0429';
  end if;
  if exists (select 1 from auth.users where lower(email) = v_email) then
    return jsonb_build_object('status', 'member');
  end if;
  select * into v_row from public.waitlist where email = v_email;
  if found then
    return jsonb_build_object('status', 'already', 'position',
      (select count(*) from public.waitlist where status = 'waiting' and created_at <= v_row.created_at));
  end if;
  insert into public.waitlist (email, name, note, ip_hash)
  values (v_email, nullif(left(trim(coalesce(p_name, '')), 80), ''), nullif(left(trim(coalesce(p_note, '')), 280), ''), p_ip_hash)
  returning * into v_row;
  return jsonb_build_object('status', 'added', 'position', (select count(*) from public.waitlist where status = 'waiting'));
end;
$$;

-- Admins: the list, waiting first (oldest first), then people already let in.
create or replace function public.admin_waitlist()
returns jsonb
language plpgsql stable security definer set search_path = public, pg_temp as $$
begin
  if not public.is_admin() then
    raise exception 'admins only' using errcode = 'P0403';
  end if;
  return coalesce((
    select jsonb_agg(jsonb_build_object('email', w.email, 'name', w.name, 'note', w.note, 'status', w.status,
                                        'created_at', w.created_at, 'invited_at', w.invited_at)
                     order by (w.status = 'invited'), case when w.status = 'waiting' then w.created_at end asc, w.invited_at desc)
      from public.waitlist w), '[]'::jsonb);
end;
$$;

-- Admins: mark someone as let in (after the invite email went out).
create or replace function public.admin_waitlist_mark(p_email text)
returns void
language plpgsql security definer set search_path = public, pg_temp as $$
begin
  if not public.is_admin() then
    raise exception 'admins only' using errcode = 'P0403';
  end if;
  update public.waitlist set status = 'invited', invited_at = now() where email = lower(trim(p_email));
end;
$$;

revoke all on function public.waitlist_join(text, text, text, text) from public;
revoke all on function public.admin_waitlist() from public, anon;
revoke all on function public.admin_waitlist_mark(text) from public, anon;
grant execute on function public.waitlist_join(text, text, text, text) to anon, authenticated;
grant execute on function public.admin_waitlist() to authenticated;
grant execute on function public.admin_waitlist_mark(text) to authenticated;
