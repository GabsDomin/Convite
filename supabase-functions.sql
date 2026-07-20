-- Supabase RPC helpers for the wedding invitation.
-- Run this in Supabase SQL Editor after supabase-schema.sql.

create or replace function public.get_public_gifts()
returns table (
  id text,
  name text,
  gift_type text,
  section text,
  category text,
  description text,
  image_url text,
  value integer,
  goal integer,
  quota_options integer[],
  status text,
  sort_order integer
)
language sql
security definer
set search_path = public
as $$
  select
    g.id,
    g.name,
    g.gift_type,
    g.section,
    g.category,
    g.description,
    g.image_url,
    g.value,
    g.goal,
    g.quota_options,
    case
      when g.gift_type = 'fixed' and exists (
        select 1
        from public.gift_reservations gr
        where gr.gift_id = g.id
          and gr.gift_type = 'fixed'
      ) then 'reserved'
      else g.status
    end as status,
    g.sort_order
  from public.gifts g
  where g.status <> 'hidden'
  order by g.sort_order, g.name;
$$;

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
begin
  if char_length(clean_name) not between 2 and 120 then
    raise exception 'Nome obrigatório';
  end if;

  if p_party_size not in ('Somente eu', 'Eu e meus filhos') then
    raise exception 'Quantidade de pessoas inválida';
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

create or replace function public.reserve_gift(
  p_gift_id text,
  p_guest_name text,
  p_amount integer default null
)
returns table (
  id uuid,
  gift_id text,
  guest_name text,
  gift_name text,
  gift_type text,
  amount integer,
  created_at timestamptz
)
language plpgsql
security definer
set search_path = public
as $$
declare
  clean_name text := regexp_replace(trim(coalesce(p_guest_name, '')), '\s+', ' ', 'g');
  selected_gift public.gifts%rowtype;
  final_amount integer;
  contributed_amount integer;
begin
  if char_length(clean_name) not between 2 and 120 then
    raise exception 'Nome obrigatório';
  end if;

  select *
  into selected_gift
  from public.gifts
  where gifts.id = p_gift_id
    and gifts.status <> 'hidden'
  for update;

  if selected_gift.id is null then
    raise exception 'Presente não encontrado';
  end if;

  if selected_gift.gift_type = 'fixed' then
    final_amount := selected_gift.value;
  else
    final_amount := p_amount;

    if final_amount is null or not (final_amount = any(selected_gift.quota_options)) then
      raise exception 'Valor da cota inválido';
    end if;

    select coalesce(sum(gr.amount), 0)::integer
    into contributed_amount
    from public.gift_reservations gr
    where gr.gift_id = selected_gift.id
      and gr.gift_type = 'quota';

    if contributed_amount + final_amount > selected_gift.goal then
      raise exception 'Essa cota já atingiu o valor necessário';
    end if;
  end if;

  insert into public.gift_reservations (gift_id, guest_name, gift_name, gift_type, amount)
  values (selected_gift.id, clean_name, selected_gift.name, selected_gift.gift_type, final_amount)
  returning
    gift_reservations.id,
    gift_reservations.gift_id,
    gift_reservations.guest_name,
    gift_reservations.gift_name,
    gift_reservations.gift_type,
    gift_reservations.amount,
    gift_reservations.created_at
  into id, gift_id, guest_name, gift_name, gift_type, amount, created_at;

  return next;
exception
  when unique_violation then
    raise exception 'Esse presente já foi escolhido';
end;
$$;

revoke execute on function public.get_public_gifts() from public, anon, authenticated;
revoke execute on function public.confirm_rsvp(text, text) from public, anon, authenticated;
revoke execute on function public.reserve_gift(text, text, integer) from public, anon, authenticated;
grant execute on function public.get_public_gifts() to service_role;
grant execute on function public.confirm_rsvp(text, text) to service_role;
grant execute on function public.reserve_gift(text, text, integer) to service_role;
