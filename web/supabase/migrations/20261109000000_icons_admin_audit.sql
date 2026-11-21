-- Board icons are names from the app's icon set (lib/icons.ts), never emoji.
-- 1) translate common emoji already stored, 2) clear anything else that is not a name,
-- 3) enforce the name format in the database (the app also enforces the exact list).
update public.slates s set icon = m.name
  from (values
    ('🎬', 'film'), ('🎥', 'film'), ('🎯', 'target'), ('💸', 'wallet'), ('💰', 'wallet'), ('💳', 'credit-card'),
    ('🏦', 'bank'), ('🧾', 'receipt'), ('🐷', 'piggy-bank'), ('📊', 'chart-bar'), ('📈', 'chart-line'), ('📉', 'chart-line'),
    ('💼', 'briefcase'), ('🏢', 'building'), ('📦', 'package'), ('💻', 'code'), ('🤖', 'bot'), ('💡', 'idea'),
    ('🚀', 'rocket'), ('⚡', 'bolt'), ('📅', 'calendar'), ('🗓️', 'calendar'), ('⏰', 'clock'), ('🔔', 'bell'),
    ('✅', 'checklist'), ('📝', 'file'), ('🏁', 'flag'), ('🏆', 'trophy'), ('⭐', 'star'), ('✨', 'sparkles'),
    ('🏠', 'home'), ('🛒', 'cart'), ('🍽️', 'food'), ('☕', 'coffee'), ('🎁', 'gift'), ('🏷️', 'tag'), ('🚗', 'car'),
    ('✈️', 'plane'), ('🌍', 'globe'), ('📍', 'map-pin'), ('❤️', 'heart'), ('🩺', 'health'), ('💊', 'pill'),
    ('🏋️', 'dumbbell'), ('🧠', 'brain'), ('🌿', 'leaf'), ('☀️', 'sun'), ('🌙', 'moon'), ('📚', 'book'), ('📖', 'book'),
    ('🎓', 'graduation'), ('📰', 'news'), ('📄', 'file'), ('📁', 'folder'), ('🔗', 'link'), ('✉️', 'mail'), ('📧', 'mail'),
    ('📞', 'phone'), ('👥', 'people'), ('🎵', 'music'), ('🎶', 'music'), ('📷', 'camera'), ('🎮', 'game'), ('🎨', 'palette'),
    ('🛡️', 'shield')
  ) m(emoji, name)
 where s.icon = m.emoji;

update public.slates set icon = null where icon is not null and icon !~ '^[a-z][a-z0-9-]{0,23}$';

alter table public.slates add constraint slates_icon_name_chk check (icon is null or icon ~ '^[a-z][a-z0-9-]{0,23}$');

-- Admin actions leave an audit trail in the admin's own activity feed.
create or replace function public.admin_set_member(p_user uuid, p_can_invite boolean, p_quota int)
returns void
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  m public.members;
begin
  if not public.is_admin() then
    raise exception 'admins only' using errcode = 'P0403';
  end if;
  if p_quota is not null and (p_quota < 0 or p_quota > 100) then
    raise exception 'quota must be 0-100' using errcode = 'P0422';
  end if;
  update public.members
     set can_invite = coalesce(p_can_invite, can_invite), invite_quota = coalesce(p_quota, invite_quota)
   where user_id = p_user
  returning * into m;
  if m.user_id is null then
    raise exception 'member not found' using errcode = 'P0404';
  end if;
  perform public._log(auth.uid(), null, null, 'admin_change',
    (select email from auth.users where id = p_user) || ': invites ' || case when m.can_invite then 'on' else 'off' end
      || ', allowance ' || m.invite_quota);
end;
$$;
