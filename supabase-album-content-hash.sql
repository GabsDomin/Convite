-- Impede a mesma mídia (mesmo conteúdo) de ser publicada mais de uma vez no álbum.

begin;

alter table public.album_media
  add column if not exists content_hash text;

alter table public.album_media
  drop constraint if exists album_media_content_hash_format;

alter table public.album_media
  add constraint album_media_content_hash_format
  check (content_hash is null or content_hash ~ '^[a-f0-9]{64}$');

create unique index if not exists album_media_content_hash_key
  on public.album_media (content_hash)
  where content_hash is not null;

commit;
