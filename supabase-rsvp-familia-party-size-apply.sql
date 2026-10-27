-- RSVP: Família (titular) + Parceiro(a) / Filho(a) nos acompanhantes

alter table public.rsvps drop constraint if exists rsvps_party_size_check;

alter table public.rsvps add constraint rsvps_party_size_check
  check (party_size in (
    'Somente eu',
    'Casal',
    'Família',
    'Responsável e menores',
    'Acompanhante',
    'Parceiro(a)',
    'Filho(a)'
  ));

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
  updated_at timestamptz,
  already_confirmed boolean
)
language plpgsql
security definer
set search_path = public, extensions
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
  existing_primary_id uuid;
  companion_name text;
  companion_index int;
  companion_normalized text;
  current_companions text[];
  companion_party_size text;
  blocked_guest_name text;
  linked_primary_name text;
  self_rsvp_id uuid;
  self_primary_rsvp_id uuid;
  self_guest_name text;
  self_party_size text;
  self_created_at timestamptz;
  self_updated_at timestamptz;
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

  if selected_party_size not in ('Somente eu', 'Casal', 'Família', 'Responsável e menores') then
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

  if selected_party_size = 'Família' and cardinality(clean_additional_names) not between 2 and 7 then
    raise exception 'Informe o parceiro ou parceira e pelo menos um filho';
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

  select
    self_row.id,
    self_row.primary_rsvp_id,
    self_row.guest_name,
    self_row.party_size,
    self_row.created_at,
    self_row.updated_at
  into
    self_rsvp_id,
    self_primary_rsvp_id,
    self_guest_name,
    self_party_size,
    self_created_at,
    self_updated_at
  from public.rsvps self_row
  where self_row.normalized_guest_name = normalized_name
  limit 1;

  if self_rsvp_id is not null and self_primary_rsvp_id is not null then
    select primary_row.guest_name
    into linked_primary_name
    from public.rsvps primary_row
    where primary_row.id = self_primary_rsvp_id;

    if selected_party_size = 'Somente eu' and cardinality(clean_additional_names) = 0 then
      return query
      select
        self_rsvp_id,
        self_guest_name,
        self_party_size,
        '{}'::text[] as additional_guest_names,
        self_created_at,
        self_updated_at,
        true as already_confirmed;
      return;
    end if;

    raise exception
      'Sua presença já foi confirmada por %. Peça para essa pessoa usar “Ajustar confirmação” se algo estiver errado.',
      coalesce(linked_primary_name, 'quem fez a confirmação');
  end if;

  if self_rsvp_id is not null and self_primary_rsvp_id is null then
    existing_primary_id := self_rsvp_id;
  else
    existing_primary_id := null;
  end if;

  foreach companion_name in array clean_additional_names loop
    companion_normalized := public.normalize_guest_name(companion_name);
    if exists (
      select 1
      from public.rsvps other_row
      where other_row.normalized_guest_name = companion_normalized
        and (
          other_row.primary_rsvp_id is distinct from existing_primary_id
          or existing_primary_id is null
        )
    ) then
      if exists (
        select 1
        from public.rsvps linked_row
        where linked_row.normalized_guest_name = companion_normalized
          and linked_row.primary_rsvp_id is not null
      ) then
        select primary_row.guest_name
        into linked_primary_name
        from public.rsvps linked_row
        join public.rsvps primary_row on primary_row.id = linked_row.primary_rsvp_id
        where linked_row.normalized_guest_name = companion_normalized
        limit 1;

        raise exception
          '% já consta na confirmação feita por %. Não é preciso confirmar de novo.',
          companion_name,
          coalesce(linked_primary_name, 'outro convidado');
      end if;

      raise exception 'Uma das pessoas informadas já possui confirmação';
    end if;
  end loop;

  if existing_primary_id is not null then
    current_companions := public.companion_names_for_primary(existing_primary_id);
    if (
      select primary_check.party_size from public.rsvps primary_check where primary_check.id = existing_primary_id
    ) = selected_party_size
      and current_companions = clean_additional_names then
      return query
      select
        r.id,
        r.guest_name,
        r.party_size,
        public.companion_names_for_primary(r.id),
        r.created_at,
        r.updated_at,
        true as already_confirmed
      from public.rsvps r
      where r.id = existing_primary_id;
      return;
    end if;

    update public.rsvps primary_row
    set
      guest_name = clean_name,
      party_size = selected_party_size
    where primary_row.id = existing_primary_id;
  else
    insert into public.rsvps as inserted (guest_name, party_size, additional_guest_names)
    values (clean_name, selected_party_size, '{}'::text[])
    returning inserted.id into existing_primary_id;
  end if;

  delete from public.rsvps companion
  where companion.primary_rsvp_id = existing_primary_id;

  for companion_index in 1..cardinality(clean_additional_names) loop
    companion_name := clean_additional_names[companion_index];
    companion_party_size := case
      when selected_party_size = 'Casal' then 'Parceiro(a)'
      when selected_party_size = 'Responsável e menores' then 'Filho(a)'
      when selected_party_size = 'Família' and companion_index = 1 then 'Parceiro(a)'
      when selected_party_size = 'Família' then 'Filho(a)'
      else 'Acompanhante'
    end;

    insert into public.rsvps (guest_name, party_size, primary_rsvp_id, additional_guest_names)
    values (companion_name, companion_party_size, existing_primary_id, '{}'::text[]);
  end loop;

  return query
  select
    r.id,
    r.guest_name,
    r.party_size,
    public.companion_names_for_primary(r.id),
    r.created_at,
    r.updated_at,
    false as already_confirmed
  from public.rsvps r
  where r.id = existing_primary_id;
