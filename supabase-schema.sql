-- Supabase schema for the Gabriel & Halanaia wedding invitation.
-- Run this file in Supabase SQL Editor.

create extension if not exists pgcrypto;

create table if not exists public.rsvps (
  id uuid primary key default gen_random_uuid(),
  guest_name text not null,
  normalized_guest_name text generated always as (
    lower(regexp_replace(trim(guest_name), '\s+', ' ', 'g'))
  ) stored,
  party_size text not null check (party_size in ('Somente eu', 'Eu e meus filhos')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create unique index if not exists rsvps_normalized_guest_name_key
  on public.rsvps (normalized_guest_name);

create table if not exists public.gifts (
  id text primary key,
  name text not null,
  gift_type text not null check (gift_type in ('fixed', 'quota')),
  section text not null check (section in ('daily', 'home', 'special', 'quotas')),
  category text,
  description text not null,
  value integer,
  goal integer,
  quota_options integer[],
  status text not null default 'available' check (status in ('available', 'reserved', 'hidden')),
  sort_order integer not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint fixed_gift_value_required check (
    (gift_type = 'fixed' and value is not null and goal is null and quota_options is null)
    or
    (gift_type = 'quota' and value is null and goal is not null and quota_options is not null)
  )
);

create table if not exists public.gift_reservations (
  id uuid primary key default gen_random_uuid(),
  gift_id text not null references public.gifts(id) on update cascade on delete restrict,
  guest_name text not null,
  normalized_guest_name text generated always as (
    lower(regexp_replace(trim(guest_name), '\s+', ' ', 'g'))
  ) stored,
  gift_name text not null,
  gift_type text not null check (gift_type in ('fixed', 'quota')),
  amount integer not null check (amount > 0),
  created_at timestamptz not null default now()
);

create unique index if not exists one_fixed_reservation_per_gift
  on public.gift_reservations (gift_id)
  where gift_type = 'fixed';

create index if not exists gift_reservations_guest_name_idx
  on public.gift_reservations (normalized_guest_name);

create or replace function public.set_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists set_rsvps_updated_at on public.rsvps;
create trigger set_rsvps_updated_at
before update on public.rsvps
for each row execute function public.set_updated_at();

drop trigger if exists set_gifts_updated_at on public.gifts;
create trigger set_gifts_updated_at
before update on public.gifts
for each row execute function public.set_updated_at();

alter table public.rsvps enable row level security;
alter table public.gifts enable row level security;
alter table public.gift_reservations enable row level security;

drop policy if exists "Public can create rsvps" on public.rsvps;
create policy "Public can create rsvps"
on public.rsvps for insert
to anon, authenticated
with check (true);

drop policy if exists "Public can update own rsvp by name" on public.rsvps;
create policy "Public can update own rsvp by name"
on public.rsvps for update
to anon, authenticated
using (true)
with check (true);

drop policy if exists "Public can read gift catalog" on public.gifts;
create policy "Public can read gift catalog"
on public.gifts for select
to anon, authenticated
using (status <> 'hidden');

drop policy if exists "Public can create gift reservations" on public.gift_reservations;
create policy "Public can create gift reservations"
on public.gift_reservations for insert
to anon, authenticated
with check (true);

insert into public.gifts (id, name, gift_type, section, category, description, value, goal, quota_options, sort_order)
values
  ('panos-prato', 'Kit de panos de prato', 'fixed', 'daily', 'Cozinha', 'Para deixar nossa cozinha mais prática no dia a dia.', 35, null, null, 10),
  ('descanso-panelas', 'Descanso de panelas', 'fixed', 'daily', 'Cozinha', 'Para cuidar da mesa nos almoços em casa.', 35, null, null, 20),
  ('colheres-pau', 'Kit de colheres de pau', 'fixed', 'daily', 'Cozinha', 'Para os primeiros preparos na nossa cozinha.', 40, null, null, 30),
  ('kit-limpeza', 'Kit Limpeza', 'fixed', 'daily', 'Lavanderia', 'Para deixar a casa sempre limpa e cheirosa 🧽', 40, null, null, 35),
  ('pegadores-cozinha', 'Kit de pegadores de cozinha', 'fixed', 'daily', 'Cozinha', 'Para ajudar nos preparos e servir com carinho.', 45, null, null, 40),
  ('caixa-organizadora', 'Caixa organizadora', 'fixed', 'daily', 'Lavanderia', 'Para guardar tudo com mais praticidade 📦', 45, null, null, 45),
  ('organizador-gaveta', 'Organizador de gavetas', 'fixed', 'daily', 'Casa', 'Para manter nosso novo lar mais arrumado.', 45, null, null, 50),
  ('tabua-corte', 'Tábua de corte', 'fixed', 'daily', 'Cozinha', 'Para os preparos do dia a dia na cozinha.', 50, null, null, 60),
  ('potes-tempero', 'Porta-temperos', 'fixed', 'daily', 'Cozinha', 'Para organizar os temperos da nossa casa.', 60, null, null, 70),
  ('escorredor-louca', 'Escorredor de louça', 'fixed', 'daily', 'Cozinha', 'Para facilitar nossa rotina depois das refeições.', 65, null, null, 80),
  ('cesto-roupas', 'Cesto de roupas', 'fixed', 'daily', 'Lavanderia', 'Para ajudar na organização da lavanderia.', 65, null, null, 90),
  ('jogo-americano', 'Jogo americano', 'fixed', 'daily', 'Mesa', 'Para montar uma mesa simples e bonita.', 70, null, null, 100),
  ('lixeira-cozinha', 'Lixeira de cozinha', 'fixed', 'daily', 'Cozinha', 'Para completar os itens essenciais da casa.', 75, null, null, 110),
  ('kit-copos-simples', 'Kit de copos para o dia a dia', 'fixed', 'daily', 'Mesa', 'Para receber visitas e compartilhar bons momentos.', 80, null, null, 120),
  ('porta-mantimentos', 'Porta-mantimentos', 'fixed', 'daily', 'Cozinha', 'Para deixar a despensa mais organizada.', 85, null, null, 130),
  ('sapateira', 'Sapateira', 'fixed', 'daily', 'Lavanderia', 'Para manter os calçados organizados no dia a dia 👟', 100, null, null, 132),
  ('kit-de-cama', 'Kit de Cama', 'fixed', 'daily', 'Quarto', 'Para deixar nosso quarto mais aconchegante 🛏️', 110, null, null, 135),
  ('edredom', 'Edredom', 'fixed', 'daily', 'Quarto', 'Para deixar nossa cama ainda mais confortável ✨', 120, null, null, 138),
  ('panela-de-pressao', 'Panela de pressão', 'fixed', 'daily', 'Cozinha', 'Para preparar refeições práticas com muito carinho 🍲', 119, null, null, 139),
  ('so-para-dizer-que-nao-dei-nada', 'Só para dizer que eu não dei nada', 'fixed', 'daily', 'Casa', 'Para participar da lista sem perder a pose 😄', 40, null, null, 38),
  ('calvice-do-noivo', 'Ajuda no tratamento de calvice do noivo', 'fixed', 'special', 'Casa', 'Uma força para manter o brilho no grande dia 💇‍♂️', 300, null, null, 315),
  ('calmante-dia-casamento', 'Calmante para o dia do casamento', 'fixed', 'daily', 'Casa', 'Para respirar fundo e aproveitar cada segundo 😌', 35, null, null, 25),
  ('tres-meses-corte-cabelo-noivo', '3 meses de corte de cabelo do noivo', 'fixed', 'daily', 'Casa', 'Para o noivo chegar sempre alinhado ✂️', 105, null, null, 134),
  ('tampao-ouvido-noivo-roncar', 'Tampão de ouvido para não ouvir o noivo roncar', 'fixed', 'daily', 'Quarto', 'Para garantir noites de paz no novo lar 😴', 70, null, null, 105),
  ('curso-culinaria-noiva', 'Curso de culinária da noiva', 'fixed', 'daily', 'Cozinha', 'Para receitas cheias de carinho e coragem 👩‍🍳', 90, null, null, 131),
  ('jantar-romantico-noivos', 'Jantar romântico dos noivos', 'fixed', 'daily', 'Mesa', 'Para celebrar o amor com uma noite especial 🍝', 200, null, null, 195),
  ('deus-tocar-coracao', 'Se Deus tocar no seu coração', 'fixed', 'home', 'Casa', 'Para contribuir com fé, amor e generosidade 🙏', 300, null, null, 255),
  ('cueca-sexy-nupcias', 'Cueca Sexy para as nupcias', 'fixed', 'daily', 'Quarto', 'Para entrar no clima com bom humor 😎', 60, null, null, 75),
  ('levar-marmita-pra-casa', 'Levar marmita pra casa', 'fixed', 'daily', 'Cozinha', 'Para garantir comida boa depois da festa 🍱', 100, null, null, 133),
  ('aviaozinho-tio-silvo', 'Aviãozinho do tio Silvo', 'fixed', 'special', 'Casa', 'Para animar a festa com estilo e nostalgia ✈️', 230, null, null, 305),
  ('utensilios', 'Kit de utensílios de cozinha', 'fixed', 'daily', 'Cozinha', 'Para ajudar nos primeiros preparos da nossa casa.', 120, null, null, 140),
  ('kit-toalhas', 'Kit toalhas', 'fixed', 'daily', 'Banheiro', 'Para trazer conforto aos nossos banhos 🛁', 130, null, null, 145),
  ('potes', 'Conjunto de potes herméticos', 'fixed', 'daily', 'Cozinha', 'Para manter nossa cozinha mais organizada.', 150, null, null, 150),
  ('cobertor', 'Cobertor', 'fixed', 'daily', 'Quarto', 'Para deixar nossas noites mais quentinhas 🛌', 150, null, null, 155),
  ('assadeiras', 'Kit de assadeiras antiaderentes', 'fixed', 'daily', 'Cozinha', 'Para preparar receitas no nosso dia a dia.', 150, null, null, 160),
  ('grill', 'Sanduicheira ou grill', 'fixed', 'daily', 'Cozinha', 'Para nossos lanches rápidos.', 180, null, null, 170),
  ('cafeteira', 'Cafeteira elétrica simples', 'fixed', 'daily', 'Cozinha', 'Para deixar nossas manhãs mais especiais.', 180, null, null, 180),
  ('chaleira', 'Chaleira elétrica', 'fixed', 'daily', 'Cozinha', 'Para cafés, chás e momentos tranquilos.', 180, null, null, 190),
  ('panela-arroz', 'Panela de arroz elétrica', 'fixed', 'daily', 'Cozinha', 'Para facilitar nossa rotina na cozinha.', 220, null, null, 200),
  ('liquidificador', 'Liquidificador', 'fixed', 'daily', 'Cozinha', 'Para sucos, vitaminas e receitas do dia a dia.', 250, null, null, 210),
  ('mixer', 'Mixer 3 em 1', 'fixed', 'daily', 'Cozinha', 'Para deixar os preparos mais práticos.', 250, null, null, 220),
  ('ferro', 'Ferro de passar roupa', 'fixed', 'daily', 'Lavanderia', 'Para cuidar das nossas roupas.', 250, null, null, 230),
  ('cama-casal', 'Jogo de cama casal', 'fixed', 'home', 'Quarto', 'Para deixar nosso quarto mais completo.', 280, null, null, 240),
  ('banho', 'Kit de banho completo', 'fixed', 'home', 'Banheiro', 'Para começar a casa com mais conforto.', 300, null, null, 250),
  ('air-fryer-compacta', 'Air Fryer compacta', 'fixed', 'home', 'Cozinha', 'Para facilitar nossas refeições.', 350, null, null, 260),
  ('aspirador', 'Aspirador de pó vertical', 'fixed', 'home', 'Limpeza', 'Para ajudar na limpeza da casa nova.', 350, null, null, 270),
  ('pressao-eletrica', 'Panela de pressão elétrica', 'fixed', 'home', 'Cozinha', 'Para deixar nossa cozinha mais prática e segura.', 400, null, null, 280),
  ('faqueiro', 'Faqueiro inox completo', 'fixed', 'home', 'Cozinha', 'Para montar nossa mesa com carinho.', 400, null, null, 290),
  ('jantar', 'Jogo de jantar', 'fixed', 'home', 'Cozinha', 'Para receber pessoas queridas na nossa casa.', 450, null, null, 300),
  ('panelas', 'Jogo de panelas antiaderente', 'fixed', 'home', 'Cozinha', 'Para começarmos a cozinhar na nossa casa.', 500, null, null, 310),
  ('forno', 'Forno elétrico', 'fixed', 'special', 'Cozinha', 'Para preparar receitas especiais.', 550, null, null, 320),
  ('cooktop', 'Cooktop a gás', 'fixed', 'special', 'Cozinha', 'Para ajudar a montar nossa cozinha.', 600, null, null, 330),
  ('air-fryer-oven', 'Air Fryer Oven', 'fixed', 'special', 'Cozinha', 'Para deixar nossa rotina ainda mais prática.', 700, null, null, 340),
  ('microondas', 'Micro-ondas', 'fixed', 'special', 'Eletrodoméstico', 'Um item essencial para o nosso dia a dia.', 750, null, null, 350),
  ('purificador', 'Purificador de água', 'fixed', 'special', 'Cozinha', 'Para termos água filtrada sempre à mão.', 800, null, null, 360),
  ('panelas-premium', 'Jogo de panelas premium', 'fixed', 'special', 'Cozinha', 'Para completar nossa cozinha com qualidade.', 900, null, null, 370),
  ('geladeira', 'Cota da geladeira', 'quota', 'quotas', 'Cota da casa', 'Para nos ajudar em um dos principais itens da casa nova.', null, 5500, array[150, 250, 500, 1000], 380),
  ('cota-maquina-de-lavar', 'Cota da máquina de lavar', 'quota', 'quotas', 'Cota da casa', 'Para facilitar nossa rotina com as roupas.', null, 1600, array[150, 250, 500, 1000], 390),
  ('sofa', 'Cota do sofá', 'quota', 'quotas', 'Cota da casa', 'Para montar nossa sala com conforto.', null, 2500, array[150, 250, 500, 1000], 400),
  ('cama-colchao', 'Cota da cama e colchão', 'quota', 'quotas', 'Cota da casa', 'Para montar nosso cantinho de descanso.', null, 2500, array[150, 250, 500, 1000], 410),
  ('guarda-roupa', 'Cota do guarda-roupa', 'quota', 'quotas', 'Cota da casa', 'Para ajudar na organização do nosso quarto.', null, 2000, array[150, 250, 500], 420),
  ('mesa-jantar', 'Cota da mesa de jantar', 'quota', 'quotas', 'Cota da casa', 'Para criarmos momentos especiais à mesa.', null, 1500, array[150, 250, 500], 430),
  ('eletrodomesticos', 'Cota dos eletrodomésticos', 'quota', 'quotas', 'Cota da casa', 'Para completar os itens essenciais da nossa casa.', null, 3000, array[150, 250, 500, 1000], 440),
  ('moveis', 'Cota para móveis da casa', 'quota', 'quotas', 'Cota da casa', 'Para nos ajudar a mobiliar nosso novo lar.', null, 3000, array[150, 250, 500, 1000], 450),
  ('casa-nova', 'Cota da casa nova', 'quota', 'quotas', 'Cota da casa', 'Para contribuir com esse novo começo.', null, 5000, array[150, 250, 500, 1000], 460)
on conflict (id) do update set
  name = excluded.name,
  gift_type = excluded.gift_type,
  section = excluded.section,
  category = excluded.category,
  description = excluded.description,
  value = excluded.value,
  goal = excluded.goal,
  quota_options = excluded.quota_options,
  sort_order = excluded.sort_order,
  updated_at = now();

update public.gifts
set status = 'hidden',
    updated_at = now()
where id = 'maquina-de-lavar'
  and gift_type = 'fixed';
