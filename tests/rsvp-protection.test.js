import assert from "node:assert/strict";
import { createHash, createHmac } from "node:crypto";
import { spawn } from "node:child_process";
import { createServer } from "node:http";
import net from "node:net";
import { after, before, beforeEach, test } from "node:test";

const signingSecret = "rsvp-test-signing-secret-with-32-characters";
const primaryId = "11111111-1111-4111-8111-111111111111";
const ownerToken = "token-do-aparelho-que-confirmou";

let fakeSupabase;
let serverProcess;
let baseUrl;
let confirmCalls = [];

function rememberCookie(rawToken) {
  const payload = Buffer.from(JSON.stringify({
    token: rawToken,
    expiresAt: Date.now() + 60 * 60 * 1000,
  }), "utf8").toString("base64url");
  const signature = createHmac("sha256", signingSecret).update(payload).digest("base64url");
  return `gab_naia_guest_remember=${payload}.${signature}`;
}

function handleFakeSupabase(request, response) {
  const url = new URL(request.url, "http://fake");
  const reply = (payload) => {
    response.writeHead(200, { "Content-Type": "application/json" });
    response.end(JSON.stringify(payload));
  };

  if (request.method === "POST" && url.pathname === "/rest/v1/rpc/confirm_rsvp") {
    let raw = "";
    request.on("data", (chunk) => { raw += chunk; });
    request.on("end", () => {
      const body = JSON.parse(raw);
      confirmCalls.push(body);
      reply([{
        id: primaryId,
        guest_name: body.p_guest_name,
        party_size: body.p_party_size,
        additional_guest_names: body.p_additional_guest_names,
        already_confirmed: false,
      }]);
    });
    return;
  }

  if (request.method === "POST" && url.pathname === "/rest/v1/rsvp_remember_tokens") {
    reply([{}]);
    return;
  }

  if (url.pathname === "/rest/v1/rsvp_remember_tokens") {
    const ownerHash = createHash("sha256").update(ownerToken).digest("hex");
    reply(url.searchParams.get("token_hash") === `eq.${ownerHash}` ? [{ primary_rsvp_id: primaryId }] : []);
    return;
  }

  if (url.pathname === "/rest/v1/rsvps") {
    const primaryRow = {
      id: primaryId,
      guest_name: "Maria Silva",
      party_size: "Casal",
      primary_rsvp_id: null,
      additional_guest_names: [],
    };
    if (url.searchParams.get("normalized_guest_name") === "eq.maria silva") return reply([primaryRow]);
    if (url.searchParams.get("id") === `eq.${primaryId}`) return reply([primaryRow]);
    if (url.searchParams.get("primary_rsvp_id") === `eq.${primaryId}`) return reply([{ guest_name: "Joao Silva" }]);
    return reply([]);
  }

  response.writeHead(404, { "Content-Type": "application/json" });
  response.end("{}");
}

async function findAvailablePort() {
  return new Promise((resolve, reject) => {
    const probe = net.createServer();
    probe.once("error", reject);
    probe.listen(0, "127.0.0.1", () => {
      const { port } = probe.address();
      probe.close(() => resolve(port));
    });
  });
}

before(async () => {
  fakeSupabase = createServer(handleFakeSupabase);
  await new Promise((resolve) => fakeSupabase.listen(0, "127.0.0.1", resolve));

  const port = await findAvailablePort();
  baseUrl = `http://127.0.0.1:${port}`;
  serverProcess = spawn(process.execPath, ["server.js"], {
    cwd: process.cwd(),
    env: {
      ...process.env,
      PORT: String(port),
      SUPABASE_URL: `http://127.0.0.1:${fakeSupabase.address().port}`,
      SUPABASE_SECRET_KEY: "sb_secret_test_secret",
      ALBUM_UPLOAD_SIGNING_SECRET: signingSecret,
      SITE_URL: "http://127.0.0.1",
    },
    stdio: ["ignore", "pipe", "pipe"],
  });

  await new Promise((resolve, reject) => {
    const timeout = setTimeout(() => reject(new Error("Servidor não iniciou a tempo.")), 5_000);
    serverProcess.stdout.on("data", (chunk) => {
      if (!String(chunk).includes("Convite rodando")) return;
      clearTimeout(timeout);
      resolve();
    });
  });
});

after(async () => {
  if (serverProcess?.exitCode == null) {
    serverProcess.kill();
    await new Promise((resolve) => serverProcess.once("exit", resolve));
  }
  await new Promise((resolve) => fakeSupabase.close(resolve));
});

beforeEach(() => {
  confirmCalls = [];
});

async function postJson(pathname, body, cookie) {
  const response = await fetch(`${baseUrl}${pathname}`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      ...(cookie ? { Cookie: cookie } : {}),
    },
    body: JSON.stringify(body),
  });
  return { status: response.status, body: await response.json() };
}

test("outra pessoa não remove acompanhantes de uma confirmação existente", async () => {
  const result = await postJson("/api/rsvp", {
    guestName: "Maria Silva",
    partySize: "Somente eu",
    additionalGuestNames: [],
  });

  assert.equal(result.status, 403);
  assert.match(result.body.error, /aparelho em que ela foi feita/);
  assert.equal(confirmCalls.length, 0);
});

test("incluir pessoas continua possível sem o aparelho original", async () => {
  const result = await postJson("/api/rsvp", {
    guestName: "Maria Silva",
    partySize: "Família",
    additionalGuestNames: ["Joao Silva", "Pedro Silva"],
  });

  assert.equal(result.status, 200);
  assert.equal(confirmCalls.length, 1);
});

test("o aparelho que confirmou pode remover acompanhantes", async () => {
  const result = await postJson("/api/rsvp", {
    guestName: "Maria Silva",
    partySize: "Somente eu",
    additionalGuestNames: [],
  }, rememberCookie(ownerToken));

  assert.equal(result.status, 200);
  assert.equal(confirmCalls.length, 1);
});

test("consulta por nome só mostra acompanhantes ao aparelho que confirmou", async () => {
  const stranger = await postJson("/api/rsvp/lookup", { guestName: "Maria Silva" });
  assert.equal(stranger.status, 200);
  assert.equal(stranger.body.rsvp.guest_name, "Maria Silva");
  assert.equal("additional_guest_names" in stranger.body.rsvp, false);

  const owner = await postJson("/api/rsvp/lookup", { guestName: "Maria Silva" }, rememberCookie(ownerToken));
  assert.deepEqual(owner.body.rsvp.additional_guest_names, ["Joao Silva"]);
});