end;
$$;

create or replace function public.authenticate_album_guest(
  p_guest_name text,
  p_password text
)
returns table (
  rsvp_id uuid,
  guest_name text
)
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  clean_name text := regexp_replace(trim(coalesce(p_guest_name, '')), '\s+', ' ', 'g');
  normalized_name text := public.normalize_guest_name(clean_name);
  matched_rsvp public.rsvps%rowtype;
  password_ok boolean := false;
begin
  if char_length(clean_name) not between 2 and 120 then
    raise exception 'Nome obrigatório';
  end if;

  if coalesce(p_password, '') = '' then
    raise exception 'Senha obrigatória';
  end if;

  select *
  into matched_rsvp
  from public.rsvps candidate
  where candidate.normalized_guest_name = normalized_name
  order by candidate.updated_at desc nulls last
  limit 1;

  if matched_rsvp.id is null then
    raise exception 'Nome não encontrado nas confirmações de presença.';
  end if;

  if matched_rsvp.password_hash is not null and btrim(matched_rsvp.password_hash) <> '' then
    password_ok := extensions.crypt(p_password, matched_rsvp.password_hash) = matched_rsvp.password_hash;
  else
    select exists (
      select 1
      from public.album_access_config config
      where config.id = 1
        and config.password_hash = extensions.crypt(p_password, config.password_hash)
    )
    into password_ok;
  end if;

  if not password_ok then
    raise exception 'Senha incorreta.';
  end if;

  rsvp_id := matched_rsvp.id;
  guest_name := matched_rsvp.guest_name;
  return next;
end;
$$;

revoke execute on function public.companion_names_for_primary(uuid) from public, anon, authenticated;
grant execute on function public.companion_names_for_primary(uuid) to service_role;
revoke execute on function public.confirm_rsvp(text, text, text[]) from public, anon, authenticated;
grant execute on function public.confirm_rsvp(text, text, text[]) to service_role;
revoke execute on function public.authenticate_album_guest(text, text) from public, anon, authenticated;
grant execute on function public.authenticate_album_guest(text, text) to service_role;

