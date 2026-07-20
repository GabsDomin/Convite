-- Catálogo do álbum coletivo com mídia no Cloudflare R2 e backup no Google Drive.
-- Este script é reaplicável e também migra a estrutura antiga do Cloudinary.

create extension if not exists pgcrypto;

create table if not exists public.album_media (
  id uuid primary key default gen_random_uuid(),
  guest_name text not null check (char_length(trim(guest_name)) between 2 and 80),
  category text not null check (category in ('Preparativos', 'Cerimônia', 'Jantar', 'Festa')),
  storage_provider text not null default 'r2',
  storage_key text unique,
  original_file_name text,
  public_id text unique,
  resource_type text not null check (resource_type in ('image', 'video')),
  mime_type text,
  format text,
  version bigint,
  bytes bigint not null,
  width integer check (width is null or width between 1 and 32000),
  height integer check (height is null or height between 1 and 32000),
  duration numeric check (duration is null or duration between 0 and 3600),
  etag text,
  backup_status text not null default 'pending',
  drive_file_id text,
  backup_attempts integer not null default 0,
  backup_error text,
  backed_up_at timestamptz,
  created_at timestamptz not null default now()
);

alter table public.album_media add column if not exists storage_provider text;
alter table public.album_media add column if not exists storage_key text;
alter table public.album_media add column if not exists original_file_name text;
alter table public.album_media add column if not exists mime_type text;
alter table public.album_media add column if not exists etag text;
alter table public.album_media add column if not exists backup_status text;
alter table public.album_media add column if not exists drive_file_id text;
alter table public.album_media add column if not exists backup_attempts integer;
alter table public.album_media add column if not exists backup_error text;
alter table public.album_media add column if not exists backed_up_at timestamptz;

-- Preserva qualquer mídia que já tenha sido cadastrada pelo Cloudinary.
update public.album_media
set storage_provider = case when storage_key is not null then 'r2' else 'cloudinary' end
where storage_provider is null;

update public.album_media
set mime_type = case
  when resource_type = 'image' then 'image/' || case when format = 'jpg' then 'jpeg' else coalesce(format, 'jpeg') end
  else 'video/' || coalesce(format, 'mp4')
end
where mime_type is null;

update public.album_media
set backup_status = case when storage_provider = 'r2' then 'pending' else 'not_applicable' end
where backup_status is null;

update public.album_media set backup_attempts = 0 where backup_attempts is null;

alter table public.album_media alter column public_id drop not null;
alter table public.album_media alter column format drop not null;
alter table public.album_media alter column version drop not null;
alter table public.album_media alter column storage_provider set default 'r2';
alter table public.album_media alter column storage_provider set not null;
alter table public.album_media alter column mime_type set not null;
alter table public.album_media alter column backup_status set default 'pending';
alter table public.album_media alter column backup_status set not null;
alter table public.album_media alter column backup_attempts set default 0;
alter table public.album_media alter column backup_attempts set not null;

alter table public.album_media drop constraint if exists album_media_bytes_check;
alter table public.album_media
  add constraint album_media_bytes_check check (bytes > 0 and bytes <= 524288000);

alter table public.album_media drop constraint if exists album_media_storage_provider_check;
alter table public.album_media
  add constraint album_media_storage_provider_check
  check (storage_provider in ('r2', 'cloudinary'));

alter table public.album_media drop constraint if exists album_media_backup_status_check;
alter table public.album_media
  add constraint album_media_backup_status_check
  check (backup_status in ('pending', 'processing', 'complete', 'error', 'not_applicable'));

alter table public.album_media drop constraint if exists album_media_storage_reference_check;
alter table public.album_media
  add constraint album_media_storage_reference_check
  check (
    (storage_provider = 'r2' and storage_key is not null and storage_key like 'gab-naia/album/originals/%')
    or (storage_provider = 'cloudinary' and public_id is not null)
  ) not valid;

do $$
begin
  alter table public.album_media
    add constraint album_media_storage_key_key unique (storage_key);
exception
  when duplicate_object then null;
end $$;

create index if not exists album_media_created_at_idx
  on public.album_media (created_at desc);

create index if not exists album_media_guest_name_idx
  on public.album_media (lower(trim(guest_name)));

create index if not exists album_media_backup_status_idx
  on public.album_media (backup_status, created_at)
  where storage_provider = 'r2';

alter table public.album_media enable row level security;

-- Os convidados nunca recebem uma chave do Supabase. Toda leitura e gravação
-- passa pela API do convite ou pelo Worker de backup.
revoke all on table public.album_media from anon, authenticated;
grant all on table public.album_media to service_role;
