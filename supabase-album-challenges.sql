-- Desafios do álbum: os noivos cadastram desafios ("Tire uma foto com o noivo")
-- e cada memória enviada pode ser marcada como a prova de um desafio.
-- Um convidado completa o desafio quando tem pelo menos uma memória ligada a ele.
-- Script reaplicável.

create table if not exists public.album_challenges (
  id uuid primary key default gen_random_uuid(),
  title text not null check (char_length(trim(title)) between 3 and 80),
  description text check (description is null or char_length(description) <= 240),
  points integer not null default 1 check (points between 1 and 100),
  sort_order integer not null default 0,
  -- Desafio encerrado deixa de aceitar envios, mas continua valendo pontos.
  active boolean not null default true,
  created_at timestamptz not null default now()
);

alter table public.album_media
  add column if not exists challenge_id uuid
  references public.album_challenges (id) on delete set null;

create index if not exists album_media_challenge_idx
  on public.album_media (challenge_id, created_at)
  where challenge_id is not null;

alter table public.album_challenges enable row level security;
revoke all on table public.album_challenges from anon, authenticated;
grant all on table public.album_challenges to service_role;

insert into public.album_challenges (title, description, points, sort_order)
select seed.title, seed.description, seed.points, seed.sort_order
from (values
  ('Foto com o noivo', 'Tire uma foto com o Gabriel.', 1, 10),
  ('Foto com a noiva', 'Tire uma foto com a Halanaia.', 1, 20),
  ('Foto com o casal', 'Tire uma foto com os noivos juntos.', 1, 30),
  ('Foto com a aliança', 'Registre as alianças de perto.', 1, 40)
) as seed (title, description, points, sort_order)
where not exists (select 1 from public.album_challenges);
