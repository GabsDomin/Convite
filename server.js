import { createReadStream, existsSync, readFileSync, statSync } from "node:fs";
import { createHmac, timingSafeEqual } from "node:crypto";
import { createServer } from "node:http";
import { extname, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = fileURLToPath(new URL(".", import.meta.url));
const root = resolve(__dirname);
const assetsRoot = resolve(root, "assets");
const port = Number(process.env.PORT || 3000);
const maxJsonBodyBytes = 64 * 1024;
const rateLimitStore = new Map();

class HttpError extends Error {
  constructor(statusCode, message, headers = {}) {
    super(message);
    this.statusCode = statusCode;
    this.headers = headers;
  }
}

function firstEnv(...names) {
  for (const name of names) {
    const value = process.env[name]?.trim();
    if (value) return value;
  }

  return "";
}

const supabaseUrl = firstEnv("SUPABASE_URL");
const supabaseSecretKey = firstEnv("SUPABASE_SECRET_KEY", "SUPABASE_SERVICE_ROLE_KEY");
const mercadoPagoAccessToken = firstEnv("MERCADO_PAGO_ACCESS_TOKEN", "MP_ACCESS_TOKEN");
const mercadoPagoWebhookSecret = firstEnv("MERCADO_PAGO_WEBHOOK_SECRET");
const siteUrl = firstEnv("SITE_URL", "FRONTEND_URL", "PUBLIC_FRONTEND_URL").replace(/\/+$/, "");
const backendUrl = firstEnv("BACKEND_URL", "PUBLIC_BACKEND_URL", "SITE_URL").replace(/\/+$/, "");
const hasSupabaseConfig = Boolean(supabaseUrl && supabaseSecretKey);
const hasMercadoPagoConfig = Boolean(mercadoPagoAccessToken && mercadoPagoWebhookSecret);
const mercadoPagoMode = mercadoPagoAccessToken.startsWith("TEST-") ? "sandbox" : "production";
const guestNotInvitedMessage = "Infelizmente, seu nome não está na lista de convidados.";

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
const rangeEnabledExtensions = new Set([".mp3"]);
const indexDocument = { content: readFileSync(new URL("./index.html", import.meta.url)), extension: ".html" };
const stylesDocument = { content: readFileSync(new URL("./styles.css", import.meta.url)), extension: ".css" };
const scriptDocument = { content: readFileSync(new URL("./script.js", import.meta.url)), extension: ".js" };
const paymentSuccessDocument = {
  content: readFileSync(new URL("./pagamento/sucesso/index.html", import.meta.url)),
  extension: ".html",
};
const paymentErrorDocument = {
  content: readFileSync(new URL("./pagamento/erro/index.html", import.meta.url)),
  extension: ".html",
};
const paymentPendingDocument = {
  content: readFileSync(new URL("./pagamento/pendente/index.html", import.meta.url)),
  extension: ".html",
};
const publicFiles = new Map([
  ["/", indexDocument],
  ["/index.html", indexDocument],
  ["/styles.css", stylesDocument],
  ["/script.js", scriptDocument],
  ["/pagamento/sucesso", paymentSuccessDocument],
  ["/pagamento/sucesso/", paymentSuccessDocument],
  ["/pagamento/erro", paymentErrorDocument],
  ["/pagamento/erro/", paymentErrorDocument],
  ["/pagamento/pendente", paymentPendingDocument],
  ["/pagamento/pendente/", paymentPendingDocument],
]);

const securityHeaders = {
  "Content-Security-Policy": [
    "default-src 'self'",
    "script-src 'self'",
    "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com",
    "font-src https://fonts.gstatic.com",
    "img-src 'self' data: https:",
    "media-src 'self'",
    "connect-src 'self'",
    "object-src 'none'",
    "base-uri 'none'",
    "frame-ancestors 'none'",
    "form-action 'self'",
    "upgrade-insecure-requests",
  ].join("; "),
  "Permissions-Policy": "camera=(), microphone=(), geolocation=()",
  "Referrer-Policy": "strict-origin-when-cross-origin",
  "X-Content-Type-Options": "nosniff",
  "X-Frame-Options": "DENY",
};

function responseHeaders(extraHeaders = {}) {
  return { ...securityHeaders, ...extraHeaders };
}

function resolvePublicAsset(pathname) {
  if (!pathname.startsWith("/assets/")) return null;

  try {
    const relativePath = decodeURIComponent(pathname.slice("/assets/".length));
    const filePath = resolve(assetsRoot, relativePath);
    if (!filePath.startsWith(`${assetsRoot}${sep}`)) return null;
    return mimeTypes[extname(filePath).toLowerCase()] ? filePath : null;
  } catch {
    return null;
  }
}

function sendBundledPublicFile(request, response, file) {
  response.writeHead(200, responseHeaders({
    "Content-Type": mimeTypes[file.extension],
    "Content-Length": file.content.byteLength,
    "Accept-Ranges": "none",
    "Cache-Control": "no-cache, no-store, must-revalidate",
  }));
  if (request.method === "HEAD") response.end();
  else response.end(file.content);
}

function sendJson(response, statusCode, payload, extraHeaders = {}) {
  response.writeHead(statusCode, responseHeaders({
    "Content-Type": "application/json; charset=utf-8",
    "Cache-Control": "no-store",
    ...extraHeaders,
  }));
  response.end(JSON.stringify(payload));
}

function getRequestOrigin(request) {
  const host = request.headers["x-forwarded-host"] || request.headers.host || `localhost:${port}`;
  const protocol = request.headers["x-forwarded-proto"] || (String(host).includes("localhost") ? "http" : "https");
  return `${protocol}://${host}`;
}

function getPublicFrontendUrl(request) {
  return siteUrl || getRequestOrigin(request);
}

function getPublicBackendUrl(request) {
  return backendUrl || getRequestOrigin(request);
}

function getClientIp(request) {
  const forwarded = String(request.headers["x-forwarded-for"] || "").split(",")[0].trim();
  return forwarded || request.socket.remoteAddress || "unknown";
}

function enforceRateLimit(request, scope, limit, windowMs) {
  const now = Date.now();
  const key = `${scope}:${getClientIp(request)}`;
  let entry = rateLimitStore.get(key);

  if (!entry || entry.resetAt <= now) {
    entry = { count: 0, resetAt: now + windowMs };
    rateLimitStore.set(key, entry);
  }

  entry.count += 1;
  if (entry.count > limit) {
    const retryAfter = Math.max(1, Math.ceil((entry.resetAt - now) / 1000));
    throw new HttpError(429, "Muitas tentativas. Aguarde um pouco e tente novamente.", {
      "Retry-After": String(retryAfter),
    });
  }

  if (rateLimitStore.size > 2_000) {
    for (const [storedKey, storedEntry] of rateLimitStore) {
      if (storedEntry.resetAt <= now) rateLimitStore.delete(storedKey);
    }
  }
}

function validateSameOriginRequest(request) {
  const origin = request.headers.origin;
  if (!origin) return;

  try {
    const requestOrigin = new URL(getRequestOrigin(request));
    const browserOrigin = new URL(String(origin));
    if (requestOrigin.host !== browserOrigin.host) {
      throw new HttpError(403, "Origem da solicitação não permitida.");
    }
  } catch (error) {
    if (error instanceof HttpError) throw error;
    throw new HttpError(403, "Origem da solicitação inválida.");
  }
}

async function readJsonBody(request) {
  const declaredLength = Number(request.headers["content-length"] || 0);
  if (declaredLength > maxJsonBodyBytes) {
    throw new HttpError(413, "Solicitação muito grande.");
  }

  const chunks = [];
  let receivedBytes = 0;
  for await (const chunk of request) {
    receivedBytes += chunk.length;
    if (receivedBytes > maxJsonBodyBytes) {
      throw new HttpError(413, "Solicitação muito grande.");
    }
    chunks.push(chunk);
  }

  const rawBody = Buffer.concat(chunks).toString("utf8");
  if (!rawBody) return {};

  try {
    return JSON.parse(rawBody);
  } catch {
    throw new HttpError(400, "JSON inválido.");
  }
}

function requireText(value, label, { min = 1, max = 120 } = {}) {
  const text = String(value ?? "").trim().replace(/\s+/g, " ");
  if (text.length < min) throw new HttpError(400, `${label} obrigatório.`);
  if (text.length > max) throw new HttpError(400, `${label} muito longo.`);
  return text;
}

function optionalText(value, label, max) {
  const text = String(value ?? "").trim();
  if (text.length > max) throw new HttpError(400, `${label} muito longo.`);
  return text || null;
}

function requireGiftId(value) {
  const giftId = String(value ?? "").trim();
  if (!/^[a-z0-9][a-z0-9-]{0,99}$/i.test(giftId)) {
    throw new HttpError(400, "Presente inválido.");
  }
  return giftId;
}

function requireAmount(value) {
  const amount = Number(value);
  if (!Number.isSafeInteger(amount) || amount <= 0 || amount > 1_000_000) {
    throw new HttpError(400, "Valor inválido.");
  }
  return amount;
}

function optionalEmail(value) {
  const email = String(value ?? "").trim();
  if (!email) return null;
  if (email.length > 254 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    throw new HttpError(400, "E-mail inválido.");
  }
  return email;
}

function getSupabaseHeaders() {
  return {
    "apikey": supabaseSecretKey,
    ...(!supabaseSecretKey.startsWith("sb_secret_")
      ? { "Authorization": `Bearer ${supabaseSecretKey}` }
      : {}),
  };
}

async function callSupabaseRpc(functionName, payload = {}) {
  const endpoint = new URL(`/rest/v1/rpc/${functionName}`, supabaseUrl);
  const supabaseResponse = await fetch(endpoint, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      ...getSupabaseHeaders(),
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
    headers: getSupabaseHeaders(),
  });
  const responseText = await supabaseResponse.text();
  const data = responseText ? JSON.parse(responseText) : null;

  if (!supabaseResponse.ok) {
    const message = data?.message || data?.error_description || data?.hint || "Erro ao ler o Supabase.";
    throw new Error(message);
  }

  return data;
}

