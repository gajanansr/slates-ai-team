-- Members & roles, invites (permissioned, quota'd), first-party analytics, admin views.
--
-- * members: one row per auth user (trigger on auth.users). role admin|member,
--   can_invite (granted by an admin), invite_quota (default 5).
-- * invites: reserved via invite_reserve() under the inviter's session (permission,
--   quota, duplicates, rate limit), then the server sends the Supabase invite with the
--   service key and records the outcome with invite_finish() (service role only, so a
--   user can never free up quota by marking their own invite failed).
-- * page_views: privacy-respecting analytics (random visitor id, no IPs, normalised
--   paths). Written only via track_view(); read only by admins via admin_stats().
-- The admin row is set by an ops statement (no emails in the repo).

-- ---------------------------------------------------------------------------
-- Members
-- ---------------------------------------------------------------------------
create table public.members (
  user_id      uuid primary key references auth.users (id) on delete cascade,
  role         text not null default 'member' check (role in ('admin', 'member')),
  can_invite   boolean not null default false,
  invite_quota int not null default 5 check (invite_quota between 0 and 100),
  invited_by   uuid references auth.users (id) on delete set null,
  created_at   timestamptz not null default now()
);
alter table public.members enable row level security;
create policy "member reads self" on public.members for select to authenticated using (user_id = (select auth.uid()));
revoke all on public.members from anon, authenticated;
grant select on public.members to authenticated;

create or replace function public._on_auth_user_created() returns trigger
language plpgsql security definer set search_path = public, pg_temp as $$
begin
  insert into public.members (user_id, invited_by)
  values (new.id, case when (new.raw_user_meta_data ->> 'invited_by') ~ '^[0-9a-f-]{36}$'
                       then (new.raw_user_meta_data ->> 'invited_by')::uuid end)
  on conflict (user_id) do nothing;
  return new;
end;
$$;
create trigger on_auth_user_created_member after insert on auth.users
  for each row execute function public._on_auth_user_created();

insert into public.members (user_id) select id from auth.users on conflict (user_id) do nothing;

create or replace function public.is_admin(p_uid uuid default auth.uid()) returns boolean
language sql stable security definer set search_path = public, pg_temp as $$
  select exists (select 1 from public.members where user_id = p_uid and role = 'admin')
$$;

-- ---------------------------------------------------------------------------
-- Invites
-- ---------------------------------------------------------------------------
create table public.invites (
  id         uuid primary key default gen_random_uuid(),
  inviter_id uuid not null references auth.users (id) on delete cascade,
  email      text not null check (char_length(email) <= 254 and email ~* '^[^@\s]+@[^@\s]+\.[^@\s]+$'),
  user_id    uuid references auth.users (id) on delete set null,
  status     text not null default 'pending' check (status in ('pending', 'sent', 'failed')),
  error      text check (char_length(error) <= 300),
  created_at timestamptz not null default now()
);
create unique index invites_email_live_idx on public.invites (lower(email)) where status <> 'failed';
create index invites_inviter_idx on public.invites (inviter_id, created_at desc);
alter table public.invites enable row level security;
create policy "inviter reads own invites" on public.invites for select to authenticated using (inviter_id = (select auth.uid()));
revoke all on public.invites from anon, authenticated;
grant select on public.invites to authenticated;

-- What the signed-in user can do, plus their invites with acceptance state.
create or replace function public.my_membership()
returns jsonb
language plpgsql stable security definer set search_path = public, pg_temp as $$
declare
  m public.members;
  v_used int;
begin
  if auth.uid() is null then
    raise exception 'not authenticated' using errcode = 'P0401';
  end if;
  select * into m from public.members where user_id = auth.uid();
  select count(*) into v_used from public.invites where inviter_id = auth.uid() and status in ('pending', 'sent');
  return jsonb_build_object(
    'role', coalesce(m.role, 'member'),
    'can_invite', coalesce(m.can_invite, false) or coalesce(m.role, '') = 'admin',
    'quota', case when m.role = 'admin' then null else coalesce(m.invite_quota, 5) end,
    'used', v_used,
    'invites', coalesce((
      select jsonb_agg(jsonb_build_object(
               'id', i.id, 'email', i.email, 'status', i.status, 'created_at', i.created_at,
               'accepted', u.last_sign_in_at is not null) order by i.created_at desc)
        from public.invites i left join auth.users u on u.id = i.user_id
       where i.inviter_id = auth.uid() and i.status <> 'failed'), '[]'::jsonb));
