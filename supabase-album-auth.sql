-- Acesso ao álbum: senha padrão compartilhada + nome confirmado no RSVP.
-- Execute no SQL Editor (pode rodar de novo com segurança).

create extension if not exists pgcrypto with schema extensions;

create table if not exists public.album_access_config (
  id smallint primary key default 1 check (id = 1),
  password_hash text not null,
  updated_at timestamptz not null default now()
);

-- Sempre redefine a senha padrão para 123456 (hash bcrypt).
insert into public.album_access_config (id, password_hash, updated_at)
values (1, extensions.crypt('123456', extensions.gen_salt('bf')), now())
on conflict (id) do update
set password_hash = excluded.password_hash,
    updated_at = now();

alter table public.album_access_config enable row level security;
revoke all on table public.album_access_config from anon, authenticated;
grant all on table public.album_access_config to service_role;

drop function if exists public.authenticate_album_guest(text, text);

create function public.authenticate_album_guest(
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
  config_count integer := 0;
begin
  if char_length(clean_name) not between 2 and 120 then
    raise exception 'Nome obrigatório';
  end if;

  if coalesce(p_password, '') = '' then
    raise exception 'Senha obrigatória';
  end if;

  select count(*)::integer
  into config_count
  from public.album_access_config
  where id = 1;

  if config_count = 0 then
    raise exception 'Senha do álbum ainda não foi configurada.';
  end if;

  select *
  into matched_rsvp
  from public.rsvps candidate
  where public.normalize_guest_name(candidate.guest_name) = normalized_name
     or lower(regexp_replace(trim(candidate.guest_name), '\s+', ' ', 'g')) = lower(clean_name)
     or exists (
       select 1
       from unnest(coalesce(candidate.additional_guest_names, '{}'::text[])) as additional(name)
       where public.normalize_guest_name(additional.name) = normalized_name
          or lower(regexp_replace(trim(additional.name), '\s+', ' ', 'g')) = lower(clean_name)
     )
  order by candidate.updated_at desc nulls last
  limit 1;

  if matched_rsvp.id is null then
    raise exception 'Nome não encontrado nas confirmações de presença.';
  end if;

  select exists (
    select 1
    from public.album_access_config config
    where config.id = 1
      and config.password_hash = extensions.crypt(p_password, config.password_hash)
  )
  into password_ok;

  if not password_ok then
    raise exception 'Senha incorreta.';
  end if;

  rsvp_id := matched_rsvp.id;
  guest_name := clean_name;
  return next;
end;
$$;

revoke execute on function public.authenticate_album_guest(text, text) from public, anon, authenticated;
grant execute on function public.authenticate_album_guest(text, text) to service_role;
