-- Invite codes for public sign-up + recovery for invited-but-unconfirmed accounts.
--
-- Codes: admins create them (label, max uses, expiry). Anyone with a code can join via
-- /join: code_reserve() (anon) checks the code, the email, and abuse limits, and
-- reserves one use; the server then sends the Supabase invite with the service key and
-- records the outcome via code_finish() (service role only), releasing the use on failure.
--
-- Recovery: invite_resend_check() (anon) tells the server whether an email belongs to an
-- invited account that never accepted, and rate-limits re-sends (3/hour per account).

alter table public.members add column if not exists invite_code text;

create or replace function public._on_auth_user_created() returns trigger
language plpgsql security definer set search_path = public, pg_temp as $$
begin
  insert into public.members (user_id, invited_by, invite_code)
  values (new.id,
          case when (new.raw_user_meta_data ->> 'invited_by') ~ '^[0-9a-f-]{36}$'
               then (new.raw_user_meta_data ->> 'invited_by')::uuid end,
          nullif(left(new.raw_user_meta_data ->> 'invite_code', 40), ''))
  on conflict (user_id) do nothing;
  return new;
end;
$$;

-- ---------------------------------------------------------------------------
-- Invite codes
-- ---------------------------------------------------------------------------
create table public.invite_codes (
  code        text primary key check (code ~ '^[A-Z0-9][A-Z0-9-]{3,39}$'),
  label       text check (char_length(label) <= 60),
  max_uses    int not null default 10 check (max_uses between 1 and 10000),
  uses        int not null default 0 check (uses >= 0),
  expires_at  timestamptz,
  disabled    boolean not null default false,
  created_by  uuid references auth.users (id) on delete set null,
  created_at  timestamptz not null default now()
);

create table public.code_redemptions (
  id         uuid primary key default gen_random_uuid(),
  code       text not null references public.invite_codes (code) on delete cascade,
  email      text not null check (char_length(email) <= 254),
  user_id    uuid references auth.users (id) on delete set null,
  ip_hash    text check (char_length(ip_hash) <= 64),
  status     text not null default 'pending' check (status in ('pending', 'sent', 'failed')),
  error      text check (char_length(error) <= 300),
  created_at timestamptz not null default now()
);
create index code_redemptions_code_idx on public.code_redemptions (code, created_at desc);
create index code_redemptions_ip_idx on public.code_redemptions (ip_hash, created_at desc);

alter table public.invite_codes enable row level security;
alter table public.code_redemptions enable row level security;
revoke all on public.invite_codes, public.code_redemptions from anon, authenticated;

-- Admin: create a code (random if none given). Returns the code row.
create or replace function public.admin_create_code(p_label text, p_max_uses int, p_days int, p_code text default null)
returns jsonb
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_code text := upper(nullif(trim(coalesce(p_code, '')), ''));
  c public.invite_codes;
begin
  if not public.is_admin() then
    raise exception 'admins only' using errcode = 'P0403';
  end if;
  if v_code is null then
    v_code := 'SLATES-' || upper(substr(replace(gen_random_uuid()::text, '-', ''), 1, 6));
  end if;
  insert into public.invite_codes (code, label, max_uses, expires_at, created_by)
  values (v_code, nullif(trim(p_label), ''), coalesce(p_max_uses, 10),
          case when coalesce(p_days, 0) > 0 then now() + make_interval(days => p_days) end, auth.uid())
  returning * into c;
  perform public._log(auth.uid(), null, null, 'admin_change', 'Created invite code ' || c.code || ' (' || c.max_uses || ' uses)');
  return to_jsonb(c);
end;
$$;

create or replace function public.admin_set_code(p_code text, p_disabled boolean)
returns void
language plpgsql security definer set search_path = public, pg_temp as $$
begin
  if not public.is_admin() then
    raise exception 'admins only' using errcode = 'P0403';
  end if;
  update public.invite_codes set disabled = p_disabled where code = upper(p_code);
  if not found then
    raise exception 'code not found' using errcode = 'P0404';
  end if;
  perform public._log(auth.uid(), null, null, 'admin_change', (case when p_disabled then 'Disabled' else 'Enabled' end) || ' invite code ' || upper(p_code));
end;
$$;

create or replace function public.admin_codes()
returns jsonb
language plpgsql stable security definer set search_path = public, pg_temp as $$
begin
  if not public.is_admin() then
    raise exception 'admins only' using errcode = 'P0403';
  end if;
  return coalesce((
    select jsonb_agg(jsonb_build_object(
             'code', c.code, 'label', c.label, 'max_uses', c.max_uses, 'uses', c.uses, 'expires_at', c.expires_at,
             'disabled', c.disabled, 'created_at', c.created_at,
             'joined', (select count(*) from public.code_redemptions r join auth.users u on u.id = r.user_id
                         where r.code = c.code and u.last_sign_in_at is not null))
           order by c.created_at desc)
      from public.invite_codes c), '[]'::jsonb);
end;
$$;

