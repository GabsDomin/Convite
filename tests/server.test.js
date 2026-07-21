import assert from "node:assert/strict";
import { createHmac } from "node:crypto";
import { spawn } from "node:child_process";
import { readFile } from "node:fs/promises";
import net from "node:net";
import { after, before, test } from "node:test";

let serverProcess;
let baseUrl;

const albumSigningSecret = "album-test-signing-secret-with-32-characters";

function albumSessionCookie(guestName = "Pessoa Teste") {
  const payload = Buffer.from(JSON.stringify({
    guestName,
    expiresAt: Date.now() + 60 * 60 * 1000,
  }), "utf8").toString("base64url");
  const signature = createHmac("sha256", albumSigningSecret).update(payload).digest("base64url");
  return `gab_naia_album_session=${payload}.${signature}`;
}

async function findAvailablePort() {
  return new Promise((resolve, reject) => {
    const probe = net.createServer();
    probe.once("error", reject);
    probe.listen(0, "127.0.0.1", () => {
      const address = probe.address();
      probe.close(() => resolve(address.port));
    });
  });
}

async function waitForServer(process, timeoutMs = 5_000) {
  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => reject(new Error("Servidor não iniciou a tempo.")), timeoutMs);

    const onData = (chunk) => {
      if (!String(chunk).includes("Convite rodando")) return;
      clearTimeout(timeout);
      process.stdout.off("data", onData);
      resolve();
    };

    process.stdout.on("data", onData);
    process.once("exit", (code) => {
      clearTimeout(timeout);
      reject(new Error(`Servidor encerrou antes do teste (código ${code}).`));
    });
  });
}

before(async () => {
  const port = await findAvailablePort();
  baseUrl = `http://127.0.0.1:${port}`;
  serverProcess = spawn(process.execPath, ["server.js"], {
    cwd: process.cwd(),
    env: {
      ...process.env,
      PORT: String(port),
      SUPABASE_URL: "https://example.supabase.co",
      SUPABASE_SECRET_KEY: "sb_secret_test_secret",
      MERCADO_PAGO_ACCESS_TOKEN: "TEST-token-sem-webhook",
      MERCADO_PAGO_WEBHOOK_SECRET: "",
      R2_ACCOUNT_ID: "account-test",
      R2_ACCESS_KEY_ID: "r2-access-key-test",
      R2_SECRET_ACCESS_KEY: "r2-secret-key-test",
      R2_BUCKET_NAME: "gab-naia-album",
      R2_PUBLIC_BASE_URL: "https://media.example.com",
      ALBUM_UPLOAD_SIGNING_SECRET: albumSigningSecret,
      ALBUM_UPLOAD_CODE: "2811",
      SITE_URL: "http://127.0.0.1",
    },
    stdio: ["ignore", "pipe", "pipe"],
  });

  await waitForServer(serverProcess);
});

after(async () => {
  if (!serverProcess || serverProcess.exitCode != null) return;
  serverProcess.kill();
  await new Promise((resolve) => serverProcess.once("exit", resolve));
});

test("serve somente os arquivos públicos esperados", async () => {
  for (const pathname of [
    "/",
    "/styles.css",
    "/script.js",
    "/album/login",
    "/album-login.js",
    "/album.css",
    "/album.js",
    "/assets/favicon.png",
    "/assets/album-hero-rings.jpg",
    "/assets/album-hero-bouquet.jpg",
    "/assets/album-hero-table.jpg",
    "/pagamento/sucesso",
  ]) {
    const response = await fetch(`${baseUrl}${pathname}`);
    assert.equal(response.status, 200, pathname);
    assert.equal(response.headers.get("x-content-type-options"), "nosniff");
  }

  const albumRedirect = await fetch(`${baseUrl}/album`, { redirect: "manual" });
  assert.equal(albumRedirect.status, 302);
  assert.equal(albumRedirect.headers.get("location"), "/album/login");
});

