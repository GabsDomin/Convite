import { createReadStream, existsSync, statSync } from "node:fs";
import { createHmac, timingSafeEqual } from "node:crypto";
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
const mercadoPagoAccessToken = firstEnv("MERCADO_PAGO_ACCESS_TOKEN", "MP_ACCESS_TOKEN");
const mercadoPagoPublicKey = firstEnv("NEXT_PUBLIC_MERCADO_PAGO_PUBLIC_KEY", "MERCADO_PAGO_PUBLIC_KEY");
const mercadoPagoWebhookSecret = process.env.MERCADO_PAGO_WEBHOOK_SECRET || "";
const siteUrl = firstEnv("SITE_URL", "FRONTEND_URL", "PUBLIC_FRONTEND_URL");
const backendUrl = firstEnv("BACKEND_URL", "PUBLIC_BACKEND_URL", "SITE_URL");
const hasSupabaseConfig = Boolean(supabaseUrl && supabaseKey);
const hasMercadoPagoConfig = Boolean(mercadoPagoAccessToken);

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
  return siteUrl || getRequestOrigin(request);
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

function isValidEmail(value) {
  const email = String(value || "").trim();
  return !email || /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
}

function normalizeMercadoPagoStatus(status) {
  if (status === "approved") return "approved";
  if (["pending", "in_process", "in_mediation"].includes(status)) return "pending";
  if (status === "rejected") return "rejected";
  if (["cancelled", "refunded", "charged_back"].includes(status)) return "cancelled";
  return "pending";
}

function parseMercadoPagoSignature(headerValue) {
  return String(headerValue || "")
    .split(",")
    .map((part) => part.trim().split("="))
    .reduce((parts, [key, value]) => {
      if (key && value) parts[key] = value;
      return parts;
    }, {});
}

function validateMercadoPagoWebhookSignature(request, body) {
  if (!mercadoPagoWebhookSecret) return;

  const signature = parseMercadoPagoSignature(request.headers["x-signature"]);
  const requestId = request.headers["x-request-id"];
  const notificationUrl = new URL(request.url || "/", `http://localhost:${port}`);
  const dataId = notificationUrl.searchParams.get("data.id")
    || notificationUrl.searchParams.get("id")
    || body?.data?.id
    || body?.id;

  if (!signature.ts || !signature.v1 || !requestId || !dataId) {
    throw new Error("Assinatura do webhook Mercado Pago ausente.");
  }

  const manifest = `id:${String(dataId).toLowerCase()};request-id:${requestId};ts:${signature.ts};`;
  const expected = createHmac("sha256", mercadoPagoWebhookSecret)
    .update(manifest)
    .digest("hex");
  const expectedBuffer = Buffer.from(expected, "hex");
  const receivedBuffer = Buffer.from(signature.v1, "hex");

  if (
    expectedBuffer.length !== receivedBuffer.length
    || !timingSafeEqual(expectedBuffer, receivedBuffer)
  ) {
    throw new Error("Assinatura do webhook Mercado Pago invalida.");
  }
}

async function createMercadoPagoPreference(order, request) {
  if (!hasMercadoPagoConfig) {
    throw new Error("Pagamento por cartao ainda nao esta configurado.");
  }

  const publicFrontendUrl = getPublicFrontendUrl(request);
  const payer = order.buyer_email
    ? { name: order.buyer_name, email: order.buyer_email }
    : undefined;
  const preferenceResponse = await fetch("https://api.mercadopago.com/checkout/preferences", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "Authorization": `Bearer ${mercadoPagoAccessToken}`,
      "X-Idempotency-Key": String(order.id),
    },
    body: JSON.stringify({
      items: [
        {
          id: order.gift_id,
          title: order.gift_name,
          quantity: 1,
          unit_price: Number(order.amount),
          currency_id: "BRL",
        },
      ],
      ...(payer ? { payer } : {}),
      back_urls: {
        success: `${publicFrontendUrl}/pagamento/sucesso`,
        failure: `${publicFrontendUrl}/pagamento/erro`,
        pending: `${publicFrontendUrl}/pagamento/pendente`,
      },
      auto_return: "approved",
      external_reference: String(order.id),
      notification_url: `${getPublicBackendUrl(request)}/api/webhooks/mercadopago?source_news=webhooks`,
    }),
  });
  const responseText = await preferenceResponse.text();
  const data = responseText ? JSON.parse(responseText) : {};

  if (!preferenceResponse.ok) {
    await callSupabaseRpc("mark_mercadopago_order_error", {
      p_order_id: String(order.id),
      p_payload: data,
    }).catch(() => {});

    const message = data?.message || data?.error || "Erro ao criar preferencia no Mercado Pago.";
    throw new Error(message);
  }

  if (!data.init_point) {
    throw new Error("O Mercado Pago nao retornou o link de pagamento.");
  }

  await callSupabaseRpc("set_mercadopago_preference", {
    p_order_id: String(order.id),
    p_preference_id: data.id,
  });

  return data;
}