-- Public: reserve one use of a code for an email. Abuse limits: valid/enabled/unexpired
-- code with uses left, one account per email, 5 attempts per network hash per hour,
-- 60 redemptions per hour overall.
create or replace function public.code_reserve(p_code text, p_email text, p_ip_hash text default null)
returns uuid
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_code  text := upper(trim(coalesce(p_code, '')));
  v_email text := lower(trim(coalesce(p_email, '')));
  c public.invite_codes;
  v_id uuid;
begin
  if v_email !~* '^[^@\s]+@[^@\s]+\.[^@\s]+$' or char_length(v_email) > 254 then
    raise exception 'Enter a valid email' using errcode = 'P0422';
  end if;
  if p_ip_hash is not null and (select count(*) from public.code_redemptions where ip_hash = p_ip_hash and created_at > now() - interval '1 hour') >= 5 then
    raise exception 'Too many attempts. Try again in an hour.' using errcode = 'P0429';
  end if;
  if (select count(*) from public.code_redemptions where created_at > now() - interval '1 hour') >= 60 then
    raise exception 'Sign-ups are busy right now. Try again shortly.' using errcode = 'P0429';
  end if;
  select * into c from public.invite_codes where code = v_code for update;
  if c.code is null or c.disabled or (c.expires_at is not null and c.expires_at < now()) or c.uses >= c.max_uses then
    raise exception 'That invite code isn''t valid or has been used up.' using errcode = 'P0404';
  end if;
  if exists (select 1 from auth.users where lower(email) = v_email and email_confirmed_at is not null) then
    raise exception 'That email already has Slates. Sign in instead.' using errcode = 'P0409';
  end if;
  if exists (select 1 from public.code_redemptions where lower(email) = v_email and status <> 'failed' and created_at > now() - interval '1 day') then
    raise exception 'We already sent an invite to that email. Check your inbox.' using errcode = 'P0409';
  end if;
  update public.invite_codes set uses = uses + 1 where code = c.code;
  insert into public.code_redemptions (code, email, ip_hash) values (c.code, v_email, left(p_ip_hash, 64)) returning id into v_id;
  return v_id;
end;
$$;

-- Server-only: record the send result; a failed send gives the use back.
create or replace function public.code_finish(p_id uuid, p_ok boolean, p_user_id uuid, p_error text)
returns void
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  r public.code_redemptions;
begin
  update public.code_redemptions
     set status = case when p_ok then 'sent' else 'failed' end,
         user_id = case when p_ok then p_user_id else user_id end,
         error = case when p_ok then null else left(p_error, 300) end
   where id = p_id and status = 'pending'
  returning * into r;
  if r.id is not null and not p_ok then
    update public.invite_codes set uses = greatest(uses - 1, 0) where code = r.code;
  end if;
end;
$$;

-- ---------------------------------------------------------------------------
-- Recovery for invited accounts that never accepted
-- ---------------------------------------------------------------------------
create table public.invite_resends (
  user_id    uuid not null references auth.users (id) on delete cascade,
  created_at timestamptz not null default now()
);
create index invite_resends_user_idx on public.invite_resends (user_id, created_at desc);
alter table public.invite_resends enable row level security;
revoke all on public.invite_resends from anon, authenticated;

-- Returns 'resend' (and records it) when the email is an invited, unconfirmed account
-- that hasn't hit the re-send limit; otherwise 'member' (already confirmed),
-- 'limited', or 'unknown'. Never says more than needed.
create or replace function public.invite_resend_check(p_email text)
returns text
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  u record;
begin
  select id, email_confirmed_at, invited_at into u from auth.users where lower(email) = lower(trim(coalesce(p_email, '')));
  if u.id is null then
    return 'unknown';
  end if;
  if u.email_confirmed_at is not null then
    return 'member';
  end if;
  if u.invited_at is null then
    return 'unknown';
  end if;
  if (select count(*) from public.invite_resends where user_id = u.id and created_at > now() - interval '1 hour') >= 3 then
    return 'limited';
  end if;
  insert into public.invite_resends (user_id) values (u.id);
  return 'resend';
end;
$$;

-- ---------------------------------------------------------------------------
-- Privileges
-- ---------------------------------------------------------------------------
revoke all on function public.admin_create_code(text, int, int, text) from public, anon;
revoke all on function public.admin_set_code(text, boolean) from public, anon;
revoke all on function public.admin_codes() from public, anon;
revoke all on function public.code_reserve(text, text, text) from public;
revoke all on function public.code_finish(uuid, boolean, uuid, text) from public, anon, authenticated;
revoke all on function public.invite_resend_check(text) from public, anon, authenticated;
grant execute on function public.admin_create_code(text, int, int, text) to authenticated;
grant execute on function public.admin_set_code(text, boolean) to authenticated;
grant execute on function public.admin_codes() to authenticated;
grant execute on function public.code_reserve(text, text, text) to anon, authenticated;
do $$
begin
  if exists (select 1 from pg_roles where rolname = 'service_role') then
    execute 'grant execute on function public.code_finish(uuid, boolean, uuid, text) to service_role';
    execute 'grant execute on function public.invite_resend_check(text) to service_role';
  end if;
end $$;
