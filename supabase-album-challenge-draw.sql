-- Sorteio de desafios: cada convidado recebe 3 desafios, um fácil, um médio e um difícil,
-- tirados de um banco de 250. A dificuldade define os pontos (fácil 1, médio 2, difícil 3).
-- - scope 'draw': entra no sorteio; scope 'all': aparece para todos, além dos 3.
-- - wedding: registra o casamento ou os noivos (do lugar da pessoa); todo convidado recebe
--   pelo menos 1 desses, para o álbum ter os momentos do casamento por vários ângulos.
-- - couple: exige ir até os noivos; cada convidado recebe no máximo 1 desses,
--   e cada um vai para no máximo max_assignees pessoas, para ninguém ficar em cima dos noivos.
-- - cada convidado pode trocar 1 desafio que ainda não completou, por outro da mesma dificuldade.
-- O sorteio roda no banco com trava (advisory lock) para não duplicar com acessos simultâneos.
-- guest_key é o nome normalizado pelo servidor (minúsculas, sem acentos, espaços simples).
-- Script reaplicável.

alter table public.album_challenges add column if not exists scope text not null default 'draw';
alter table public.album_challenges add column if not exists difficulty text not null default 'easy';
alter table public.album_challenges add column if not exists couple boolean not null default false;
alter table public.album_challenges add column if not exists wedding boolean not null default false;
alter table public.album_challenges add column if not exists max_assignees integer;

alter table public.album_challenges drop constraint if exists album_challenges_scope_check;
alter table public.album_challenges
  add constraint album_challenges_scope_check check (scope in ('draw', 'all'));

alter table public.album_challenges drop constraint if exists album_challenges_difficulty_check;
alter table public.album_challenges
  add constraint album_challenges_difficulty_check check (difficulty in ('easy', 'medium', 'hard'));

alter table public.album_challenges drop constraint if exists album_challenges_max_assignees_check;
alter table public.album_challenges
  add constraint album_challenges_max_assignees_check check (max_assignees is null or max_assignees between 1 and 500);

create table if not exists public.album_challenge_assignments (
  id uuid primary key default gen_random_uuid(),
  guest_key text not null,
  guest_name text not null,
  challenge_id uuid not null references public.album_challenges (id) on delete cascade,
  active boolean not null default true,
  swapped boolean not null default false,
  created_at timestamptz not null default now(),
  unique (guest_key, challenge_id)
);

create index if not exists album_challenge_assignments_guest_idx
  on public.album_challenge_assignments (guest_key) where active;
create index if not exists album_challenge_assignments_challenge_idx
  on public.album_challenge_assignments (challenge_id) where active;

alter table public.album_challenge_assignments enable row level security;
revoke all on table public.album_challenge_assignments from anon, authenticated;
grant all on table public.album_challenge_assignments to service_role;

-- Garante 1 desafio ativo de cada dificuldade para o convidado,
-- escolhendo sempre o menos sorteado (empate aleatório).
-- As dificuldades que faltam são preenchidas em ordem aleatória; enquanto a pessoa não tiver
-- desafio de registrar o casamento, a primeira que tiver um desses disponível recebe um.
create or replace function public.assign_album_challenges(p_guest_key text, p_guest_name text)
returns setof public.album_challenge_assignments
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  level text;
  missing_levels text[];
  has_couple boolean;
  has_wedding boolean;
  only_wedding boolean;
  picked uuid;