function normalizeImageUrl(value) {
  const url = String(value || "").trim();
  if (!url) return "";

  try {
    const parsedUrl = new URL(url);
    const driveFileMatch = parsedUrl.hostname.includes("drive.google.com")
      ? parsedUrl.pathname.match(/\/file\/d\/([^/]+)/)
      : null;

    if (driveFileMatch?.[1]) {
      return `https://drive.google.com/thumbnail?id=${encodeURIComponent(driveFileMatch[1])}&sz=w700`;
    }

    return parsedUrl.protocol === "https:" ? parsedUrl.href : "";
  } catch {
    return "";
  }
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
  if (!mercadoPagoWebhookSecret) {
    throw new HttpError(503, "Webhook do Mercado Pago não está configurado.");
  }

  const signature = parseMercadoPagoSignature(request.headers["x-signature"]);
  const requestId = request.headers["x-request-id"];
  const notificationUrl = new URL(request.url || "/", `http://localhost:${port}`);
  const dataId = notificationUrl.searchParams.get("data.id")
    || notificationUrl.searchParams.get("id")
    || body?.data?.id
    || body?.id;

  if (!signature.ts || !/^[a-f0-9]{64}$/i.test(signature.v1 || "") || !requestId || !dataId) {
    throw new HttpError(401, "Assinatura do webhook Mercado Pago ausente ou inválida.");
  }

  const manifest = `id:${String(dataId).toLowerCase()};request-id:${requestId};ts:${signature.ts};`;
  const expected = createHmac("sha256", mercadoPagoWebhookSecret)
    .update(manifest)
    .digest("hex");
  const expectedBuffer = Buffer.from(expected, "hex");
  const receivedBuffer = Buffer.from(signature.v1, "hex");

  if (!timingSafeEqual(expectedBuffer, receivedBuffer)) {
    throw new HttpError(401, "Assinatura do webhook Mercado Pago inválida.");
  }
}

