# Convite Gabriel & Halanaia

Convite de casamento com confirmação de presença, lista de presentes no Supabase e pagamento online pelo Mercado Pago Checkout Pro.

## Publicação na Vercel

1. Importe o repositório `GabsDomin/Convite`.
2. Mantenha `Application Preset: Node` e `Root Directory: ./`.
3. Cadastre as variáveis abaixo em `Settings > Environment Variables`.
4. Faça o deploy. O arquivo `server.ts` é a entrada Node detectada pela Vercel.
5. Em `Settings > Domains`, adicione `gab-naia.online` e, se quiser, `www.gab-naia.online`.
6. No provedor do domínio, use exatamente os registros DNS mostrados pela Vercel.

## Variáveis de ambiente

Cadastre em `Production`:

```env
SUPABASE_URL=https://lyuqvwrikfajmcodwous.supabase.co
SUPABASE_SECRET_KEY=sb_secret_...
MERCADO_PAGO_ACCESS_TOKEN=...
MERCADO_PAGO_WEBHOOK_SECRET=...
SITE_URL=https://gab-naia.online
```

`BACKEND_URL` é opcional. Ele só é necessário se a API ficar em outro domínio; nesse projeto, deixe sem cadastrar porque o backend usa o mesmo `SITE_URL`.

Segredos como `SUPABASE_SECRET_KEY`, `MERCADO_PAGO_ACCESS_TOKEN` e `MERCADO_PAGO_WEBHOOK_SECRET` ficam somente no servidor. Nunca use prefixos públicos como `NEXT_PUBLIC_`, `VITE_` ou `PUBLIC_` nessas variáveis. A variável antiga `SUPABASE_SERVICE_ROLE_KEY` continua aceita apenas para compatibilidade.

## Banco de dados

No Supabase, abra o SQL Editor e execute os arquivos nesta ordem, inclusive se as tabelas já existirem:

```txt
supabase-schema.sql
supabase-functions.sql
supabase-payments.sql
supabase-restricted-guests.sql
supabase-rsvp-guests.sql
```

Os scripts são reaplicáveis e restringem tabelas e funções à `service_role`. O navegador não recebe uma chave do Supabase.

### Nomes sem acesso à confirmação

Depois de executar `supabase-restricted-guests.sql`, cadastre os nomes pela tabela
`restricted_guests` no Table Editor do Supabase. Preencha apenas `guest_name` e, se
quiser, `internal_note`; `active` deve permanecer marcado. A comparação ignora
maiúsculas, acentos e espaços extras. Para liberar uma pessoa sem apagar o cadastro,
desmarque `active`.

Quando um nome ativo dessa tabela tentar confirmar presença, nada será salvo e o
site mostrará: “Infelizmente, seu nome não está na lista de convidados.”

### Confirmação por casal ou com menores

O arquivo `supabase-rsvp-guests.sql` atualiza as confirmações para três opções:
individual, casal e responsável com menores. Cada adulto confirma separadamente,
mas uma pessoa pode informar o nome do companheiro ou companheira. Pais e
responsáveis podem cadastrar até seis menores de 18 anos, sempre informando o nome
de cada um. O banco impede nomes repetidos na mesma confirmação e mantém as
variações da lista restrita funcionando para todas as pessoas informadas.

## Mercado Pago

1. Crie uma aplicação com Checkout Pro no Mercado Pago Developers.
2. Use primeiro um Access Token `TEST-...`; em produção, troque por `APP_USR-...`.
3. Cadastre um webhook para o evento `payment` nesta URL:

```txt
https://gab-naia.online/api/webhooks/mercadopago
```

4. Copie a assinatura secreta do webhook para `MERCADO_PAGO_WEBHOOK_SECRET` na Vercel.
5. Depois de alterar qualquer variável, faça um novo deploy.

As páginas de retorno são `/pagamento/sucesso`, `/pagamento/erro` e `/pagamento/pendente`. Elas não aprovam pagamentos; somente o webhook validado confirma o status consultado diretamente no Mercado Pago.

## Desenvolvimento e validação

```bash
npm start
npm run check
```

`npm run check` valida a sintaxe e testa arquivos públicos, proteção contra exposição de código e segredos, limites da API e a data exibida.
