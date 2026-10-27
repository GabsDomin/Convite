-- Corrige "column reference gift_id is ambiguous" em funções que retornam gift_id
-- como coluna de saída e também referenciam payment_orders.gift_id no corpo.

create or replace function public.create_mercadopago_order(
  p_gift_id text,
  p_buyer_name text,
  p_buyer_email text,
  p_message text default null,
  p_amount integer default null
)
returns table (
  id uuid,
  gift_id text,
  buyer_name text,
  buyer_email text,
  gift_name text,
  gift_type text,
  amount integer,
  status text,
  expires_at timestamptz
)
language plpgsql
security definer
set search_path = public
as $$
declare
  clean_name text := regexp_replace(trim(coalesce(p_buyer_name, '')), '\s+', ' ', 'g');
  clean_email text := lower(trim(coalesce(p_buyer_email, '')));
  selected_gift public.gifts%rowtype;
  inserted_order public.payment_orders%rowtype;
  final_amount integer;
  committed_amount integer;
begin
  if char_length(clean_name) not between 2 and 120 then
    raise exception 'Nome obrigatório';
  end if;

  if char_length(clean_email) > 254
    or (clean_email <> '' and clean_email !~* '^[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}$') then
    raise exception 'E-mail inválido';
  end if;

  if char_length(coalesce(p_message, '')) > 5000 then
    raise exception 'Mensagem muito longa';
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

  update public.payment_orders po
  set status = 'cancelled'
  where po.gift_id = selected_gift.id
    and po.status = 'pending'
    and po.expires_at <= now();

  if selected_gift.gift_type = 'fixed' then
    if exists (
      select 1
      from public.gift_reservations gr
      where gr.gift_id = selected_gift.id
        and gr.gift_type = 'fixed'
    ) or exists (
      select 1
      from public.payment_orders po
      where po.gift_id = selected_gift.id
        and po.gift_type = 'fixed'
        and po.status in ('approved', 'paid')
    ) then
      raise exception 'Esse presente já foi escolhido';
    end if;

    final_amount := selected_gift.value;
  elsif selected_gift.gift_type = 'open' then
    final_amount := p_amount;

    if final_amount is null or final_amount < 1 or final_amount > 1000000 then
      raise exception 'Valor inválido';
    end if;
  else
    final_amount := p_amount;

    if final_amount is null or not (final_amount = any(selected_gift.quota_options)) then
      raise exception 'Valor da cota inválido';
    end if;

    select (
      coalesce((
        select sum(gr.amount)
        from public.gift_reservations gr
        where gr.gift_id = selected_gift.id
          and gr.gift_type = 'quota'
      ), 0)
      + coalesce((
        select sum(po.amount)
        from public.payment_orders po
        where po.gift_id = selected_gift.id
          and po.gift_type = 'quota'
          and po.status = 'pending'
          and po.expires_at > now()
      ), 0)
    )::integer
    into committed_amount;

    if committed_amount + final_amount > selected_gift.goal then
      raise exception 'Essa cota já atingiu o valor necessário';
    end if;
  end if;

  insert into public.payment_orders (
    gift_id,
    guest_name,
    buyer_email,
    message,
    gift_name,
    gift_type,
    amount,
    gateway
  )
  values (
    selected_gift.id,
    clean_name,
    nullif(clean_email, ''),
    nullif(trim(coalesce(p_message, '')), ''),
    selected_gift.name,
    selected_gift.gift_type,
    final_amount,
    'mercado_pago'
  )
  returning * into inserted_order;

  id := inserted_order.id;
  gift_id := inserted_order.gift_id;
  buyer_name := inserted_order.guest_name;
  buyer_email := inserted_order.buyer_email;
  gift_name := inserted_order.gift_name;
  gift_type := inserted_order.gift_type;
  amount := inserted_order.amount;
  status := inserted_order.status;
  expires_at := inserted_order.expires_at;

  return next;
exception
  when unique_violation then
    raise exception 'Esse presente já está aguardando pagamento';
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
  inserted_reservation public.gift_reservations%rowtype;
  final_amount integer;
  committed_amount integer;
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

  update public.payment_orders po
  set status = 'cancelled'
  where po.gift_id = selected_gift.id
    and po.status = 'pending'
    and po.expires_at <= now();

  if selected_gift.gift_type = 'fixed' then
    if exists (
      select 1
      from public.payment_orders po
      where po.gift_id = selected_gift.id
        and po.gift_type = 'fixed'
        and po.status = 'pending'
    ) then
      raise exception 'Esse presente já está aguardando pagamento';
    end if;

    final_amount := selected_gift.value;
  elsif selected_gift.gift_type = 'open' then
    final_amount := p_amount;

    if final_amount is null or final_amount < 1 or final_amount > 1000000 then
      raise exception 'Valor inválido';
    end if;
  else
    final_amount := p_amount;

    if final_amount is null or not (final_amount = any(selected_gift.quota_options)) then
      raise exception 'Valor da cota inválido';
    end if;

    select (
      coalesce((
        select sum(gr.amount)
        from public.gift_reservations gr
        where gr.gift_id = selected_gift.id
          and gr.gift_type = 'quota'
      ), 0)
      + coalesce((
        select sum(po.amount)
        from public.payment_orders po
        where po.gift_id = selected_gift.id
          and po.gift_type = 'quota'
          and po.status = 'pending'
          and po.expires_at > now()
      ), 0)
    )::integer
    into committed_amount;

    if committed_amount + final_amount > selected_gift.goal then
      raise exception 'Essa cota já atingiu o valor necessário';
    end if;
  end if;

  insert into public.gift_reservations (gift_id, guest_name, gift_name, gift_type, amount)
  values (selected_gift.id, clean_name, selected_gift.name, selected_gift.gift_type, final_amount)
  returning * into inserted_reservation;

  id := inserted_reservation.id;
  gift_id := inserted_reservation.gift_id;
  guest_name := inserted_reservation.guest_name;
  gift_name := inserted_reservation.gift_name;
  gift_type := inserted_reservation.gift_type;
  amount := inserted_reservation.amount;
  created_at := inserted_reservation.created_at;

  return next;
exception
  when unique_violation then
    raise exception 'Esse presente já foi escolhido';
end;
$$;

revoke execute on function public.create_mercadopago_order(text, text, text, text, integer) from public, anon, authenticated;
grant execute on function public.create_mercadopago_order(text, text, text, text, integer) to service_role;
revoke execute on function public.reserve_gift(text, text, integer) from public, anon, authenticated;
grant execute on function public.reserve_gift(text, text, integer) to service_role;
