-- Eventos de engajamento no site (somente leitura/escrita via service_role no servidor).

create table if not exists public.site_engagement_events (
  id uuid primary key default gen_random_uuid(),
  event_type text not null check (event_type in ('gifts_area_view', 'gifts_list_opened')),
  guest_name text,
  session_key text not null,
  created_at timestamptz not null default now()
);

create index if not exists site_engagement_events_type_created_idx
  on public.site_engagement_events (event_type, created_at desc);

create index if not exists site_engagement_events_session_idx
  on public.site_engagement_events (session_key);

alter table public.site_engagement_events enable row level security;

revoke all on table public.site_engagement_events from public, anon, authenticated;
grant all on table public.site_engagement_events to service_role;