end;
$$;

create or replace function public.invite_reserve(p_email text)
returns uuid
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_uid   uuid := auth.uid();
  m       public.members;
  v_email text := lower(trim(coalesce(p_email, '')));
  v_id    uuid;
begin
  if v_uid is null then
    raise exception 'not authenticated' using errcode = 'P0401';
  end if;
  select * into m from public.members where user_id = v_uid;
  if not (coalesce(m.can_invite, false) or coalesce(m.role, '') = 'admin') then
    raise exception 'You don''t have invites yet. Ask the admin for access.' using errcode = 'P0403';
  end if;
  if v_email !~* '^[^@\s]+@[^@\s]+\.[^@\s]+$' or char_length(v_email) > 254 then
    raise exception 'Enter a valid email' using errcode = 'P0422';
  end if;
  if exists (select 1 from auth.users where lower(email) = v_email) then
    raise exception 'That person already has Slates' using errcode = 'P0409';
  end if;
  if exists (select 1 from public.invites where lower(email) = v_email and status <> 'failed') then
    raise exception 'Already invited' using errcode = 'P0409';
  end if;
  if m.role <> 'admin' and (select count(*) from public.invites where inviter_id = v_uid and status in ('pending', 'sent')) >= m.invite_quota then
    raise exception 'You''ve used all % invites', m.invite_quota using errcode = 'P0403';
  end if;
  if (select count(*) from public.invites where inviter_id = v_uid and created_at > now() - interval '1 hour') >= 10 then
    raise exception 'Too many invites in the last hour' using errcode = 'P0429';
  end if;
  insert into public.invites (inviter_id, email) values (v_uid, v_email) returning id into v_id;
  return v_id;
end;
$$;

-- Server-only (service role): record the outcome of sending.
create or replace function public.invite_finish(p_id uuid, p_ok boolean, p_user_id uuid, p_error text)
returns void
language sql security definer set search_path = public, pg_temp as $$
  update public.invites
     set status = case when p_ok then 'sent' else 'failed' end,
         user_id = case when p_ok then p_user_id else user_id end,
         error = case when p_ok then null else left(p_error, 300) end
   where id = p_id and status = 'pending'
$$;

-- ---------------------------------------------------------------------------
-- Analytics
-- ---------------------------------------------------------------------------
create table public.page_views (
  id         bigint generated always as identity primary key,
  ts         timestamptz not null default now(),
  visitor_id text not null check (visitor_id ~ '^[A-Za-z0-9-]{8,64}$'),
  user_id    uuid references auth.users (id) on delete set null,
  path       text not null check (char_length(path) <= 120),
  referrer   text check (char_length(referrer) <= 120),
  country    text check (country ~ '^[A-Z]{2}$'),
  device     text not null default 'other' check (device in ('mobile', 'tablet', 'desktop', 'other')),
  standalone boolean not null default false
);
create index page_views_ts_idx on public.page_views (ts);
create index page_views_visitor_idx on public.page_views (visitor_id, ts);
alter table public.page_views enable row level security;
revoke all on public.page_views from anon, authenticated;

-- Record one view. auth.uid() (from the verified JWT) attributes signed-in views;
-- dynamic segments are collapsed so private names never land in analytics.
create or replace function public.track_view(
  p_visitor text, p_path text, p_referrer text default null, p_country text default null,
  p_device text default 'other', p_standalone boolean default false)
returns void
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_path text := split_part(split_part(coalesce(p_path, '/'), '?', 1), '#', 1);
begin
  if p_visitor is null or p_visitor !~ '^[A-Za-z0-9-]{8,64}$' or left(v_path, 1) <> '/' then
    return;
  end if;
  v_path := regexp_replace(v_path, '^/s/[^/]+', '/s/:slug');
  v_path := regexp_replace(v_path, '^/(api|dev|mcp|_next)(/.*)?$', '/\1');
  v_path := left(v_path, 120);
  -- simple abuse guard: at most 300 views per visitor per hour
  if (select count(*) from public.page_views where visitor_id = p_visitor and ts > now() - interval '1 hour') >= 300 then
    return;
  end if;
  insert into public.page_views (visitor_id, user_id, path, referrer, country, device, standalone)
  values (p_visitor, auth.uid(), v_path,
          nullif(left(lower(coalesce(p_referrer, '')), 120), ''),
          case when upper(coalesce(p_country, '')) ~ '^[A-Z]{2}$' then upper(p_country) end,
          case when p_device in ('mobile', 'tablet', 'desktop') then p_device else 'other' end,
          coalesce(p_standalone, false));
