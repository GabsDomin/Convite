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

export function createFakeSupabase({ tables = {}, passwords = {} } = {}) {
  const state = {
    rsvps: [],
    album_guests: [],
    album_challenges: [],
    album_media: [],
    restricted_guests: [],
    rsvp_remember_tokens: [],
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

  const server = createServer(async (request, response) => {
    const url = new URL(request.url, "http://127.0.0.1");
    const chunks = [];
    for await (const chunk of request) chunks.push(chunk);
    const body = chunks.length ? JSON.parse(Buffer.concat(chunks).toString("utf8")) : null;

    const rpcMatch = url.pathname.match(/^\/rest\/v1\/rpc\/([a-z_]+)$/);
    if (rpcMatch) {
      if (rpcMatch[1] !== "authenticate_album_guest") return send(response, 404, { message: "RPC não simulada." });
      const [status, payload] = authenticate(body || {});
      return send(response, status, payload);
    }

    const table = url.pathname.match(/^\/rest\/v1\/([a-z_]+)$/)?.[1];
    if (!table || !state[table]) return send(response, 404, { message: `Tabela ${table} não existe.` });
    const params = Array.from(url.searchParams.entries());

    if (request.method === "GET") {
      let rows = state[table].filter((row) => matches(row, params));
      const limit = Number(url.searchParams.get("limit"));
      if (limit) rows = rows.slice(0, limit);
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
