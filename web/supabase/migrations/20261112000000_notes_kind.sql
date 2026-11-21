-- Notes: one board (slug "notes") holding every note; dashboards link to notes by id.
alter type public.slate_kind add value if not exists 'notes';
