-- Lembrete de dispositivo após confirmação de presença (cookie + token no servidor).
create table if not exists public.rsvp_remember_tokens (
  id uuid primary key default gen_random_uuid(),
  primary_rsvp_id uuid not null references public.rsvps(id) on delete cascade,
  token_hash text not null unique,
  last_ip_hash text,
  last_seen_at timestamptz not null default now(),
  created_at timestamptz not null default now()
);

create index if not exists rsvp_remember_tokens_primary_idx
  on public.rsvp_remember_tokens (primary_rsvp_id);

create index if not exists rsvp_remember_tokens_last_seen_idx
  on public.rsvp_remember_tokens (last_seen_at desc);

alter table public.rsvp_remember_tokens enable row level security;

revoke all on table public.rsvp_remember_tokens from anon, authenticated;
grant all on table public.rsvp_remember_tokens to service_role;
