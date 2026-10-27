// Ponta a ponta: servidor real contra um Supabase falso em memória.
// Cobre a entrada no álbum sem senha, a senha dos noivos e os desafios com ranking.
import assert from "node:assert/strict";
import { createHash, createHmac } from "node:crypto";
import { spawn } from "node:child_process";
import net from "node:net";
import { after, before, describe, test } from "node:test";
import { createFakeSupabase } from "./helpers/fake-supabase.js";

const signingSecret = "album-test-signing-secret-with-32-characters";
const couplePassword = "senha-dos-noivos-teste";
const joiceId = "11111111-1111-4111-8111-111111111111";
const rememberToken = "token-do-aparelho-da-joice";

function seedTables() {
  return {
    rsvps: [
      { id: "22222222-2222-4222-8222-222222222222", guest_name: "Gabriel Domingues", party_size: "Somente eu", primary_rsvp_id: null },
      { id: "33333333-3333-4333-8333-333333333333", guest_name: "Halanaia Vitória", party_size: "Somente eu", primary_rsvp_id: null },
      { id: "44444444-4444-4444-8444-444444444444", guest_name: "Livia Fernandes", party_size: "Responsável e menores", primary_rsvp_id: null },
      { id: joiceId, guest_name: "Joice de Paula Silva", party_size: "Família", primary_rsvp_id: null },
      { id: "55555555-5555-4555-8555-555555555555", guest_name: "Livia de Paula", party_size: "Filho(a)", primary_rsvp_id: joiceId },
      { id: "66666666-6666-4666-8666-666666666666", guest_name: "Tainá Antunes", party_size: "Somente eu", primary_rsvp_id: null },
    ].map((row) => ({ ...row, normalized_guest_name: row.guest_name.toLowerCase(), created_at: "2026-07-01T00:00:00Z" })),
    rsvp_remember_tokens: [
      { id: "77777777-7777-4777-8777-777777777777", primary_rsvp_id: joiceId, token_hash: createHash("sha256").update(rememberToken).digest("hex") },
    ],
    restricted_guests: [{ id: "88888888-8888-4888-8888-888888888888", guest_name: "Pessoa Bloqueada", active: true }],
  };
}

function rememberCookie(token = rememberToken) {
  const payload = Buffer.from(JSON.stringify({ token, expiresAt: Date.now() + 60_000 })).toString("base64url");
  const signature = createHmac("sha256", signingSecret).update(payload).digest("base64url");
  return `gab_naia_guest_remember=${payload}.${signature}`;
}

async function findPort() {
  return new Promise((resolve, reject) => {
    const probe = net.createServer();
    probe.once("error", reject);
    probe.listen(0, "127.0.0.1", () => {
      const { port } = probe.address();
      probe.close(() => resolve(port));
    });
  });
}