async function createMercadoPagoPreference(order, request) {
  if (!hasMercadoPagoConfig) {
    throw new HttpError(503, "Pagamento por cartão ainda não está configurado.");
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
      expires: true,
      expiration_date_from: new Date().toISOString(),
      expiration_date_to: new Date(order.expires_at).toISOString(),
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

    const message = data?.message || data?.error || "Erro ao criar preferência no Mercado Pago.";
    throw new Error(message);
  }

  if (!data.init_point) {
    throw new Error("O Mercado Pago não retornou o link de pagamento.");
  }

  data.checkout_url = mercadoPagoMode === "sandbox" && data.sandbox_init_point
    ? data.sandbox_init_point
    : data.init_point;

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
      return await readSupabaseTable("gifts?select=id,name,gift_type,section,category,description,image_url,value,goal,quota_options,status,sort_order&status=neq.hidden&order=sort_order.asc,name.asc");
    } catch (tableError) {
      throw new Error(`Tabela gifts: ${tableError.message}. RPC get_public_gifts: ${rpcError.message}`);
    }
  }
}

function normalizeGift(gift) {
  const quotaOptions = Array.isArray(gift.quota_options) ? gift.quota_options : [];

  return {
    id: gift.id,
    type: gift.gift_type,
    section: gift.section,
    name: gift.name,
    value: Number(gift.value || 0),
    goal: Number(gift.goal || 0),
    contributed: Number(gift.contributed_amount || 0),
    options: quotaOptions.map(Number),
    category: gift.category,
    text: gift.description,
    imageUrl: normalizeImageUrl(gift.image_url),
    status: gift.status,
  };
}

