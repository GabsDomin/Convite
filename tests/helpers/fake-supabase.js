// Supabase falso em memória para os testes de ponta a ponta do álbum.
// Implementa só o pedaço do PostgREST que o servidor usa: filtros eq / not.is.null,
// insert, update, delete e a RPC authenticate_album_guest.
import { randomUUID } from "node:crypto";
import { createServer } from "node:http";

function stripAccents(value) {
  return String(value || "").normalize("NFD").replace(/[̀-ͯ]/g, "");
}

// Igual à coluna gerada do banco real: minúsculas e espaços simples, mantendo acentos.
export function rsvpColumnName(name) {
  return String(name || "").trim().replace(/\s+/g, " ").toLowerCase();
}

export function createFakeSupabase({ tables = {}, passwords = {}, maxRows = 1000 } = {}) {
  const state = {
    rsvps: [],
    album_guests: [],
    album_challenges: [],
    album_media: [],
    restricted_guests: [],
    rsvp_remember_tokens: [],
    album_challenge_assignments: [],
    ...structuredClone(tables),
  };
  let clock = Date.parse("2026-11-28T18:00:00Z");
  const nextTimestamp = () => new Date((clock += 1000)).toISOString();

  const uniqueColumns = {
    album_guests: ["normalized_guest_name"],
    album_media: ["content_hash", "storage_key"],
  };

  function matches(row, params) {
    for (const [column, raw] of params) {
      if (["select", "order", "limit", "offset"].includes(column)) continue;
      if (raw.startsWith("eq.")) {
        const expected = raw.slice(3);
        if (String(row[column] ?? "") !== expected) return false;
      } else if (raw === "not.is.null") {
        if (row[column] == null) return false;
      } else if (raw === "is.null") {
        if (row[column] != null) return false;
      } else {
        throw new Error(`Filtro não suportado no Supabase falso: ${column}=${raw}`);
      }
    }
    return true;
  }

  function prepareRow(table, payload) {
    const row = { id: randomUUID(), created_at: nextTimestamp(), ...payload };
    if (table === "rsvps") row.normalized_guest_name = rsvpColumnName(row.guest_name);
    if (table === "album_challenges") {
      row.active ??= true;
      row.points ??= 1;
      row.sort_order ??= 0;
      row.scope ??= "draw";
      row.difficulty ??= "easy";
      row.couple ??= false;
      row.wedding ??= false;
      row.max_assignees ??= null;
    }
    if (table === "album_challenge_assignments") {
      row.active ??= true;
      row.swapped ??= false;
    }
    if (table === "album_media") row.challenge_id ??= null;
    for (const column of uniqueColumns[table] || []) {
      if (row[column] != null && state[table].some((existing) => existing[column] === row[column])) {
        return { conflict: column };
      }
    }
    return { row };
  }

  function send(response, status, payload) {
    response.writeHead(status, { "Content-Type": "application/json" });
    response.end(payload === undefined ? "" : JSON.stringify(payload));
  }

  function authenticate({ p_guest_name: guestName, p_password: password }) {
    const key = stripAccents(rsvpColumnName(guestName));
    const row = state.rsvps.find((candidate) => stripAccents(candidate.normalized_guest_name) === key);
    if (!row) return [400, { message: "Nome não encontrado nas confirmações de presença." }];
    if (passwords[row.guest_name] !== password) return [400, { message: "Senha incorreta." }];
    return [200, [{ rsvp_id: row.id, guest_name: row.guest_name }]];
  }

  // Mesma regra de supabase-album-challenge-draw.sql: 1 desafio ativo por dificuldade,
  // o menos sorteado primeiro, no máximo 1 com os noivos, respeitando max_assignees
  // e garantindo pelo menos 1 de registrar o casamento numa das dificuldades que faltam.
  function assignChallenges({ p_guest_key: guestKey, p_guest_name: guestName }) {
    const challengeById = new Map(state.album_challenges.map((challenge) => [challenge.id, challenge]));
    const activeRows = () => state.album_challenge_assignments.filter((row) => row.active);
    const mine = () => activeRows().filter((row) => row.guest_key === guestKey);
    const missingLevels = ["easy", "medium", "hard"].filter((level) => !mine().some((row) => {
      const challenge = challengeById.get(row.challenge_id);
      return challenge?.active && challenge.scope === "draw" && challenge.difficulty === level;
    })).sort(() => Math.random() - 0.5);
    for (const level of missingLevels) {
      const hasCouple = mine().some((row) => challengeById.get(row.challenge_id)?.couple);
      const hasWedding = mine().some((row) => challengeById.get(row.challenge_id)?.wedding);
      const used = (id) => activeRows().filter((row) => row.challenge_id === id).length;
      const pick = (onlyWedding) => state.album_challenges
        .filter((challenge) => challenge.active && challenge.scope === "draw" && challenge.difficulty === level)
        .filter((challenge) => !onlyWedding || challenge.wedding)
        .filter((challenge) => !state.album_challenge_assignments
          .some((row) => row.guest_key === guestKey && row.challenge_id === challenge.id))
        .filter((challenge) => !challenge.couple
          || (!hasCouple && (challenge.max_assignees == null || used(challenge.id) < challenge.max_assignees)))
        .sort((a, b) => used(a.id) - used(b.id))[0];
      const picked = (!hasWedding && pick(true)) || pick(false);
      if (picked) {
        prepareAndPush("album_challenge_assignments", { guest_key: guestKey, guest_name: guestName, challenge_id: picked.id });
      }
    }
    return [200, mine()];
  }

  function swapChallenge(body) {
    const { p_guest_key: guestKey, p_challenge_id: challengeId, p_max_swaps: maxSwaps = 1 } = body;
    const swaps = state.album_challenge_assignments.filter((row) => row.guest_key === guestKey && row.swapped).length;
    if (swaps >= maxSwaps) return [400, { message: "Você já usou sua troca de desafio." }];
    const row = state.album_challenge_assignments
      .find((candidate) => candidate.guest_key === guestKey && candidate.challenge_id === challengeId && candidate.active);
    if (!row) return [400, { message: "Este desafio não está entre os seus." }];
    row.active = false;
    row.swapped = true;
    return assignChallenges(body);
  }

  function prepareAndPush(table, payload) {
    const { row } = prepareRow(table, payload);
    state[table].push(row);
    return row;
  }

  const rpcHandlers = {
    authenticate_album_guest: authenticate,
    assign_album_challenges: assignChallenges,
    swap_album_challenge: swapChallenge,
  };

  const server = createServer(async (request, response) => {
    const url = new URL(request.url, "http://127.0.0.1");
    const chunks = [];
    for await (const chunk of request) chunks.push(chunk);
    const body = chunks.length ? JSON.parse(Buffer.concat(chunks).toString("utf8")) : null;

    const rpcMatch = url.pathname.match(/^\/rest\/v1\/rpc\/([a-z_]+)$/);
    if (rpcMatch) {
      const handler = rpcHandlers[rpcMatch[1]];
      if (!handler) return send(response, 404, { message: "RPC não simulada." });
      const [status, payload] = handler(body || {});
      return send(response, status, payload);
    }

    const table = url.pathname.match(/^\/rest\/v1\/([a-z_]+)$/)?.[1];
    if (!table || !state[table]) return send(response, 404, { message: `Tabela ${table} não existe.` });
    const params = Array.from(url.searchParams.entries());

    if (request.method === "GET") {
      // Como no Supabase: no máximo 1000 linhas por consulta, mesmo pedindo mais.
      const offset = Number(url.searchParams.get("offset")) || 0;
      const limit = Math.min(Number(url.searchParams.get("limit")) || maxRows, maxRows);
      const rows = state[table].filter((row) => matches(row, params)).slice(offset, offset + limit);
      return send(response, 200, rows);
    }
    if (request.method === "POST") {
      const inserted = [];
      for (const payload of Array.isArray(body) ? body : [body]) {
        const { row, conflict } = prepareRow(table, payload);
        if (conflict) {
          return send(response, 409, { message: `duplicate key value violates unique constraint "${table}_${conflict}_key"` });
        }
        state[table].push(row);
        inserted.push(row);
      }
      return send(response, 201, inserted);
    }
    if (request.method === "PATCH") {
      const updated = state[table].filter((row) => matches(row, params));
      updated.forEach((row) => Object.assign(row, body));
      return send(response, 200, updated);
    }
    if (request.method === "DELETE") {
      const deleted = state[table].filter((row) => matches(row, params));
      state[table] = state[table].filter((row) => !deleted.includes(row));
      if (table === "album_challenges") {
        const ids = new Set(deleted.map((row) => row.id));
        state.album_media.forEach((media) => {
          if (ids.has(media.challenge_id)) media.challenge_id = null;
        });
        state.album_challenge_assignments = state.album_challenge_assignments
          .filter((row) => !ids.has(row.challenge_id));
      }
      return send(response, 200, deleted);
    }
    return send(response, 405, { message: "Método não simulado." });
  });

  return {
    state,
    insert(table, payload) {
      const { row, conflict } = prepareRow(table, payload);
      if (conflict) throw new Error(`Conflito em ${table}.${conflict}`);
      state[table].push(row);
      return row;
    },
    async listen() {
      await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
      return `http://127.0.0.1:${server.address().port}`;
    },
    async close() {
      await new Promise((resolve) => server.close(resolve));
    },
  };
}
