-- Presente com contribuição livre (valor escolhido pelo convidado).

alter table public.gifts drop constraint if exists fixed_gift_value_required;
alter table public.gifts drop constraint if exists gifts_type_fields_required;
alter table public.gifts drop constraint if exists gifts_gift_type_check;

alter table public.gifts
  add constraint gifts_gift_type_check check (gift_type in ('fixed', 'quota', 'open'));

alter table public.gifts
  add constraint gifts_type_fields_required check (
    (gift_type = 'fixed' and value is not null and goal is null and quota_options is null)
    or (gift_type = 'quota' and value is null and goal is not null and quota_options is not null)
    or (gift_type = 'open' and value is null and goal is null and quota_options is null)
  );

alter table public.gift_reservations drop constraint if exists gift_reservations_gift_type_check;
alter table public.gift_reservations
  add constraint gift_reservations_gift_type_check check (gift_type in ('fixed', 'quota', 'open'));

alter table public.payment_orders drop constraint if exists payment_orders_gift_type_check;
alter table public.payment_orders
  add constraint payment_orders_gift_type_check check (gift_type in ('fixed', 'quota', 'open'));

insert into public.gifts (id, name, gift_type, section, category, description, value, goal, quota_options, sort_order, status, image_url)
values (
  'contribuicao-livre',
  'Contribua com o valor que quiser',
  'open',
  'quotas',
  'Cota da casa',
  'Presenteie com o valor que fizer sentido para você — quantas vezes quiser, cada gesto nos ajuda a montar nosso cantinho com carinho.',
  null,
  null,
  null,
  375,
  'available',
  'https://lyuqvwrikfajmcodwous.supabase.co/storage/v1/object/public/gift-images/QuandoQuiser.png'
)
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
  status = excluded.status,
  image_url = excluded.image_url;

drop function if exists public.get_public_gifts();

create function public.get_public_gifts()
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
  contributed_amount integer,
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
      when g.gift_type = 'quota' then coalesce((
        select sum(gr.amount)
        from public.gift_reservations gr
        where gr.gift_id = g.id
          and gr.gift_type = 'quota'
      ), 0)::integer
      when g.gift_type = 'open' then coalesce((
        select sum(gr.amount)
        from public.gift_reservations gr
        where gr.gift_id = g.id
          and gr.gift_type = 'open'
      ), 0)::integer
      else 0
    end as contributed_amount,
    case
      when g.gift_type = 'fixed' and (
        exists (
          select 1
          from public.gift_reservations gr
          where gr.gift_id = g.id
            and gr.gift_type = 'fixed'
        )
        or exists (
          select 1
          from public.payment_orders po
          where po.gift_id = g.id
            and po.gift_type = 'fixed'
            and po.status in ('approved', 'paid')
        )
      ) then 'reserved'
      when g.gift_type = 'quota' and coalesce((
        select sum(gr.amount)
        from public.gift_reservations gr
        where gr.gift_id = g.id
          and gr.gift_type = 'quota'
      ), 0) >= g.goal then 'reserved'
      when g.gift_type = 'open' then 'available'
      else g.status
    end as status,
    g.sort_order
  from public.gifts g
  where g.status <> 'hidden'
  order by g.sort_order, g.name;
$$;

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

  update public.payment_orders
  set status = 'cancelled'
  where gift_id = selected_gift.id
    and status = 'pending'
    and expires_at <= now();

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
grant execute on function public.get_public_gifts() to service_role;
revoke execute on function public.reserve_gift(text, text, integer) from public, anon, authenticated;
grant execute on function public.reserve_gift(text, text, integer) to service_role;
revoke execute on function public.create_mercadopago_order(text, text, text, text, integer) from public, anon, authenticated;
grant execute on function public.create_mercadopago_order(text, text, text, text, integer) to service_role;