async function handleApi(request, response, pathname) {
  if (request.method === "GET" && pathname === "/api/config") {
    sendJson(response, 200, {
      supabaseConfigured: hasSupabaseConfig,
      mercadoPagoConfigured: hasMercadoPagoConfig,
      mercadoPagoMode: hasMercadoPagoConfig ? mercadoPagoMode : "",
    });
    return true;
  }

  if (!hasSupabaseConfig) {
    sendJson(response, 503, { error: "Supabase não está configurado no servidor." });
    return true;
  }

  try {
    if (request.method === "GET" && pathname === "/api/gifts") {
      enforceRateLimit(request, "gifts", 120, 60_000);
      const gifts = await getPublicGifts();
      sendJson(response, 200, { gifts: gifts.map(normalizeGift) });
      return true;
    }

    if (request.method === "POST" && pathname === "/api/rsvp") {
      validateSameOriginRequest(request);
      enforceRateLimit(request, "rsvp", 20, 10 * 60_000);
      const body = await readJsonBody(request);
      const guestName = requireText(body.guestName, "Nome", { min: 2, max: 120 });
      const partySize = String(body.partySize ?? "").trim();
      if (!["Somente eu", "Eu e meus filhos"].includes(partySize)) {
        throw new HttpError(400, "Quantidade de pessoas inválida.");
      }

      const rsvp = await callSupabaseRpc("confirm_rsvp", {
        p_guest_name: guestName,
        p_party_size: partySize,
      });
      sendJson(response, 200, { rsvp: rsvp?.[0] });
      return true;
    }

    if (request.method === "POST" && pathname === "/api/gifts/reserve") {
      validateSameOriginRequest(request);
      enforceRateLimit(request, "reserve", 20, 10 * 60_000);
      const body = await readJsonBody(request);
      const reservation = await callSupabaseRpc("reserve_gift", {
        p_gift_id: requireGiftId(body.giftId),
        p_guest_name: requireText(body.guestName, "Nome", { min: 2, max: 120 }),
        p_amount: body.amount == null ? null : requireAmount(body.amount),
      });
      sendJson(response, 200, { reservation: reservation?.[0] });
      return true;
    }

    if (request.method === "POST" && pathname === "/api/mercadopago/create-preference") {
      validateSameOriginRequest(request);
      enforceRateLimit(request, "payment", 8, 10 * 60_000);
      if (!hasMercadoPagoConfig) {
        throw new HttpError(503, "Pagamento por cartão ainda não está configurado.");
      }

      const body = await readJsonBody(request);
      const order = await callSupabaseRpc("create_mercadopago_order", {
        p_gift_id: requireGiftId(body.giftId),
        p_buyer_name: requireText(body.buyerName, "Nome", { min: 2, max: 120 }),
        p_buyer_email: optionalEmail(body.buyerEmail),
        p_message: optionalText(body.message, "Mensagem", 500),
        p_amount: requireAmount(body.amount),
      });
      if (!order?.[0]) {
        throw new Error("Não foi possível criar o pedido de pagamento.");
      }

      const preference = await createMercadoPagoPreference(order[0], request);
      sendJson(response, 200, {
        preferenceId: preference.id,
        checkoutUrl: preference.checkout_url,
        mercadoPagoMode,
        init_point: preference.init_point,
        sandbox_init_point: preference.sandbox_init_point,
      });
      return true;
    }

    if (request.method === "POST" && pathname === "/api/webhooks/mercadopago") {
      enforceRateLimit(request, "mercadopago-webhook", 120, 60_000);
      if (!hasMercadoPagoConfig) {
        throw new HttpError(503, "Mercado Pago não está configurado.");
      }

      const body = await readJsonBody(request);
      validateMercadoPagoWebhookSignature(request, body);

      const paymentId = body?.data?.id
        || body?.id
        || new URL(request.url || "/", `http://localhost:${port}`).searchParams.get("data.id");
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
    const guestNotInvited = error.message === guestNotInvitedMessage;
    const statusCode = guestNotInvited ? 403 : error instanceof HttpError ? error.statusCode : 400;
    const headers = error instanceof HttpError ? error.headers : {};
    sendJson(response, statusCode, {
      error: error.message || "Erro ao processar solicitação.",
      ...(guestNotInvited ? { code: "guest_not_invited" } : {}),
    }, headers);
    return true;
  }
}

const server = createServer(async (request, response) => {
  let pathname;
  try {
    pathname = new URL(request.url || "/", `http://localhost:${port}`).pathname;
  } catch {
    response.writeHead(400, responseHeaders({ "Content-Type": "text/plain; charset=utf-8" }));
    response.end("Solicitação inválida");
    return;
  }

  if (pathname.startsWith("/api/")) {
    const handled = await handleApi(request, response, pathname);
    if (handled) return;
  }

  if (!["GET", "HEAD"].includes(request.method || "")) {
    response.writeHead(405, responseHeaders({
      "Content-Type": "text/plain; charset=utf-8",
      "Allow": "GET, HEAD",
    }));
    response.end("Método não permitido");
    return;
  }

  const bundledFile = publicFiles.get(pathname);
  if (bundledFile) {
    sendBundledPublicFile(request, response, bundledFile);
    return;
  }

  const filePath = resolvePublicAsset(pathname);
  if (!filePath || !existsSync(filePath) || !statSync(filePath).isFile()) {
    response.writeHead(404, responseHeaders({ "Content-Type": "text/plain; charset=utf-8" }));
    response.end("Arquivo não encontrado");
    return;
  }

  const extension = extname(filePath).toLowerCase();
  const fileSize = statSync(filePath).size;
  const contentType = mimeTypes[extension] || "application/octet-stream";

  if (rangeEnabledExtensions.has(extension) && request.headers.range) {
    const match = /^bytes=(\d*)-(\d*)$/.exec(request.headers.range);

    if (match) {
      const start = match[1] ? Number(match[1]) : 0;
      const end = match[2] ? Number(match[2]) : fileSize - 1;

      if (start <= end && start >= 0 && end < fileSize) {
        response.writeHead(206, responseHeaders({
          "Content-Type": contentType,
          "Content-Length": end - start + 1,
          "Content-Range": `bytes ${start}-${end}/${fileSize}`,
          "Accept-Ranges": "bytes",
          "Cache-Control": "public, max-age=31536000, immutable",
        }));
        if (request.method === "HEAD") response.end();
        else createReadStream(filePath, { start, end }).pipe(response);
        return;
      }
    }

    response.writeHead(416, responseHeaders({
      "Content-Range": `bytes */${fileSize}`,
      "Accept-Ranges": "bytes",
    }));
    response.end();
    return;
  }

  response.writeHead(200, responseHeaders({
    "Content-Type": contentType,
    "Content-Length": fileSize,
    "Accept-Ranges": rangeEnabledExtensions.has(extension) ? "bytes" : "none",
    "Cache-Control": noCacheExtensions.has(extension)
      ? "no-cache, no-store, must-revalidate"
      : "public, max-age=31536000, immutable",
  }));
  if (request.method === "HEAD") response.end();
  else createReadStream(filePath).pipe(response);
});

server.listen(port, () => {
  console.log(`Convite rodando na porta ${port}`);
});