async function startApp({ supabaseUrl, openAt }) {
  const port = await findPort();
  const child = spawn(process.execPath, ["server.js"], {
    cwd: process.cwd(),
    env: {
      ...process.env,
      PORT: String(port),
      SUPABASE_URL: supabaseUrl,
      SUPABASE_SECRET_KEY: "sb_secret_test_secret",
      MERCADO_PAGO_ACCESS_TOKEN: "",
      R2_ACCOUNT_ID: "account-test",
      R2_ACCESS_KEY_ID: "r2-access-key-test",
      R2_SECRET_ACCESS_KEY: "r2-secret-key-test",
      R2_BUCKET_NAME: "gab-naia-album",
      R2_PUBLIC_BASE_URL: "https://media.example.com",
      ALBUM_UPLOAD_SIGNING_SECRET: signingSecret,
      ALBUM_UPLOAD_CODE: "",
      ALBUM_ADMIN_GUEST_NAMES: "",
      SUPPORT_PANEL_GUEST_NAMES: "",
      ALBUM_PUBLIC_OPEN_AT: openAt,
      SITE_URL: "http://127.0.0.1",
    },
    stdio: ["ignore", "pipe", "pipe"],
  });
  await new Promise((resolve, reject) => {
    const timeout = setTimeout(() => reject(new Error("Servidor não iniciou a tempo.")), 5_000);
    child.stdout.on("data", (chunk) => {
      if (String(chunk).includes("Convite rodando")) {
        clearTimeout(timeout);
        resolve();
      }
    });
    child.once("exit", (code) => reject(new Error(`Servidor encerrou (código ${code}).`)));
  });
  const baseUrl = `http://127.0.0.1:${port}`;

  async function call(pathname, { method = "GET", body, cookie } = {}) {
    const response = await fetch(`${baseUrl}${pathname}`, {
      method,
      headers: {
        ...(body === undefined ? {} : { "Content-Type": "application/json" }),
        ...(cookie ? { Cookie: cookie } : {}),
      },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    const text = await response.text();
    const sessionCookie = (response.headers.get("set-cookie") || "").match(/gab_naia_album_session=[^;]+/)?.[0] || null;
    return { status: response.status, body: text ? JSON.parse(text) : null, sessionCookie };
  }

  return {
    call,
    async stop() {
      if (child.exitCode != null) return;
      child.kill();
      await new Promise((resolve) => child.once("exit", resolve));
    },
  };
}

async function enter(app, guestName, source, cookie) {
  return app.call("/api/album/enter", { method: "POST", body: { guestName, source }, cookie });
}

async function coupleLogin(app, guestName) {
  const login = await app.call("/api/album/login", { method: "POST", body: { guestName, password: couplePassword } });
  assert.equal(login.status, 200, JSON.stringify(login.body));
  assert.ok(login.sessionCookie);
  return login.sessionCookie;
}

describe("álbum antes da abertura (28/11 às 15h)", () => {
  let supabase;
  let app;

  before(async () => {
    supabase = createFakeSupabase({
      tables: seedTables(),
      passwords: { "Gabriel Domingues": couplePassword, "Halanaia Vitória": couplePassword },
    });
    app = await startApp({ supabaseUrl: await supabase.listen(), openAt: "2099-01-01T00:00:00-03:00" });
  });

  after(async () => {
    await app?.stop();
    await supabase?.close();
  });

  test("a busca só encontra os noivos e convidados ainda não entram", async () => {
    const entry = await app.call("/api/album/entry", { cookie: rememberCookie() });
    assert.equal(entry.body.publicOpen, false);
    assert.deepEqual(entry.body.remembered, []);

    assert.deepEqual((await app.call("/api/album/guests?q=hala")).body.guests, ["Halanaia Vitória"]);
    assert.deepEqual((await app.call("/api/album/guests?q=livia")).body.guests, []);

    const guest = await enter(app, "Livia Fernandes", "list");
    assert.equal(guest.status, 403);
    assert.match(guest.body.error, /28\/11/);
    assert.equal(guest.sessionCookie, null);

    const created = await enter(app, "Pessoa Nova Teste", "new");
    assert.equal(created.status, 403);
    assert.equal(supabase.state.album_guests.length, 0);
  });

  test("os noivos recebem o pedido de senha e entram antes da abertura", async () => {
    for (const name of ["Halanaia Vitória", "Gabriel Domingues"]) {
      const withoutPassword = await enter(app, name, "list");
      assert.equal(withoutPassword.status, 403);
      assert.equal(withoutPassword.body.code, "admin_password");
      assert.equal(withoutPassword.sessionCookie, null);
    }

    const wrong = await app.call("/api/album/login", {
      method: "POST",
      body: { guestName: "Halanaia Vitória", password: "errada" },
    });
    assert.equal(wrong.status, 403);
    assert.match(wrong.body.error, /senha incorreta/i);

    // Sem acento também precisa funcionar.
    const cookie = await coupleLogin(app, "halanaia vitoria");
    const session = await app.call("/api/album/session", { cookie });
    assert.equal(session.body.authenticated, true);
    assert.equal(session.body.isAlbumAdmin, true);
    assert.equal(session.body.albumAvailable, true);

    const guestPassword = await app.call("/api/album/login", {
      method: "POST",
      body: { guestName: "Livia Fernandes", password: couplePassword },
    });
    assert.equal(guestPassword.status, 403);
  });
});

describe("álbum aberto", () => {
  let supabase;
  let app;
  let coupleCookie;

  before(async () => {
    supabase = createFakeSupabase({
      tables: seedTables(),
      passwords: { "Gabriel Domingues": couplePassword, "Halanaia Vitória": couplePassword },
    });
    app = await startApp({ supabaseUrl: await supabase.listen(), openAt: "2020-01-01T00:00:00-03:00" });
    coupleCookie = await coupleLogin(app, "Gabriel Domingues");
  });

  after(async () => {
    await app?.stop();
    await supabase?.close();
  });

  test("busca ignora acento e caixa, exige 3 letras e acha por sobrenome", async () => {
    assert.deepEqual((await app.call("/api/album/guests?q=li")).body.guests, []);
    assert.deepEqual((await app.call("/api/album/guests?q=livia")).body.guests, ["Livia de Paula", "Livia Fernandes"]);
    assert.deepEqual((await app.call(`/api/album/guests?q=${encodeURIComponent("LÍVIA fer")}`)).body.guests, ["Livia Fernandes"]);
    assert.deepEqual((await app.call("/api/album/guests?q=taina")).body.guests, ["Tainá Antunes"]);
    assert.deepEqual((await app.call("/api/album/guests?q=paula")).body.guests, ["Joice de Paula Silva", "Livia de Paula"]);
  });

  test("convidado da lista entra sem senha", async () => {
    const response = await enter(app, "tainá antunes", "list");
    assert.equal(response.status, 200);
    assert.equal(response.body.guestName, "Tainá Antunes");
    const session = await app.call("/api/album/session", { cookie: response.sessionCookie });
    assert.equal(session.body.guestName, "Tainá Antunes");
    assert.equal(session.body.isAlbumAdmin, false);

    const unknown = await enter(app, "Fulano Inexistente", "list");
    assert.equal(unknown.status, 404);
  });

  test("aparelho que confirmou presença entra só com os nomes da própria família", async () => {
    const entry = await app.call("/api/album/entry", { cookie: rememberCookie() });
    assert.deepEqual(entry.body.remembered, ["Joice de Paula Silva", "Livia de Paula"]);

    const companion = await enter(app, "Livia de Paula", "remembered", rememberCookie());
    assert.equal(companion.status, 200);
    assert.ok(companion.sessionCookie);

    const outsider = await enter(app, "Livia Fernandes", "remembered", rememberCookie());
    assert.equal(outsider.status, 403);

    const forged = await app.call("/api/album/entry", { cookie: rememberCookie("token-inventado") });
    assert.deepEqual(forged.body.remembered, []);
  });

  test("\"Não achei meu nome\" cria o acesso uma vez e o nome passa a aparecer na busca", async () => {
    const created = await enter(app, "  Maria   Nova Silva ", "new");
    assert.equal(created.status, 200);
    assert.equal(created.body.guestName, "Maria Nova Silva");
    assert.equal(supabase.state.album_guests.length, 1);
    assert.deepEqual((await app.call("/api/album/guests?q=maria")).body.guests, ["Maria Nova Silva"]);

    const again = await enter(app, "maria nova silva", "new");
    assert.equal(again.status, 200);
    assert.equal(again.body.guestName, "Maria Nova Silva");
    assert.equal(supabase.state.album_guests.length, 1);

    const existing = await enter(app, "livia fernandes", "new");
    assert.equal(existing.body.guestName, "Livia Fernandes");
    assert.equal(supabase.state.album_guests.length, 1);

    const blocked = await enter(app, "Pessoa Bloqueada", "new");
    assert.equal(blocked.status, 403);
    assert.equal(supabase.state.album_guests.length, 1);

    const bride = await enter(app, "Halanaia Vitoria", "new");
    assert.equal(bride.body.code, "admin_password");
  });

  test("desafios: noivos criam, convidados pontuam e o ranking ordena e desempata", async () => {
    const guestCookie = (await enter(app, "Livia Fernandes", "list")).sessionCookie;
    const forbidden = await app.call("/api/album/challenges", {
      method: "POST",
      body: { title: "Foto com o noivo" },
      cookie: guestCookie,
    });
    assert.equal(forbidden.status, 403);

    const create = async (title, points) => {
      const response = await app.call("/api/album/challenges", {
        method: "POST",
        body: { title, description: "", points },
        cookie: coupleCookie,
      });
      assert.equal(response.status, 201, JSON.stringify(response.body));
      return response.body.challenge;
    };
    const noivo = await create("Foto com o noivo", 1);
    const alianca = await create("Foto com a aliança", 3);

    const invalidPoints = await app.call("/api/album/challenges", {
      method: "POST",
      body: { title: "Foto inválida", points: 0 },
      cookie: coupleCookie,
    });
    assert.equal(invalidPoints.status, 400);

    // Upload para desafio: a assinatura aceita o desafio aberto.
    const signature = await app.call("/api/album/upload-signature", {
      method: "POST",
      cookie: guestCookie,
      body: {
        category: "Festa",
        challengeId: alianca.id,
        contentHash: "b".repeat(64),
        fileName: "alianca.jpg",
        fileType: "image/jpeg",
        fileSize: 1_000_000,
      },
    });
    assert.equal(signature.status, 200, JSON.stringify(signature.body));

    const proof = (guestName, challengeId) => supabase.insert("album_media", {
      guest_name: guestName,
      category: "Festa",
      storage_provider: "r2",
      storage_key: `gab-naia/album/originals/${Math.random().toString(16).slice(2)}.jpg`,
      resource_type: "image",
      mime_type: "image/jpeg",
      bytes: 1000,
      backup_status: "pending",
      challenge_id: challengeId,
    });
    proof("Tainá Antunes", noivo.id);
    proof("Livia Fernandes", alianca.id);
    proof("Livia Fernandes", alianca.id); // segunda prova do mesmo desafio não soma
    proof("Maria Nova Silva", alianca.id);
    proof("Livia Fernandes", noivo.id);
    const lateMedia = proof("Maria Nova Silva", noivo.id);

    const board = (await app.call("/api/album/challenges", { cookie: guestCookie })).body;
    assert.equal(board.totalPoints, 4);
    assert.deepEqual(
      board.leaderboard.map(({ guestName, points, rank }) => [rank, guestName, points]),
      [[1, "Livia Fernandes", 4], [2, "Maria Nova Silva", 4], [3, "Tainá Antunes", 1]],
    );
    assert.deepEqual(board.me, { points: 4, completed: 2, rank: 1 });
    assert.equal(board.challenges.find((challenge) => challenge.id === alianca.id).completedCount, 2);
    assert.equal(board.challenges.every((challenge) => challenge.completedByMe), true);
    assert.equal("withoutRsvp" in board.leaderboard[0], false);

    const coupleBoard = (await app.call("/api/album/challenges", { cookie: coupleCookie })).body;
    assert.deepEqual(
      coupleBoard.leaderboard.map((entry) => [entry.guestName, entry.withoutRsvp]),
      [["Livia Fernandes", false], ["Maria Nova Silva", true], ["Tainá Antunes", false]],
    );

    // "Não vale para o desafio": a foto sai do desafio e a pontuação cai.
    const unlink = await app.call(`/api/album/media/${lateMedia.id}/challenge`, {
      method: "PATCH",
      body: { challengeId: null },
      cookie: coupleCookie,
    });
    assert.equal(unlink.status, 200);
    assert.equal(unlink.body.media.challengeId, null);
    const afterUnlink = (await app.call("/api/album/challenges", { cookie: guestCookie })).body;
    assert.deepEqual(afterUnlink.leaderboard.find((entry) => entry.guestName === "Maria Nova Silva").points, 3);

    // Encerrado: não aceita novas fotos, mas os pontos continuam.
    const close = await app.call(`/api/album/challenges/${alianca.id}`, {
      method: "PATCH",
      body: { active: false },
      cookie: coupleCookie,
    });
    assert.equal(close.status, 200);
    assert.equal(close.body.challenge.active, false);
    const closedUpload = await app.call("/api/album/upload-signature", {
      method: "POST",
      cookie: guestCookie,
      body: {
        category: "Festa",
        challengeId: alianca.id,
        contentHash: "c".repeat(64),
        fileName: "alianca2.jpg",
        fileType: "image/jpeg",
        fileSize: 1_000_000,
      },
    });
    assert.equal(closedUpload.status, 409);
    const afterClose = (await app.call("/api/album/challenges", { cookie: guestCookie })).body;
    assert.equal(afterClose.me.points, 4);

    // Excluído: a foto fica no álbum, mas para de contar.
    const remove = await app.call(`/api/album/challenges/${alianca.id}`, { method: "DELETE", cookie: coupleCookie });
    assert.equal(remove.status, 200);
    const afterDelete = (await app.call("/api/album/challenges", { cookie: guestCookie })).body;
    assert.equal(afterDelete.totalPoints, 1);
    assert.equal(afterDelete.me.points, 1);
    assert.equal(supabase.state.album_media.length, 6);

    const media = (await app.call("/api/album/media", { cookie: guestCookie })).body.media;
    assert.equal(media.length, 6);
    assert.equal(media.filter((item) => item.challengeId === noivo.id).length, 2);
  });

  test("convidado vê só os 10 primeiros do ranking; os noivos veem todos", async () => {
    const challenge = (await app.call("/api/album/challenges", {
      method: "POST",
      body: { title: "Foto com a noiva", points: 1 },
      cookie: coupleCookie,
    })).body.challenge;
    for (let index = 0; index < 12; index += 1) {
      supabase.insert("album_media", {
        guest_name: `Convidado Numero${String(index).padStart(2, "0")}`,
        category: "Festa",
        storage_provider: "r2",
        storage_key: `gab-naia/album/originals/extra-${index}.jpg`,
        resource_type: "image",
        mime_type: "image/jpeg",
        bytes: 1000,
        backup_status: "pending",
        challenge_id: challenge.id,
      });
    }
    const guestCookie = (await enter(app, "Joice de Paula Silva", "list")).sessionCookie;
    const guestBoard = (await app.call("/api/album/challenges", { cookie: guestCookie })).body;
    assert.equal(guestBoard.leaderboard.length, 10);
    assert.equal(guestBoard.me.rank, null);
    const coupleBoard = (await app.call("/api/album/challenges", { cookie: coupleCookie })).body;
    assert.ok(coupleBoard.leaderboard.length > 10);
  });
});
