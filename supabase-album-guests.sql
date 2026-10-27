-- Convidados que entraram no álbum pelo "Não achei meu nome".
-- Eles não estão nas confirmações de presença, mas passam a aparecer na busca do álbum.
-- normalized_guest_name é gravado pelo servidor (minúsculas, sem acentos, espaços simples).
-- Script reaplicável.

create table if not exists public.album_guests (
  id uuid primary key default gen_random_uuid(),
  guest_name text not null check (char_length(trim(guest_name)) between 5 and 120),
  normalized_guest_name text not null unique,
  created_at timestamptz not null default now()
);

alter table public.album_guests enable row level security;
revoke all on table public.album_guests from anon, authenticated;
grant all on table public.album_guests to service_role;
