import { createReadStream, existsSync, statSync } from "node:fs";
import { createServer } from "node:http";
import { extname, join, normalize, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = fileURLToPath(new URL(".", import.meta.url));
const root = resolve(__dirname);
const port = Number(process.env.PORT || 3000);

function firstEnv(...names) {
  for (const name of names) {
    const value = process.env[name];
    if (value) return value;
  }

  return "";
}

const supabaseUrl = firstEnv(
  "SUPABASE_URL",
  "VITE_SUPABASE_URL",
  "NEXT_PUBLIC_SUPABASE_URL",
  "PUBLIC_SUPABASE_URL",
);
const supabaseKey = firstEnv(
  "SUPABASE_ANON_KEY",
  "SUPABASE_KEY",
  "VITE_SUPABASE_ANON_KEY",
  "NEXT_PUBLIC_SUPABASE_ANON_KEY",
  "PUBLIC_SUPABASE_ANON_KEY",
);
const infinityPayCardUrl = process.env.INFINITY_PAY_CARD_URL || "";
const hasSupabaseConfig = Boolean(supabaseUrl && supabaseKey);

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

const noCacheExtensions = new Set([".html", ".css", ".js"]);

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

async function callSupabaseRpc(functionName, payload = {}) {
  const endpoint = new URL(`/rest/v1/rpc/${functionName}`, supabaseUrl);
  const supabaseResponse = await fetch(endpoint, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "apikey": supabaseKey,
      "Authorization": `Bearer ${supabaseKey}`,
    },
    body: JSON.stringify(payload),
  });
  const responseText = await supabaseResponse.text();
  const data = responseText ? JSON.parse(responseText) : null;

  if (!supabaseResponse.ok) {
    const message = data?.message || data?.error_description || data?.hint || "Erro ao chamar o Supabase.";
    throw new Error(message);
  }

  return data;
}

async function readSupabaseTable(path) {
  const endpoint = new URL(`/rest/v1/${path}`, supabaseUrl);
  const supabaseResponse = await fetch(endpoint, {
    headers: {
      "apikey": supabaseKey,
      "Authorization": `Bearer ${supabaseKey}`,
    },
  });
  const responseText = await supabaseResponse.text();
  const data = responseText ? JSON.parse(responseText) : null;

  if (!supabaseResponse.ok) {
    const message = data?.message || data?.error_description || data?.hint || "Erro ao ler o Supabase.";
    throw new Error(message);
  }

  return data;
}

async function getPublicGifts() {
  try {
    return readSupabaseTable("gifts?select=id,name,gift_type,section,category,description,value,goal,quota_options,status,sort_order&status=neq.hidden&order=sort_order.asc,name.asc");
  } catch (tableError) {
    try {
      return await callSupabaseRpc("get_public_gifts");
    } catch (rpcError) {
      throw new Error(`Tabela gifts: ${tableError.message}. RPC get_public_gifts: ${rpcError.message}`);
    }
  }
}

function normalizeGift(gift) {
  const quotaOptions = Array.isArray(gift.quota_options)
    ? gift.quota_options
    : [];

  return {
    id: gift.id,
    type: gift.gift_type,
    section: gift.section,
    name: gift.name,
    value: Number(gift.value || 0),
    goal: Number(gift.goal || 0),
    options: quotaOptions.map(Number),
    category: gift.category,
    text: gift.description,
    status: gift.status,
  };
}

async function handleApi(request, response, pathname) {
  if (request.method === "GET" && pathname === "/api/config") {
    sendJson(response, 200, {
      supabaseUrl: supabaseUrl || "",
      supabaseAnonKey: supabaseKey || "",
      supabaseConfigured: hasSupabaseConfig,
      infinityPayCardUrl,
    });
    return true;
  }

  if (!hasSupabaseConfig) {
    sendJson(response, 503, { error: "Supabase nao esta configurado no servidor." });
    return true;
  }

  try {
    if (request.method === "GET" && pathname === "/api/gifts") {
      const gifts = await getPublicGifts();
      sendJson(response, 200, { gifts: gifts.map(normalizeGift) });
      return true;
    }

    if (request.method === "POST" && pathname === "/api/rsvp") {
      const body = await readJsonBody(request);
      const rsvp = await callSupabaseRpc("confirm_rsvp", {
        p_guest_name: body.guestName,
        p_party_size: body.partySize,
      });
      sendJson(response, 200, { rsvp: rsvp?.[0] });
      return true;
    }

    if (request.method === "POST" && pathname === "/api/gifts/reserve") {
      const body = await readJsonBody(request);
      const reservation = await callSupabaseRpc("reserve_gift", {
        p_gift_id: body.giftId,
        p_guest_name: body.guestName,
        p_amount: body.amount ?? null,
      });
      sendJson(response, 200, { reservation: reservation?.[0] });
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

  const extension = extname(filePath).toLowerCase();

  response.writeHead(200, {
    "Content-Type": mimeTypes[extension] || "application/octet-stream",
    "Cache-Control": noCacheExtensions.has(extension)
      ? "no-cache, no-store, must-revalidate"
      : "public, max-age=31536000, immutable",
  });
  createReadStream(filePath).pipe(response);
}).listen(port, () => {
  console.log(`Convite rodando na porta ${port}`);
});
