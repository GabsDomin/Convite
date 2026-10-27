-- Corrige a senha do álbum para nomes com acento (ex.: "Halanaia Vitória").
-- rsvps.normalized_guest_name mantém os acentos, mas normalize_guest_name() os remove,
-- então a comparação antiga nunca encontrava esses nomes. Agora as duas pontas
-- passam pela mesma normalização. Script reaplicável.

create or replace function public.authenticate_album_guest(p_guest_name text, p_password text)
returns table (rsvp_id uuid, guest_name text)
language plpgsql
security definer
set search_path to 'public', 'extensions'
as $function$
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
  where public.normalize_guest_name(candidate.guest_name) = normalized_name
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
$function$;
