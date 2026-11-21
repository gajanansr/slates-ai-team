-- Charts: a new slate kind agents can create (bar, line, area, parts of a whole).
-- Data shape is validated by the app (lib/kinds.ts) before it reaches slates_exec.
alter type public.slate_kind add value if not exists 'chart';
