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
  for (const pathname of ["/", "/styles.css", "/script.js", "/assets/favicon.png", "/pagamento/sucesso"]) {
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
});

test("data exibida e data do casamento usam 2026", async () => {
  const html = await readFile(new URL("../index.html", import.meta.url), "utf8");
  const script = await readFile(new URL("../script.js", import.meta.url), "utf8");

  assert.match(html, /28 nov 2026/);
  assert.doesNotMatch(html, /28 nov 2025/);
  assert.match(script, /2026-11-28T11:30:00-03:00/);
});