begin
  if coalesce(trim(p_guest_key), '') = '' then
    raise exception 'Convidado obrigatório';
  end if;

  perform pg_advisory_xact_lock(hashtext('album_challenge_draw'));

  select coalesce(array_agg(wanted.level order by random()), array[]::text[])
  into missing_levels
  from unnest(array['easy', 'medium', 'hard']) as wanted (level)
  where not exists (
    select 1
    from public.album_challenge_assignments a
    join public.album_challenges c on c.id = a.challenge_id
    where a.guest_key = p_guest_key and a.active and c.active and c.scope = 'draw' and c.difficulty = wanted.level
  );

  foreach level in array missing_levels loop
    select
      coalesce(bool_or(c.couple), false),
      coalesce(bool_or(c.wedding), false)
    into has_couple, has_wedding
    from public.album_challenge_assignments a
    join public.album_challenges c on c.id = a.challenge_id
    where a.guest_key = p_guest_key and a.active;

    picked := null;
    -- Primeira tentativa respeita a garantia do casamento; se não houver candidato, sorteia qualquer um.
    foreach only_wedding in array array[not has_wedding, false] loop
      select c.id
      into picked
      from public.album_challenges c
      left join (
        select challenge_id, count(*) as total
        from public.album_challenge_assignments
        where active
        group by challenge_id
      ) used on used.challenge_id = c.id
      where c.active
        and c.scope = 'draw'
        and c.difficulty = level
        and (not only_wedding or c.wedding)
        and not exists (
          select 1 from public.album_challenge_assignments mine
          where mine.guest_key = p_guest_key and mine.challenge_id = c.id
        )
        and (
          not c.couple
          or (not has_couple and (c.max_assignees is null or coalesce(used.total, 0) < c.max_assignees))
        )
      order by coalesce(used.total, 0), random()
      limit 1;
      exit when picked is not null;
    end loop;

    if picked is not null then
      insert into public.album_challenge_assignments (guest_key, guest_name, challenge_id)
      values (p_guest_key, p_guest_name, picked);
    end if;
  end loop;

  return query
  select * from public.album_challenge_assignments
  where guest_key = p_guest_key and active
  order by created_at;
end;
$function$;

-- Troca um desafio sorteado (p_max_swaps por convidado) e sorteia outro da mesma dificuldade.
create or replace function public.swap_album_challenge(p_guest_key text, p_guest_name text, p_challenge_id uuid, p_max_swaps integer default 1)
returns setof public.album_challenge_assignments
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  used_swaps integer;
begin
  perform pg_advisory_xact_lock(hashtext('album_challenge_draw'));

  select count(*) into used_swaps
  from public.album_challenge_assignments
  where guest_key = p_guest_key and swapped;

  if used_swaps >= p_max_swaps then
    raise exception 'Você já usou sua troca de desafio.';
  end if;

  update public.album_challenge_assignments a
  set active = false, swapped = true
  from public.album_challenges c
  where c.id = a.challenge_id
    and a.guest_key = p_guest_key
    and a.challenge_id = p_challenge_id
    and a.active
    and c.scope = 'draw';

  if not found then
    raise exception 'Este desafio não está entre os seus.';
  end if;

  return query select * from public.assign_album_challenges(p_guest_key, p_guest_name);
end;
$function$;

revoke execute on function public.assign_album_challenges(text, text) from public, anon, authenticated;
revoke execute on function public.swap_album_challenge(text, text, uuid, integer) from public, anon, authenticated;
grant execute on function public.assign_album_challenges(text, text) to service_role;
grant execute on function public.swap_album_challenge(text, text, uuid, integer) to service_role;

-- Os 4 desafios iniciais viram desafios com os noivos, com limite de pessoas.
update public.album_challenges set title = 'Foto com o noivo', description = 'Rapidinho, sem atrapalhar o momento.',
  difficulty = 'medium', points = 2, couple = true, max_assignees = 4, sort_order = 20000
where title = 'Foto com o noivo';
update public.album_challenges set title = 'Foto com a noiva', description = 'Rapidinho, sem atrapalhar o momento.',
  difficulty = 'medium', points = 2, couple = true, max_assignees = 4, sort_order = 20010
where title = 'Foto com a noiva';
update public.album_challenges set title = 'Foto com os noivos', description = 'Os dois juntos, rapidinho, sem atrapalhar o momento.',
  difficulty = 'hard', points = 3, couple = true, max_assignees = 4, sort_order = 30000