test("não expõe código, configuração, Git ou SQL", async () => {
  for (const pathname of ["/.git/config", "/.env.example", "/server.js", "/server.ts", "/supabase-schema.sql"]) {
    const response = await fetch(`${baseUrl}${pathname}`);
    assert.equal(response.status, 404, pathname);
  }
});

test("configuração pública não contém segredos", async () => {
  const response = await fetch(`${baseUrl}/api/config`);
  const payload = await response.json();

  assert.equal(response.status, 200);
  assert.deepEqual(payload, {
    supabaseConfigured: true,
    mercadoPagoConfigured: false,
    mercadoPagoMode: "",
    albumConfigured: true,
  });
  assert.equal(JSON.stringify(payload).includes("sb_secret_test_secret"), false);
  assert.equal(JSON.stringify(payload).includes("r2-secret-key-test"), false);
});

test("URL do R2 é temporária, vinculada a um arquivo e não expõe segredo", async () => {
  const response = await fetch(`${baseUrl}/api/album/upload-signature`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Cookie: albumSessionCookie(),
    },
    body: JSON.stringify({
      guestName: "Pessoa Teste",
      category: "Festa",
      fileName: "foto.jpg",
      fileType: "image/jpeg",
      fileSize: 8_000_000,
      accessCode: "2811",
    }),
  });
  const payload = await response.json();

  assert.equal(response.status, 200);
  assert.match(payload.storageKey, /^gab-naia\/album\/originals\/[a-f0-9-]+\.jpg$/);
  assert.match(payload.uploadUrl, /^https:\/\/account-test\.r2\.cloudflarestorage\.com\/gab-naia-album\//);
  assert.match(payload.uploadUrl, /X-Amz-Signature=/);
  assert.doesNotMatch(payload.uploadUrl, /x-amz-checksum/i);
  assert.match(payload.uploadToken, /^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/);
  assert.deepEqual(payload.headers, {
    "Content-Type": "image/jpeg",
    "Cache-Control": "public, max-age=31536000, immutable",
  });
  assert.equal(payload.maxFileBytes, 500 * 1024 * 1024);
  assert.equal(JSON.stringify(payload).includes("r2-secret-key-test"), false);
  assert.equal(JSON.stringify(payload).includes("album-test-signing-secret"), false);
});

test("criação de upload exige o código privado do álbum", async () => {
  const response = await fetch(`${baseUrl}/api/album/upload-signature`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Cookie: albumSessionCookie(),
    },
    body: JSON.stringify({
      guestName: "Pessoa Teste",
      category: "Festa",
      fileName: "foto.jpg",
      fileType: "image/jpeg",
      fileSize: 8_000_000,
      accessCode: "0000",
    }),
  });
  const payload = await response.json();

  assert.equal(response.status, 403);
  assert.match(payload.error, /código do álbum incorreto/i);
});

test("exclusão de mídia exige administrador do álbum", async () => {
  const mediaId = "00000000-0000-4000-8000-000000000001";
  const noSession = await fetch(`${baseUrl}/api/album/media/${mediaId}`, { method: "DELETE" });
  assert.equal(noSession.status, 401);

  const notAdmin = await fetch(`${baseUrl}/api/album/media/${mediaId}`, {
    method: "DELETE",
    headers: { Cookie: albumSessionCookie("Pessoa Teste") },
  });
  const notAdminPayload = await notAdmin.json();
  assert.equal(notAdmin.status, 403);
  assert.match(notAdminPayload.error, /administrador do álbum/i);
});

test("APIs do álbum exigem sessão autenticada", async () => {
  const response = await fetch(`${baseUrl}/api/album/media`);
  const payload = await response.json();
  assert.equal(response.status, 401);
  assert.match(payload.error, /entre no álbum/i);
});