async function getMercadoPagoPayment(paymentId) {
  const paymentResponse = await fetch(`https://api.mercadopago.com/v1/payments/${encodeURIComponent(paymentId)}`, {
    headers: {
      "Authorization": `Bearer ${mercadoPagoAccessToken}`,
    },
  });
  const responseText = await paymentResponse.text();
  const data = responseText ? JSON.parse(responseText) : {};

  if (!paymentResponse.ok) {
    const message = data?.message || data?.error || "Erro ao consultar pagamento no Mercado Pago.";
    throw new Error(message);
  }

  return data;
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
      mercadoPagoConfigured: hasMercadoPagoConfig,
      mercadoPagoPublicKey,
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

    if (request.method === "POST" && pathname === "/api/mercadopago/create-preference") {
      if (!hasMercadoPagoConfig) {
        throw new Error("Pagamento por cartao ainda nao esta configurado.");
      }

      const body = await readJsonBody(request);
      if (!body.giftId) throw new Error("Presente obrigatorio.");
      if (!body.giftName) throw new Error("Nome do presente obrigatorio.");
      if (!Number(body.amount) || Number(body.amount) <= 0) throw new Error("Valor invalido.");
      if (!body.buyerName) throw new Error("Nome obrigatorio.");
      if (!isValidEmail(body.buyerEmail)) throw new Error("E-mail invalido.");

      const order = await callSupabaseRpc("create_mercadopago_order", {
        p_gift_id: body.giftId,
        p_buyer_name: body.buyerName,
        p_buyer_email: body.buyerEmail || null,
        p_message: body.message || null,
        p_amount: body.amount ?? null,
      });
      if (!order?.[0]) {
        throw new Error("Nao foi possivel criar o pedido de pagamento.");
      }

      const preference = await createMercadoPagoPreference(order[0], request);
      sendJson(response, 200, {
        preferenceId: preference.id,
        init_point: preference.init_point,
        sandbox_init_point: preference.sandbox_init_point,
      });
      return true;
    }

    if (request.method === "POST" && pathname === "/api/webhooks/mercadopago") {
      const body = await readJsonBody(request);
      validateMercadoPagoWebhookSignature(request, body);

      const paymentId = body?.data?.id || body?.id || new URL(request.url || "/", `http://localhost:${port}`).searchParams.get("data.id");
      if (paymentId) {
        const payment = await getMercadoPagoPayment(paymentId);
        const status = normalizeMercadoPagoStatus(payment.status);

        if (payment.external_reference) {
          await callSupabaseRpc("confirm_mercadopago_payment", {
            p_order_id: payment.external_reference,
            p_payment_id: String(payment.id),
            p_status: status,
            p_amount: payment.transaction_amount ?? null,
            p_payment_method_id: payment.payment_method_id ?? null,
            p_date_approved: payment.date_approved ?? null,
            p_payer_email: payment.payer?.email ?? null,
            p_payload: payment,
          });
        }
      }

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

  const paymentPage = ["/pagamento/sucesso", "/pagamento/erro", "/pagamento/pendente"].includes(pathname)
    ? resolve(join(root, pathname.replace(/^\/+/, ""), "index.html"))
    : null;
  const filePath = paymentPage
    ? paymentPage
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
