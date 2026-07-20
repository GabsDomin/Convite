-- Catálogo do álbum coletivo Gabriel & Halanaia.
-- Execute este arquivo uma vez no SQL Editor do Supabase.

create extension if not exists pgcrypto;

create table if not exists public.album_media (
  id uuid primary key default gen_random_uuid(),
  guest_name text not null check (char_length(trim(guest_name)) between 2 and 80),
  category text not null check (category in ('Preparativos', 'Cerimônia', 'Jantar', 'Festa')),
  public_id text not null unique check (public_id like 'gab-naia/album/%'),
  resource_type text not null check (resource_type in ('image', 'video')),
  format text not null check (format ~ '^[a-z0-9]{2,12}$'),
  version bigint not null check (version > 0),
  bytes bigint not null check (bytes > 0 and bytes <= 104857600),
  width integer check (width is null or width between 1 and 32000),
  height integer check (height is null or height between 1 and 32000),
  duration numeric check (duration is null or duration between 0 and 3600),
  created_at timestamptz not null default now()
);

create index if not exists album_media_created_at_idx
  on public.album_media (created_at desc);

create index if not exists album_media_guest_name_idx
  on public.album_media (lower(trim(guest_name)));

alter table public.album_media enable row level security;

-- Os convidados nunca recebem uma chave do Supabase. Toda leitura e gravação
-- passa pela API do convite, que valida os dados e usa a chave secreta no servidor.
revoke all on table public.album_media from anon, authenticated;
grant all on table public.album_media to service_role;