test("registro do álbum rejeita autorização de upload adulterada", async () => {
  const response = await fetch(`${baseUrl}/api/album/media`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Cookie: albumSessionCookie(),
    },
    body: JSON.stringify({
      uploadToken: "autorizacao.adulterada",
    }),
  });
  const payload = await response.json();

  assert.equal(response.status, 401);
  assert.match(payload.error, /autorização de upload inválida/i);
});

test("rejeita origem externa, entrada inválida e corpo excessivo", async () => {
  const externalOrigin = await fetch(`${baseUrl}/api/rsvp`, {
    method: "POST",
    headers: { "Content-Type": "application/json", "Origin": "https://site-malicioso.example" },
    body: JSON.stringify({ guestName: "Pessoa Teste", partySize: "Somente eu" }),
  });
  assert.equal(externalOrigin.status, 403);

  const singleName = await fetch(`${baseUrl}/api/rsvp`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ guestName: "Gabriel", partySize: "Somente eu" }),
  });
  assert.equal(singleName.status, 400);
  assert.match((await singleName.json()).error, /nome e sobrenome/i);

  const invalidInput = await fetch(`${baseUrl}/api/rsvp`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ guestName: "A", partySize: "Somente eu" }),
  });
  assert.equal(invalidInput.status, 400);

  const oversized = await fetch(`${baseUrl}/api/rsvp`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ guestName: "x".repeat(70_000), partySize: "Somente eu" }),
  });
  assert.equal(oversized.status, 413);

  const coupleWithoutName = await fetch(`${baseUrl}/api/rsvp`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ guestName: "Pessoa Teste", partySize: "Casal", additionalGuestNames: [] }),
  });
  assert.equal(coupleWithoutName.status, 400);

  const minorsWithoutNames = await fetch(`${baseUrl}/api/rsvp`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ guestName: "Pessoa Teste", partySize: "Responsável e menores", additionalGuestNames: [] }),
  });
  assert.equal(minorsWithoutNames.status, 400);

  const repeatedName = await fetch(`${baseUrl}/api/rsvp`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ guestName: "José Teste", partySize: "Casal", additionalGuestNames: ["Jose Teste"] }),
  });
  assert.equal(repeatedName.status, 400);
});

test("data exibida e contagem até meia-noite do casamento usam 2026", async () => {
  const html = await readFile(new URL("../index.html", import.meta.url), "utf8");
  const script = await readFile(new URL("../script.js", import.meta.url), "utf8");

  assert.match(html, /28 nov 2026/);
  assert.doesNotMatch(html, /28 nov 2025/);
  assert.match(script, /2026-11-28T00:00:00-03:00/);
});

test("local da celebração mostra o endereço e abre o Google Maps com segurança", async () => {
  const html = await readFile(new URL("../index.html", import.meta.url), "utf8");

  assert.match(html, /Rua José Marques Ribeiro, 521/);
  assert.match(html, /Guaturinho · Cajamar\/SP · CEP 07750-000/);
  assert.match(html, /class="event-location-card"[\s\S]*?Rua José Marques Ribeiro, 521 · CEP 07750-000/);
  assert.match(html, /href="https:\/\/maps\.app\.goo\.gl\/rGEtAHSXq4ArMM4o7"/);
  assert.match(html, /target="_blank"/);
  assert.match(html, /rel="noopener noreferrer"/);
  assert.doesNotMatch(html, /Espaço a definir/);
});

