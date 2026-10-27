-- Acesso ao álbum: senha 123456 por convidado (hash em public.rsvps.password_hash).
-- Senha compartilhada em album_access_config permanece como fallback legado.

create extension if not exists pgcrypto with schema extensions;

create table if not exists public.album_access_config (
  id smallint primary key default 1 check (id = 1),
  password_hash text not null,
  updated_at timestamptz not null default now()
);

insert into public.album_access_config (id, password_hash, updated_at)
values (1, extensions.crypt('123456', extensions.gen_salt('bf')), now())
on conflict (id) do update
set password_hash = excluded.password_hash,
    updated_at = now();

alter table public.album_access_config enable row level security;
revoke all on table public.album_access_config from anon, authenticated;
grant all on table public.album_access_config to service_role;

-- Ver supabase-rsvp-per-guest-rows.sql para authenticate_album_guest e colunas em rsvps.
