-- New board kinds: kanban trackers, habits, goals and countdowns.
-- Data shapes are validated by the app (lib/kinds.ts) before they reach slates_exec.
alter type public.slate_kind add value if not exists 'tracker';
alter type public.slate_kind add value if not exists 'habits';
alter type public.slate_kind add value if not exists 'goals';
alter type public.slate_kind add value if not exists 'countdown';
