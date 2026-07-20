import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { readFile } from "node:fs/promises";
import net from "node:net";
import { after, before, test } from "node:test";

let serverProcess;
let baseUrl;

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
    "/album",
    "/album.css",
    "/album.js",
    "/assets/favicon.png",
    "/pagamento/sucesso",
  ]) {
    const response = await fetch(`${baseUrl}${pathname}`);
    assert.equal(response.status, 200, pathname);
    assert.equal(response.headers.get("x-content-type-options"), "nosniff");
  }
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
  });
  assert.equal(JSON.stringify(payload).includes("sb_secret_test_secret"), false);
});

test("rejeita origem externa, entrada inválida e corpo excessivo", async () => {
  const externalOrigin = await fetch(`${baseUrl}/api/rsvp`, {
    method: "POST",
    headers: { "Content-Type": "application/json", "Origin": "https://site-malicioso.example" },
    body: JSON.stringify({ guestName: "Pessoa Teste", partySize: "Somente eu" }),
  });
  assert.equal(externalOrigin.status, 403);

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
  const [script, migration] = await Promise.all([
    readFile(new URL("../script.js", import.meta.url), "utf8"),
    readFile(new URL("../supabase-rsvp-guests.sql", import.meta.url), "utf8"),
  ]);

  assert.match(script, /Somente minha presença/);
  assert.match(script, /Eu e meu\/minha companheiro\(a\)/);
  assert.match(script, /Eu e menor\(es\) sob minha responsabilidade/);
  assert.match(script, /Adultos devem confirmar separadamente/);
  assert.match(script, /getAll\("additionalGuestNames"\)/);
  assert.doesNotMatch(script, /<option>Eu e meus filhos<\/option>/);
  assert.match(migration, /add column if not exists additional_guest_names text\[\]/i);
  assert.match(migration, /p_additional_guest_names text\[\] default/i);
  assert.match(migration, /cardinality\(clean_additional_names\) <> 1/i);
});

test("protótipo mobile do álbum publica memórias, usa câmera e agrupa stories por convidado", async () => {
  const [index, album, albumStyles, albumScript, server] = await Promise.all([
    readFile(new URL("../index.html", import.meta.url), "utf8"),
    readFile(new URL("../album.html", import.meta.url), "utf8"),
    readFile(new URL("../album.css", import.meta.url), "utf8"),
    readFile(new URL("../album.js", import.meta.url), "utf8"),
    readFile(new URL("../server.js", import.meta.url), "utf8"),
  ]);

  assert.match(index, /href="\/album"[^>]*>Conhecer o álbum coletivo</i);
  assert.match(album, /Os novos envios aparecem imediatamente, sem fila de aprovação\./i);
  assert.match(album, /Os arquivos enviados nesta tela ficam somente neste navegador/i);
  assert.match(album, /Até 10 arquivos · fotos de 15 MB · vídeos de 50 MB/i);
  assert.match(albumScript, /memoryGrid\.prepend\(fragment\)/);
  assert.match(albumScript, /URL\.createObjectURL\(file\)/);
  assert.match(album, /Stories dos convidados/i);
  assert.match(album, /class="mobile-action-bar"/i);
  assert.match(albumStyles, /\.story-viewer[\s\S]*?height:\s*min\(calc\(100vh/i);
  assert.match(albumStyles, /\.memory-grid[\s\S]*?columns:\s*2/i);
  assert.match(albumScript, /storyGroups\.set\(guestName, \{ slides: newStorySlides \}\)/);
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
  assert.match(album, /video\/webm/);
  assert.match(albumScript, /cameraVideoTrack\.getCapabilities\(\)/);
  assert.match(albumScript, /cameraVideoTrack\.applyConstraints\(\{ advanced: \[\{ zoom \}\] \}\)/);
  assert.match(albumScript, /new MediaRecorder\(cameraStream/);
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
