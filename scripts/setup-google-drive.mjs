import { createServer } from "node:http";

const clientId = String(process.env.GOOGLE_DRIVE_CLIENT_ID || "").trim();
const clientSecret = String(process.env.GOOGLE_DRIVE_CLIENT_SECRET || "").trim();
const port = 53682;
const redirectUri = `http://127.0.0.1:${port}/oauth2/callback`;
const scope = "https://www.googleapis.com/auth/drive.file";

if (!clientId || !clientSecret) {
  console.error("Defina GOOGLE_DRIVE_CLIENT_ID e GOOGLE_DRIVE_CLIENT_SECRET antes de executar.");
  process.exit(1);
}

function waitForAuthorizationCode() {
  return new Promise((resolve, reject) => {
    const server = createServer((request, response) => {
      const url = new URL(request.url || "/", redirectUri);
      if (url.pathname !== "/oauth2/callback") {
        response.writeHead(404).end();
        return;
      }
      const error = url.searchParams.get("error");
      const code = url.searchParams.get("code");
      response.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
      response.end(error
        ? "<h1>Autorização cancelada</h1><p>Você pode fechar esta janela.</p>"
        : "<h1>Google Drive conectado</h1><p>Volte ao terminal para concluir.</p>");
      server.close();
      if (error || !code) reject(new Error(error || "O Google não retornou o código de autorização."));
      else resolve(code);
    });
    server.listen(port, "127.0.0.1");
    server.on("error", reject);
  });
}

const authorizationUrl = new URL("https://accounts.google.com/o/oauth2/v2/auth");
authorizationUrl.search = new URLSearchParams({
  client_id: clientId,
  redirect_uri: redirectUri,
  response_type: "code",
  scope,
  access_type: "offline",
  prompt: "consent",
}).toString();

console.log("\nAbra esta URL no navegador e autorize somente a conta do Drive de 1 TB:\n");
console.log(authorizationUrl.href);
console.log(`\nAguardando o retorno em ${redirectUri} ...\n`);

const code = await waitForAuthorizationCode();
const tokenResponse = await fetch("https://oauth2.googleapis.com/token", {
  method: "POST",
  headers: { "Content-Type": "application/x-www-form-urlencoded" },
  body: new URLSearchParams({
    client_id: clientId,
    client_secret: clientSecret,
    code,
    grant_type: "authorization_code",
    redirect_uri: redirectUri,
  }),
});
const tokens = await tokenResponse.json();
if (!tokenResponse.ok || !tokens.access_token || !tokens.refresh_token) {
  throw new Error(tokens.error_description || "Não foi possível gerar os tokens do Google Drive.");
}

const folderResponse = await fetch("https://www.googleapis.com/drive/v3/files?fields=id,name", {
  method: "POST",
  headers: {
    Authorization: `Bearer ${tokens.access_token}`,
    "Content-Type": "application/json",
  },
  body: JSON.stringify({
    name: "Casamento Gabriel e Halanaia - Originais",
    mimeType: "application/vnd.google-apps.folder",
    appProperties: { application: "gab-naia-album" },
  }),
});
const folder = await folderResponse.json();
if (!folderResponse.ok || !folder.id) {
  throw new Error(folder.error?.message || "Não foi possível criar a pasta no Google Drive.");
}

console.log("\nConfiguração criada. Guarde estes valores como segredos do Worker:\n");
console.log(`GOOGLE_DRIVE_REFRESH_TOKEN=${tokens.refresh_token}`);
console.log(`GOOGLE_DRIVE_FOLDER_ID=${folder.id}`);
console.log("\nA pasta foi criada no seu Drive com o nome:");
console.log(folder.name);