test("confirmação prioriza os detalhes da cerimônia sem pressionar por presentes", async () => {
  const [html, script] = await Promise.all([
    readFile(new URL("../index.html", import.meta.url), "utf8"),
    readFile(new URL("../script.js", import.meta.url), "utf8"),
  ]);

  assert.match(html, /data-scroll-details hidden>Detalhes da cerimônia/);
  assert.match(html, /id="detalhes"/);
  assert.match(script, /detailsButton\.hidden = false/);
  assert.match(script, /Que alegria ter você conosco!/);
  assert.match(script, /se desejar, nossa lista de presentes/);
  assert.match(script, /getKnownGuestName\(\)/);
  assert.match(script, /openGiftModal[\s\S]*value="\$\{knownGuestName/);
  assert.doesNotMatch(script, /Se entrou aqui procurando um presentinho/);
});

test("detalhes apresentam cerimônia, jantar e programação sem traje ou padrinhos", async () => {
  const html = await readFile(new URL("../index.html", import.meta.url), "utf8");

  assert.match(html, /<h3>Cerimônia<\/h3>[\s\S]*?<strong>Horário a confirmar<\/strong>/);
  assert.match(html, /<h3>Jantar<\/h3>[\s\S]*?<strong>Após a cerimônia<\/strong>/);
  assert.match(html, /<h3>Programação<\/h3>[\s\S]*?<strong>Mais detalhes em breve<\/strong>/);
  assert.doesNotMatch(html, /11h30|Almoço|Traje|madrinhas|padrinhos/i);
});

test("confirmação diferencia indivíduo, casal e responsável com menores", async () => {
  const [script, migration, server] = await Promise.all([
    readFile(new URL("../script.js", import.meta.url), "utf8"),
    readFile(new URL("../supabase-rsvp-guests.sql", import.meta.url), "utf8"),
    readFile(new URL("../server.js", import.meta.url), "utf8"),
  ]);

  assert.match(script, /rsvpWizardSetStep/);
  assert.match(script, /data-rsvp-include-partner/);
  assert.match(script, /Adicionar outro filho\(a\)/);
  assert.match(script, /showRsvpError/);
  assert.match(script, /data-rsvp-restore/);
  assert.match(script, /captureRsvpDraft/);
  assert.match(script, /Cada casal pode confirmar pelo par/);
  assert.doesNotMatch(script, /rsvp-policy/);
  assert.doesNotMatch(script, /confirmationType/);
  assert.match(migration, /add column if not exists additional_guest_names text\[\]/i);
  assert.match(migration, /p_additional_guest_names text\[\] default/i);
  assert.match(migration, /cardinality\(clean_additional_names\) not between 1 and 7/i);
  assert.match(migration, /already_confirmed boolean/i);
  assert.match(migration, /true as already_confirmed/);
  assert.doesNotMatch(migration, /on conflict \(normalized_guest_name\)/i);
  assert.match(script, /alreadyConfirmed/);
  assert.match(script, /já estava confirmada/i);
  assert.match(server, /alreadyConfirmed: Boolean\(row\?\.already_confirmed\)/);
});

test("álbum mobile preserva originais, publica memórias, usa câmera e agrupa stories por convidado", async () => {
  const [index, album, albumLogin, albumLoginScript, albumStyles, albumScript, server, albumSchema, albumAuthSchema] = await Promise.all([
    readFile(new URL("../index.html", import.meta.url), "utf8"),
    readFile(new URL("../album.html", import.meta.url), "utf8"),
    readFile(new URL("../album-login.html", import.meta.url), "utf8"),
    readFile(new URL("../album-login.js", import.meta.url), "utf8"),
    readFile(new URL("../album.css", import.meta.url), "utf8"),
    readFile(new URL("../album.js", import.meta.url), "utf8"),
    readFile(new URL("../server.js", import.meta.url), "utf8"),
    readFile(new URL("../supabase-album-schema.sql", import.meta.url), "utf8"),
    readFile(new URL("../supabase-album-auth.sql", import.meta.url), "utf8"),
  ]);

  assert.match(index, /href="\/album"[^>]*>Conhecer o álbum coletivo</i);
  assert.match(album, /aria-label="Stories dos convidados"/i);
  assert.match(album, /gallery-intro/);
  assert.match(album, /Memórias do nosso dia/);
  assert.doesNotMatch(album, /Confirmo que posso compartilhar/i);
  assert.match(albumScript, /startAutoplay/);
  assert.match(albumScript, /showLocalAlbumStatus/);
  assert.match(album, /Até 10 arquivos · fotos e vídeos de até 500 MB cada · backup automático dos originais/i);
  assert.match(album, /data-album-logout/);
  assert.match(albumLogin, /data-album-login-form/);
  assert.match(albumLogin, /data-album-known-name/);
  assert.match(albumLoginScript, /gabriel-halanaia-rsvp/);
  assert.match(albumLoginScript, /applyKnownNameMode/);
  assert.match(albumAuthSchema, /authenticate_album_guest/i);
  assert.match(albumAuthSchema, /extensions\.crypt\('123456'/);
  assert.match(albumAuthSchema, /set search_path = public, extensions/);
  assert.match(album, /data-download-media/);
  assert.match(album, /data-delete-media/);
  assert.match(albumScript, /downloadMediaFile/);
  assert.match(albumScript, /albumIsAdmin/);
  assert.match(albumScript, /deleteActiveMedia/);
  assert.match(server, /isAlbumAdmin/);
  assert.match(server, /albumMediaDeleteMatch/);
  assert.match(server, /Gabriel Domingues/);
  assert.match(albumScript, /Baixar original/);
  assert.match(albumScript, /memoryGrid\.prepend\(fragment\)/);
  assert.match(albumScript, /URL\.createObjectURL\(file\)/);
  assert.match(albumScript, /\/api\/album\/upload-signature/);
  assert.match(albumScript, /new XMLHttpRequest\(\)/);
  assert.match(albumScript, /xhr\.open\("PUT", upload\.uploadUrl\)/);
  assert.match(albumScript, /xhr\.send\(file\)/);
  assert.match(albumScript, /maximumAlbumFileSize = 500 \* 1024 \* 1024/);
  assert.match(server, /new PutObjectCommand/);
  assert.match(server, /new HeadObjectCommand/);
  assert.match(server, /createAlbumUploadToken/);
  assert.match(server, /Autorização de upload inválida/);
  assert.match(albumSchema, /create table if not exists public\.album_media/i);
  assert.match(albumSchema, /storage_provider text not null default 'r2'/i);
  assert.match(albumSchema, /backup_status text not null default 'pending'/i);
  assert.match(albumSchema, /revoke all on table public\.album_media from anon, authenticated/i);
  assert.match(album, /Stories dos convidados/i);
  assert.match(album, /data-hero-carousel/);
  assert.match(album, /Gabriel[\s\S]*?Halanaia/);
  assert.match(album, /data-hero-slide/g);
  assert.match(album, /data-hero-dot="0"[\s\S]*?data-hero-dot="2"/);
  assert.match(albumScript, /function showHeroSlide\(index/);
  assert.match(albumScript, /heroCarousel\.addEventListener\("touchstart"/);
  assert.match(albumStyles, /\.hero-slide\.is-active[\s\S]*?opacity:\s*1/);
  assert.match(album, /class="mobile-action-bar"/i);
  assert.match(albumStyles, /\.story-viewer[\s\S]*?height:\s*min\(calc\(100vh/i);
  assert.match(albumStyles, /\.memory-grid[\s\S]*?columns:\s*2/i);
  assert.match(albumScript, /const storyGroups = new Map\(\)/);
  assert.match(albumScript, /storyGroupHasMedia/);
  assert.match(albumScript, /MAX_CAROUSEL_PHOTOS = 4/);
  assert.match(albumScript, /function buildGalleryTiles\(entries\)/);
  assert.match(albumScript, /function getStoryDisplayName\(person\)/);
  assert.match(albumScript, /buildStoryDisplayNameMap/);
  assert.match(albumScript, /function openStory\(person\)/);
  assert.match(album, /data-open-camera[\s\S]*?Abrir câmera/i);
  assert.match(album, /data-camera-video/);
  assert.match(album, /data-capture-camera/);
  assert.match(albumScript, /navigator\.mediaDevices\?\.getUserMedia/);
  assert.match(albumScript, /cameraCanvas\.toBlob/);
  assert.match(albumScript, /cameraStream\.getTracks\(\)/);
  assert.match(albumScript, /capturedFiles\.push\(new File/);
  assert.match(album, /data-camera-mode="photo"[\s\S]*?data-camera-mode="video"/i);
  assert.match(album, /data-camera-zoom-input/);
  assert.match(album, /data-camera-recording/);
  assert.match(album, /data-camera-gallery/);
  assert.match(album, /class="camera-topbar"/);
  assert.match(album, /video\/webm/);
  assert.match(albumScript, /cameraVideoTrack\.getCapabilities\(\)/);
  assert.match(albumScript, /cameraVideoTrack\.applyConstraints\(\{ advanced: \[\{ zoom \}\] \}\)/);
  assert.match(albumScript, /new ImageCapture\(cameraVideoTrack\)/);
  assert.match(albumScript, /cameraImageCapture\.getPhotoCapabilities\(\)/);
  assert.match(albumScript, /cameraPhotoSettings[\s\S]*?cameraImageCapture\.takePhoto\(cameraPhotoSettings\)/);
  assert.match(albumScript, /cameraCanvas\.toBlob\(resolve, "image\/jpeg", 0\.96\)/);
  assert.match(albumScript, /photoMode \? 4096 : 3840/);
  assert.match(albumScript, /cameraVideoTrack\.contentHint = cameraMode === "photo" \? "detail" : "motion"/);
  assert.match(albumScript, /new MediaRecorder\(cameraStream/);
  assert.match(albumScript, /videoBitsPerSecond: getRecordingVideoBitrate\(\)/);
  assert.match(albumScript, /pixels >= 3840 \* 2160\) return 20_000_000/);
  assert.match(albumScript, /pixels >= 1920 \* 1080\) return 12_000_000/);
  assert.match(albumScript, /audioBitsPerSecond: 192_000/);
  assert.match(albumScript, /cameraGalleryButton\.addEventListener\("click"/);
  assert.match(albumStyles, /\.camera-panel[\s\S]*?position:\s*fixed[\s\S]*?height:\s*100dvh/);
  assert.match(albumScript, /maximumRecordingDuration = 30_000/);
  assert.match(albumScript, /audio:[\s\S]*?echoCancellation: true/);
  assert.match(album, /data-share-story[\s\S]*?Compartilhar no Instagram/i);
  assert.match(albumScript, /storyExportWidth = 1080/);
  assert.match(albumScript, /storyExportHeight = 1920/);
  assert.match(albumScript, /canvas\.toBlob\(\(blob\)/);
  assert.match(albumScript, /prepareStoryShareFile\(slide, activeStoryPerson\)/);
  assert.match(albumScript, /navigator\.canShare\?\.\(\{ files: \[shareFile\] \}\)/);
  assert.match(albumScript, /await navigator\.share\(\{ files: \[shareFile\] \}\)/);
  assert.doesNotMatch(albumScript, /url:\s*`\$\{location\.origin\}\/album`/);
  assert.doesNotMatch(albumScript, /Compartilhar este álbum|Link do álbum copiado/i);
  assert.match(albumScript, /file,[\s\S]*?caption:/);
  assert.match(server, /"Permissions-Policy": "camera=\(self\), microphone=\(self\), web-share=\(self\), geolocation=\(\)"/);
  assert.doesNotMatch(album, /on(?:click|change|submit)\s*=/i);
});

test("configuração da Vercel inclui os arquivos lidos pelo servidor Node", async () => {
  const config = JSON.parse(await readFile(new URL("../vercel.json", import.meta.url), "utf8"));
  assert.equal(config.functions?.["server.ts"]?.includeFiles, "**/*");
});
