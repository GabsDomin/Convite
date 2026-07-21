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
R2_ACCOUNT_ID=...
R2_ACCESS_KEY_ID=...
R2_SECRET_ACCESS_KEY=...
R2_BUCKET_NAME=gab-naia-album
R2_PUBLIC_BASE_URL=https://media.gab-naia.online
R2_IMAGE_TRANSFORM_BASE_URL=https://media.gab-naia.online
ALBUM_UPLOAD_SIGNING_SECRET=...
ALBUM_UPLOAD_CODE=...
```

`BACKEND_URL` é opcional. Ele só é necessário se a API ficar em outro domínio; nesse projeto, deixe sem cadastrar porque o backend usa o mesmo `SITE_URL`.

Segredos como `SUPABASE_SECRET_KEY`, `MERCADO_PAGO_ACCESS_TOKEN`, `MERCADO_PAGO_WEBHOOK_SECRET`, `R2_SECRET_ACCESS_KEY` e `ALBUM_UPLOAD_SIGNING_SECRET` ficam somente no servidor. Nunca use prefixos públicos como `NEXT_PUBLIC_`, `VITE_` ou `PUBLIC_` nessas variáveis. A variável antiga `SUPABASE_SERVICE_ROLE_KEY` continua aceita apenas para compatibilidade.

## Banco de dados

No Supabase, abra o SQL Editor e execute os arquivos nesta ordem, inclusive se as tabelas já existirem:

```txt
supabase-schema.sql
supabase-functions.sql
supabase-payments.sql
supabase-restricted-guests.sql
supabase-rsvp-guests.sql
supabase-album-schema.sql
supabase-album-auth.sql
```

O arquivo `supabase-album-auth.sql` cria a senha padrão do álbum (`123456`, salva como hash) e a função que libera o login apenas para nomes confirmados no RSVP.

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

## Álbum coletivo

Os convidados enviam os arquivos diretamente para o Cloudflare R2. A API verifica
o arquivo antes de registrá-lo no Supabase, e um Worker copia o original para uma
pasta privada do Google Drive. A fila possui repetição automática e a tabela
`album_media` registra o estado de cada backup.

O passo a passo completo de criação do bucket, CORS, domínio de mídia, OAuth do
Google Drive, filas e Worker está em [`docs/album-storage-setup.md`](docs/album-storage-setup.md).

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
