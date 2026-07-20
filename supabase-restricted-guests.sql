-- Lista privada de nomes que não podem confirmar presença.
-- Execute este arquivo no Supabase SQL Editor depois dos outros scripts.

begin;

create or replace function public.normalize_guest_name(p_name text)
returns text
language sql
immutable
set search_path = public
as $$
  select regexp_replace(
    translate(
      lower(trim(coalesce(p_name, ''))),
      'áàâãäéèêëíìîïóòôõöúùûüçñ',
      'aaaaaeeeeiiiiooooouuuucn'
    ),
    '\s+',
    ' ',
    'g'
  );
$$;

create table if not exists public.restricted_guests (
  id uuid primary key default gen_random_uuid(),
  guest_name text not null check (char_length(trim(guest_name)) between 2 and 120),
  normalized_guest_name text generated always as (
    public.normalize_guest_name(guest_name)
  ) stored,
  internal_note text,
  active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create unique index if not exists restricted_guests_normalized_name_key
  on public.restricted_guests (normalized_guest_name);

drop trigger if exists set_restricted_guests_updated_at on public.restricted_guests;
create trigger set_restricted_guests_updated_at
before update on public.restricted_guests
for each row execute function public.set_updated_at();

alter table public.restricted_guests enable row level security;

revoke all on table public.restricted_guests from public, anon, authenticated;
grant all on table public.restricted_guests to service_role;
revoke execute on function public.normalize_guest_name(text) from public, anon, authenticated;
grant execute on function public.normalize_guest_name(text) to service_role;

create or replace function public.confirm_rsvp(
  p_guest_name text,
  p_party_size text
)
returns table (
  id uuid,
  guest_name text,
  party_size text,
  created_at timestamptz,
  updated_at timestamptz
)
language plpgsql
security definer
set search_path = public
as $$
declare
  clean_name text := regexp_replace(trim(coalesce(p_guest_name, '')), '\s+', ' ', 'g');
  normalized_name text := public.normalize_guest_name(clean_name);
begin
  if char_length(clean_name) not between 2 and 120 then
    raise exception 'Nome obrigatório';
  end if;

  if p_party_size not in ('Somente eu', 'Eu e meus filhos') then
    raise exception 'Quantidade de pessoas inválida';
  end if;

  if exists (
    select 1
    from public.restricted_guests rg
    where rg.active
      and rg.normalized_guest_name = normalized_name
  ) then
    raise exception 'Infelizmente, seu nome não está na lista de convidados.';
  end if;

  insert into public.rsvps (guest_name, party_size)
  values (clean_name, p_party_size)
  on conflict (normalized_guest_name)
  do update set
    guest_name = excluded.guest_name,
    party_size = excluded.party_size
  returning rsvps.id, rsvps.guest_name, rsvps.party_size, rsvps.created_at, rsvps.updated_at
  into id, guest_name, party_size, created_at, updated_at;

  return next;
end;
$$;

revoke execute on function public.confirm_rsvp(text, text) from public, anon, authenticated;
grant execute on function public.confirm_rsvp(text, text) to service_role;

commit;

-- Para cadastrar nomes depois de executar este arquivo:
-- insert into public.restricted_guests (guest_name, internal_note)
-- values
--   ('Nome completo da pessoa', 'Observação opcional')
-- on conflict (normalized_guest_name) do update set
--   guest_name = excluded.guest_name,
--   internal_note = excluded.internal_note,
--   active = true;