where title in ('Foto com o casal', 'Foto com os noivos');
update public.album_challenges set title = 'Foto da aliança', description = 'Peça com jeitinho para ver de perto.',
  difficulty = 'medium', points = 2, couple = true, max_assignees = 4, sort_order = 20020
where title in ('Foto com a aliança', 'Foto da aliança');

insert into public.album_challenges (title, description, difficulty, points, sort_order, couple, max_assignees)
select
  seed.title,
  nullif(seed.description, ''),
  seed.difficulty,
  case seed.difficulty when 'easy' then 1 when 'medium' then 2 else 3 end,
  case seed.difficulty when 'easy' then 10000 when 'medium' then 20100 else 30100 end + seed.position * 10,
  seed.couple,
  case when seed.couple then 4 end
from (
  select data.*, row_number() over (partition by data.difficulty) as position
  from (values
    -- FÁCIL: é só olhar em volta e fotografar.
    ('O local da cerimônia antes de começar', 'Sem flash.', 'easy', false),
    ('O arranjo de flores mais bonito', 'Sem flash e sem sair do lugar.', 'easy', false),
    ('O céu durante a cerimônia', '', 'easy', false),
    ('O corredor da cerimônia decorado', 'Sem flash.', 'easy', false),
    ('A plateia aplaudindo no fim da cerimônia', '', 'easy', false),
    ('Seu detalhe favorito da decoração', '', 'easy', false),
    ('A flor azul mais bonita que encontrar', '', 'easy', false),
    ('A iluminação da festa à noite', '', 'easy', false),
    ('O nome ou número da sua mesa', '', 'easy', false),
    ('O bolo', '', 'easy', false),
    ('A mesa de doces, antes de alguém atacar', '', 'easy', false),
    ('A forminha vazia do doce que você comeu', '', 'easy', false),
    ('A lembrancinha dos noivos', '', 'easy', false),
    ('O carro dos noivos', '', 'easy', false),
    ('Seu prato favorito do jantar', '', 'easy', false),
    ('Uma foto tirada através de uma taça', '', 'easy', false),
    ('Todos os celulares da mesa empilhados', '', 'easy', false),
    ('O detalhe favorito do seu look', '', 'easy', false),
    ('Panorâmica do salão inteiro', '', 'easy', false),
    ('O fotógrafo oficial trabalhando', '', 'easy', false),
    ('Alguém fotografando outra pessoa', '', 'easy', false),
    ('Uma vela ou luz da decoração', '', 'easy', false),
    ('O centro da sua mesa', '', 'easy', false),
    ('A sobremesa', '', 'easy', false),
    ('Sua taça ou copo da noite', '', 'easy', false),
    ('As cadeiras da cerimônia', '', 'easy', false),
    ('A entrada do salão', '', 'easy', false),
    ('A vista mais bonita do local', '', 'easy', false),
    ('Uma planta ou árvore do local', '', 'easy', false),
    ('Um detalhe dourado ou prateado da decoração', '', 'easy', false),
    ('Uma comida servida no jantar', '', 'easy', false),
    ('Seus sapatos da festa', '', 'easy', false),
    ('Seu reflexo numa taça ou talher', '', 'easy', false),
    ('O céu à noite', '', 'easy', false),
    ('Sua chegada na festa', '', 'easy', false),
    ('A valsa dos noivos, vista do seu lugar', 'Sem flash e sem levantar.', 'easy', false),
    ('Os noivos de longe, sem eles perceberem', '', 'easy', false),
    ('Uma criança arrumada para a festa', 'Com permissão dos pais.', 'easy', false),
    ('Alguém sorrindo na sua mesa', '', 'easy', false),
    ('Os copos da sua mesa num brinde', '', 'easy', false),
    ('Selfie com a decoração ao fundo', '', 'easy', false),
    ('Selfie com quem veio com você', '', 'easy', false),
    ('Algo azul que não seja flor', '', 'easy', false),
    ('Um sorriso de alguém da sua família', '', 'easy', false),
    ('A mesa mais bonita, na sua opinião', '', 'easy', false),
    ('Uma bandeja de salgados ou bebidas', '', 'easy', false),
    ('Um momento de conversa animada', '', 'easy', false),
    ('Uma foto em preto e branco de qualquer coisa', '', 'easy', false),
    ('Uma flor bem de pertinho', '', 'easy', false),
    ('Algo que comece com a letra G', 'De Gabriel.', 'easy', false),
    ('Algo que comece com a letra H', 'De Halanaia.', 'easy', false),
    ('Algo em formato de coração', '', 'easy', false),
    ('Uma mão segurando uma taça', '', 'easy', false),
    ('O convite aberto no seu celular', '', 'easy', false),
    ('A saída da cerimônia', '', 'easy', false),
    ('Um casal conversando, de longe', '', 'easy', false),
    ('A cara de quem acabou de provar a sobremesa', '', 'easy', false),
    ('O momento em que a comida chegou na mesa', '', 'easy', false),
    ('Algo que te lembre o casal', '', 'easy', false),
    ('A decoração da mesa de outra pessoa', '', 'easy', false),

    -- MÉDIO: envolve outras pessoas ou uma pose combinada.
    ('Selfie com a sua mesa inteira', '', 'medium', false),
    ('Selfie com alguém que você conheceu hoje', '', 'medium', false),
    ('Brinde com alguém que você acabou de conhecer', '', 'medium', false),
    ('Com alguém que tem a mesma inicial que você', '', 'medium', false),
    ('Com alguém vestindo a mesma cor que você', '', 'medium', false),
    ('Com a pessoa mais alta que encontrar', '', 'medium', false),
    ('Com alguém que faz aniversário no mesmo mês que você', '', 'medium', false),
    ('Duas taças se tocando no momento do brinde', '', 'medium', false),
    ('O momento mais engraçado da sua mesa', '', 'medium', false),
    ('Guardanapos dobrados em formas criativas', '', 'medium', false),
    ('Alguém pego no flagra comendo doce antes da hora', '', 'medium', false),
    ('Pose de capa de revista', '', 'medium', false),
    ('Coração com as mãos, feito com outra pessoa', '', 'medium', false),
    ('Você refletido num espelho ou janela', '', 'medium', false),
    ('Em preto e branco, com cara de 1950', 'Capriche na pose.', 'medium', false),
    ('Pose de "noivos" com seu acompanhante ou um amigo', '', 'medium', false),
    ('Só as mãos dadas de um casal', '', 'medium', false),
    ('Seu look completo, como no tapete vermelho', '', 'medium', false),
    ('Com um acessório improvisado', 'Guardanapo virando gravata, por exemplo.', 'medium', false),
    ('Uma mesa inteira com os braços para cima, comemorando', '', 'medium', false),
    ('Um avô ou uma avó sorrindo', '', 'medium', false),
    ('Uma criança brincando ou aprontando', 'Com permissão dos pais.', 'medium', false),
    ('Alguém contando uma história e a mesa rindo', '', 'medium', false),
    ('A pessoa mais animada da festa', '', 'medium', false),
    ('Uma mensagem para os noivos escrita num guardanapo', '', 'medium', false),
    ('Um coração montado com coisas da mesa', '', 'medium', false),
    ('Uma foto com 5 coisas azuis aparecendo', 'Tudo na mesma foto.', 'medium', false),
    ('Algo que comece com G e algo com H na mesma foto', 'De Gabriel e Halanaia.', 'medium', false),
    ('Alguém se emocionando', 'Mostre a foto para a pessoa depois.', 'medium', false),
    ('Um abraço de reencontro', '', 'medium', false),
    ('Com alguém de óculos, os dois fazendo pose', '', 'medium', false),
    ('Sua mesa inteira fazendo careta', '', 'medium', false),
    ('Sua mesa inteira fazendo "joinha"', '', 'medium', false),
    ('Você imitando a pose de alguém de outra mesa', 'Os dois na foto.', 'medium', false),
    ('Com alguém que nasceu na mesma cidade que você', '', 'medium', false),
    ('Com alguém que tem a mesma profissão que você', '', 'medium', false),
    ('Com alguém que torce para o mesmo time que você', '', 'medium', false),
    ('Com alguém que torce para o time rival', 'Pose de rivalidade.', 'medium', false),
    ('Com um casal de convidados recém-casados ou noivos', '', 'medium', false),
    ('Com alguém vestindo vermelho', '', 'medium', false),
    ('Com a pessoa do penteado mais bonito', '', 'medium', false),
    ('Com a pessoa mais elegante, eleita pela sua mesa', '', 'medium', false),
    ('Sua mesa fazendo pose de banda de rock', '', 'medium', false),
    ('Você e alguém fazendo a mesma careta', '', 'medium', false),
    ('Pose de melhores amigos com alguém que conheceu hoje', '', 'medium', false),
    ('Alguém fotografado de baixo para cima, como super-herói', '', 'medium', false),
    ('Uma selfie com 5 pessoas sorrindo', '', 'medium', false),
    ('Alguém segurando uma flor', '', 'medium', false),
    ('Brinde com alguém mais velho que você', '', 'medium', false),
    ('Brinde com alguém mais novo que você', '', 'medium', false),
    ('Um "toca aqui" congelado no ar', '', 'medium', false),
    ('Alguém dando uma gargalhada de verdade', '', 'medium', false),
    ('Alguém dando uma piscadinha', '', 'medium', false),
    ('Uma foto de perspectiva: você "segurando" uma luz ou a lua', '', 'medium', false),
    ('Foto do buquê', 'Rapidinho, sem atrapalhar o momento.', 'medium', true),
    ('Brinde entre duas gerações', 'Avô ou avó com neto ou neta.', 'medium', false),
    ('Selfie com alguém de outra mesa', '', 'medium', false),

    -- DIFÍCIL: precisa procurar alguém, juntar gente ou caprichar na criatividade.
    ('Com quem veio de mais longe', 'Pergunte por aí!', 'hard', false),
    ('Com alguém que conhece os noivos há mais de 10 anos', '', 'hard', false),
    ('Com alguém que conheceu os noivos há menos de 1 ano', '', 'hard', false),
    ('Com alguém do "outro lado"', 'Da família ou dos amigos do outro noivo.', 'hard', false),
    ('Com alguém que trabalha com o Gabriel ou com a Halanaia', '', 'hard', false),
    ('Duas pessoas que não se conheciam se cumprimentando', '', 'hard', false),
    ('Com o casal que está junto há mais tempo na festa', '', 'hard', false),
    ('Três gerações juntas', 'Avó ou avô, pais e netos.', 'hard', false),
    ('Foto de grupo com 10 pessoas ou mais', '', 'hard', false),
    ('Foto de pulo, com todo mundo no ar', 'Pelo menos 3 pessoas.', 'hard', false),
    ('Imitando um quadro ou foto famosa', '', 'hard', false),
    ('As letras G e H formadas com o corpo', 'Precisa de 2 pessoas.', 'hard', false),
    ('Uma foto tirada de cima', 'De uma escada ou sacada, com segurança.', 'hard', false),
    ('Pessoas de 3 mesas diferentes na mesma foto', '', 'hard', false),
    ('A mesa apontando para quem conhece os noivos há mais tempo', '', 'hard', false),
    ('Alguém casado há muitos anos segurando um conselho escrito', 'Um conselho de casamento para os noivos.', 'hard', false),
    ('Uma previsão escrita sobre os noivos', '"Daqui a 10 anos, o Gabriel e a Halanaia vão…"', 'hard', false),
    ('Um desenho dos noivos feito por uma criança', '', 'hard', false),
    ('Um grupo formando um coração com os braços', '', 'hard', false),
    ('Alguém da família do noivo e alguém da família da noiva juntos', '', 'hard', false),
    ('Com alguém que tem exatamente a sua idade', '', 'hard', false),
    ('Com alguém que faz aniversário no mesmo dia do mês que você', '', 'hard', false),
    ('Com a pessoa mais velha da festa', 'Com todo o carinho.', 'hard', false),
    ('Com o bebê ou a criança mais nova da festa', 'Com os pais na foto.', 'hard', false),
    ('Com alguém que já foi a mais de 10 casamentos', 'Pergunte!', 'hard', false),
    ('Com alguém que sabe como os noivos se conheceram', '', 'hard', false),
    ('Com alguém que fala outra língua', '', 'hard', false),
    ('Com alguém que tem o mesmo nome que você', '', 'hard', false),
    ('Uma mesa inteira de pé, todos na mesma pose', '', 'hard', false),
    ('5 pessoas ou mais em fila, da mais baixa à mais alta', '', 'hard', false),
    ('8 mãos ou mais empilhadas, como time antes do jogo', '', 'hard', false),
    ('Com pessoas de 5 mesas diferentes', '', 'hard', false),
    ('A história de como os noivos se conheceram, escrita num guardanapo', '', 'hard', false),
    ('Com alguém que já deu carona para um dos noivos', '', 'hard', false),
    ('Com o convidado que chegou primeiro à festa', 'Descubra quem foi!', 'hard', false),
    ('Com o convidado que mora mais perto dos noivos', '', 'hard', false),
    ('Com um amigo de infância de um dos noivos', '', 'hard', false),
    ('Com alguém mostrando no celular uma foto antiga com os noivos', '', 'hard', false),
    ('Uma mesa inteira imitando uma pose de casal', '', 'hard', false),
    ('Com alguém que tem um apelido engraçado, escrito num papel', '', 'hard', false),
    ('Uma corrente de 8 pessoas ou mais de mãos dadas', '', 'hard', false),
    ('4 pessoas posando como capa de disco de banda', '', 'hard', false),
    ('3 pessoas vestindo a mesma cor', '', 'hard', false),
    ('Uma criança e um avô ou uma avó fazendo a mesma careta', '', 'hard', false),
    ('Com alguém que foi ao casamento dos pais de um dos noivos', '', 'hard', false),
    ('Com alguém que veio de avião para a festa', '', 'hard', false),
    ('Pessoas de 4 décadas diferentes juntas', '20 e poucos, 30, 40, 50 anos ou mais.', 'hard', false),
    ('Uma cena que conte uma história sem palavras', '', 'hard', false),
    ('Um casal de convidados posando como capa de revista de casamento', '', 'hard', false),
    ('Recriando uma foto conhecida dos noivos', 'Do convite ou das redes sociais.', 'hard', false),
    ('Você pequenininho e a decoração enorme', 'Brinque com a perspectiva.', 'hard', false),
    ('Uma foto artística da festa, digna de quadro', '', 'hard', false),

    -- REGISTRAR O CASAMENTO: fotografar os noivos e os momentos do seu lugar, sem ir até eles.
    ('A entrada do noivo', 'Do seu lugar, sem flash.', 'easy', false),
    ('A entrada da noiva', 'Do seu lugar, sem flash.', 'easy', false),
    ('Os noivos no altar', 'Do seu lugar, sem flash.', 'easy', false),
    ('Os noivos sentados à mesa deles', '', 'easy', false),
    ('O vestido da noiva', 'De onde você estiver.', 'easy', false),
    ('O traje do noivo', 'De onde você estiver.', 'easy', false),
    ('Os noivos sorrindo', '', 'easy', false),
    ('Os noivos conversando com convidados', '', 'easy', false),
    ('A mesa dos noivos', '', 'easy', false),
    ('Os noivos saindo da cerimônia', '', 'easy', false),
    ('A troca de alianças', 'Do seu lugar, sem flash.', 'medium', false),
    ('O primeiro beijo de casados', 'Do seu lugar, sem flash.', 'medium', false),
    ('Os noivos se olhando', '', 'medium', false),
    ('Os noivos rindo juntos', '', 'medium', false),
    ('Os noivos recebendo os cumprimentos', '', 'medium', false),
    ('Os noivos brindando', '', 'medium', false),
    ('A noiva emocionada', '', 'medium', false),
    ('O noivo emocionado', '', 'medium', false),
    ('Os noivos na valsa, com os convidados em volta', '', 'medium', false),
    ('Os noivos com o bolo', '', 'medium', false),
    ('Uma foto dos noivos que poderia virar quadro', '', 'hard', false),
    ('Os noivos e a decoração inteira na mesma foto', '', 'hard', false),
    ('Os noivos contra a luz, em silhueta', '', 'hard', false),
    ('Os noivos emoldurados por algo', 'Folhas, uma taça, uma janela…', 'hard', false),
    ('A reação dos convidados ao primeiro beijo', 'Os convidados, não os noivos!', 'hard', false),
    ('Os noivos com o maior número de convidados ao fundo', '', 'hard', false),
    ('O olhar do noivo vendo a noiva entrar', 'Do seu lugar, sem flash.', 'hard', false),

    -- MAIS 50 (fácil 17, médio 17, difícil 16).
    ('O bolo visto de pertinho', '', 'easy', false),
    ('Os doces enfileirados, bem de pertinho', '', 'easy', false),
    ('As luzes da festa desfocadas ao fundo', '', 'easy', false),
    ('A primeira bebida que você pegar', '', 'easy', false),
    ('Um cantinho tranquilo do local', '', 'easy', false),
    ('O portão ou a porta de entrada do local', '', 'easy', false),
    ('As bebidas sendo servidas', '', 'easy', false),
    ('Alguém tirando uma selfie', '', 'easy', false),
    ('Duas pessoas brindando', '', 'easy', false),
    ('Um grupo de amigos rindo', '', 'easy', false),
    ('Os salgados chegando à mesa', '', 'easy', false),
    ('Uma criança comendo um doce', 'Com permissão dos pais.', 'easy', false),
    ('Pétalas ou folhas da decoração, de pertinho', '', 'easy', false),
    ('O céu no fim da tarde', '', 'easy', false),
    ('O buquê nas mãos da noiva, de longe', '', 'easy', false),
    ('Os noivos chegando à recepção', '', 'easy', false),
    ('Os noivos caminhando juntos', '', 'easy', false),
    ('Selfie com a pessoa mais engraçada da sua mesa', '', 'medium', false),
    ('Com alguém que você não via há mais de 1 ano', '', 'medium', false),
    ('Com alguém que tem a mesma cor de olhos que você', '', 'medium', false),
    ('Com alguém que nasceu no mesmo ano que você', '', 'medium', false),
    ('Brinde com alguém da família do noivo', '', 'medium', false),
    ('Brinde com alguém da família da noiva', '', 'medium', false),
    ('Sua mesa inteira fazendo um coração com as mãos', '', 'medium', false),
    ('Alguém mostrando o melhor sorriso para a câmera', '', 'medium', false),
    ('Alguém rindo sem perceber a câmera', '', 'medium', false),
    ('Uma criança fazendo pose de adulto', 'Com permissão dos pais.', 'medium', false),
    ('Dois amigos de longa data juntos', '', 'medium', false),
    ('Alguém segurando a lembrancinha dos noivos', '', 'medium', false),
    ('Você e alguém de costas, olhando para o salão', '', 'medium', false),
    ('Com alguém que mora em outro estado', '', 'medium', false),
    ('As alianças nas mãos dos noivos, de onde você estiver', 'Sem ir até eles: use o zoom!', 'medium', false),
    ('A noiva rindo', '', 'medium', false),
    ('O noivo rindo', '', 'medium', false),
    ('Com alguém que tem o mesmo sobrenome que você, sem ser da sua família', '', 'hard', false),
    ('Com alguém que conhece a família da noiva há mais de 20 anos', '', 'hard', false),
    ('Com alguém que estava no dia em que os noivos se conheceram', '', 'hard', false),
    ('6 pessoas de mesas diferentes fazendo a mesma pose', '', 'hard', false),
    ('Um grupo formando a palavra "SIM" com o corpo', '', 'hard', false),
    ('Três gerações brindando juntas', '', 'hard', false),
    ('Uma mesa inteira com acessórios improvisados', '', 'hard', false),
    ('Um reflexo da festa numa superfície, bem criativo', 'Mesa, taça, vidro…', 'hard', false),
    ('Uma foto que pareça propaganda de perfume', '', 'hard', false),
    ('Um casal de convidados como capa de livro de romance', '', 'hard', false),
    ('Com o convidado que tem o celular mais antigo', '', 'hard', false),
    ('Uma história engraçada com os noivos, escrita num guardanapo', 'Com quem contou a história na foto.', 'hard', false),
    ('Uma foto com 10 sorrisos ou mais', '', 'hard', false),
    ('Com alguém que veio sozinho e já fez amizade na festa', '', 'hard', false),
    ('Os noivos e os pais deles na mesma foto', 'De onde você estiver.', 'hard', false),
    ('O beijo dos noivos de um ângulo diferente de todo mundo', '', 'hard', false)
  ) as data (title, description, difficulty, couple)
) as seed
where not exists (
  select 1 from public.album_challenges existing where existing.title = seed.title
);