-- dados legados
update public.rsvps set party_size = 'Família' where id = 'f6a4d999-942f-4e10-96fb-df1fbc03f9c3';
update public.rsvps set party_size = 'Parceiro(a)' where id = '85bf8e6c-39d4-4887-aad2-e591fa57810f';
update public.rsvps set party_size = 'Filho(a)' where id in (
  '9e1582a6-e581-490e-b1f9-9521d3d175e3',
  'af394b25-c792-4f97-88c9-77b9a60f89b8'
);
update public.rsvps companion set party_size = 'Parceiro(a)'
where companion.party_size = 'Acompanhante'
  and companion.primary_rsvp_id in (
    select p.id from public.rsvps p
    where p.primary_rsvp_id is null and p.party_size = 'Casal'
      and (select count(*) from public.rsvps c where c.primary_rsvp_id = p.id) = 1
  );
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
  updated_at timestamptz,
  already_confirmed boolean
)
language plpgsql
security definer
set search_path = public, extensions
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
  existing_primary_id uuid;
  companion_name text;
  companion_index int;
  companion_normalized text;
  current_companions text[];
  companion_party_size text;
  blocked_guest_name text;
  linked_primary_name text;
  self_rsvp_id uuid;
  self_primary_rsvp_id uuid;
  self_guest_name text;
  self_party_size text;
  self_created_at timestamptz;
  self_updated_at timestamptz;
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

  if selected_party_size not in ('Somente eu', 'Casal', 'Família', 'Responsável e menores') then
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

  if selected_party_size = 'Família' and cardinality(clean_additional_names) not between 2 and 7 then
    raise exception 'Informe o parceiro ou parceira e pelo menos um filho';
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

  select
    self_row.id,
    self_row.primary_rsvp_id,
    self_row.guest_name,
    self_row.party_size,
    self_row.created_at,
    self_row.updated_at
  into
    self_rsvp_id,
    self_primary_rsvp_id,
    self_guest_name,
    self_party_size,
    self_created_at,
    self_updated_at
  from public.rsvps self_row
  where self_row.normalized_guest_name = normalized_name
  limit 1;

  if self_rsvp_id is not null and self_primary_rsvp_id is not null then
    select primary_row.guest_name
    into linked_primary_name
    from public.rsvps primary_row
    where primary_row.id = self_primary_rsvp_id;

    if selected_party_size = 'Somente eu' and cardinality(clean_additional_names) = 0 then
      return query
      select
        self_rsvp_id,
        self_guest_name,
        self_party_size,
        '{}'::text[] as additional_guest_names,
        self_created_at,
        self_updated_at,
        true as already_confirmed;
      return;
    end if;

    raise exception
      'Sua presença já foi confirmada por %. Peça para essa pessoa usar “Ajustar confirmação” se algo estiver errado.',
      coalesce(linked_primary_name, 'quem fez a confirmação');
  end if;

  if self_rsvp_id is not null and self_primary_rsvp_id is null then
    existing_primary_id := self_rsvp_id;
  else
    existing_primary_id := null;
  end if;

  foreach companion_name in array clean_additional_names loop
    companion_normalized := public.normalize_guest_name(companion_name);
    if exists (
      select 1
      from public.rsvps other_row
      where other_row.normalized_guest_name = companion_normalized
        and (
          other_row.primary_rsvp_id is distinct from existing_primary_id
          or existing_primary_id is null
        )
    ) then
      if exists (
        select 1
        from public.rsvps linked_row
        where linked_row.normalized_guest_name = companion_normalized
          and linked_row.primary_rsvp_id is not null
      ) then
        select primary_row.guest_name
        into linked_primary_name
        from public.rsvps linked_row
        join public.rsvps primary_row on primary_row.id = linked_row.primary_rsvp_id
        where linked_row.normalized_guest_name = companion_normalized
        limit 1;

        raise exception
          '% já consta na confirmação feita por %. Não é preciso confirmar de novo.',
          companion_name,
          coalesce(linked_primary_name, 'outro convidado');
      end if;

      raise exception 'Uma das pessoas informadas já possui confirmação';
    end if;
  end loop;

  if existing_primary_id is not null then
    current_companions := public.companion_names_for_primary(existing_primary_id);
    if (
      select primary_check.party_size from public.rsvps primary_check where primary_check.id = existing_primary_id
    ) = selected_party_size
      and current_companions = clean_additional_names then
      return query
      select
        r.id,
        r.guest_name,
        r.party_size,
        public.companion_names_for_primary(r.id),
        r.created_at,
        r.updated_at,
        true as already_confirmed
      from public.rsvps r
      where r.id = existing_primary_id;
      return;
    end if;

    update public.rsvps primary_row
    set
      guest_name = clean_name,
      party_size = selected_party_size
    where primary_row.id = existing_primary_id;
  else
    insert into public.rsvps as inserted (guest_name, party_size, additional_guest_names)
    values (clean_name, selected_party_size, '{}'::text[])
    returning inserted.id into existing_primary_id;
  end if;

  delete from public.rsvps companion
  where companion.primary_rsvp_id = existing_primary_id;

  for companion_index in 1..cardinality(clean_additional_names) loop
    companion_name := clean_additional_names[companion_index];
    companion_party_size := case
      when selected_party_size = 'Casal' then 'Parceiro(a)'
      when selected_party_size = 'Responsável e menores' then 'Filho(a)'
      when selected_party_size = 'Família' and companion_index = 1 then 'Parceiro(a)'
      when selected_party_size = 'Família' then 'Filho(a)'
      else 'Acompanhante'
    end;

    insert into public.rsvps (guest_name, party_size, primary_rsvp_id, additional_guest_names)
    values (companion_name, companion_party_size, existing_primary_id, '{}'::text[]);
  end loop;

  return query
  select
    r.id,
    r.guest_name,
    r.party_size,
    public.companion_names_for_primary(r.id),
    r.created_at,
    r.updated_at,
    false as already_confirmed
  from public.rsvps r
  where r.id = existing_primary_id;