end;
$$;

-- ---------------------------------------------------------------------------
-- Admin
-- ---------------------------------------------------------------------------
create or replace function public.admin_set_member(p_user uuid, p_can_invite boolean, p_quota int)
returns void
language plpgsql security definer set search_path = public, pg_temp as $$
begin
  if not public.is_admin() then
    raise exception 'admins only' using errcode = 'P0403';
  end if;
  if p_quota is not null and (p_quota < 0 or p_quota > 100) then
    raise exception 'quota must be 0-100' using errcode = 'P0422';
  end if;
  update public.members
     set can_invite = coalesce(p_can_invite, can_invite), invite_quota = coalesce(p_quota, invite_quota)
   where user_id = p_user;
  if not found then
    raise exception 'member not found' using errcode = 'P0404';
  end if;
end;
$$;

create or replace function public.admin_users()
returns jsonb
language plpgsql stable security definer set search_path = public, pg_temp as $$
begin
  if not public.is_admin() then
    raise exception 'admins only' using errcode = 'P0403';
  end if;
  return coalesce((
    select jsonb_agg(row_to_json(x)::jsonb order by x.created_at)
      from (
        select u.id, u.email, u.created_at, u.last_sign_in_at,
               coalesce(m.role, 'member') as role, coalesce(m.can_invite, false) as can_invite,
               coalesce(m.invite_quota, 5) as invite_quota,
               (select email from auth.users where id = m.invited_by) as invited_by,
               (select count(*) from public.invites i where i.inviter_id = u.id and i.status in ('pending', 'sent'))::int as invites_used,
               (select count(*) from public.slates s where s.owner_id = u.id)::int as slates,
               (select count(*) from public.agents a where a.owner_id = u.id and a.revoked_at is null)::int as agents,
               (select count(*) from public.reminders r where r.owner_id = u.id and r.done_at is null)::int as reminders_open,
               (select count(*) from public.push_subscriptions p where p.owner_id = u.id)::int as push_devices,
               (select max(ts) from public.page_views v where v.user_id = u.id) as last_seen
          from auth.users u left join public.members m on m.user_id = u.id
      ) x), '[]'::jsonb);
end;
$$;

create or replace function public.admin_stats(p_days int default 30)
returns jsonb
language plpgsql stable security definer set search_path = public, pg_temp as $$
declare
  d     int := least(greatest(coalesce(p_days, 30), 1), 365);
  since timestamptz := date_trunc('day', now()) - make_interval(days => d - 1);
