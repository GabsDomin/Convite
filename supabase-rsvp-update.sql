-- Permite ajustar confirmação existente (incluir parceiro, filhos, etc.).
-- Execute no Supabase SQL Editor.

begin;

create or replace function public.confirm_rsvp(
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
  updated_at timestamptz,
  already_confirmed boolean
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
  blocked_guest_name text;
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

  if char_length(clean_name) not between 3 and 120 then
    raise exception 'Nome obrigatório';
  end if;

  if (
    select count(*) filter (where char_length(trim(part)) >= 2)
    from unnest(string_to_array(clean_name, ' ')) as part
  ) < 2 then
    raise exception 'Informe nome e sobrenome';
  end if;

  if selected_party_size not in ('Somente eu', 'Casal', 'Responsável e menores') then
    raise exception 'Tipo de confirmação inválido';
  end if;

  if exists (
    select 1
    from unnest(clean_additional_names) additional_name
    where char_length(additional_name) not between 3 and 120
       or (
         select count(*) filter (where char_length(trim(part)) >= 2)
         from unnest(string_to_array(additional_name, ' ')) as part
       ) < 2
  ) then
    raise exception 'Informe nome e sobrenome de cada pessoa';
  end if;

  if selected_party_size = 'Somente eu' and cardinality(clean_additional_names) <> 0 then
    raise exception 'A confirmação individual não deve incluir outros nomes';
  end if;

  if selected_party_size = 'Casal' and cardinality(clean_additional_names) not between 1 and 7 then
    raise exception 'Informe o nome do seu companheiro ou companheira';
  end if;

  if selected_party_size = 'Responsável e menores'
    and not legacy_children_confirmation
    and cardinality(clean_additional_names) not between 1 and 6 then
    raise exception 'Informe o nome de cada filho';
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
      and rg.normalized_guest_name = normalized_name
  ) then
    raise exception 'Infelizmente, % não está na lista de convidados.', clean_name;
  end if;

  select candidate.guest_label
  into blocked_guest_name
  from (
    select additional_name as guest_label
    from unnest(clean_additional_names) as additional_name
  ) candidate
  where exists (
    select 1
    from public.restricted_guests rg
    where rg.active
      and rg.normalized_guest_name = public.normalize_guest_name(candidate.guest_label)
  )
  limit 1;

  if blocked_guest_name is not null then
    raise exception 'Infelizmente, % não está na lista de convidados.', blocked_guest_name;
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

  if existing_rsvp_id is not null then
    if exists (
      select 1
      from public.rsvps r
      where r.id = existing_rsvp_id
        and r.party_size = selected_party_size
        and r.additional_guest_names = clean_additional_names
    ) then
      return query
      select
        r.id,
        r.guest_name,
        r.party_size,
        r.additional_guest_names,
        r.created_at,
        r.updated_at,
        true as already_confirmed
      from public.rsvps r
      where r.id = existing_rsvp_id;
      return;
    end if;

    return query
    update public.rsvps r
    set
      guest_name = clean_name,
      party_size = selected_party_size,
      additional_guest_names = clean_additional_names
    where r.id = existing_rsvp_id
    returning
      r.id,
      r.guest_name,
      r.party_size,
      r.additional_guest_names,
      r.created_at,
      r.updated_at,
      false as already_confirmed;
    return;
  end if;

  return query
  insert into public.rsvps (guest_name, party_size, additional_guest_names)
  values (clean_name, selected_party_size, clean_additional_names)
  returning
    rsvps.id,
    rsvps.guest_name,
    rsvps.party_size,
    rsvps.additional_guest_names,
    rsvps.created_at,
    rsvps.updated_at,
    false as already_confirmed;
end;
$$;

revoke execute on function public.confirm_rsvp(text, text, text[]) from public, anon, authenticated;
grant execute on function public.confirm_rsvp(text, text, text[]) to service_role;

commit;