-- Desafios que já existiam antes desta migração ganham os pontos da sua dificuldade.
update public.album_challenges
set points = case difficulty when 'easy' then 1 when 'medium' then 2 else 3 end
where scope = 'draw';

-- Registrar o casamento: os que exigem ir até os noivos e os que são fotografados do lugar.
update public.album_challenges
set wedding = true
where couple
  or title in (
    'A valsa dos noivos, vista do seu lugar',
    'Os noivos de longe, sem eles perceberem',
    'A entrada do noivo',
    'A entrada da noiva',
    'Os noivos no altar',
    'Os noivos sentados à mesa deles',
    'O vestido da noiva',
    'O traje do noivo',
    'Os noivos sorrindo',
    'Os noivos conversando com convidados',
    'A mesa dos noivos',
    'Os noivos saindo da cerimônia',
    'A troca de alianças',
    'O primeiro beijo de casados',
    'Os noivos se olhando',
    'Os noivos rindo juntos',
    'Os noivos recebendo os cumprimentos',
    'Os noivos brindando',
    'A noiva emocionada',
    'O noivo emocionado',
    'Os noivos na valsa, com os convidados em volta',
    'Os noivos com o bolo',
    'Uma foto dos noivos que poderia virar quadro',
    'Os noivos e a decoração inteira na mesma foto',
    'Os noivos contra a luz, em silhueta',
    'Os noivos emoldurados por algo',
    'A reação dos convidados ao primeiro beijo',
    'Os noivos com o maior número de convidados ao fundo',
    'O olhar do noivo vendo a noiva entrar',
    'O buquê nas mãos da noiva, de longe',
    'Os noivos chegando à recepção',
    'Os noivos caminhando juntos',
    'As alianças nas mãos dos noivos, de onde você estiver',
    'A noiva rindo',
    'O noivo rindo',
    'Os noivos e os pais deles na mesma foto',
    'O beijo dos noivos de um ângulo diferente de todo mundo'
  );
