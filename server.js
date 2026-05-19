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
const infinitePayHandle = firstEnv("INFINITEPAY_HANDLE", "INFINITYPAY_HANDLE");
const frontendUrl = firstEnv("FRONTEND_URL", "PUBLIC_FRONTEND_URL");
const backendUrl = firstEnv("BACKEND_URL", "PUBLIC_BACKEND_URL");
const hasSupabaseConfig = Boolean(supabaseUrl && supabaseKey);
const hasInfinitePayConfig = Boolean(infinitePayHandle);

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

function getRequestOrigin(request) {
  const host = request.headers.host || `localhost:${port}`;
  const protocol = request.headers["x-forwarded-proto"] || (host.includes("localhost") ? "http" : "https");
  return `${protocol}://${host}`;
}

function getPublicFrontendUrl(request) {
  return frontendUrl || getRequestOrigin(request);
}

function getPublicBackendUrl(request) {
  return backendUrl || getRequestOrigin(request);
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

async function createInfinitePayCheckout(order, request) {
  if (!hasInfinitePayConfig) {
    throw new Error("Pagamento por cartao ainda nao esta configurado.");
  }

  const amountInCents = Math.round(Number(order.amount) * 100);
  const checkoutResponse = await fetch("https://api.checkout.infinitepay.io/links", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      handle: infinitePayHandle,
      items: [
        {
          quantity: 1,
          price: amountInCents,
          description: order.gift_name,
        },
      ],
      order_nsu: String(order.id),
      redirect_url: `${getPublicFrontendUrl(request)}/pagamento/sucesso`,
      webhook_url: `${getPublicBackendUrl(request)}/api/webhooks/infinitepay`,
    }),
  });
  const responseText = await checkoutResponse.text();
  const data = responseText ? JSON.parse(responseText) : {};

  if (!checkoutResponse.ok) {
    await callSupabaseRpc("mark_infinitepay_order_error", {
      p_order_nsu: String(order.id),
      p_payload: data,
    }).catch(() => {});

    const message = data?.message || data?.error || "Erro ao criar link de pagamento na InfinitePay.";
    throw new Error(message);
  }

  const checkoutUrl = data.url || data.checkout_url || data.checkoutUrl || data.link;
  if (!checkoutUrl) {
    throw new Error("A InfinitePay nao retornou o link de pagamento.");
  }

  return checkoutUrl;
}

async function getPublicGifts() {
  try {
    return await callSupabaseRpc("get_public_gifts");
  } catch (rpcError) {
    try {
      return await readSupabaseTable("gifts?select=id,name,gift_type,section,category,description,value,goal,quota_options,status,sort_order&status=neq.hidden&order=sort_order.asc,name.asc");
    } catch (tableError) {
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
      infinitePayConfigured: hasInfinitePayConfig,
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

    const checkoutMatch = pathname.match(/^\/api\/presentes\/([^/]+)\/checkout-infinitepay$/);
    if (request.method === "POST" && checkoutMatch) {
      if (!hasInfinitePayConfig) {
        throw new Error("Pagamento por cartao ainda nao esta configurado.");
      }

      const body = await readJsonBody(request);
      const order = await callSupabaseRpc("create_infinitepay_order", {
        p_gift_id: decodeURIComponent(checkoutMatch[1]),
        p_guest_name: body.guestName,
        p_amount: body.amount ?? null,
      });
      if (!order?.[0]) {
        throw new Error("Nao foi possivel criar o pedido de pagamento.");
      }

      const checkoutUrl = await createInfinitePayCheckout(order[0], request);
      sendJson(response, 200, { checkoutUrl });
      return true;
    }

    if (request.method === "POST" && pathname === "/api/webhooks/infinitepay") {
      const body = await readJsonBody(request);
      await callSupabaseRpc("confirm_infinitepay_payment", {
        p_order_nsu: body.order_nsu,
        p_transaction_nsu: body.transaction_nsu ?? null,
        p_receipt_url: body.receipt_url ?? null,
        p_amount: body.amount ?? null,
        p_paid_amount: body.paid_amount ?? null,
        p_installments: body.installments ?? null,
        p_capture_method: body.capture_method ?? null,
        p_invoice_slug: body.invoice_slug ?? null,
        p_payload: body,
      });
      sendJson(response, 200, { ok: true });
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

  const filePath = pathname === "/pagamento/sucesso"
    ? resolve(join(root, "pagamento", "sucesso", "index.html"))
    : resolveRequestPath(request.url || "/");

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
