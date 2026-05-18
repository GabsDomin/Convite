import { createReadStream, existsSync, statSync } from "node:fs";
import { createServer } from "node:http";
import { extname, join, normalize, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { createClient } from "@supabase/supabase-js";
import WebSocket from "ws";

const __dirname = fileURLToPath(new URL(".", import.meta.url));
const root = resolve(__dirname);
const port = Number(process.env.PORT || 3000);
const supabaseUrl = process.env.SUPABASE_URL;
const supabaseKey = process.env.SUPABASE_ANON_KEY;
const supabase = supabaseUrl && supabaseKey
  ? createClient(supabaseUrl, supabaseKey, {
      realtime: {
        transport: WebSocket,
      },
    })
  : null;

const mimeTypes = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "application/javascript; charset=utf-8",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".webp": "image/webp",
  ".mp3": "audio/mpeg",
  ".ico": "image/x-icon",
};

function resolveRequestPath(url) {
  const pathname = decodeURIComponent(new URL(url, `http://localhost:${port}`).pathname);
  const cleanPath = normalize(pathname).replace(/^(\.\.[/\\])+/, "");
  const requestedPath = cleanPath === "/" || cleanPath === "\\" ? "index.html" : cleanPath.replace(/^[/\\]/, "");
  const filePath = resolve(join(root, requestedPath));

  if (!filePath.startsWith(root)) return null;
  return filePath;
}

function sendJson(response, statusCode, payload) {
  response.writeHead(statusCode, {
    "Content-Type": "application/json; charset=utf-8",
    "Cache-Control": "no-store",
  });
  response.end(JSON.stringify(payload));
}

async function readJsonBody(request) {
  const chunks = [];
  for await (const chunk of request) chunks.push(chunk);
  const rawBody = Buffer.concat(chunks).toString("utf8");
  return rawBody ? JSON.parse(rawBody) : {};
}

function normalizeGift(gift) {
  return {
    id: gift.id,
    type: gift.gift_type,
    section: gift.section,
    name: gift.name,
    value: gift.value,
    goal: gift.goal,
    options: gift.quota_options,
    category: gift.category,
    text: gift.description,
    status: gift.status,
  };
}

async function handleApi(request, response, pathname) {
  if (!supabase) {
    sendJson(response, 503, { error: "Supabase não está configurado no Railway." });
    return true;
  }

  try {
    if (request.method === "GET" && pathname === "/api/gifts") {
      const { data, error } = await supabase.rpc("get_public_gifts");
      if (error) throw error;
      sendJson(response, 200, { gifts: data.map(normalizeGift) });
      return true;
    }

    if (request.method === "GET" && pathname === "/api/config") {
      sendJson(response, 200, {
        supabaseUrl,
        supabaseAnonKey: supabaseKey,
      });
      return true;
    }

    if (request.method === "POST" && pathname === "/api/rsvp") {
      const body = await readJsonBody(request);
      const { data, error } = await supabase.rpc("confirm_rsvp", {
        p_guest_name: body.guestName,
        p_party_size: body.partySize,
      });
      if (error) throw error;
      sendJson(response, 200, { rsvp: data?.[0] });
      return true;
    }

    if (request.method === "POST" && pathname === "/api/gifts/reserve") {
      const body = await readJsonBody(request);
      const { data, error } = await supabase.rpc("reserve_gift", {
        p_gift_id: body.giftId,
        p_guest_name: body.guestName,
        p_amount: body.amount ?? null,
      });
      if (error) throw error;
      sendJson(response, 200, { reservation: data?.[0] });
      return true;
    }

    return false;
  } catch (error) {
    sendJson(response, 400, { error: error.message || "Erro ao processar solicitação." });
    return true;
  }
}

createServer(async (request, response) => {
  const pathname = new URL(request.url || "/", `http://localhost:${port}`).pathname;

  if (pathname.startsWith("/api/")) {
    const handled = await handleApi(request, response, pathname);
    if (handled) return;
  }

  const filePath = resolveRequestPath(request.url || "/");

  if (!filePath || !existsSync(filePath) || !statSync(filePath).isFile()) {
    response.writeHead(404, { "Content-Type": "text/plain; charset=utf-8" });
    response.end("Arquivo não encontrado");
    return;
  }

  response.writeHead(200, {
    "Content-Type": mimeTypes[extname(filePath).toLowerCase()] || "application/octet-stream",
    "Cache-Control": "public, max-age=3600",
  });
  createReadStream(filePath).pipe(response);
}).listen(port, () => {
  console.log(`Convite rodando na porta ${port}`);
});
