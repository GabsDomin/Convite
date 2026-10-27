-- Limite da mensagem do presente (pagamento online): 5000 caracteres.

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

  update public.payment_orders
  set status = 'cancelled'
  where gift_id = selected_gift.id
    and status = 'pending'
    and expires_at <= now();

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
  returning
    payment_orders.id,
    payment_orders.gift_id,
    payment_orders.guest_name,
    payment_orders.buyer_email,
    payment_orders.gift_name,
    payment_orders.gift_type,
    payment_orders.amount,
    payment_orders.status,
    payment_orders.expires_at
  into id, gift_id, buyer_name, buyer_email, gift_name, gift_type, amount, status, expires_at;

  return next;
exception
  when unique_violation then
    raise exception 'Esse presente já está aguardando pagamento';
end;
$$;

revoke execute on function public.create_mercadopago_order(text, text, text, text, integer) from public, anon, authenticated;
grant execute on function public.create_mercadopago_order(text, text, text, text, integer) to service_role;
