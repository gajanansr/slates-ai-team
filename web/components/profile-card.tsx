'use client';
import { useState, useTransition } from 'react';
import { Check, Loader2 } from 'lucide-react';
import { AVATARS, AVATAR_LABEL, Avatar, type AvatarStyle } from '@/components/avatar';
import { saveProfile } from '@/app/(app)/profile-actions';
import type { Profile } from '@/lib/profile';

/** Big avatar on a lime panel, the name, and a picker for the illustration. */
export function ProfileCard({ profile }: { profile: Profile }) {
  const [avatar, setAvatar] = useState<AvatarStyle>(profile.avatar);
  const [name, setName] = useState(profile.name ?? '');
  const [saved, setSaved] = useState(profile.name ?? '');
  const [error, setError] = useState('');
  const [pending, start] = useTransition();

  const pick = (a: AvatarStyle) => {
    const prev = avatar;
    setAvatar(a);
    start(async () => {
      const r = await saveProfile({ avatar: a });
      if (!r.ok) {
        setAvatar(prev);
        setError(r.error);
      }
    });
  };
  const commitName = () => {
    if (name.trim() === saved.trim()) return;
    start(async () => {
      const r = await saveProfile({ name });
      if (r.ok) setSaved(name.trim());
      else setError(r.error);
    });
  };

  return (
    <section className="card overflow-hidden">
      <div className="relative flex items-end gap-4 bg-accent px-4 pb-4 pt-6 text-[#1d1c1a]">
        <svg aria-hidden className="pointer-events-none absolute -right-10 -top-14 size-48 text-[#1d1c1a]/[0.07]" viewBox="0 0 100 100" fill="none" stroke="currentColor" strokeWidth="8">
          <circle cx="50" cy="50" r="28" />
          <circle cx="50" cy="50" r="44" />
        </svg>
        <Avatar style={avatar} name={saved} email={profile.email} className="relative size-[88px] flex-none shadow-[0_8px_24px_rgba(29,28,26,0.18)] ring-4 ring-[#fbfbf8]" label="Your avatar" />
        <div className="relative min-w-0 pb-1">
          <p className="truncate text-[22px] font-semibold leading-tight tracking-[-0.035em]">{saved || 'Add your name'}</p>
          <p className="truncate text-[13px] opacity-70">{profile.email}</p>
        </div>
      </div>

      <div className="px-4 py-4">
        <label htmlFor="profile-name" className="kicker mb-1.5 block">
          Name
        </label>
        <div className="relative">
          <input
            id="profile-name"
            value={name}
            onChange={(e) => setName(e.target.value)}
            onBlur={commitName}
            onKeyDown={(e) => e.key === 'Enter' && (e.currentTarget.blur(), e.preventDefault())}
            placeholder="First and last name"
            autoComplete="name"
            enterKeyHint="done"
            maxLength={60}
            className="field pr-11"
          />
          <span className="absolute right-3.5 top-1/2 -translate-y-1/2 text-fg-3" aria-live="polite">
            {pending ? <Loader2 className="size-4 animate-spin" /> : name.trim() && name.trim() === saved.trim() ? <Check className="size-4" /> : null}
          </span>
        </div>

        <p className="kicker mb-2 mt-4">Avatar</p>
        <div role="radiogroup" aria-label="Avatar" className="grid grid-cols-5 gap-2">
          {[...AVATARS, 'initials' as const].map((a) => {
            const on = avatar === a;
            return (
              <button
                key={a}
                type="button"
                role="radio"
                aria-checked={on}
                onClick={() => pick(a)}
                className="flex flex-col items-center gap-1.5 rounded-2xl py-1 active:scale-95"
              >
                <span className={`rounded-full p-[3px] transition-shadow ${on ? 'shadow-[0_0_0_2px_var(--ink)]' : ''}`}>
                  <Avatar style={a} name={saved} email={profile.email} className="size-12" />
                </span>
                <span className={`text-[11.5px] ${on ? 'font-medium text-fg' : 'text-fg-3'}`}>{AVATAR_LABEL[a]}</span>
              </button>
            );
          })}
        </div>
        {error && <p className="mt-2 text-sm text-fg">{error}</p>}
      </div>
    </section>
  );
}
