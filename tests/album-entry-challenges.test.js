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

  async function call(pathname, { method = "GET", body, cookie, host } = {}) {
    const response = await fetch(`${baseUrl}${pathname}`, {
      method,
      headers: {
        ...(body === undefined ? {} : { "Content-Type": "application/json" }),
        ...(cookie ? { Cookie: cookie } : {}),
        ...(host ? { "X-Forwarded-Host": host } : {}),
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
    assert.deepEqual((await app.call("/api/album/guests?q=h")).body.guests, ["Halanaia Vitória"]);
    assert.deepEqual((await app.call("/api/album/guests?q=l")).body.guests, []);
    assert.deepEqual((await app.call("/api/album/guests?q=livia")).body.guests, []);

    const guest = await enter(app, "Livia Fernandes", "list");
    assert.equal(guest.status, 403);
    assert.match(guest.body.error, /28\/11/);
    assert.equal(guest.sessionCookie, null);

    const created = await enter(app, "Pessoa Nova Teste", "new");
    assert.equal(created.status, 403);
    assert.equal(supabase.state.album_guests.length, 0);
  });

  test("ambiente de teste: pelo endereço de teste o álbum já está liberado; pelo normal, não", async () => {
    const testHost = "gab-naia-teste.vercel.app";
    const config = (await app.call("/api/config", { host: testHost })).body;
    assert.equal(config.albumPublicOpen, true);
    assert.equal(config.albumTestMode, true);
    assert.equal("albumTestMode" in (await app.call("/api/config")).body, false);

    assert.equal((await app.call("/api/album/entry", { host: testHost })).body.publicOpen, true);
    assert.deepEqual((await app.call("/api/album/guests?q=livia", { host: testHost })).body.guests, ["Livia de Paula", "Livia Fernandes"]);

    const guest = await app.call("/api/album/enter", { method: "POST", body: { guestName: "Livia Fernandes", source: "list" }, host: testHost });
    assert.equal(guest.status, 200);
    const session = (await app.call("/api/album/session", { cookie: guest.sessionCookie, host: testHost })).body;
    assert.equal(session.albumAvailable, true);
    assert.equal(session.albumTestMode, true);
    assert.equal((await app.call("/api/album/media", { cookie: guest.sessionCookie, host: testHost })).status, 200);

    // Ranking de exemplo só no ambiente de teste, com o noivo em 1º.
    const testBoard = (await app.call("/api/album/challenges", { cookie: guest.sessionCookie, host: testHost })).body;
    assert.deepEqual(testBoard.leaderboard.slice(0, 3).map(({ rank, guestName, points, demo }) => [rank, guestName, points, demo]), [
      [1, "Gabriel Domingues", 83, true],
      [2, "Ana Exemplo", 77, true],
      [3, "Bruno Exemplo", 52, true],
    ]);
    assert.equal(supabase.state.album_media.length, 0, "o exemplo não grava nada no banco");

    // A mesma sessão, pelo endereço normal, continua barrada até a data.
    assert.equal((await app.call("/api/album/media", { cookie: guest.sessionCookie })).status, 403);
    assert.equal((await app.call("/api/album/entry")).body.publicOpen, false);
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

  test("busca sugere desde a 1ª letra, ignora acento e caixa e acha por sobrenome", async () => {
    assert.deepEqual((await app.call("/api/album/guests?q=%20")).body.guests, []);
    assert.deepEqual((await app.call("/api/album/guests?q=l")).body.guests, ["Livia de Paula", "Livia Fernandes"]);
    assert.deepEqual((await app.call("/api/album/guests?q=t")).body.guests, ["Tainá Antunes"]);
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

  function proof(guestName, challengeId, label = Math.random().toString(16).slice(2)) {
    return supabase.insert("album_media", {
      guest_name: guestName,
      category: "Festa",
      storage_provider: "r2",
      storage_key: `gab-naia/album/originals/${label}.jpg`,
      resource_type: "image",
      mime_type: "image/jpeg",
      bytes: 1000,
      backup_status: "pending",
      challenge_id: challengeId,
    });
  }

  async function createChallenge(body) {
    const response = await app.call("/api/album/challenges", { method: "POST", body, cookie: coupleCookie });
    assert.equal(response.status, 201, JSON.stringify(response.body));
    return response.body.challenge;
  }

  const board = async (cookie) => (await app.call("/api/album/challenges", { cookie })).body;
  const signature = (cookie, challengeId, hash) => app.call("/api/album/upload-signature", {
    method: "POST",
    cookie,
    body: { category: "Festa", challengeId, contentHash: hash, fileName: "foto.jpg", fileType: "image/jpeg", fileSize: 1_000_000 },
  });

  test("desafios: sorteio de 1 fácil, 1 médio e 1 difícil, pontos por dificuldade e ranking", async () => {
    const livia = (await enter(app, "Livia Fernandes", "list")).sessionCookie;
    const maria = (await enter(app, "Maria Nova Silva", "list")).sessionCookie;
    const taina = (await enter(app, "Tainá Antunes", "list")).sessionCookie;

    const forbidden = await app.call("/api/album/challenges", { method: "POST", body: { title: "O bolo" }, cookie: livia });
    assert.equal(forbidden.status, 403);
    const invalid = await app.call("/api/album/challenges", {
      method: "POST",
      body: { title: "Foto inválida", difficulty: "impossível" },
      cookie: coupleCookie,
    });
    assert.equal(invalid.status, 400);

    // Um desafio por dificuldade: o sorteio é determinístico e todos recebem os três.
    const easy = await createChallenge({ title: "O bolo", difficulty: "easy" });
    const medium = await createChallenge({ title: "Selfie com a mesa", difficulty: "medium" });
    const hard = await createChallenge({ title: "Foto de pulo", difficulty: "hard" });
    assert.deepEqual([easy.points, medium.points, hard.points], [1, 2, 3]);

    for (const cookie of [livia, maria, taina]) {
      const mine = await board(cookie);
      assert.deepEqual(mine.challenges.map((challenge) => challenge.difficulty).sort(), ["easy", "hard", "medium"]);
      assert.equal(mine.me.swapsLeft, 1);
    }
    assert.equal(supabase.state.album_challenge_assignments.length, 9);
    // Abrir de novo não sorteia mais nada.
    await board(livia);
    assert.equal(supabase.state.album_challenge_assignments.length, 9);

    const coupleView = await board(coupleCookie);
    assert.equal(coupleView.challenges.length, 3);
    assert.deepEqual(coupleView.challenges.map((challenge) => challenge.assignedCount), [3, 3, 3]);
    assert.equal(coupleView.me.swapsLeft, 0);

    assert.equal((await signature(livia, hard.id, "b".repeat(64))).status, 200);

    proof("Tainá Antunes", easy.id);
    proof("Livia Fernandes", hard.id);
    proof("Livia Fernandes", hard.id); // segunda prova do mesmo desafio não soma
    proof("Maria Nova Silva", hard.id);
    proof("Livia Fernandes", easy.id);
    const lateMedia = proof("Maria Nova Silva", easy.id);

    // Pontuação = desafios (fácil 10, médio 20, difícil 30) + rapidez (+3/+2/+1 por desafio) + fotos (1 cada, até 15).
    // Livia: 30 + 10 | 1ª no difícil (+3), 2ª no fácil (+2) | 3 fotos = 48
    // Maria: 30 + 10 | 2ª no difícil (+2), 3ª no fácil (+1) | 2 fotos = 45
    // Tainá: 10      | 1ª no fácil (+3)                    | 1 foto  = 14
    const result = await board(livia);
    assert.deepEqual(
      result.leaderboard.map(({ guestName, points, rank }) => [rank, guestName, points]),
      [[1, "Livia Fernandes", 48], [2, "Maria Nova Silva", 45], [3, "Tainá Antunes", 14]],
    );
    assert.deepEqual(result.me, {
      points: 48,
      completed: 2,
      challengePoints: 40,
      speedBonus: 5,
      photos: 3,
      photoPoints: 3,
      rank: 1,
      swapsLeft: 1,
    });
    assert.deepEqual(result.rules, {
      pointsPerChallengePoint: 10,
      speedBonuses: [3, 2, 1],
      pointsPerPhoto: 1,
      maxPhotoPoints: 15,
      difficultyPoints: { easy: 1, medium: 2, hard: 3 },
    });
    assert.equal(result.challenges.find((challenge) => challenge.id === hard.id).completedCount, 2);
    assert.equal("withoutRsvp" in result.leaderboard[0], false);

    const coupleBoard = await board(coupleCookie);
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
    // Maria perde o fácil (10) e o bônus de 3ª (+1), mas a foto continua contando.
    assert.equal((await board(livia)).leaderboard.find((entry) => entry.guestName === "Maria Nova Silva").points, 34);

    // Encerrado: não aceita novas fotos, mas os pontos continuam.
    const close = await app.call(`/api/album/challenges/${hard.id}`, {
      method: "PATCH",
      body: { active: false },
      cookie: coupleCookie,
    });
    assert.equal(close.status, 200);
    assert.equal(close.body.challenge.active, false);
    assert.equal((await signature(livia, hard.id, "c".repeat(64))).status, 409);
    assert.equal((await board(livia)).me.points, 48);

    // Excluído: a foto fica no álbum, mas para de contar.
    const remove = await app.call(`/api/album/challenges/${hard.id}`, { method: "DELETE", cookie: coupleCookie });
    assert.equal(remove.status, 200);
    // Livia fica com o fácil (10), 2ª no fácil (+2) e 3 fotos = 15.
    assert.equal((await board(livia)).me.points, 15);
    assert.equal(supabase.state.album_media.length, 6);
    const media = (await app.call("/api/album/media", { cookie: livia })).body.media;
    assert.equal(media.filter((item) => item.challengeId === easy.id).length, 2);

    // Desafio que não foi sorteado para a pessoa: não aceita foto nem conta ponto.
    const otherEasy = await createChallenge({ title: "A lembrancinha", difficulty: "easy" });
    assert.equal((await signature(livia, otherEasy.id, "d".repeat(64))).status, 403);
    proof("Livia Fernandes", otherEasy.id);
    assert.equal((await board(livia)).me.points, 16); // só +1 da foto

    // Desafio "para todos": aparece para todo mundo, além dos sorteados.
    const everyone = await createChallenge({ title: "Brinde geral", difficulty: "medium", scope: "all" });
    const withEveryone = await board(taina);
    assert.ok(withEveryone.challenges.some((challenge) => challenge.id === everyone.id));
    assert.equal((await signature(taina, everyone.id, "e".repeat(64))).status, 200);
  });

  test("troca: só 1 por convidado, só de desafio não completado e por outro da mesma dificuldade", async () => {
    await createChallenge({ title: "Coração com as mãos", difficulty: "medium" });
    const joice = (await enter(app, "Joice de Paula Silva", "list")).sessionCookie;
    const before = await board(joice);
    const myMedium = before.challenges.find((challenge) => challenge.difficulty === "medium" && challenge.scope === "draw");
    assert.ok(myMedium);

    const swapped = await app.call(`/api/album/challenges/${myMedium.id}/swap`, { method: "POST", cookie: joice });
    assert.equal(swapped.status, 200, JSON.stringify(swapped.body));
    const newMedium = swapped.body.challenges.find((challenge) => challenge.difficulty === "medium" && challenge.scope === "draw");
    assert.ok(newMedium, "deveria receber outro médio no lugar");
    assert.notEqual(newMedium.id, myMedium.id);
    assert.equal(swapped.body.me.swapsLeft, 0);

    const secondSwap = await app.call(`/api/album/challenges/${newMedium.id}/swap`, { method: "POST", cookie: joice });
    assert.equal(secondSwap.status, 409);
    assert.match(secondSwap.body.error, /já usou/i);

    // Livia já completou o fácil: não pode trocar.
    const livia = (await enter(app, "Livia Fernandes", "list")).sessionCookie;
    const liviaEasy = (await board(livia)).challenges.find((challenge) => challenge.completedByMe);
    const blocked = await app.call(`/api/album/challenges/${liviaEasy.id}/swap`, { method: "POST", cookie: livia });
    assert.equal(blocked.status, 409);
    assert.match(blocked.body.error, /já completou/i);
  });

  test("desafios com os noivos: no máximo 1 por convidado e respeitando o limite de pessoas", async () => {
    const coupleEasy = await createChallenge({ title: "Os noivos de longe", difficulty: "easy", couple: true, maxAssignees: 2 });
    const coupleMedium = await createChallenge({ title: "Foto com a noiva", difficulty: "medium", couple: true });
    // O difícil do teste anterior foi excluído; sem um difícil ativo não há o que sortear.
    await createChallenge({ title: "Três gerações juntas", difficulty: "hard" });
    // Registrar o casamento do próprio lugar: sem limite, garante 1 para todos quando os 💍 esgotam.
    const ceremony = await createChallenge({ title: "A troca de alianças", difficulty: "medium", wedding: true });
    assert.equal(ceremony.wedding, true);
    assert.equal(coupleEasy.wedding, true); // ir até os noivos também é registrar o casamento
    assert.equal(coupleEasy.maxAssignees, 2);
    assert.equal(coupleMedium.maxAssignees, 4); // padrão para desafios com os noivos

    // Acesso criado pelo "Não achei meu nome" já sai com os 3 desafios, sem precisar abrir o álbum.
    for (let index = 0; index < 6; index += 1) {
      await enter(app, `Convidado Sorteio${index}`, "new");
      const mine = supabase.state.album_challenge_assignments
        .filter((row) => row.guest_key === `convidado sorteio${index}` && row.active);
      assert.equal(mine.length, 3, `Convidado Sorteio${index} deveria ter 3 desafios`);
    }
    const challengeById = new Map(supabase.state.album_challenges.map((challenge) => [challenge.id, challenge]));
    const activeRows = supabase.state.album_challenge_assignments.filter((row) => row.active);
    assert.ok(activeRows.filter((row) => row.challenge_id === coupleEasy.id).length <= 2);
    assert.ok(activeRows.filter((row) => row.challenge_id === coupleMedium.id).length <= 4);
    const couplePerGuest = new Map();
    for (const row of activeRows) {
      if (!challengeById.get(row.challenge_id)?.couple) continue;
      couplePerGuest.set(row.guest_key, (couplePerGuest.get(row.guest_key) || 0) + 1);
    }
    assert.ok(couplePerGuest.size > 0, "algum convidado deveria receber desafio com os noivos");
    assert.ok([...couplePerGuest.values()].every((count) => count === 1));
    for (let index = 0; index < 6; index += 1) {
      const weddingCount = activeRows
        .filter((row) => row.guest_key === `convidado sorteio${index}`)
        .filter((row) => challengeById.get(row.challenge_id)?.wedding).length;
      assert.ok(weddingCount >= 1, `Convidado Sorteio${index} deveria ter 1 desafio de registrar o casamento`);
    }
  });

  test("ranking e desafios passam do limite de 1000 linhas por consulta do Supabase", async () => {
    // Mais de 1000 fotos: o servidor precisa paginar, senão o ranking para de contar.
    for (let index = 0; index < 1100; index += 1) proof("Convidado Volume", null, `volume-${index}`);
    const late = await createChallenge({ title: "Desafio criado por último", difficulty: "easy", scope: "all" });
    proof("Convidado Volume", late.id, "volume-desafio");
    const cookie = (await enter(app, "Convidado Volume", "new")).sessionCookie;
    const mine = (await board(cookie)).me;
    assert.equal(mine.photos, 1101);
    assert.equal(mine.completed >= 1, true, "a foto mais recente (depois da milésima) deveria contar o desafio");
  });

  test("fotos têm teto de 15 pontos e todos veem o ranking completo", async () => {
    const taina = (await enter(app, "Tainá Antunes", "list")).sessionCookie;
    const before = (await board(taina)).me;
    for (let index = 0; index < 20; index += 1) proof("Tainá Antunes", null, `spam-${index}`);
    const after = (await board(taina)).me;
    assert.equal(after.photos, before.photos + 20);
    assert.equal(after.photoPoints, 15);
    assert.equal(after.points - after.photoPoints, before.points - before.photoPoints);

    for (let index = 0; index < 12; index += 1) proof(`Convidado Foto${String(index).padStart(2, "0")}`, null, `extra-${index}`);
    const joice = (await enter(app, "Joice de Paula Silva", "list")).sessionCookie;
    const guestBoard = await board(joice);
    assert.equal(guestBoard.me.rank, null);
    assert.equal(guestBoard.leaderboard.some((entry) => "withoutRsvp" in entry), false);
    const coupleBoard = await board(coupleCookie);
    assert.equal(guestBoard.leaderboard.length, coupleBoard.leaderboard.length);
    assert.ok(guestBoard.leaderboard.length > 12);
  });
});
