-- Confirmações individuais, por casal ou por responsável com menores.
-- Execute no Supabase SQL Editor depois de supabase-restricted-guests.sql.

begin;

alter table public.rsvps
  add column if not exists additional_guest_names text[] not null default '{}'::text[];

alter table public.rsvps
  drop constraint if exists rsvps_party_size_check;

update public.rsvps
set party_size = 'Responsável e menores'
where party_size = 'Eu e meus filhos';

alter table public.rsvps
  add constraint rsvps_party_size_check
  check (party_size in ('Somente eu', 'Casal', 'Responsável e menores'));

alter table public.rsvps
  drop constraint if exists rsvps_additional_guest_names_limit;

alter table public.rsvps
  add constraint rsvps_additional_guest_names_limit
  check (cardinality(additional_guest_names) <= 6);

drop function if exists public.confirm_rsvp(text, text);
drop function if exists public.confirm_rsvp(text, text, text[]);

create function public.confirm_rsvp(
  p_guest_name text,
  p_party_size text,
  p_additional_guest_names text[] default '{}'::text[]
)
returns table (
  id uuid,
  guest_name text,
  party_size text,
  additional_guest_names text[],
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
  clean_additional_names text[];
  selected_party_size text := case
    when p_party_size = 'Eu e meus filhos' then 'Responsável e menores'
    else p_party_size
  end;
  legacy_children_confirmation boolean := p_party_size = 'Eu e meus filhos';
  existing_rsvp_id uuid;
begin
  select coalesce(array_agg(candidate.clean_name order by candidate.position), '{}'::text[])
  into clean_additional_names
  from (
    select
      names.position,
      regexp_replace(trim(coalesce(names.guest_name, '')), '\s+', ' ', 'g') as clean_name
    from unnest(coalesce(p_additional_guest_names, '{}'::text[]))
      with ordinality as names(guest_name, position)
  ) candidate
  where candidate.clean_name <> '';

  if char_length(clean_name) not between 2 and 120 then
    raise exception 'Nome obrigatório';
  end if;

  if selected_party_size not in ('Somente eu', 'Casal', 'Responsável e menores') then
    raise exception 'Tipo de confirmação inválido';
  end if;

  if exists (
    select 1
    from unnest(clean_additional_names) additional_name
    where char_length(additional_name) not between 2 and 120
  ) then
    raise exception 'Informe o nome completo de cada pessoa';
  end if;

  if selected_party_size = 'Somente eu' and cardinality(clean_additional_names) <> 0 then
    raise exception 'A confirmação individual não deve incluir outros nomes';
  end if;

  if selected_party_size = 'Casal' and cardinality(clean_additional_names) <> 1 then
    raise exception 'Informe o nome do seu companheiro ou companheira';
  end if;

  if selected_party_size = 'Responsável e menores'
    and not legacy_children_confirmation
    and cardinality(clean_additional_names) not between 1 and 6 then
    raise exception 'Informe o nome de cada menor sob sua responsabilidade';
  end if;

  if exists (
    select 1
    from unnest(clean_additional_names) additional_name
    where public.normalize_guest_name(additional_name) = normalized_name
  ) then
    raise exception 'Não repita seu próprio nome na confirmação';
  end if;

  if exists (
    select public.normalize_guest_name(additional_name)
    from unnest(clean_additional_names) additional_name
    group by public.normalize_guest_name(additional_name)
    having count(*) > 1
  ) then
    raise exception 'Informe cada pessoa apenas uma vez';
  end if;

  if exists (
    select 1
    from public.restricted_guests rg
    where rg.active
      and (
        rg.normalized_guest_name = normalized_name
        or rg.normalized_guest_name in (
          select public.normalize_guest_name(additional_name)
          from unnest(clean_additional_names) additional_name
        )
      )
  ) then
    raise exception 'Infelizmente, seu nome não está na lista de convidados.';
  end if;

  select r.id
  into existing_rsvp_id
  from public.rsvps r
  where r.normalized_guest_name = normalized_name;

  if exists (
    select 1
    from public.rsvps other_rsvp
    where other_rsvp.id is distinct from existing_rsvp_id
      and (
        other_rsvp.normalized_guest_name in (
          select public.normalize_guest_name(additional_name)
          from unnest(clean_additional_names) additional_name
        )
        or exists (
          select 1
          from unnest(other_rsvp.additional_guest_names) saved_additional_name
          where public.normalize_guest_name(saved_additional_name) = normalized_name
             or public.normalize_guest_name(saved_additional_name) in (
               select public.normalize_guest_name(additional_name)
               from unnest(clean_additional_names) additional_name
             )
        )
      )
  ) then
    raise exception 'Uma das pessoas informadas já possui confirmação';
  end if;

  insert into public.rsvps (guest_name, party_size, additional_guest_names)
  values (clean_name, selected_party_size, clean_additional_names)
  on conflict (normalized_guest_name)
  do update set
    guest_name = excluded.guest_name,
    party_size = excluded.party_size,
    additional_guest_names = excluded.additional_guest_names
  returning
    rsvps.id,
    rsvps.guest_name,
    rsvps.party_size,
    rsvps.additional_guest_names,
    rsvps.created_at,
    rsvps.updated_at
  into id, guest_name, party_size, additional_guest_names, created_at, updated_at;

  return next;
end;
$$;

revoke execute on function public.confirm_rsvp(text, text, text[]) from public, anon, authenticated;
grant execute on function public.confirm_rsvp(text, text, text[]) to service_role;

commit;
