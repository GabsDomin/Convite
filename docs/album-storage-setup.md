# Configuração do armazenamento do álbum

## 1. Supabase

Abra o SQL Editor e execute `supabase-album-schema.sql`. O script pode ser
executado novamente e migra a estrutura anterior sem apagar mídias existentes.

## 2. Cloudflare R2

1. Crie um bucket Standard chamado `gab-naia-album`.
2. Crie um token de API do R2 com leitura e gravação apenas nesse bucket.
3. Em `Settings > CORS`, aplique o conteúdo de `cloudflare/r2-cors.json`.
4. Conecte o domínio público `media.gab-naia.online` ao bucket.
5. Ative Image Transformations para o domínio, para a galeria usar versões leves
   sem alterar os originais.

Para um teste temporário, o domínio `r2.dev` pode ser usado como
`R2_PUBLIC_BASE_URL`, mas o domínio personalizado é necessário para produção.

Cadastre na Vercel, em Production e Preview:

```env
R2_ACCOUNT_ID=...
R2_ACCESS_KEY_ID=...
R2_SECRET_ACCESS_KEY=...
R2_BUCKET_NAME=gab-naia-album
R2_PUBLIC_BASE_URL=https://media.gab-naia.online
R2_IMAGE_TRANSFORM_BASE_URL=https://media.gab-naia.online
ALBUM_UPLOAD_SIGNING_SECRET=...
ALBUM_UPLOAD_CODE=...
```

`ALBUM_UPLOAD_SIGNING_SECRET` deve ser uma chave aleatória com no mínimo 32
caracteres. No PowerShell, gere uma com:

```powershell
[Convert]::ToHexString([Security.Cryptography.RandomNumberGenerator]::GetBytes(32)).ToLower()
```

`ALBUM_UPLOAD_CODE` é um código curto compartilhado apenas com os convidados. Ele
protege a criação de uploads sem impedir que todos vejam a galeria.

## 3. Autorização do Google Drive

1. Crie um projeto no Google Cloud Console.
2. Ative a Google Drive API.
3. Configure a tela de consentimento para uso externo em modo de teste e inclua
   somente sua conta Google como usuário de teste.
4. Crie um OAuth Client ID do tipo Desktop.
5. No PowerShell, defina temporariamente o Client ID e o Client Secret e execute:

```powershell
$env:GOOGLE_DRIVE_CLIENT_ID="seu-client-id"
$env:GOOGLE_DRIVE_CLIENT_SECRET="seu-client-secret"
npm run setup:drive
```

O script solicitará autorização somente para arquivos criados pelo aplicativo,
criará a pasta privada `Casamento Gabriel e Halanaia - Originais` e mostrará o
Refresh Token e o Folder ID. Não publique esses valores no GitHub.

## 4. Fila e Worker de backup

Faça login no Wrangler e crie as duas filas:

```powershell
npx wrangler@latest login
npx wrangler@latest queues create gab-naia-drive-backup
npx wrangler@latest queues create gab-naia-drive-backup-dead
```

Cadastre os segredos. Cada comando solicitará o valor sem colocá-lo no arquivo do
projeto:

```powershell
npx wrangler@latest secret put SUPABASE_URL --config cloudflare/drive-backup-worker/wrangler.jsonc
npx wrangler@latest secret put SUPABASE_SECRET_KEY --config cloudflare/drive-backup-worker/wrangler.jsonc
npx wrangler@latest secret put GOOGLE_DRIVE_CLIENT_ID --config cloudflare/drive-backup-worker/wrangler.jsonc
npx wrangler@latest secret put GOOGLE_DRIVE_CLIENT_SECRET --config cloudflare/drive-backup-worker/wrangler.jsonc
npx wrangler@latest secret put GOOGLE_DRIVE_REFRESH_TOKEN --config cloudflare/drive-backup-worker/wrangler.jsonc
npx wrangler@latest secret put GOOGLE_DRIVE_FOLDER_ID --config cloudflare/drive-backup-worker/wrangler.jsonc
```

Publique o Worker:

```powershell
npx wrangler@latest deploy --config cloudflare/drive-backup-worker/wrangler.jsonc
```

Conecte os novos objetos do R2 à fila, filtrando apenas os originais:

```powershell
npx wrangler@latest r2 bucket notification create gab-naia-album --event-type object-create --queue gab-naia-drive-backup --prefix "gab-naia/album/originals/"
```

O Worker também executa uma reconciliação a cada 15 minutos. Assim, um arquivo que
tenha chegado ao R2 antes do registro no Supabase não fica sem backup.

## 5. Validação

1. Faça um novo deploy da Vercel depois de cadastrar as variáveis.
2. Envie uma foto pequena em `https://gab-naia.online/album`.
3. Confirme que ela apareceu na galeria.
4. No Supabase, consulte `album_media.backup_status`; ele deve mudar de `pending`
   para `complete`.
5. Confira o original na pasta privada criada no Drive.

Se o status ficar `error`, consulte `backup_error` e os logs do Worker. A fila tenta
novamente e a reconciliação recupera erros temporários.