begin
  if not public.is_admin() then
    raise exception 'admins only' using errcode = 'P0403';
  end if;
  return jsonb_build_object(
    'days', d,
    'daily', (
      select coalesce(jsonb_agg(jsonb_build_object('day', to_char(g.day, 'YYYY-MM-DD'), 'visitors', coalesce(v.visitors, 0),
                                                   'views', coalesce(v.views, 0), 'users', coalesce(v.users, 0)) order by g.day), '[]'::jsonb)
        from generate_series(since, date_trunc('day', now()), interval '1 day') g(day)
        left join (select date_trunc('day', ts) as day, count(distinct visitor_id) as visitors, count(*) as views,
                          count(distinct user_id) as users
                     from public.page_views where ts >= since group by 1) v on v.day = g.day),
    'totals', jsonb_build_object(
      'views', (select count(*) from public.page_views where ts >= since),
      'visitors', (select count(distinct visitor_id) from public.page_views where ts >= since),
      'users', (select count(*) from auth.users),
      'new_users', (select count(*) from auth.users where created_at >= since),
      'dau', (select count(distinct user_id) from public.page_views where ts >= date_trunc('day', now())),
      'wau', (select count(distinct user_id) from public.page_views where ts >= now() - interval '7 days'),
      'mau', (select count(distinct user_id) from public.page_views where ts >= now() - interval '30 days'),
      'installed_share', (select round(100.0 * count(*) filter (where standalone) / nullif(count(*), 0)) from public.page_views where ts >= since)),
    'top_paths', (select coalesce(jsonb_agg(row_to_json(t)::jsonb), '[]'::jsonb) from (
        select path, count(*)::int as views from public.page_views where ts >= since group by path order by 2 desc limit 8) t),
    'referrers', (select coalesce(jsonb_agg(row_to_json(t)::jsonb), '[]'::jsonb) from (
        select referrer, count(distinct visitor_id)::int as visitors from public.page_views
         where ts >= since and referrer is not null group by referrer order by 2 desc limit 6) t),
    'devices', (select coalesce(jsonb_agg(row_to_json(t)::jsonb), '[]'::jsonb) from (
        select device, count(distinct visitor_id)::int as visitors from public.page_views
         where ts >= since group by device order by 2 desc) t),
    'countries', (select coalesce(jsonb_agg(row_to_json(t)::jsonb), '[]'::jsonb) from (
        select country, count(distinct visitor_id)::int as visitors from public.page_views
         where ts >= since and country is not null group by country order by 2 desc limit 8) t),
    'signups_weekly', (select coalesce(jsonb_agg(jsonb_build_object('week', to_char(g.wk, 'DD Mon'), 'users', coalesce(s.n, 0)) order by g.wk), '[]'::jsonb)
        from generate_series(date_trunc('week', now()) - interval '11 weeks', date_trunc('week', now()), interval '1 week') g(wk)
        left join (select date_trunc('week', created_at) as wk, count(*) as n from auth.users group by 1) s on s.wk = g.wk),
    'agents', jsonb_build_object(
      'active', (select count(*) from public.agents where revoked_at is null),
      'by_kind', (select coalesce(jsonb_agg(row_to_json(t)::jsonb), '[]'::jsonb) from (
          select kind, count(*)::int as agents from public.agents where revoked_at is null group by kind order by 2 desc limit 8) t),
      'writes', (select count(*) from public.activity where agent_id is not null and created_at >= since)),
    'content', jsonb_build_object(
      'slates', (select count(*) from public.slates),
      'by_kind', (select coalesce(jsonb_agg(row_to_json(t)::jsonb), '[]'::jsonb) from (
          select kind::text as kind, count(*)::int as slates from public.slates group by kind order by 2 desc) t),
      'reminders_open', (select count(*) from public.reminders where done_at is null),
      'reminders_fired', (select count(*) from public.activity where action = 'reminded' and created_at >= since),
      'notifications', (select count(*) from public.activity where action = 'notified' and created_at >= since),
      'push_devices', (select count(*) from public.push_subscriptions)),
    'invites', jsonb_build_object(
      'sent', (select count(*) from public.invites where status = 'sent'),
      'accepted', (select count(*) from public.invites i join auth.users u on u.id = i.user_id where u.last_sign_in_at is not null),
      'pending', (select count(*) from public.invites where status = 'pending'),
      'inviters', (select count(*) from public.members where can_invite or role = 'admin'))
  );
end;
$$;

-- ---------------------------------------------------------------------------
-- Privileges
-- ---------------------------------------------------------------------------
revoke all on function public._on_auth_user_created() from public, anon, authenticated;
revoke all on function public.is_admin(uuid) from public, anon;
revoke all on function public.my_membership() from public, anon;
revoke all on function public.invite_reserve(text) from public, anon;
revoke all on function public.invite_finish(uuid, boolean, uuid, text) from public, anon, authenticated;
revoke all on function public.track_view(text, text, text, text, text, boolean) from public;
revoke all on function public.admin_set_member(uuid, boolean, int) from public, anon;
revoke all on function public.admin_users() from public, anon;
revoke all on function public.admin_stats(int) from public, anon;
grant execute on function public.is_admin(uuid) to authenticated;
grant execute on function public.my_membership() to authenticated;
grant execute on function public.invite_reserve(text) to authenticated;
grant execute on function public.track_view(text, text, text, text, text, boolean) to anon, authenticated;
grant execute on function public.admin_set_member(uuid, boolean, int) to authenticated;
grant execute on function public.admin_users() to authenticated;
grant execute on function public.admin_stats(int) to authenticated;
do $$
begin
  if exists (select 1 from pg_roles where rolname = 'service_role') then
    execute 'grant execute on function public.invite_finish(uuid, boolean, uuid, text) to service_role';
  end if;
end $$;
