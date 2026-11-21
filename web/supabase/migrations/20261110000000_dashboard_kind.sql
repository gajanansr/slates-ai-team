-- Dashboards: one board composed of several widgets (validated by the app).
alter type public.slate_kind add value if not exists 'dashboard';