end;
$$;

create or replace function public.authenticate_album_guest(
  p_guest_name text,
  p_password text
)
returns table (
  rsvp_id uuid,
  guest_name text
)
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  clean_name text := regexp_replace(trim(coalesce(p_guest_name, '')), '\s+', ' ', 'g');
  normalized_name text := public.normalize_guest_name(clean_name);
  matched_rsvp public.rsvps%rowtype;
  password_ok boolean := false;
begin
  if char_length(clean_name) not between 2 and 120 then
    raise exception 'Nome obrigatório';
  end if;

  if coalesce(p_password, '') = '' then
    raise exception 'Senha obrigatória';
  end if;

  select *
  into matched_rsvp
  from public.rsvps candidate
  where candidate.normalized_guest_name = normalized_name
  order by candidate.updated_at desc nulls last
  limit 1;

  if matched_rsvp.id is null then
    raise exception 'Nome não encontrado nas confirmações de presença.';
  end if;

  if matched_rsvp.password_hash is not null and btrim(matched_rsvp.password_hash) <> '' then
    password_ok := extensions.crypt(p_password, matched_rsvp.password_hash) = matched_rsvp.password_hash;
  else
    select exists (
      select 1
      from public.album_access_config config
      where config.id = 1
        and config.password_hash = extensions.crypt(p_password, config.password_hash)
    )
    into password_ok;
  end if;

  if not password_ok then
    raise exception 'Senha incorreta.';
  end if;

  rsvp_id := matched_rsvp.id;
  guest_name := matched_rsvp.guest_name;
  return next;
end;
$$;

revoke execute on function public.companion_names_for_primary(uuid) from public, anon, authenticated;
grant execute on function public.companion_names_for_primary(uuid) to service_role;
revoke execute on function public.confirm_rsvp(text, text, text[]) from public, anon, authenticated;
grant execute on function public.confirm_rsvp(text, text, text[]) to service_role;
revoke execute on function public.authenticate_album_guest(text, text) from public, anon, authenticated;
grant execute on function public.authenticate_album_guest(text, text) to service_role;

-- dados legados
update public.rsvps set party_size = 'Família' where id = 'f6a4d999-942f-4e10-96fb-df1fbc03f9c3';
update public.rsvps set party_size = 'Parceiro(a)' where id = '85bf8e6c-39d4-4887-aad2-e591fa57810f';
update public.rsvps set party_size = 'Filho(a)' where id in (
  '9e1582a6-e581-490e-b1f9-9521d3d175e3',
  'af394b25-c792-4f97-88c9-77b9a60f89b8'
);
update public.rsvps companion set party_size = 'Parceiro(a)'
where companion.party_size = 'Acompanhante'
  and companion.primary_rsvp_id in (
    select p.id from public.rsvps p
    where p.primary_rsvp_id is null and p.party_size = 'Casal'
      and (select count(*) from public.rsvps c where c.primary_rsvp_id = p.id) = 1
  );
