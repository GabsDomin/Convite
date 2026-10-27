import { createReadStream, existsSync, readFileSync, statSync } from "node:fs";
import { createHash, createHmac, randomUUID, timingSafeEqual } from "node:crypto";
import { createServer } from "node:http";
import { extname, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { DeleteObjectCommand, HeadObjectCommand, PutObjectCommand, S3Client } from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";

const __dirname = fileURLToPath(new URL(".", import.meta.url));
const root = resolve(__dirname);
const assetsRoot = resolve(root, "assets");
const port = Number(process.env.PORT || 3000);
const maxJsonBodyBytes = 64 * 1024;
const maxGiftMessageLength = 5000;
const maxAlbumFileBytes = 500 * 1024 * 1024;
const rateLimitStore = new Map();
const supportOverviewCacheTtlMs = 45_000;
let supportOverviewCache = { expiresAt: 0, payload: null };
let supportOverviewBuildPromise = null;

class HttpError extends Error {
  constructor(statusCode, message, headers = {}, { code } = {}) {
    super(message);
    this.statusCode = statusCode;
    this.headers = headers;
    this.code = code;
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
const cloudinaryCloudName = firstEnv("CLOUDINARY_CLOUD_NAME");
const r2AccountId = firstEnv("R2_ACCOUNT_ID");
const r2AccessKeyId = firstEnv("R2_ACCESS_KEY_ID");
const r2SecretAccessKey = firstEnv("R2_SECRET_ACCESS_KEY");
const r2BucketName = firstEnv("R2_BUCKET_NAME");
const r2PublicBaseUrl = firstEnv("R2_PUBLIC_BASE_URL").replace(/\/+$/, "");
const r2ImageTransformBaseUrl = firstEnv("R2_IMAGE_TRANSFORM_BASE_URL").replace(/\/+$/, "");
const albumUploadSigningSecret = firstEnv("ALBUM_UPLOAD_SIGNING_SECRET");
const albumUploadCode = firstEnv("ALBUM_UPLOAD_CODE");
const siteUrl = firstEnv("SITE_URL", "FRONTEND_URL", "PUBLIC_FRONTEND_URL").replace(/\/+$/, "");
const backendUrl = firstEnv("BACKEND_URL", "PUBLIC_BACKEND_URL", "SITE_URL").replace(/\/+$/, "");
const hasSupabaseConfig = Boolean(supabaseUrl && supabaseSecretKey);
const hasMercadoPagoConfig = Boolean(mercadoPagoAccessToken && mercadoPagoWebhookSecret);
const hasCloudinaryConfig = Boolean(cloudinaryCloudName);
const hasR2Config = Boolean(
  r2AccountId
  && r2AccessKeyId
  && r2SecretAccessKey
  && r2BucketName
  && r2PublicBaseUrl
  && albumUploadSigningSecret.length >= 32
);
const hasAlbumConfig = hasSupabaseConfig && hasR2Config;
const mercadoPagoMode = mercadoPagoAccessToken.startsWith("TEST-") ? "sandbox" : "production";
const guestNotInvitedMessagePattern = /^Infelizmente, .+ não está na lista de convidados\.$/;
const siteEngagementEventTypes = new Set(["gifts_area_view", "gifts_list_opened", "gift_modal_opened"]);
const albumCategories = new Set(["Preparativos", "Cerimônia", "Jantar", "Festa"]);
const albumImageTypes = new Set(["image/jpeg", "image/png", "image/webp", "image/avif", "image/heic", "image/heif"]);
const albumVideoTypes = new Set(["video/mp4", "video/quicktime", "video/webm"]);
const albumR2KeyPrefix = "gab-naia/album/originals/";
const albumUploadUrlTtlSeconds = 30 * 60;
const albumSessionCookieName = "gab_naia_album_session";
const albumSessionTtlMs = 7 * 24 * 60 * 60 * 1000;
const albumMediaSelect = "id,guest_name,category,storage_provider,storage_key,public_id,resource_type,mime_type,format,version,bytes,width,height,duration,backup_status,content_hash,challenge_id,created_at";
const albumChallengeSelect = "id,title,description,points,sort_order,active,scope,difficulty,couple,wedding,max_assignees,created_at";
// Cada convidado recebe um desafio de cada dificuldade; a dificuldade define os pontos.
const albumChallengeDifficultyPoints = { easy: 1, medium: 2, hard: 3 };
const albumChallengeSwapsPerGuest = 1;
const albumCoupleChallengeDefaultMax = 4;
// Pontuação do ranking: desafios valem mais, rapidez vira corrida por desafio e fotos têm teto.
const albumScoreRules = {
  pointsPerChallengePoint: 10,
  speedBonuses: [3, 2, 1],
  pointsPerPhoto: 1,
  maxPhotoPoints: 15,
};
function parseGuestNameList(value) {
  return new Set(String(value).split(",").map(normalizeGuestName).filter(Boolean));
}

// Os noivos: entram no álbum antes da abertura e sempre com senha.
const albumAdminGuestNames = parseGuestNameList(
  firstEnv("ALBUM_ADMIN_GUEST_NAMES") || "Gabriel Domingues Fernandes,Gabriel Domingues,Halanaia Vitória",
);
// O painel de apoio (presentes, pagamentos, confirmações) é só do Gabriel.
const supportPanelGuestNames = parseGuestNameList(
  firstEnv("SUPPORT_PANEL_GUEST_NAMES") || "Gabriel Domingues Fernandes,Gabriel Domingues",
);
const albumPublicOpenAtRaw = firstEnv("ALBUM_PUBLIC_OPEN_AT") || "2026-11-28T15:00:00-03:00";
const albumPublicOpenAtMs = Date.parse(albumPublicOpenAtRaw);
const hasSupportPanelConfig = hasSupabaseConfig && albumUploadSigningSecret.length >= 32;
const supportSessionCookieName = "gab_naia_support_session";
const supportSessionTtlMs = 12 * 60 * 60 * 1000;
const guestRememberCookieName = "gab_naia_guest_remember";
const guestRememberTtlMs = 400 * 24 * 60 * 60 * 1000;
const albumFileExtensions = new Map([
  ["image/jpeg", "jpg"],
  ["image/png", "png"],
  ["image/webp", "webp"],
  ["image/avif", "avif"],
  ["image/heic", "heic"],
  ["image/heif", "heif"],
  ["video/mp4", "mp4"],
  ["video/quicktime", "mov"],
  ["video/webm", "webm"],
]);

const r2Client = hasR2Config
  ? new S3Client({
      region: "auto",
      endpoint: `https://${r2AccountId}.r2.cloudflarestorage.com`,
      forcePathStyle: true,
      requestChecksumCalculation: "WHEN_REQUIRED",
      responseChecksumValidation: "WHEN_REQUIRED",
      credentials: {
        accessKeyId: r2AccessKeyId,
        secretAccessKey: r2SecretAccessKey,
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

const noCacheExtensions = new Set([".html", ".css", ".js"]);
const rangeEnabledExtensions = new Set([".mp3"]);
const indexDocument = { content: readFileSync(new URL("./index.html", import.meta.url)), extension: ".html" };
const stylesDocument = { content: readFileSync(new URL("./styles.css", import.meta.url)), extension: ".css" };
const scriptDocument = { content: readFileSync(new URL("./script.js", import.meta.url)), extension: ".js" };
const albumDocument = { content: readFileSync(new URL("./album.html", import.meta.url)), extension: ".html" };
const albumStylesDocument = { content: readFileSync(new URL("./album.css", import.meta.url)), extension: ".css" };
const albumScriptDocument = { content: readFileSync(new URL("./album.js", import.meta.url)), extension: ".js" };
const albumLoginDocument = { content: readFileSync(new URL("./album-login.html", import.meta.url)), extension: ".html" };
const albumLoginScriptDocument = { content: readFileSync(new URL("./album-login.js", import.meta.url)), extension: ".js" };
const supportDocument = { content: readFileSync(new URL("./support.html", import.meta.url)), extension: ".html" };
const supportStylesDocument = { content: readFileSync(new URL("./support.css", import.meta.url)), extension: ".css" };
const supportScriptDocument = { content: readFileSync(new URL("./support.js", import.meta.url)), extension: ".js" };
const supportLoginDocument = { content: readFileSync(new URL("./support-login.html", import.meta.url)), extension: ".html" };
const supportLoginScriptDocument = { content: readFileSync(new URL("./support-login.js", import.meta.url)), extension: ".js" };
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
  ["/album", albumDocument],
  ["/album/", albumDocument],
  ["/album.html", albumDocument],
  ["/album.css", albumStylesDocument],
  ["/album.js", albumScriptDocument],
  ["/album/login", albumLoginDocument],
  ["/album/login/", albumLoginDocument],
  ["/album-login.html", albumLoginDocument],
  ["/album-login.js", albumLoginScriptDocument],
  ["/support.css", supportStylesDocument],
  ["/support.js", supportScriptDocument],
  ["/support-login.js", supportLoginScriptDocument],
  ["/apoio", supportDocument],
  ["/apoio/", supportDocument],
  ["/apoio/login", supportLoginDocument],
  ["/apoio/login/", supportLoginDocument],
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
    "img-src 'self' data: blob: https:",
    "media-src 'self' blob: https:",
    "connect-src 'self' https:",
    "object-src 'none'",
    "base-uri 'none'",
    "frame-ancestors 'none'",
    "form-action 'self'",
    "upgrade-insecure-requests",
  ].join("; "),
  "Permissions-Policy": "camera=(self), microphone=(self), web-share=(self), geolocation=()",
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

function requireFullGuestName(value, label = "Nome") {
  const text = requireText(value, label, { min: 3, max: 120 });
  const parts = text.split(" ").filter(Boolean);
  if (parts.length < 2 || parts.some((part) => part.length < 2)) {
    throw new HttpError(400, `${label} deve incluir nome e sobrenome.`);
  }
  return text;
}

function normalizeGuestName(value) {
  return String(value || "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLocaleLowerCase("pt-BR")
    .trim()
    .replace(/\s+/g, " ");
}

async function readRsvpGroupRecord(guestName) {
  const normalized = normalizeGuestName(guestName);
  let rows = await readSupabaseTable(
    `rsvps?select=id,guest_name,party_size,primary_rsvp_id,additional_guest_names&normalized_guest_name=eq.${encodeURIComponent(normalized)}&limit=1`,
  );
  let row = Array.isArray(rows) ? rows[0] : rows;
  if (!row?.guest_name) return null;

  const primaryId = row.primary_rsvp_id || row.id;
  const matchedCompanion = Boolean(row.primary_rsvp_id);
  if (row.primary_rsvp_id) {
    rows = await readSupabaseTable(
      `rsvps?select=id,guest_name,party_size,primary_rsvp_id,additional_guest_names&id=eq.${encodeURIComponent(primaryId)}&limit=1`,
    );
    row = Array.isArray(rows) ? rows[0] : rows;
    if (!row?.guest_name) return null;
  }

  const companions = await readSupabaseTable(
    `rsvps?select=guest_name&primary_rsvp_id=eq.${encodeURIComponent(primaryId)}&order=created_at.asc,guest_name.asc`,
  );
  const additionalGuestNames = (Array.isArray(companions) ? companions : [])
    .map((companion) => companion.guest_name)
    .filter(Boolean);

  return {
    primaryId,
    matchedCompanion,
    guest_name: row.guest_name,
    party_size: row.party_size,
    additional_guest_names: additionalGuestNames,
  };
}

async function readRsvpGroupByGuestName(guestName) {
  const record = await readRsvpGroupRecord(guestName);
  if (!record) return null;
  return {
    guest_name: record.guest_name,
    party_size: record.party_size,
    additional_guest_names: record.additional_guest_names,
  };
}

// Sem o cookie do aparelho que confirmou, só é possível incluir pessoas, nunca remover.
async function assertRsvpChangeAllowed(request, guestName, additionalGuestNames) {
  const existing = await readRsvpGroupRecord(guestName);
  if (!existing || existing.matchedCompanion) return;

  const requestedNames = new Set(additionalGuestNames.map(normalizeGuestName));
  const removesSomeone = existing.additional_guest_names
    .some((name) => !requestedNames.has(normalizeGuestName(name)));
  if (!removesSomeone) return;

  const rememberedPrimaryId = await readRememberedPrimaryRsvpId(request);
  if (rememberedPrimaryId !== existing.primaryId) {
    throw new HttpError(
      403,
      "Para remover pessoas desta confirmação, use o aparelho em que ela foi feita ou fale com os noivos.",
    );
  }
}

function validateAdditionalGuestNames(value, partySize, primaryGuestName) {
  if (!Array.isArray(value)) {
    throw new HttpError(400, "Lista de pessoas inválida.");
  }
  if (value.length > 6) {
    throw new HttpError(400, "É possível incluir no máximo seis menores.");
  }

  const names = value.map((name) => requireFullGuestName(name, "Nome da pessoa"));
  const normalizedPrimaryName = normalizeGuestName(primaryGuestName);
  const normalizedNames = names.map(normalizeGuestName);

  if (normalizedNames.includes(normalizedPrimaryName)) {
    throw new HttpError(400, "Não repita seu próprio nome na confirmação.");
  }
  if (new Set(normalizedNames).size !== normalizedNames.length) {
    throw new HttpError(400, "Informe cada pessoa apenas uma vez.");
  }

  if (partySize === "Somente eu" && names.length !== 0) {
    throw new HttpError(400, "A confirmação individual não deve incluir outros nomes.");
  }
  if (partySize === "Casal" && (names.length < 1 || names.length > 7)) {
    throw new HttpError(400, "Informe o nome do seu companheiro ou companheira.");
  }
  if (partySize === "Família" && (names.length < 2 || names.length > 7)) {
    throw new HttpError(400, "Informe o parceiro ou parceira e pelo menos um filho.");
  }
  if (partySize === "Responsável e menores" && (names.length < 1 || names.length > 6)) {
    throw new HttpError(400, "Informe o nome de cada filho.");
  }

  return names;
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

function requireAlbumCategory(value) {
  const category = String(value ?? "").trim();
  if (!albumCategories.has(category)) {
    throw new HttpError(400, "Momento do álbum inválido.");
  }
  return category;
}

function requireContentHash(value) {
  const hash = String(value || "").trim().toLowerCase();
  if (!/^[a-f0-9]{64}$/.test(hash)) {
    throw new HttpError(400, "Identificador do arquivo inválido.");
  }
  return hash;
}

async function assertAlbumMediaHashAvailable(contentHash) {
  const rows = await readSupabaseTable(
    `album_media?select=id&content_hash=eq.${encodeURIComponent(contentHash)}&limit=1`,
  );
  if (Array.isArray(rows) && rows[0]?.id) {
    throw new HttpError(409, "Esta memória já está no álbum.");
  }
}

function requireAlbumAccessCode(value) {
  if (!albumUploadCode) return;
  const expected = Buffer.from(albumUploadCode, "utf8");
  const received = Buffer.from(String(value || "").trim(), "utf8");
  if (received.length !== expected.length || !timingSafeEqual(received, expected)) {
    throw new HttpError(403, "Código do álbum incorreto.");
  }
}

function parseCookies(request) {
  const cookies = {};
  for (const part of String(request.headers.cookie || "").split(";")) {
    const separator = part.indexOf("=");
    if (separator <= 0) continue;
    const name = part.slice(0, separator).trim();
    const value = part.slice(separator + 1).trim();
    if (!name) continue;
    try {
      cookies[name] = decodeURIComponent(value);
    } catch {
      cookies[name] = value;
    }
  }
  return cookies;
}

function createAlbumSessionToken(guestName) {
  if (albumUploadSigningSecret.length < 32) {
    throw new HttpError(503, "Sessão do álbum indisponível.");
  }
  const payload = {
    guestName: requireText(guestName, "Nome", { min: 2, max: 120 }),
    expiresAt: Date.now() + albumSessionTtlMs,
  };
  const encodedPayload = Buffer.from(JSON.stringify(payload), "utf8").toString("base64url");
  const signature = createHmac("sha256", albumUploadSigningSecret).update(encodedPayload).digest("base64url");
  return `${encodedPayload}.${signature}`;
}

function readAlbumSession(request) {
  if (albumUploadSigningSecret.length < 32) return null;
  const token = parseCookies(request)[albumSessionCookieName];
  if (!token) return null;
  const [encodedPayload, signature] = String(token).split(".");
  if (!encodedPayload || !signature) return null;

  const expectedSignature = createHmac("sha256", albumUploadSigningSecret).update(encodedPayload).digest("base64url");
  const receivedBuffer = Buffer.from(signature);
  const expectedBuffer = Buffer.from(expectedSignature);
  if (receivedBuffer.length !== expectedBuffer.length || !timingSafeEqual(receivedBuffer, expectedBuffer)) {
    return null;
  }

  try {
    const payload = JSON.parse(Buffer.from(encodedPayload, "base64url").toString("utf8"));
    if (!Number.isSafeInteger(payload.expiresAt) || payload.expiresAt < Date.now()) return null;
    return {
      guestName: requireText(payload.guestName, "Nome", { min: 2, max: 120 }),
      expiresAt: payload.expiresAt,
    };
  } catch {
    return null;
  }
}

function requireAlbumSession(request) {
  const session = readAlbumSession(request);
  if (!session) {
    throw new HttpError(401, "Entre no álbum com seu nome e senha para continuar.");
  }
  return session;
}

function isAlbumAdmin(guestName) {
  return albumAdminGuestNames.has(normalizeGuestName(guestName));
}

function canAccessSupportPanel(guestName) {
  return supportPanelGuestNames.has(normalizeGuestName(guestName));
}

function isAlbumPubliclyOpen(now = Date.now()) {
  return Number.isFinite(albumPublicOpenAtMs) && now >= albumPublicOpenAtMs;
}

function canAccessAlbum(guestName) {
  return isAlbumPubliclyOpen() || isAlbumAdmin(guestName);
}

function requireAlbumAccess(session) {
  if (!canAccessAlbum(session.guestName)) {
    throw new HttpError(403, "O álbum coletivo abre no dia 28/11, às 15h.");
  }
}

function requireAlbumAdmin(session) {
  if (!isAlbumAdmin(session.guestName)) {
    throw new HttpError(403, "Somente o administrador do álbum pode fazer isso.");
  }
}

function createSupportSessionToken(guestName) {
  if (!hasSupportPanelConfig) {
    throw new HttpError(503, "Painel de apoio indisponível.");
  }
  const cleanGuestName = requireText(guestName, "Nome", { min: 2, max: 120 });
  if (!canAccessSupportPanel(cleanGuestName)) {
    throw new HttpError(403, "Somente o administrador pode acessar o painel de apoio.");
  }
  const payload = {
    role: "support",
    guestName: cleanGuestName,
    expiresAt: Date.now() + supportSessionTtlMs,
  };
  const encodedPayload = Buffer.from(JSON.stringify(payload), "utf8").toString("base64url");
  const signature = createHmac("sha256", albumUploadSigningSecret).update(encodedPayload).digest("base64url");
  return `${encodedPayload}.${signature}`;
}

function readSupportSession(request) {
  if (!hasSupportPanelConfig) return null;
  const token = parseCookies(request)[supportSessionCookieName];
  if (!token) return null;
  const [encodedPayload, signature] = String(token).split(".");
  if (!encodedPayload || !signature) return null;

  const expectedSignature = createHmac("sha256", albumUploadSigningSecret).update(encodedPayload).digest("base64url");
  const receivedBuffer = Buffer.from(signature);
  const expectedBuffer = Buffer.from(expectedSignature);
  if (receivedBuffer.length !== expectedBuffer.length || !timingSafeEqual(receivedBuffer, expectedBuffer)) {
    return null;
  }

  try {
    const payload = JSON.parse(Buffer.from(encodedPayload, "base64url").toString("utf8"));
    if (payload.role !== "support") return null;
    if (!Number.isSafeInteger(payload.expiresAt) || payload.expiresAt < Date.now()) return null;
    const guestName = requireText(payload.guestName, "Nome", { min: 2, max: 120 });
    if (!canAccessSupportPanel(guestName)) return null;
    return { guestName, expiresAt: payload.expiresAt };
  } catch {
    return null;
  }
}

function requireSupportSession(request) {
  const session = readSupportSession(request);
  if (!session) {
    throw new HttpError(401, "Entre no painel de apoio para continuar.");
  }
  return session;
}

function supportSessionCookieHeader(token, { clear = false } = {}) {
  if (clear) {
    return `${supportSessionCookieName}=; Path=/; Max-Age=0; HttpOnly; SameSite=Lax`;
  }
  const secureFlag = backendUrl.startsWith("https://") || siteUrl.startsWith("https://") ? "; Secure" : "";
  return `${supportSessionCookieName}=${encodeURIComponent(token)}; Path=/; Max-Age=${Math.floor(supportSessionTtlMs / 1000)}; HttpOnly; SameSite=Lax${secureFlag}`;
}

function requireAlbumMediaId(value) {
  const id = String(value || "").trim();
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(id)) {
    throw new HttpError(400, "Identificador de mídia inválido.");
  }
  return id;
}

function requireAlbumChallengeId(value) {
  const id = String(value || "").trim();
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(id)) {
    throw new HttpError(400, "Desafio inválido.");
  }
  return id.toLowerCase();
}

function optionalAlbumChallengeId(value) {
  if (value == null || value === "") return null;
  return requireAlbumChallengeId(value);
}

function requireAlbumChallengeInput(body, { partial = false } = {}) {
  const input = {};
  if (!partial || body.title !== undefined) {
    input.title = requireText(body.title, "Título do desafio", { min: 3, max: 80 });
  }
  if (!partial || body.description !== undefined) {
    input.description = optionalText(body.description, "Descrição do desafio", 240) || null;
  }
  if (!partial || body.difficulty !== undefined) {
    const difficulty = body.difficulty == null || body.difficulty === "" ? "easy" : String(body.difficulty);
    if (!Object.hasOwn(albumChallengeDifficultyPoints, difficulty)) {
      throw new HttpError(400, "Escolha a dificuldade: fácil, médio ou difícil.");
    }
    input.difficulty = difficulty;
    input.points = albumChallengeDifficultyPoints[difficulty];
  }
  if (body.active !== undefined) {
    if (typeof body.active !== "boolean") throw new HttpError(400, "Situação do desafio inválida.");
    input.active = body.active;
  }
  if (!partial || body.scope !== undefined) {
    const scope = body.scope == null || body.scope === "" ? "draw" : String(body.scope);
    if (!["draw", "all"].includes(scope)) throw new HttpError(400, "Escolha se o desafio é sorteado ou para todos.");
    input.scope = scope;
  }
  if (!partial || body.couple !== undefined) {
    if (body.couple != null && typeof body.couple !== "boolean") throw new HttpError(400, "Opção dos noivos inválida.");
    input.couple = Boolean(body.couple);
  }
  if (body.wedding != null && typeof body.wedding !== "boolean") throw new HttpError(400, "Opção do casamento inválida.");
  // Ir até os noivos também é registrar o casamento.
  if (!partial || body.wedding !== undefined) input.wedding = Boolean(body.wedding) || Boolean(input.couple);
  else if (input.couple) input.wedding = true;
  if (!partial || body.maxAssignees !== undefined || body.couple !== undefined) {
    const fallback = input.couple ? albumCoupleChallengeDefaultMax : null;
    const max = body.maxAssignees == null || body.maxAssignees === "" ? fallback : Number(body.maxAssignees);
    if (max != null && (!Number.isSafeInteger(max) || max < 1 || max > 500)) {
      throw new HttpError(400, "O limite de pessoas deve ficar entre 1 e 500.");
    }
    input.max_assignees = max;
  }
  if (partial && !Object.keys(input).length) {
    throw new HttpError(400, "Nada para atualizar no desafio.");
  }
  return input;
}

function albumSessionCookieHeader(token, { clear = false } = {}) {
  if (clear) {
    return `${albumSessionCookieName}=; Path=/; Max-Age=0; HttpOnly; SameSite=Lax`;
  }
  const secureFlag = siteUrl.startsWith("https://") || process.env.VERCEL ? "; Secure" : "";
  return `${albumSessionCookieName}=${encodeURIComponent(token)}; Path=/; Max-Age=${Math.floor(albumSessionTtlMs / 1000)}; HttpOnly; SameSite=Lax${secureFlag}`;
}

function hashRememberDeviceToken(token) {
  return createHash("sha256").update(String(token)).digest("hex");
}

function hashClientIp(ip) {
  const clean = String(ip || "").trim();
  if (!clean) return null;
  return createHash("sha256").update(`${clean}|${albumUploadSigningSecret.slice(0, 16)}`).digest("hex");
}

function createGuestRememberCookieValue(rawToken, expiresAt) {
  if (albumUploadSigningSecret.length < 32) {
    throw new HttpError(503, "Lembrete de convidado indisponível.");
  }
  const payload = {
    token: String(rawToken),
    expiresAt,
  };
  const encodedPayload = Buffer.from(JSON.stringify(payload), "utf8").toString("base64url");
  const signature = createHmac("sha256", albumUploadSigningSecret).update(encodedPayload).digest("base64url");
  return `${encodedPayload}.${signature}`;
}

function readGuestRememberRawToken(request) {
  if (albumUploadSigningSecret.length < 32) return null;
  const token = parseCookies(request)[guestRememberCookieName];
  if (!token) return null;
  const [encodedPayload, signature] = String(token).split(".");
  if (!encodedPayload || !signature) return null;

  const expectedSignature = createHmac("sha256", albumUploadSigningSecret).update(encodedPayload).digest("base64url");
  const receivedBuffer = Buffer.from(signature);
  const expectedBuffer = Buffer.from(expectedSignature);
  if (receivedBuffer.length !== expectedBuffer.length || !timingSafeEqual(receivedBuffer, expectedBuffer)) {
    return null;
  }

  try {
    const payload = JSON.parse(Buffer.from(encodedPayload, "base64url").toString("utf8"));
    if (!payload?.token || !Number.isSafeInteger(payload.expiresAt) || payload.expiresAt < Date.now()) {
      return null;
    }
    return String(payload.token);
  } catch {
    return null;
  }
}

function guestRememberCookieHeader(signedValue, { clear = false } = {}) {
  if (clear) {
    return `${guestRememberCookieName}=; Path=/; Max-Age=0; HttpOnly; SameSite=Lax`;
  }
  const secureFlag = siteUrl.startsWith("https://") || process.env.VERCEL ? "; Secure" : "";
  return `${guestRememberCookieName}=${encodeURIComponent(signedValue)}; Path=/; Max-Age=${Math.floor(guestRememberTtlMs / 1000)}; HttpOnly; SameSite=Lax${secureFlag}`;
}

async function issueGuestRememberToken(primaryRsvpId, request) {
  const rawToken = randomUUID();
  const tokenHash = hashRememberDeviceToken(rawToken);
  const ipHash = hashClientIp(getClientIp(request));

  try {
    await insertSupabaseTable("rsvp_remember_tokens", {
      primary_rsvp_id: primaryRsvpId,
      token_hash: tokenHash,
      last_ip_hash: ipHash,
    });
  } catch (error) {
    console.error("issueGuestRememberToken:", error?.message || error);
    return null;
  }

  return createGuestRememberCookieValue(rawToken, Date.now() + guestRememberTtlMs);
}

async function readRememberedPrimaryRsvpId(request) {
  const rawToken = readGuestRememberRawToken(request);
  if (!rawToken) return null;

  try {
    const tokenRows = await readSupabaseTable(
      `rsvp_remember_tokens?select=primary_rsvp_id&token_hash=eq.${encodeURIComponent(hashRememberDeviceToken(rawToken))}&limit=1`,
    );
    const row = Array.isArray(tokenRows) ? tokenRows[0] : tokenRows;
    return row?.primary_rsvp_id || null;
  } catch {
    return null;
  }
}

async function resolveGuestRememberSession(request) {
  const rawToken = readGuestRememberRawToken(request);
  if (!rawToken) return null;

  const tokenHash = hashRememberDeviceToken(rawToken);
  let row;
  try {
    const tokenRows = await readSupabaseTable(
      `rsvp_remember_tokens?select=primary_rsvp_id&token_hash=eq.${encodeURIComponent(tokenHash)}&limit=1`,
    );
    row = Array.isArray(tokenRows) ? tokenRows[0] : tokenRows;
  } catch {
    return null;
  }

  if (!row?.primary_rsvp_id) return null;

  const ipHash = hashClientIp(getClientIp(request));
  try {
    await fetch(new URL(`/rest/v1/rsvp_remember_tokens?token_hash=eq.${encodeURIComponent(tokenHash)}`, supabaseUrl), {
      method: "PATCH",
      headers: {
        "Content-Type": "application/json",
        Prefer: "return=minimal",
        ...getSupabaseHeaders(),
      },
      body: JSON.stringify({
        last_seen_at: new Date().toISOString(),
        ...(ipHash ? { last_ip_hash: ipHash } : {}),
      }),
    });
  } catch {
    /* best effort */
  }

  const primaryRows = await readSupabaseTable(
    `rsvps?select=id,guest_name,party_size&id=eq.${encodeURIComponent(row.primary_rsvp_id)}&limit=1`,
  );
  const primary = Array.isArray(primaryRows) ? primaryRows[0] : primaryRows;
  if (!primary?.guest_name) return null;

  return readRsvpGroupByGuestName(primary.guest_name);
}

function requireAlbumFile(value) {
  const fileName = requireText(value?.fileName, "Nome do arquivo", { min: 1, max: 180 });
  const fileType = String(value?.fileType ?? "").trim().toLowerCase();
  const fileSize = Number(value?.fileSize);
  const resourceType = albumImageTypes.has(fileType)
    ? "image"
    : albumVideoTypes.has(fileType)
      ? "video"
      : "";

  if (!resourceType) throw new HttpError(400, "Formato de arquivo não permitido.");
  if (!Number.isSafeInteger(fileSize) || fileSize <= 0) {
    throw new HttpError(400, "Tamanho de arquivo inválido.");
  }
  if (fileSize > maxAlbumFileBytes) {
    throw new HttpError(413, "O arquivo ultrapassa o limite de 500 MB.");
  }

  return { fileName, fileType, fileSize, resourceType };
}

function createAlbumUploadToken(payload) {
  const encodedPayload = Buffer.from(JSON.stringify(payload)).toString("base64url");
  const signature = createHmac("sha256", albumUploadSigningSecret)
    .update(encodedPayload)
    .digest("base64url");
  return `${encodedPayload}.${signature}`;
}

function requireAlbumUploadToken(value) {
  const token = String(value || "");
  const [encodedPayload, receivedSignature, ...extraParts] = token.split(".");
  if (!encodedPayload || !receivedSignature || extraParts.length) {
    throw new HttpError(401, "Autorização de upload inválida.");
  }

  const expectedSignature = createHmac("sha256", albumUploadSigningSecret)
    .update(encodedPayload)
    .digest();
  let receivedBuffer;
  try {
    receivedBuffer = Buffer.from(receivedSignature, "base64url");
  } catch {
    throw new HttpError(401, "Autorização de upload inválida.");
  }
  if (receivedBuffer.length !== expectedSignature.length || !timingSafeEqual(receivedBuffer, expectedSignature)) {
    throw new HttpError(401, "Autorização de upload inválida.");
  }

  let payload;
  try {
    payload = JSON.parse(Buffer.from(encodedPayload, "base64url").toString("utf8"));
  } catch {
    throw new HttpError(401, "Autorização de upload inválida.");
  }

  if (!Number.isSafeInteger(payload.expiresAt) || payload.expiresAt < Date.now()) {
    throw new HttpError(401, "A autorização do upload expirou. Envie o arquivo novamente.");
  }
  if (!String(payload.storageKey || "").startsWith(albumR2KeyPrefix)) {
    throw new HttpError(401, "Destino do upload inválido.");
  }

  const file = requireAlbumFile(payload);
  return {
    ...file,
    guestName: requireText(payload.guestName, "Nome", { min: 2, max: 80 }),
    category: requireAlbumCategory(payload.category),
    storageKey: String(payload.storageKey),
    contentHash: requireContentHash(payload.contentHash),
    challengeId: optionalAlbumChallengeId(payload.challengeId),
  };
}

function validateAlbumMediaMeasurements(body) {
  const parseInteger = (value, label) => {
    if (value == null || value === "") return null;
    const parsed = Number(value);
    if (!Number.isSafeInteger(parsed) || parsed <= 0 || parsed > 32_000) {
      throw new HttpError(400, `${label} inválida.`);
    }
    return parsed;
  };
  const width = parseInteger(body.width, "Largura");
  const height = parseInteger(body.height, "Altura");
  const duration = body.duration == null || body.duration === "" ? null : Number(body.duration);
  if (duration != null && (!Number.isFinite(duration) || duration < 0 || duration > 3600)) {
    throw new HttpError(400, "Duração inválida.");
  }
  return { width, height, duration };
}

async function requireR2UploadResult(body) {
  const upload = requireAlbumUploadToken(body.uploadToken);
  let storedObject;
  try {
    storedObject = await r2Client.send(new HeadObjectCommand({
      Bucket: r2BucketName,
      Key: upload.storageKey,
    }));
  } catch (error) {
    if (error?.$metadata?.httpStatusCode === 404 || error?.name === "NotFound") {
      throw new HttpError(409, "O arquivo ainda não chegou ao armazenamento.");
    }
    throw error;
  }

  if (Number(storedObject.ContentLength) !== upload.fileSize) {
    throw new HttpError(409, "O tamanho recebido não corresponde ao arquivo enviado.");
  }
  const storedContentType = String(storedObject.ContentType || "").split(";")[0].trim().toLowerCase();
  if (storedContentType && storedContentType !== upload.fileType) {
    throw new HttpError(409, "O formato recebido não corresponde ao arquivo enviado.");
  }

  return {
    ...upload,
    ...validateAlbumMediaMeasurements(body),
    etag: String(storedObject.ETag || "").replace(/^\"|\"$/g, "") || null,
    format: albumFileExtensions.get(upload.fileType),
  };
}

function buildCloudinaryUrl(media, transformation = "", outputFormat = media.format) {
  const publicId = media.public_id
    .split("/")
    .map((segment) => encodeURIComponent(segment))
    .join("/");
  const transformPath = transformation ? `${transformation}/` : "";
  return `https://res.cloudinary.com/${encodeURIComponent(cloudinaryCloudName)}/${media.resource_type}/upload/${transformPath}v${media.version}/${publicId}.${outputFormat}`;
}

function buildR2PublicUrl(storageKey) {
  const encodedKey = String(storageKey)
    .split("/")
    .map((segment) => encodeURIComponent(segment))
    .join("/");
  return `${r2PublicBaseUrl}/${encodedKey}`;
}

function buildR2ImageUrl(sourceUrl, transformation) {
  if (!r2ImageTransformBaseUrl) return sourceUrl;
  return `${r2ImageTransformBaseUrl}/cdn-cgi/image/${transformation}/${sourceUrl}`;
}

function normalizeAlbumMedia(media) {
  if (media.storage_provider === "r2" || media.storage_key) {
    const isVideo = media.resource_type === "video";
    const originalUrl = buildR2PublicUrl(media.storage_key);
    return {
      id: media.id,
      guestName: media.guest_name,
      category: media.category,
      resourceType: media.resource_type,
      mimeType: media.mime_type,
      bytes: Number(media.bytes),
      width: media.width == null ? null : Number(media.width),
      height: media.height == null ? null : Number(media.height),
      duration: media.duration == null ? null : Number(media.duration),
      originalUrl,
      displayUrl: isVideo
        ? originalUrl
        : buildR2ImageUrl(originalUrl, "width=2400,fit=scale-down,quality=90,format=auto"),
      thumbnailUrl: isVideo
        ? null
        : buildR2ImageUrl(originalUrl, "width=900,height=1200,fit=cover,quality=82,format=auto"),
      backupStatus: media.backup_status || "pending",
      contentHash: media.content_hash || null,
      challengeId: media.challenge_id || null,
      createdAt: media.created_at,
    };
  }

  if (!hasCloudinaryConfig) return null;
  const isVideo = media.resource_type === "video";
  return {
    id: media.id,
    guestName: media.guest_name,
    category: media.category,
    resourceType: media.resource_type,
    mimeType: `${isVideo ? "video" : "image"}/${media.format === "jpg" ? "jpeg" : media.format}`,
    bytes: Number(media.bytes),
    width: media.width == null ? null : Number(media.width),
    height: media.height == null ? null : Number(media.height),
    duration: media.duration == null ? null : Number(media.duration),
    originalUrl: buildCloudinaryUrl(media),
    displayUrl: buildCloudinaryUrl(
      media,
      isVideo ? "f_auto,q_auto:best,vc_auto" : "f_auto,q_auto:best,c_limit,w_2400",
    ),
    thumbnailUrl: buildCloudinaryUrl(
      media,
      isVideo ? "so_0,f_jpg,q_auto:good,c_fill,g_auto,w_900,h_1200" : "f_auto,q_auto:good,c_fill,g_auto,w_900,h_1200",
      isVideo ? "jpg" : media.format,
    ),
    createdAt: media.created_at,
    contentHash: media.content_hash || null,
    challengeId: media.challenge_id || null,
  };
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
    const message = data?.message
      || data?.error_description
      || data?.hint
      || data?.error
      || (typeof data === "string" ? data : null)
      || "Erro ao chamar o Supabase.";
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

// O Supabase devolve no máximo 1000 linhas por consulta, mesmo pedindo mais.
// Lê em páginas até acabar; o path deve ter um "order" estável (ex.: terminando em id).
async function readSupabaseTableAll(path, pageSize = 500) {
  const rows = [];
  for (let offset = 0; ; offset += pageSize) {
    const page = await readSupabaseTable(`${path}&limit=${pageSize}&offset=${offset}`);
    const list = Array.isArray(page) ? page : [];
    rows.push(...list);
    if (list.length < pageSize) return rows;
  }
}

async function countSupabaseRows(pathQuery) {
  const endpoint = new URL(`/rest/v1/${pathQuery}`, supabaseUrl);
  const supabaseResponse = await fetch(endpoint, {
    headers: {
      ...getSupabaseHeaders(),
      Prefer: "count=exact",
    },
  });
  const responseText = await supabaseResponse.text();

  if (!supabaseResponse.ok) {
    let data = null;
    try {
      data = responseText ? JSON.parse(responseText) : null;
    } catch {
      data = null;
    }
    const message = data?.message || data?.error_description || data?.hint || "Erro ao ler o Supabase.";
    throw new Error(message);
  }

  const contentRange = supabaseResponse.headers.get("content-range") || "";
  const total = Number(contentRange.split("/")[1]);
  return Number.isFinite(total) ? total : 0;
}

function incrementCount(map, key) {
  const label = String(key || "—");
  map[label] = (map[label] || 0) + 1;
}

function householdPeopleCount(household) {
  return Array.isArray(household.members) ? household.members.length : 0;
}

async function loadGiftsEngagementStats(confirmedGuestNames = new Set()) {
  const empty = {
    configured: false,
    areaViews: 0,
    listOpened: 0,
    modalOpens: 0,
    uniqueSessions: 0,
    identifiedGuests: 0,
    sessionsWithName: 0,
    confirmedVisitors: 0,
    funnel: { sawSection: 0, openedList: 0, openedGiftModal: 0 },
    recentVisitors: [],
    visitorSessions: [],
  };

  try {
    const events = await readSupabaseTable(
      "site_engagement_events?select=event_type,guest_name,session_key,gift_id,created_at&order=created_at.desc&limit=400",
    );
    const rows = Array.isArray(events) ? events : [];
    let areaViews = 0;
    let listOpened = 0;
    let modalOpens = 0;
    for (const row of rows) {
      if (row.event_type === "gifts_area_view") areaViews += 1;
      else if (row.event_type === "gifts_list_opened") listOpened += 1;
      else if (row.event_type === "gift_modal_opened") modalOpens += 1;
    }
    const sessions = new Map();

    for (const row of rows) {
      const key = row.session_key;
      if (!key) continue;
      let session = sessions.get(key);
      if (!session) {
        session = {
          sessionKey: key,
          guestName: row.guest_name || null,
          areaViewAt: null,
          listOpenedAt: null,
          modalOpens: 0,
          lastGiftId: null,
          firstSeenAt: row.created_at,
          lastSeenAt: row.created_at,
        };
        sessions.set(key, session);
      }
      if (row.guest_name && !session.guestName) session.guestName = row.guest_name;
      if (Date.parse(row.created_at || "") < Date.parse(session.firstSeenAt || "")) {
        session.firstSeenAt = row.created_at;
      }
      if (row.event_type === "gifts_area_view" && !session.areaViewAt) session.areaViewAt = row.created_at;
      if (row.event_type === "gifts_list_opened" && !session.listOpenedAt) session.listOpenedAt = row.created_at;
      if (row.event_type === "gift_modal_opened") {
        session.modalOpens += 1;
        session.lastGiftId = row.gift_id || session.lastGiftId;
      }
      if (Date.parse(row.created_at || "") > Date.parse(session.lastSeenAt || "")) {
        session.lastSeenAt = row.created_at;
      }
    }

    const sessionList = [...sessions.values()];
    const sessionsByGuest = new Map();
    for (const session of sessionList) {
      if (!session.guestName) continue;
      const normalized = normalizeGuestName(session.guestName);
      const bucket = sessionsByGuest.get(normalized) || [];
      bucket.push(session);
      sessionsByGuest.set(normalized, bucket);
    }
    for (const [, guestSessions] of sessionsByGuest) {
      guestSessions.sort(
        (left, right) => Date.parse(left.firstSeenAt || "") - Date.parse(right.firstSeenAt || ""),
      );
      guestSessions.forEach((session, index) => {
        session.visitNumber = index + 1;
        session.isReturnVisit = index > 0;
      });
    }
    for (const session of sessionList) {
      session.confirmedInRsvp = session.guestName
        ? confirmedGuestNames.has(normalizeGuestName(session.guestName))
        : false;
      if (!session.visitNumber) {
        session.visitNumber = 1;
        session.isReturnVisit = false;
      }
    }

    const guests = new Set();
    let sessionsWithName = 0;
    let confirmedVisitors = 0;

    for (const session of sessionList) {
      if (session.guestName) {
        sessionsWithName += 1;
        guests.add(normalizeGuestName(session.guestName));
        if (confirmedGuestNames.has(normalizeGuestName(session.guestName))) {
          confirmedVisitors += 1;
        }
      }
    }

    const funnel = {
      sawSection: sessionList.filter((s) => s.areaViewAt).length,
      openedList: sessionList.filter((s) => s.listOpenedAt).length,
      openedGiftModal: sessionList.filter((s) => s.modalOpens > 0).length,
    };

    const recentVisitors = sessionList
      .sort((left, right) => Date.parse(right.lastSeenAt || "") - Date.parse(left.lastSeenAt || ""))
      .slice(0, 25);

    const visitorSessions = sessionList
      .sort((left, right) => Date.parse(right.lastSeenAt || "") - Date.parse(left.lastSeenAt || ""))
      .slice(0, 100);

    return {
      configured: true,
      areaViews,
      listOpened,
      modalOpens,
      uniqueSessions: sessionList.length,
      identifiedGuests: guests.size,
      sessionsWithName,
      confirmedVisitors,
      funnel,
      recentVisitors,
      visitorSessions,
    };
  } catch {
    return empty;
  }
}

async function loadGuestRememberStats(primaryNameById = new Map()) {
  const empty = {
    configured: false,
    summary: { devices: 0, returningDevices: 0, guestsWithDevice: 0 },
    devices: [],
  };

  try {
    const rows = await readSupabaseTable(
      "rsvp_remember_tokens?select=primary_rsvp_id,created_at,last_seen_at&order=last_seen_at.desc&limit=500",
    );
    const list = Array.isArray(rows) ? rows : [];
    const devices = list
      .map((row) => {
        const guestName = primaryNameById.get(row.primary_rsvp_id);
        if (!guestName) return null;
        const createdMs = Date.parse(row.created_at || "");
        const lastMs = Date.parse(row.last_seen_at || "");
        const returned = Number.isFinite(createdMs) && Number.isFinite(lastMs) && lastMs - createdMs > 5 * 60 * 1000;
        return {
          guestName,
          createdAt: row.created_at,
          lastSeenAt: row.last_seen_at,
          returned,
        };
      })
      .filter(Boolean);

    return {
      configured: true,
      summary: {
        devices: devices.length,
        returningDevices: devices.filter((device) => device.returned).length,
        guestsWithDevice: new Set(devices.map((device) => normalizeGuestName(device.guestName))).size,
      },
      devices,
    };
  } catch {
    return empty;
  }
}

function computeGiftBilling(catalogEnriched, inPersonReservations, paymentRows) {
  let catalogTotal = 0;
  let guaranteedTotal = 0;
  let fixedCatalogTotal = 0;
  let fixedGuaranteed = 0;
  let quotaCatalogTotal = 0;
  let quotaGuaranteed = 0;
  const giftRows = [];

  for (const gift of catalogEnriched) {
    if (gift.type === "fixed") {
      const value = Number(gift.value) || 0;
      catalogTotal += value;
      fixedCatalogTotal += value;
      const guaranteed = gift.status === "reserved" ? value : 0;
      guaranteedTotal += guaranteed;
      fixedGuaranteed += guaranteed;
      giftRows.push({
        id: gift.id,
        name: gift.name,
        type: "fixed",
        section: gift.section,
        catalogAmount: value,
        guaranteedAmount: guaranteed,
        remainingAmount: Math.max(0, value - guaranteed),
        status: gift.status,
      });
    } else if (gift.type === "quota") {
      const goal = Number(gift.goal) || 0;
      const contributed = Number(gift.contributed) || 0;
      catalogTotal += goal;
      quotaCatalogTotal += goal;
      guaranteedTotal += contributed;
      quotaGuaranteed += contributed;
      giftRows.push({
        id: gift.id,
        name: gift.name,
        type: "quota",
        section: gift.section,
        catalogAmount: goal,
        guaranteedAmount: contributed,
        remainingAmount: Math.max(0, goal - contributed),
        status: gift.status,
        progressPercent: gift.progressPercent,
      });
    } else if (gift.type === "open") {
      const contributed = Number(gift.contributed) || 0;
      giftRows.push({
        id: gift.id,
        name: gift.name,
        type: "open",
        section: gift.section,
        catalogAmount: 0,
        guaranteedAmount: contributed,
        remainingAmount: 0,
        status: gift.status,
        contributionCount: gift.contributionCount ?? 0,
      });
    }
  }

  let committedInPerson = 0;
  for (const row of inPersonReservations) {
    committedInPerson += Number(row.amount) || 0;
  }

  let receivedOnline = 0;
  let pendingOnline = 0;
  for (const order of paymentRows) {
    const amount = Number(order.amount) || 0;
    const status = String(order.status || "").toLowerCase();
    if (status === "approved" || status === "paid") receivedOnline += amount;
    else if (status === "pending") pendingOnline += amount;
  }

  const remainingTotal = Math.max(0, catalogTotal - guaranteedTotal);
  const progressPercent = catalogTotal > 0
    ? Math.min(100, Math.round((guaranteedTotal / catalogTotal) * 100))
    : 0;

  giftRows.sort((left, right) => right.remainingAmount - left.remainingAmount || left.name.localeCompare(right.name, "pt-BR"));

  const openGuaranteed = giftRows
    .filter((row) => row.type === "open")
    .reduce((sum, row) => sum + (Number(row.guaranteedAmount) || 0), 0);

  return {
    catalogTotal,
    guaranteedTotal,
    remainingTotal,
    progressPercent,
    fixedCatalogTotal,
    fixedGuaranteed,
    fixedRemaining: Math.max(0, fixedCatalogTotal - fixedGuaranteed),
    quotaCatalogTotal,
    quotaGuaranteed,
    quotaRemaining: Math.max(0, quotaCatalogTotal - quotaGuaranteed),
    openGuaranteed,
    receivedOnline,
    pendingOnline,
    committedInPerson,
    giftRows,
  };
}

async function readGiftReservationsForSupport() {
  const withPayment = "gift_reservations?select=id,gift_id,guest_name,gift_name,gift_type,amount,created_at,payment_order_id&order=created_at.desc&limit=200";
  const withoutPayment = "gift_reservations?select=id,gift_id,guest_name,gift_name,gift_type,amount,created_at&order=created_at.desc&limit=200";
  try {
    return await readSupabaseTable(withPayment);
  } catch {
    const rows = await readSupabaseTable(withoutPayment);
    return Array.isArray(rows) ? rows.map((row) => ({ ...row, payment_order_id: null })) : [];
  }
}

async function readPaymentOrdersForSupport() {
  try {
    return await readSupabaseTable(
      "payment_orders?select=id,gift_id,guest_name,gift_name,gift_type,amount,status,buyer_email,message,created_at,paid_at,approved_at&order=created_at.desc&limit=200",
    );
  } catch {
    return [];
  }
}

async function loadGiftSupportDetails() {
  const empty = {
    catalog: [],
    reservations: [],
    inPersonReservations: [],
    openContributions: [],
    payments: [],
    giftsAvailable: 0,
    giftsReserved: 0,
    giftsHidden: 0,
    paymentTotals: { pending: 0, approved: 0, rejected: 0, other: 0 },
    billing: {
      catalogTotal: 0,
      guaranteedTotal: 0,
      remainingTotal: 0,
      progressPercent: 0,
      fixedCatalogTotal: 0,
      fixedGuaranteed: 0,
      fixedRemaining: 0,
      quotaCatalogTotal: 0,
      quotaGuaranteed: 0,
      quotaRemaining: 0,
      receivedOnline: 0,
      pendingOnline: 0,
      committedInPerson: 0,
      openGuaranteed: 0,
      giftRows: [],
    },
    summary: {
      approvedAmount: 0,
      pendingAmount: 0,
      reservedAmount: 0,
      uniqueReservers: 0,
      uniqueInPersonReservers: 0,
      uniquePayers: 0,
      fixedAvailable: 0,
      fixedReserved: 0,
      quotaInProgress: 0,
      openContributionsCount: 0,
      openContributionsTotal: 0,
    },
    openContributions: [],
  };

  try {
    const catalogRaw = await getPublicGifts();
    const catalog = (Array.isArray(catalogRaw) ? catalogRaw : []).map((gift) => ({
      id: gift.id,
      name: gift.name,
      type: gift.gift_type || gift.type,
      section: gift.section,
      category: gift.category,
      status: gift.status,
      value: gift.value == null ? null : Number(gift.value),
      goal: gift.goal == null ? null : Number(gift.goal),
      contributed: Number(gift.contributed_amount || gift.contributed || 0),
      options: Array.isArray(gift.quota_options) ? gift.quota_options : [],
    }));

    const [
      reservations,
      payments,
    ] = await Promise.all([
      readGiftReservationsForSupport(),
      readPaymentOrdersForSupport(),
    ]);

    let giftsAvailable = 0;
    let giftsReserved = 0;
    let giftsHidden = 0;
    for (const gift of catalog) {
      if (gift.status === "available") giftsAvailable += 1;
      else if (gift.status === "reserved") giftsReserved += 1;
      else if (gift.status === "hidden") giftsHidden += 1;
    }

    const reservationRows = (Array.isArray(reservations) ? reservations : []).map((row) => ({
      ...row,
      modality: row.payment_order_id == null ? "in_person" : "online",
    }));
    const inPersonReservations = reservationRows.filter((row) => row.modality === "in_person");
    const paymentRows = Array.isArray(payments) ? payments : [];
    const reservedByGift = new Map();
    const contributionsByGift = new Map();
    for (const row of reservationRows) {
      const amount = Number(row.amount) || 0;
      const existing = contributionsByGift.get(row.gift_id) || { count: 0, total: 0, last: null };
      existing.count += 1;
      existing.total += amount;
      if (!existing.last || Date.parse(row.created_at || "") >= Date.parse(existing.last.at || "")) {
        existing.last = {
          guestName: row.guest_name,
          amount: row.amount,
          at: row.created_at,
        };
      }
      contributionsByGift.set(row.gift_id, existing);

      if (row.gift_type !== "open" && !reservedByGift.has(row.gift_id)) {
        reservedByGift.set(row.gift_id, {
          guestName: row.guest_name,
          amount: row.amount,
          at: row.created_at,
        });
      }
    }

    const openContributions = reservationRows.filter((row) => row.gift_type === "open");
    let openContributionsTotal = 0;
    for (const row of openContributions) {
      openContributionsTotal += Number(row.amount) || 0;
    }

    const catalogEnriched = catalog.map((gift) => {
      const contributions = contributionsByGift.get(gift.id);
      return {
        ...gift,
        reservedBy: gift.type === "open" ? contributions?.last || null : reservedByGift.get(gift.id) || null,
        contributionCount: contributions?.count ?? 0,
        contributionTotal: contributions?.total ?? (gift.type === "open" ? gift.contributed : null),
        progressPercent: gift.type === "quota" && gift.goal
          ? Math.min(100, Math.round((gift.contributed / gift.goal) * 100))
          : null,
      };
    });

    const paymentTotals = { pending: 0, approved: 0, rejected: 0, other: 0 };
    let approvedAmount = 0;
    let pendingAmount = 0;
    const reservers = new Set();
    const inPersonReservers = new Set();
    const payers = new Set();

    for (const row of reservationRows) {
      reservers.add(normalizeGuestName(row.guest_name));
    }
    for (const row of inPersonReservations) {
      inPersonReservers.add(normalizeGuestName(row.guest_name));
    }

    for (const order of paymentRows) {
      payers.add(normalizeGuestName(order.guest_name));
      const amount = Number(order.amount) || 0;
      const status = String(order.status || "").toLowerCase();
      if (status === "pending") {
        paymentTotals.pending += 1;
        pendingAmount += amount;
      } else if (status === "approved" || status === "paid") {
        paymentTotals.approved += 1;
        approvedAmount += amount;
      } else if (status === "rejected" || status === "cancelled") {
        paymentTotals.rejected += 1;
      } else {
        paymentTotals.other += 1;
      }
    }

    let reservedAmount = 0;
    let fixedAvailable = 0;
    let fixedReserved = 0;
    let quotaInProgress = 0;
    for (const gift of catalogEnriched) {
      if (gift.type === "fixed") {
        if (gift.status === "available") fixedAvailable += 1;
        if (gift.status === "reserved") {
          fixedReserved += 1;
          reservedAmount += Number(gift.value) || 0;
        }
      } else if (gift.type === "quota" && gift.contributed > 0 && gift.contributed < (gift.goal || 0)) {
        quotaInProgress += 1;
      }
    }

    const billing = computeGiftBilling(catalogEnriched, inPersonReservations, paymentRows);

    return {
      catalog: catalogEnriched,
      reservations: reservationRows,
      inPersonReservations,
      openContributions,
      payments: paymentRows,
      giftsAvailable,
      giftsReserved,
      giftsHidden,
      paymentTotals,
      billing,
      summary: {
        approvedAmount,
        pendingAmount,
        reservedAmount,
        uniqueReservers: reservers.size,
        uniqueInPersonReservers: inPersonReservers.size,
        uniquePayers: payers.size,
        fixedAvailable,
        fixedReserved,
        quotaInProgress,
        openContributionsCount: openContributions.length,
        openContributionsTotal,
      },
    };
  } catch (error) {
    console.error("loadGiftSupportDetails failed:", error?.message || error);
    return empty;
  }
}

async function loadAlbumSupportStats() {
  const base = {
    configured: hasAlbumConfig,
    publicOpen: isAlbumPubliclyOpen(),
    publicOpenAt: albumPublicOpenAtRaw,
    mediaCount: 0,
    contributorCount: 0,
    recentUploads: [],
  };

  if (!hasAlbumConfig) return base;

  try {
    const [mediaCount, mediaRows, contributorRows] = await Promise.all([
      countSupabaseRows("album_media?select=id"),
      readSupabaseTable(
        `album_media?select=guest_name,category,created_at&order=created_at.desc&limit=25`,
      ),
      readSupabaseTable("album_media?select=guest_name&order=created_at.desc&limit=300"),
    ]);
    const rows = Array.isArray(mediaRows) ? mediaRows : [];
    const contributorList = Array.isArray(contributorRows) ? contributorRows : [];
    const contributors = new Set(
      contributorList.map((row) => normalizeGuestName(row.guest_name)).filter(Boolean),
    );

    return {
      ...base,
      mediaCount,
      contributorCount: contributors.size,
      recentUploads: rows,
    };
  } catch {
    return base;
  }
}

async function buildSupportOverviewCached({ bypassCache = false } = {}) {
  const now = Date.now();
  if (!bypassCache && supportOverviewCache.payload && supportOverviewCache.expiresAt > now) {
    return supportOverviewCache.payload;
  }
  if (supportOverviewBuildPromise) {
    return supportOverviewBuildPromise;
  }

  supportOverviewBuildPromise = buildSupportOverview()
    .then((payload) => {
      supportOverviewCache = {
        payload,
        expiresAt: Date.now() + supportOverviewCacheTtlMs,
      };
      return payload;
    })
    .finally(() => {
      supportOverviewBuildPromise = null;
    });

  return supportOverviewBuildPromise;
}

async function buildSupportOverview() {
  if (!hasSupabaseConfig) {
    throw new HttpError(503, "Supabase não configurado.");
  }

  const rows = await readSupabaseTable(
    "rsvps?select=id,guest_name,party_size,primary_rsvp_id,created_at,updated_at&order=created_at.asc,guest_name.asc",
  );
  const allRows = Array.isArray(rows) ? rows : [];
  const primaries = allRows.filter((row) => !row.primary_rsvp_id);
  const companionsByPrimary = new Map();

  for (const row of allRows) {
    if (!row.primary_rsvp_id) continue;
    const bucket = companionsByPrimary.get(row.primary_rsvp_id) || [];
    bucket.push(row);
    companionsByPrimary.set(row.primary_rsvp_id, bucket);
  }

  const titularByPartySize = {};
  const companionByPartySize = {};

  for (const row of allRows) {
    if (row.primary_rsvp_id) incrementCount(companionByPartySize, row.party_size);
    else incrementCount(titularByPartySize, row.party_size);
  }

  const households = primaries.map((primary) => {
    const companions = companionsByPrimary.get(primary.id) || [];
    const members = [
      { name: primary.guest_name, partySize: primary.party_size },
      ...companions.map((companion) => ({
        name: companion.guest_name,
        partySize: companion.party_size,
      })),
    ];

    return {
      id: primary.id,
      titular: primary.guest_name,
      partySize: primary.party_size,
      createdAt: primary.created_at,
      updatedAt: primary.updated_at,
      members,
    };
  }).sort((left, right) => {
    const leftTime = Date.parse(left.updatedAt || left.createdAt || "") || 0;
    const rightTime = Date.parse(right.updatedAt || right.createdAt || "") || 0;
    return rightTime - leftTime;
  });

  const segments = {
    solo: { households: 0, people: 0 },
    couples: { households: 0, people: 0 },
    families: { households: 0, people: 0 },
    withMinors: { households: 0, people: 0 },
  };

  const peopleByType = {};
  for (const household of households) {
    const people = householdPeopleCount(household);
    peopleByType[household.partySize] = (peopleByType[household.partySize] || 0) + people;

    const type = household.partySize;
    if (type === "Somente eu") {
      segments.solo.households += 1;
      segments.solo.people += people;
    } else if (type === "Casal") {
      segments.couples.households += 1;
      segments.couples.people += people;
    } else if (type === "Família") {
      segments.families.households += 1;
      segments.families.people += people;
    } else if (type === "Responsável e menores") {
      segments.withMinors.households += 1;
      segments.withMinors.people += people;
    }
  }

  const recentConfirmations = households.slice(0, 12);

  const confirmedGuestNames = new Set(
    allRows.map((row) => normalizeGuestName(row.guest_name)).filter(Boolean),
  );

  const primaryNameById = new Map(households.map((household) => [household.id, household.titular]));

  const [engagement, giftDetails, album, guestRemember] = await Promise.all([
    loadGiftsEngagementStats(confirmedGuestNames),
    loadGiftSupportDetails(),
    loadAlbumSupportStats(),
    loadGuestRememberStats(primaryNameById),
  ]);

  const engagementWithRemember = { ...engagement, guestRemember };

  const engagementNames = new Set(
    (engagement.visitorSessions || [])
      .map((session) => session.guestName)
      .filter(Boolean)
      .map((name) => normalizeGuestName(name)),
  );
  const confirmedWithoutGiftVisit = primaries
    .map((primary) => primary.guest_name)
    .filter((name) => !engagementNames.has(normalizeGuestName(name)));

  return {
    generatedAt: new Date().toISOString(),
    counts: {
      people: allRows.length,
      households: primaries.length,
      titularByPartySize,
      companionByPartySize,
      peopleByTitularType: peopleByType,
    },
    segments,
    households,
    recentConfirmations,
    engagement: engagementWithRemember,
    gifts: {
      ...giftDetails,
      engagement: engagementWithRemember,
      insights: {
        confirmedWithoutGiftVisit: confirmedWithoutGiftVisit.slice(0, 50),
        confirmedWhoVisitedGifts: engagementWithRemember.confirmedVisitors ?? 0,
      },
    },
    album,
    services: {
      supabaseConfigured: hasSupabaseConfig,
      mercadoPagoConfigured: hasMercadoPagoConfig,
      albumConfigured: hasAlbumConfig,
      albumPublicOpen: isAlbumPubliclyOpen(),
    },
  };
}

async function insertSupabaseTable(path, payload) {
  const endpoint = new URL(`/rest/v1/${path}`, supabaseUrl);
  const supabaseResponse = await fetch(endpoint, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "Prefer": "return=representation",
      ...getSupabaseHeaders(),
    },
    body: JSON.stringify(payload),
  });
  const responseText = await supabaseResponse.text();
  const data = responseText ? JSON.parse(responseText) : null;

  if (!supabaseResponse.ok) {
    const message = data?.message || data?.error_description || data?.hint || "Erro ao salvar no Supabase.";
    throw new Error(message);
  }

  return data;
}

async function deleteSupabaseTable(path) {
  const endpoint = new URL(`/rest/v1/${path}`, supabaseUrl);
  const supabaseResponse = await fetch(endpoint, {
    method: "DELETE",
    headers: {
      "Prefer": "return=representation",
      ...getSupabaseHeaders(),
    },
  });
  const responseText = await supabaseResponse.text();
  const data = responseText ? JSON.parse(responseText) : null;

  if (!supabaseResponse.ok) {
    const message = data?.message || data?.error_description || data?.hint || "Erro ao excluir no Supabase.";
    throw new Error(message);
  }

  return data;
}

async function patchSupabaseTable(path, payload) {
  const endpoint = new URL(`/rest/v1/${path}`, supabaseUrl);
  const supabaseResponse = await fetch(endpoint, {
    method: "PATCH",
    headers: {
      "Content-Type": "application/json",
      "Prefer": "return=representation",
      ...getSupabaseHeaders(),
    },
    body: JSON.stringify(payload),
  });
  const responseText = await supabaseResponse.text();
  const data = responseText ? JSON.parse(responseText) : null;

  if (!supabaseResponse.ok) {
    const message = data?.message || data?.error_description || data?.hint || "Erro ao atualizar no Supabase.";
    throw new Error(message);
  }

  return data;
}

function normalizeAlbumChallenge(challenge) {
  return {
    id: challenge.id,
    title: challenge.title,
    description: challenge.description || "",
    points: Number(challenge.points || 1),
    active: Boolean(challenge.active),
    scope: challenge.scope === "all" ? "all" : "draw",
    difficulty: Object.hasOwn(albumChallengeDifficultyPoints, challenge.difficulty) ? challenge.difficulty : "easy",
    couple: Boolean(challenge.couple),
    wedding: Boolean(challenge.wedding || challenge.couple),
    maxAssignees: challenge.max_assignees == null ? null : Number(challenge.max_assignees),
  };
}

async function readAlbumChallenges() {
  return readSupabaseTableAll(`album_challenges?select=${albumChallengeSelect}&order=sort_order.asc,created_at.asc,id.asc`);
}

// Convidado só envia foto para desafio "para todos" ou sorteado para ele; os noivos, para qualquer um.
async function requireOpenAlbumChallenge(challengeId, guestName) {
  const rows = await readSupabaseTable(
    `album_challenges?select=id,active,scope&id=eq.${encodeURIComponent(challengeId)}&limit=1`,
  );
  const challenge = Array.isArray(rows) ? rows[0] : rows;
  if (!challenge?.id) throw new HttpError(404, "Desafio não encontrado.");
  if (!challenge.active) throw new HttpError(409, "Este desafio já foi encerrado.");
  if (challenge.scope !== "all" && !isAlbumAdmin(guestName)) {
    const assigned = await readSupabaseTable(
      `album_challenge_assignments?select=id&guest_key=eq.${encodeURIComponent(normalizeGuestName(guestName))}`
      + `&challenge_id=eq.${encodeURIComponent(challenge.id)}&active=eq.true&limit=1`,
    );
    if (!assigned?.[0]?.id) throw new HttpError(403, "Este desafio não é um dos seus.");
  }
  return challenge.id;
}

async function assignAlbumChallenges(guestName) {
  return callSupabaseRpc("assign_album_challenges", {
    p_guest_key: normalizeGuestName(guestName),
    p_guest_name: guestName,
  });
}

// Ranking a partir de todas as mídias do álbum:
// - cada desafio conta uma vez por convidado, na data da primeira prova enviada;
// - em cada desafio, os primeiros a completar ganham o bônus de rapidez;
// - toda foto/vídeo soma, até o teto.
// Desempate: mais desafios, mais bônus de rapidez e, por fim, quem chegou antes à pontuação.
// Só conta desafio "para todos" ou sorteado para a pessoa.
function buildAlbumChallengeBoard(challengeRows, mediaRows, viewerGuestName, { assignments = [], viewerIsAdmin = false } = {}) {
  const challenges = challengeRows.map(normalizeAlbumChallenge);
  const challengeById = new Map(challenges.map((challenge) => [challenge.id, challenge]));
  const people = new Map();
  const activeAssignments = new Set();
  const assignedCount = new Map();
  for (const row of assignments) {
    if (!row.active) continue;
    activeAssignments.add(`${row.guest_key}|${row.challenge_id}`);
    assignedCount.set(row.challenge_id, (assignedCount.get(row.challenge_id) || 0) + 1);
  }
  const isEligible = (guestKey, challenge) => challenge.scope === "all"
    || activeAssignments.has(`${guestKey}|${challenge.id}`);

  const sortedMedia = [...mediaRows].sort((a, b) => String(a.created_at).localeCompare(String(b.created_at)));
  for (const row of sortedMedia) {
    const key = normalizeGuestName(row.guest_name);
    if (!key) continue;
    const person = people.get(key) || {
      guestName: row.guest_name,
      photos: 0,
      lastPhotoAt: "",
      completedAt: new Map(),
      speedBonus: 0,
    };
    person.photos += 1;
    person.lastPhotoAt = row.created_at;
    const challenge = challengeById.get(row.challenge_id);
    if (challenge && isEligible(key, challenge) && !person.completedAt.has(challenge.id)) {
      person.completedAt.set(challenge.id, row.created_at);
    }
    people.set(key, person);
  }

  const completionsByChallenge = new Map();
  people.forEach((person) => {
    person.completedAt.forEach((completedAt, challengeId) => {
      const list = completionsByChallenge.get(challengeId) || [];
      list.push({ person, completedAt });
      completionsByChallenge.set(challengeId, list);
    });
  });
  completionsByChallenge.forEach((list) => {
    list.sort((a, b) => a.completedAt.localeCompare(b.completedAt));
    list.forEach(({ person }, index) => {
      person.speedBonus += albumScoreRules.speedBonuses[index] || 0;
    });
  });

  const leaderboard = Array.from(people.values()).map((person) => {
    let challengePoints = 0;
    let reachedAt = "";
    person.completedAt.forEach((completedAt, challengeId) => {
      challengePoints += challengeById.get(challengeId).points * albumScoreRules.pointsPerChallengePoint;
      if (completedAt > reachedAt) reachedAt = completedAt;
    });
    const photoPoints = Math.min(person.photos * albumScoreRules.pointsPerPhoto, albumScoreRules.maxPhotoPoints);
    // A pontuação de fotos só para de crescer no teto; depois disso, novas fotos não mudam a data.
    const photoReachedAt = person.photos * albumScoreRules.pointsPerPhoto <= albumScoreRules.maxPhotoPoints
      ? person.lastPhotoAt
      : "";
    return {
      guestName: person.guestName,
      points: challengePoints + person.speedBonus + photoPoints,
      completed: person.completedAt.size,
      challengePoints,
      speedBonus: person.speedBonus,
      photos: person.photos,
      photoPoints,
      completedIds: Array.from(person.completedAt.keys()),
      reachedAt: photoReachedAt > reachedAt ? photoReachedAt : reachedAt,
    };
  });

  leaderboard.sort((a, b) => b.points - a.points
    || b.completed - a.completed
    || b.speedBonus - a.speedBonus
    || a.reachedAt.localeCompare(b.reachedAt));
  leaderboard.forEach((entry, index) => {
    entry.rank = index + 1;
  });

  const viewerKey = normalizeGuestName(viewerGuestName);
  const viewer = leaderboard.find((entry) => normalizeGuestName(entry.guestName) === viewerKey);
  const viewerCompleted = new Set(viewer?.completedIds || []);
  const swapsUsed = assignments.filter((row) => row.guest_key === viewerKey && row.swapped).length;

  return {
    // Os noivos veem e administram todos; cada convidado vê os seus e os "para todos".
    challenges: challenges
      .filter((challenge) => viewerIsAdmin || isEligible(viewerKey, challenge))
      .map((challenge) => ({
        ...challenge,
        completedByMe: viewerCompleted.has(challenge.id),
        completedCount: completionsByChallenge.get(challenge.id)?.length || 0,
        ...(viewerIsAdmin ? { assignedCount: assignedCount.get(challenge.id) || 0 } : {}),
      })),
    leaderboard: leaderboard.map(({ completedIds, reachedAt, ...entry }) => entry),
    me: {
      points: viewer?.points || 0,
      completed: viewer?.completed || 0,
      challengePoints: viewer?.challengePoints || 0,
      speedBonus: viewer?.speedBonus || 0,
      photos: viewer?.photos || 0,
      photoPoints: viewer?.photoPoints || 0,
      rank: viewer?.rank || null,
      swapsLeft: viewerIsAdmin ? 0 : Math.max(0, albumChallengeSwapsPerGuest - swapsUsed),
    },
    rules: { ...albumScoreRules, difficultyPoints: albumChallengeDifficultyPoints },
  };
}

async function loadAlbumChallengeBoard(viewerGuestName) {
  const viewerIsAdmin = isAlbumAdmin(viewerGuestName);
  // Os noivos não participam do sorteio; convidados recebem os 4 na primeira vez que abrem.
  if (!viewerIsAdmin) await assignAlbumChallenges(viewerGuestName);
  const [challengeRows, mediaRows, assignmentRows] = await Promise.all([
    readAlbumChallenges(),
    readSupabaseTableAll("album_media?select=guest_name,challenge_id,created_at&order=created_at.asc,id.asc"),
    readSupabaseTableAll("album_challenge_assignments?select=guest_key,challenge_id,active,swapped&order=id.asc"),
  ]);
  return buildAlbumChallengeBoard(challengeRows, Array.isArray(mediaRows) ? mediaRows : [], viewerGuestName, {
    assignments: Array.isArray(assignmentRows) ? assignmentRows : [],
    viewerIsAdmin,
  });
}

let albumGuestDirectoryCache = { entries: null, expiresAt: 0 };

function invalidateAlbumGuestDirectory() {
  albumGuestDirectoryCache = { entries: null, expiresAt: 0 };
}

// Nomes que podem entrar no álbum: confirmações de presença + acessos criados no próprio álbum.
async function loadAlbumGuestDirectory() {
  if (albumGuestDirectoryCache.entries && albumGuestDirectoryCache.expiresAt > Date.now()) {
    return albumGuestDirectoryCache.entries;
  }
  const [rsvpRows, albumGuestRows] = await Promise.all([
    readSupabaseTableAll("rsvps?select=guest_name&order=id.asc"),
    readSupabaseTableAll("album_guests?select=guest_name&order=id.asc").catch(() => []),
  ]);
  const entries = new Map();
  const addRows = (rows, source) => {
    for (const row of Array.isArray(rows) ? rows : []) {
      const key = normalizeGuestName(row.guest_name);
      if (key && !entries.has(key)) entries.set(key, { guestName: row.guest_name, key, source });
    }
  };
  addRows(rsvpRows, "rsvp");
  addRows(albumGuestRows, "album");
  albumGuestDirectoryCache = { entries, expiresAt: Date.now() + 60_000 };
  return entries;
}

function searchAlbumGuestDirectory(entries, query, limit = 8) {
  const terms = normalizeGuestName(query).split(" ").filter(Boolean);
  if (!terms.length) return [];
  const matches = [];
  for (const entry of entries.values()) {
    const words = entry.key.split(" ");
    if (!terms.every((term) => words.some((word) => word.startsWith(term)))) continue;
    matches.push(entry);
  }
  matches.sort((a, b) => Number(!a.key.startsWith(terms[0])) - Number(!b.key.startsWith(terms[0]))
    || a.key.localeCompare(b.key, "pt-BR"));
  return matches.slice(0, limit).map((entry) => entry.guestName);
}

async function assertGuestNotRestricted(guestName) {
  let rows;
  try {
    rows = await readSupabaseTable("restricted_guests?select=guest_name&active=eq.true&limit=1000");
  } catch {
    return;
  }
  const key = normalizeGuestName(guestName);
  if ((Array.isArray(rows) ? rows : []).some((row) => normalizeGuestName(row.guest_name) === key)) {
    throw new HttpError(403, "Não foi possível liberar o álbum para este nome.");
  }
}

// Busca a família pelo id da confirmação (e não pelo nome), para funcionar com nomes acentuados.
async function readRememberedAlbumGuests(request) {
  const primaryId = await readRememberedPrimaryRsvpId(request);
  if (!primaryId) return [];
  try {
    const encodedId = encodeURIComponent(primaryId);
    const [primaryRows, companionRows] = await Promise.all([
      readSupabaseTable(`rsvps?select=guest_name&id=eq.${encodedId}&limit=1`),
      readSupabaseTable(`rsvps?select=guest_name&primary_rsvp_id=eq.${encodedId}&order=created_at.asc,guest_name.asc`),
    ]);
    const primaryName = (Array.isArray(primaryRows) ? primaryRows[0] : primaryRows)?.guest_name;
    if (!primaryName) return [];
    return [primaryName, ...(Array.isArray(companionRows) ? companionRows : []).map((row) => row.guest_name)]
      .filter(Boolean);
  } catch {
    return [];
  }
}

function requireAlbumPublicEntry(guestName) {
  if (isAlbumAdmin(guestName)) {
    throw new HttpError(403, "Os noivos entram com senha.", {}, { code: "admin_password" });
  }
  if (!isAlbumPubliclyOpen()) {
    throw new HttpError(403, "O álbum coletivo abre no dia 28/11, às 15h.");
  }
}

async function deleteAlbumMediaRecord(mediaId) {
  const rows = await deleteSupabaseTable(`album_media?id=eq.${encodeURIComponent(mediaId)}`);
  const deleted = Array.isArray(rows) ? rows[0] : rows;
  if (!deleted?.id) {
    throw new HttpError(404, "Memória não encontrada.");
  }
  return deleted;
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

function formatGiverFirstName(guestName) {
  const firstName = String(guestName || "").trim().split(/\s+/)[0] || "";
  if (firstName.length < 2) return "";
  return firstName.charAt(0).toLocaleUpperCase("pt-BR") + firstName.slice(1).toLocaleLowerCase("pt-BR");
}

// Reservas incluem as entregas em mãos e os pagamentos aprovados; só o primeiro nome é público.
async function loadGiftGiversByGiftId() {
  const giversByGiftId = new Map();
  let rows;
  try {
    rows = await readSupabaseTable("gift_reservations?select=gift_id,guest_name&order=created_at.asc&limit=2000");
  } catch (error) {
    console.error("loadGiftGiversByGiftId:", error?.message || error);
    return giversByGiftId;
  }

  for (const row of Array.isArray(rows) ? rows : []) {
    const firstName = formatGiverFirstName(row.guest_name);
    if (!row.gift_id || !firstName) continue;
    const givers = giversByGiftId.get(row.gift_id) || [];
    if (!givers.some((name) => normalizeGuestName(name) === normalizeGuestName(firstName))) {
      givers.push(firstName);
    }
    giversByGiftId.set(row.gift_id, givers);
  }
  return giversByGiftId;
}

function normalizeGift(gift, giversByGiftId = new Map()) {
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
    givers: giversByGiftId.get(gift.id) || [],
  };
}

async function handleApi(request, response, pathname) {
  if (request.method === "GET" && pathname === "/api/config") {
    sendJson(response, 200, {
      supabaseConfigured: hasSupabaseConfig,
      mercadoPagoConfigured: hasMercadoPagoConfig,
      mercadoPagoMode: hasMercadoPagoConfig ? mercadoPagoMode : "",
      albumConfigured: hasAlbumConfig,
      albumPublicOpenAt: albumPublicOpenAtRaw,
      albumPublicOpen: isAlbumPubliclyOpen(),
    });
    return true;
  }

  try {
    if (request.method === "POST" && pathname === "/api/engagement") {
      validateSameOriginRequest(request);
      enforceRateLimit(request, "engagement", 40, 10 * 60_000);
      if (!hasSupabaseConfig) {
        sendJson(response, 204, {});
        return true;
      }

      const body = await readJsonBody(request);
      const eventType = String(body.eventType || "").trim();
      if (!siteEngagementEventTypes.has(eventType)) {
        throw new HttpError(400, "Evento inválido.");
      }
      const sessionKey = requireText(body.sessionKey, "Sessão", { min: 8, max: 80 });
      const guestNameRaw = String(body.guestName ?? "").trim().replace(/\s+/g, " ");
      const guestName = guestNameRaw.length >= 2 ? guestNameRaw.slice(0, 120) : null;
      const giftIdRaw = String(body.giftId ?? "").trim();
      const giftId = /^[a-z0-9][a-z0-9-]{0,99}$/i.test(giftIdRaw) ? giftIdRaw : null;

      try {
        await insertSupabaseTable("site_engagement_events", {
          event_type: eventType,
          guest_name: guestName,
          session_key: sessionKey,
          ...(giftId ? { gift_id: giftId } : {}),
        });
      } catch {
        // Tabela ainda não migrada: não quebra o site.
      }

      sendJson(response, 204, {});
      return true;
    }

    if (request.method === "GET" && pathname === "/api/album/session") {
      const session = readAlbumSession(request);
      sendJson(response, 200, {
        authenticated: Boolean(session),
        guestName: session?.guestName || null,
        isAlbumAdmin: Boolean(session && isAlbumAdmin(session.guestName)),
        albumAvailable: Boolean(session && canAccessAlbum(session.guestName)),
        albumPublicOpenAt: albumPublicOpenAtRaw,
        albumPublicOpen: isAlbumPubliclyOpen(),
      });
      return true;
    }

    if (request.method === "POST" && pathname === "/api/album/login") {
      validateSameOriginRequest(request);
      enforceRateLimit(request, "album-login", 20, 10 * 60_000);
      if (!hasSupabaseConfig) throw new HttpError(503, "Confirmações ainda não estão disponíveis.");
      if (albumUploadSigningSecret.length < 32) throw new HttpError(503, "Sessão do álbum indisponível.");
      const body = await readJsonBody(request);
      const guestName = requireText(body.guestName, "Nome", { min: 2, max: 120 });
      const password = String(body.password ?? "");
      if (!password) throw new HttpError(400, "Senha obrigatória.");
      // Senha é só para os noivos; convidados entram por /api/album/enter.
      if (!isAlbumAdmin(guestName)) throw new HttpError(403, "Convidados entram no álbum sem senha.");

      let rows;
      try {
        rows = await callSupabaseRpc("authenticate_album_guest", {
          p_guest_name: guestName,
          p_password: password,
        });
      } catch (error) {
        const message = String(error.message || "");
        if (/senha do álbum ainda não foi configurada/i.test(message)) {
          throw new HttpError(503, "Senha do álbum ainda não foi configurada no banco.");
        }
        if (/senha incorreta/i.test(message)) throw new HttpError(403, "Senha incorreta.");
        if (/não encontrado|nome obrigatório/i.test(message)) {
          throw new HttpError(403, "Nome não encontrado nas confirmações de presença. Use exatamente o nome da confirmação.");
        }
        throw new HttpError(403, message || "Não foi possível entrar no álbum.");
      }

      const row = Array.isArray(rows) ? rows[0] : rows;
      if (!row?.guest_name) {
        throw new HttpError(403, "Não foi possível autenticar no álbum.");
      }
      if (!canAccessAlbum(row.guest_name)) {
        throw new HttpError(403, "O álbum coletivo abre no dia 28/11, às 15h.");
      }

      sendJson(response, 200, {
        ok: true,
        guestName: row.guest_name,
        isAlbumAdmin: isAlbumAdmin(row.guest_name),
      }, {
        "Set-Cookie": albumSessionCookieHeader(createAlbumSessionToken(row.guest_name)),
      });
      return true;
    }

    if (request.method === "GET" && pathname === "/api/album/entry") {
      enforceRateLimit(request, "album-entry", 60, 60_000);
      const remembered = hasSupabaseConfig && isAlbumPubliclyOpen()
        ? await readRememberedAlbumGuests(request)
        : [];
      sendJson(response, 200, {
        publicOpen: isAlbumPubliclyOpen(),
        publicOpenAt: albumPublicOpenAtRaw,
        remembered,
      });
      return true;
    }

    if (request.method === "GET" && pathname === "/api/album/guests") {
      enforceRateLimit(request, "album-guest-search", 90, 60_000);
      if (!hasSupabaseConfig) throw new HttpError(503, "Confirmações ainda não estão disponíveis.");
      const query = String(new URL(request.url, "http://127.0.0.1").searchParams.get("q") || "").slice(0, 80);
      // Sugere desde a primeira letra, mas devolve poucos nomes por vez.
      if (!normalizeGuestName(query)) {
        sendJson(response, 200, { guests: [] });
        return true;
      }
      // Antes da abertura só os noivos aparecem; escolher um deles pede a senha.
      const guests = searchAlbumGuestDirectory(await loadAlbumGuestDirectory(), query)
        .filter((name) => isAlbumPubliclyOpen() || isAlbumAdmin(name));
      sendJson(response, 200, { guests });
      return true;
    }

    if (request.method === "POST" && pathname === "/api/album/enter") {
      validateSameOriginRequest(request);
      enforceRateLimit(request, "album-enter", 30, 10 * 60_000);
      if (!hasSupabaseConfig) throw new HttpError(503, "Confirmações ainda não estão disponíveis.");
      if (albumUploadSigningSecret.length < 32) throw new HttpError(503, "Sessão do álbum indisponível.");
      const body = await readJsonBody(request);
      const source = String(body.source || "");
      const requestedName = requireText(body.guestName, "Nome", { min: 2, max: 120 });
      requireAlbumPublicEntry(requestedName);

      let guestName;
      if (source === "remembered") {
        const remembered = await readRememberedAlbumGuests(request);
        guestName = remembered.find((name) => normalizeGuestName(name) === normalizeGuestName(requestedName));
        if (!guestName) throw new HttpError(403, "Este aparelho não confirmou presença com esse nome.");
      } else if (source === "list") {
        guestName = (await loadAlbumGuestDirectory()).get(normalizeGuestName(requestedName))?.guestName;
        if (!guestName) throw new HttpError(404, "Nome não encontrado. Toque em \"Não achei meu nome\".");
      } else if (source === "new") {
        const typedName = requireFullGuestName(requestedName, "Nome");
        const key = normalizeGuestName(typedName);
        guestName = (await loadAlbumGuestDirectory()).get(key)?.guestName;
        if (!guestName) {
          await assertGuestNotRestricted(typedName);
          try {
            await insertSupabaseTable("album_guests", { guest_name: typedName, normalized_guest_name: key });
          } catch (error) {
            if (!/duplicate|unique/i.test(String(error.message || ""))) throw error;
          }
          invalidateAlbumGuestDirectory();
          guestName = typedName;
        }
      } else {
        throw new HttpError(400, "Forma de entrada inválida.");
      }
      requireAlbumPublicEntry(guestName);

      // Quem entra (inclusive acesso recém-criado) já recebe os desafios; se falhar, o álbum sorteia ao abrir.
      try {
        await assignAlbumChallenges(guestName);
      } catch (error) {
        console.error("assignAlbumChallenges:", error?.message || error);
      }

      sendJson(response, 200, { ok: true, guestName, isAlbumAdmin: false }, {
        "Set-Cookie": albumSessionCookieHeader(createAlbumSessionToken(guestName)),
      });
      return true;
    }

    if (request.method === "POST" && pathname === "/api/album/logout") {
      validateSameOriginRequest(request);
      sendJson(response, 200, { ok: true }, {
        "Set-Cookie": albumSessionCookieHeader("", { clear: true }),
      });
      return true;
    }

    if (pathname.startsWith("/api/support/") && !hasSupportPanelConfig) {
      throw new HttpError(404, "Painel de apoio indisponível.");
    }

    if (request.method === "GET" && pathname === "/api/support/session") {
      const session = readSupportSession(request);
      sendJson(response, 200, {
        authenticated: Boolean(session),
        guestName: session?.guestName || null,
      });
      return true;
    }

    if (request.method === "POST" && pathname === "/api/support/login") {
      validateSameOriginRequest(request);
      enforceRateLimit(request, "support-login", 10, 10 * 60_000);
      if (!hasSupabaseConfig) throw new HttpError(503, "Painel de apoio indisponível.");
      if (albumUploadSigningSecret.length < 32) throw new HttpError(503, "Painel de apoio indisponível.");

      const body = await readJsonBody(request);
      const guestName = requireText(body.guestName, "Nome", { min: 2, max: 120 });
      const password = String(body.password ?? "");
      if (!password) throw new HttpError(400, "Senha obrigatória.");

      if (!canAccessSupportPanel(guestName)) {
        throw new HttpError(403, "Somente Gabriel Domingues pode acessar o painel de apoio.");
      }

      let rows;
      try {
        rows = await callSupabaseRpc("authenticate_album_guest", {
          p_guest_name: guestName,
          p_password: password,
        });
      } catch (error) {
        const message = String(error.message || "");
        if (/senha incorreta/i.test(message)) throw new HttpError(403, "Senha incorreta.");
        if (/não encontrado|nome obrigatório/i.test(message)) {
          throw new HttpError(403, "Nome não encontrado nas confirmações. Use o nome exato da sua confirmação.");
        }
        throw new HttpError(403, message || "Não foi possível entrar no painel.");
      }

      const row = Array.isArray(rows) ? rows[0] : rows;
      if (!row?.guest_name || !canAccessSupportPanel(row.guest_name)) {
        throw new HttpError(403, "Somente Gabriel Domingues pode acessar o painel de apoio.");
      }

      sendJson(response, 200, {
        ok: true,
        guestName: row.guest_name,
      }, {
        "Set-Cookie": supportSessionCookieHeader(createSupportSessionToken(row.guest_name)),
      });
      return true;
    }

    if (request.method === "POST" && pathname === "/api/support/logout") {
      validateSameOriginRequest(request);
      sendJson(response, 200, { ok: true }, {
        "Set-Cookie": supportSessionCookieHeader("", { clear: true }),
      });
      return true;
    }

    if (request.method === "GET" && pathname === "/api/support/overview") {
      enforceRateLimit(request, "support-overview", 60, 60_000);
      requireSupportSession(request);
      const bypassCache = new URL(request.url, "http://127.0.0.1").searchParams.get("fresh") === "1";
      const overview = await buildSupportOverviewCached({ bypassCache });
      sendJson(response, 200, overview);
      return true;
    }

    if (request.method === "GET" && pathname === "/api/album/media") {
      enforceRateLimit(request, "album-media", 120, 60_000);
      requireAlbumAccess(requireAlbumSession(request));
      if (!hasAlbumConfig) {
        sendJson(response, 200, {
          configured: false,
          media: [],
          maxFileBytes: maxAlbumFileBytes,
          uploadCodeRequired: Boolean(albumUploadCode),
        });
        return true;
      }
      const media = await readSupabaseTable(
        `album_media?select=${albumMediaSelect}&order=created_at.desc&limit=500`,
      );
      sendJson(response, 200, {
        configured: true,
        media: media.map(normalizeAlbumMedia).filter(Boolean),
        maxFileBytes: maxAlbumFileBytes,
        uploadCodeRequired: Boolean(albumUploadCode),
      });
      return true;
    }

    const albumMediaDeleteMatch = pathname.match(/^\/api\/album\/media\/([0-9a-f-]{36})$/i);
    if (request.method === "DELETE" && albumMediaDeleteMatch) {
      validateSameOriginRequest(request);
      enforceRateLimit(request, "album-delete", 30, 10 * 60_000);
      const session = requireAlbumSession(request);
      requireAlbumAccess(session);
      requireAlbumAdmin(session);
      if (!hasAlbumConfig) throw new HttpError(503, "O armazenamento do álbum ainda não está configurado.");

      const mediaId = requireAlbumMediaId(albumMediaDeleteMatch[1]);
      const rows = await readSupabaseTable(
        `album_media?select=id,storage_provider,storage_key&id=eq.${encodeURIComponent(mediaId)}&limit=1`,
      );
      const media = Array.isArray(rows) ? rows[0] : rows;
      if (!media?.id) throw new HttpError(404, "Memória não encontrada.");

      if (media.storage_provider === "r2" && media.storage_key) {
        try {
          await r2Client.send(new DeleteObjectCommand({
            Bucket: r2BucketName,
            Key: media.storage_key,
          }));
        } catch (error) {
          if (error?.$metadata?.httpStatusCode !== 404 && error?.name !== "NotFound") {
            throw error;
          }
        }
      }

      await deleteAlbumMediaRecord(mediaId);
      sendJson(response, 200, { ok: true, id: mediaId });
      return true;
    }

    if (request.method === "POST" && pathname === "/api/album/upload-signature") {
      validateSameOriginRequest(request);
      enforceRateLimit(request, "album-signature", 600, 10 * 60_000);
      if (!hasAlbumConfig) throw new HttpError(503, "O armazenamento do álbum ainda não está configurado.");
      const session = requireAlbumSession(request);
      requireAlbumAccess(session);
      const body = await readJsonBody(request);
      requireAlbumAccessCode(body.accessCode);
      const guestName = requireFullGuestName(session.guestName, "Nome");
      const category = requireAlbumCategory(body.category);
      const file = requireAlbumFile(body);
      const contentHash = requireContentHash(body.contentHash);
      const requestedChallengeId = optionalAlbumChallengeId(body.challengeId);
      const challengeId = requestedChallengeId ? await requireOpenAlbumChallenge(requestedChallengeId, guestName) : null;
      const storageKey = `${albumR2KeyPrefix}${randomUUID()}.${albumFileExtensions.get(file.fileType)}`;
      const expiresAt = Date.now() + albumUploadUrlTtlSeconds * 1000;
      const uploadToken = createAlbumUploadToken({
        ...file,
        guestName,
        category,
        contentHash,
        challengeId,
        storageKey,
        expiresAt,
      });
      const uploadUrl = await getSignedUrl(
        r2Client,
        new PutObjectCommand({
          Bucket: r2BucketName,
          Key: storageKey,
          ContentType: file.fileType,
          CacheControl: "public, max-age=31536000, immutable",
        }),
        { expiresIn: albumUploadUrlTtlSeconds },
      );
      sendJson(response, 200, {
        uploadUrl,
        uploadToken,
        storageKey,
        headers: {
          "Content-Type": file.fileType,
          "Cache-Control": "public, max-age=31536000, immutable",
        },
        maxFileBytes: maxAlbumFileBytes,
        expiresAt,
      });
      return true;
    }

    if (request.method === "POST" && pathname === "/api/album/media") {
      validateSameOriginRequest(request);
      enforceRateLimit(request, "album-register", 600, 10 * 60_000);
      if (!hasAlbumConfig) throw new HttpError(503, "O armazenamento do álbum ainda não está configurado.");
      const session = requireAlbumSession(request);
      requireAlbumAccess(session);
      const body = await readJsonBody(request);
      const upload = await requireR2UploadResult(body);
      if (normalizeGuestName(upload.guestName) !== normalizeGuestName(session.guestName)) {
        throw new HttpError(403, "Autorização de upload inválida.");
      }
      const existing = await readSupabaseTable(
        `album_media?select=${albumMediaSelect}&storage_key=eq.${encodeURIComponent(upload.storageKey)}&limit=1`,
      );
      if (existing?.[0]) {
        sendJson(response, 200, { media: normalizeAlbumMedia(existing[0]) });
        return true;
      }
      await assertAlbumMediaHashAvailable(upload.contentHash);
      const inserted = await insertSupabaseTable("album_media", {
        guest_name: upload.guestName,
        category: upload.category,
        storage_provider: "r2",
        storage_key: upload.storageKey,
        original_file_name: upload.fileName,
        resource_type: upload.resourceType,
        mime_type: upload.fileType,
        format: upload.format,
        bytes: upload.fileSize,
        width: upload.width,
        height: upload.height,
        duration: upload.duration,
        etag: upload.etag,
        content_hash: upload.contentHash,
        ...(upload.challengeId ? { challenge_id: upload.challengeId } : {}),
        backup_status: "pending",
      });
      if (!inserted?.[0]) throw new Error("O Supabase não retornou a memória salva.");
      sendJson(response, 201, { media: normalizeAlbumMedia(inserted[0]) });
      return true;
    }

    if (request.method === "GET" && pathname === "/api/album/challenges") {
      enforceRateLimit(request, "album-challenges", 120, 60_000);
      const session = requireAlbumSession(request);
      requireAlbumAccess(session);
      if (!hasSupabaseConfig) {
        sendJson(response, 200, buildAlbumChallengeBoard([], [], session.guestName));
        return true;
      }
      const board = await loadAlbumChallengeBoard(session.guestName);
      // Todos veem o ranking completo; só os noivos veem quem entrou sem confirmação.
      if (isAlbumAdmin(session.guestName)) {
        const directory = await loadAlbumGuestDirectory().catch(() => new Map());
        board.leaderboard.forEach((entry) => {
          entry.withoutRsvp = directory.get(normalizeGuestName(entry.guestName))?.source !== "rsvp";
        });
      }
      sendJson(response, 200, board);
      return true;
    }

    if (request.method === "POST" && pathname === "/api/album/challenges") {
      validateSameOriginRequest(request);
      enforceRateLimit(request, "album-challenge-write", 60, 10 * 60_000);
      const session = requireAlbumSession(request);
      requireAlbumAccess(session);
      requireAlbumAdmin(session);
      if (!hasSupabaseConfig) throw new HttpError(503, "Supabase não está configurado no servidor.");
      const input = requireAlbumChallengeInput(await readJsonBody(request));
      const existing = await readAlbumChallenges();
      const nextSortOrder = existing.reduce((max, row) => Math.max(max, Number(row.sort_order) || 0), 0) + 10;
      const inserted = await insertSupabaseTable("album_challenges", { ...input, sort_order: nextSortOrder });
      if (!inserted?.[0]) throw new Error("O Supabase não retornou o desafio salvo.");
      sendJson(response, 201, { challenge: normalizeAlbumChallenge(inserted[0]) });
      return true;
    }

    const albumChallengeMatch = pathname.match(/^\/api\/album\/challenges\/([0-9a-f-]{36})$/i);
    if ((request.method === "PATCH" || request.method === "DELETE") && albumChallengeMatch) {
      validateSameOriginRequest(request);
      enforceRateLimit(request, "album-challenge-write", 60, 10 * 60_000);
      const session = requireAlbumSession(request);
      requireAlbumAccess(session);
      requireAlbumAdmin(session);
      if (!hasSupabaseConfig) throw new HttpError(503, "Supabase não está configurado no servidor.");
      const challengeId = requireAlbumChallengeId(albumChallengeMatch[1]);
      const filter = `album_challenges?id=eq.${encodeURIComponent(challengeId)}`;

      if (request.method === "DELETE") {
        // As memórias continuam no álbum; só deixam de contar para o desafio (on delete set null).
        const deleted = await deleteSupabaseTable(filter);
        if (!deleted?.[0]) throw new HttpError(404, "Desafio não encontrado.");
        sendJson(response, 200, { ok: true, id: challengeId });
        return true;
      }

      const input = requireAlbumChallengeInput(await readJsonBody(request), { partial: true });
      const updated = await patchSupabaseTable(filter, input);
      if (!updated?.[0]) throw new HttpError(404, "Desafio não encontrado.");
      sendJson(response, 200, { challenge: normalizeAlbumChallenge(updated[0]) });
      return true;
    }

    const albumChallengeSwapMatch = pathname.match(/^\/api\/album\/challenges\/([0-9a-f-]{36})\/swap$/i);
    if (request.method === "POST" && albumChallengeSwapMatch) {
      validateSameOriginRequest(request);
      enforceRateLimit(request, "album-challenge-swap", 10, 10 * 60_000);
      const session = requireAlbumSession(request);
      requireAlbumAccess(session);
      if (isAlbumAdmin(session.guestName)) throw new HttpError(400, "Os noivos não participam do sorteio.");
      if (!hasSupabaseConfig) throw new HttpError(503, "Supabase não está configurado no servidor.");
      const challengeId = requireAlbumChallengeId(albumChallengeSwapMatch[1]);
      const guestKey = normalizeGuestName(session.guestName);
      // Desafio já completado não pode ser trocado, senão a pessoa ganharia os pontos e um desafio novo.
      const proofs = await readSupabaseTableAll(
        `album_media?select=guest_name&challenge_id=eq.${encodeURIComponent(challengeId)}&order=id.asc`,
      );
      if ((Array.isArray(proofs) ? proofs : []).some((row) => normalizeGuestName(row.guest_name) === guestKey)) {
        throw new HttpError(409, "Você já completou este desafio.");
      }
      try {
        await callSupabaseRpc("swap_album_challenge", {
          p_guest_key: guestKey,
          p_guest_name: session.guestName,
          p_challenge_id: challengeId,
          p_max_swaps: albumChallengeSwapsPerGuest,
        });
      } catch (error) {
        throw new HttpError(409, error.message || "Não foi possível trocar o desafio.");
      }
      sendJson(response, 200, await loadAlbumChallengeBoard(session.guestName));
      return true;
    }

    const albumMediaChallengeMatch = pathname.match(/^\/api\/album\/media\/([0-9a-f-]{36})\/challenge$/i);
    if (request.method === "PATCH" && albumMediaChallengeMatch) {
      validateSameOriginRequest(request);
      enforceRateLimit(request, "album-challenge-write", 60, 10 * 60_000);
      const session = requireAlbumSession(request);
      requireAlbumAccess(session);
      requireAlbumAdmin(session);
      if (!hasSupabaseConfig) throw new HttpError(503, "Supabase não está configurado no servidor.");
      const mediaId = requireAlbumMediaId(albumMediaChallengeMatch[1]);
      const body = await readJsonBody(request);
      const challengeId = optionalAlbumChallengeId(body.challengeId);
      if (challengeId) {
        const rows = await readSupabaseTable(
          `album_challenges?select=id&id=eq.${encodeURIComponent(challengeId)}&limit=1`,
        );
        if (!rows?.[0]?.id) throw new HttpError(404, "Desafio não encontrado.");
      }
      const updated = await patchSupabaseTable(
        `album_media?id=eq.${encodeURIComponent(mediaId)}&select=${albumMediaSelect}`,
        { challenge_id: challengeId },
      );
      if (!updated?.[0]) throw new HttpError(404, "Memória não encontrada.");
      sendJson(response, 200, { media: normalizeAlbumMedia(updated[0]) });
      return true;
    }

    if (!hasSupabaseConfig) {
      sendJson(response, 503, { error: "Supabase não está configurado no servidor." });
      return true;
    }

    if (request.method === "GET" && pathname === "/api/gifts") {
      enforceRateLimit(request, "gifts", 120, 60_000);
      const [gifts, giversByGiftId] = await Promise.all([getPublicGifts(), loadGiftGiversByGiftId()]);
      sendJson(response, 200, { gifts: gifts.map((gift) => normalizeGift(gift, giversByGiftId)) });
      return true;
    }

    if (request.method === "GET" && pathname === "/api/rsvp/session") {
      if (!hasSupabaseConfig) {
        sendJson(response, 200, { authenticated: false });
        return true;
      }
      const remembered = await resolveGuestRememberSession(request);
      if (!remembered?.guest_name) {
        sendJson(response, 200, { authenticated: false });
        return true;
      }
      sendJson(response, 200, { authenticated: true, rsvp: remembered });
      return true;
    }

    if (request.method === "POST" && pathname === "/api/rsvp/lookup") {
      validateSameOriginRequest(request);
      enforceRateLimit(request, "rsvp-lookup", 40, 10 * 60_000);
      if (!hasSupabaseConfig) throw new HttpError(503, "Confirmações ainda não estão disponíveis.");
      const body = await readJsonBody(request);
      const guestName = requireFullGuestName(body.guestName, "Nome");
      const record = await readRsvpGroupRecord(guestName);
      if (!record?.guest_name) {
        throw new HttpError(404, "Confirmação não encontrada para este nome.");
      }
      // Acompanhantes só aparecem para o aparelho que fez a confirmação.
      const rememberedPrimaryId = await readRememberedPrimaryRsvpId(request);
      sendJson(response, 200, {
        rsvp: {
          guest_name: record.guest_name,
          party_size: record.party_size,
          ...(rememberedPrimaryId === record.primaryId
            ? { additional_guest_names: record.additional_guest_names }
            : {}),
        },
      });
      return true;
    }

    if (request.method === "POST" && pathname === "/api/rsvp") {
      validateSameOriginRequest(request);
      enforceRateLimit(request, "rsvp", 20, 10 * 60_000);
      const body = await readJsonBody(request);
      const guestName = requireFullGuestName(body.guestName, "Nome");
      const partySize = String(body.partySize ?? "").trim();
      if (!["Somente eu", "Casal", "Família", "Responsável e menores"].includes(partySize)) {
        throw new HttpError(400, "Tipo de confirmação inválido.");
      }
      const additionalGuestNames = validateAdditionalGuestNames(
        body.additionalGuestNames ?? [],
        partySize,
        guestName,
      );
      await assertRsvpChangeAllowed(request, guestName, additionalGuestNames);

      const rsvp = await callSupabaseRpc("confirm_rsvp", {
        p_guest_name: guestName,
        p_party_size: partySize,
        p_additional_guest_names: additionalGuestNames,
      });
      const row = rsvp?.[0];
      const extraHeaders = {};
      if (row?.id && albumUploadSigningSecret.length >= 32) {
        const rememberCookie = await issueGuestRememberToken(row.id, request);
        if (rememberCookie) {
          extraHeaders["Set-Cookie"] = guestRememberCookieHeader(rememberCookie);
        }
      }
      sendJson(response, 200, {
        rsvp: row,
        alreadyConfirmed: Boolean(row?.already_confirmed),
      }, extraHeaders);
      return true;
    }

    if (request.method === "POST" && pathname === "/api/gifts/reserve") {
      validateSameOriginRequest(request);
      enforceRateLimit(request, "reserve", 20, 10 * 60_000);
      const body = await readJsonBody(request);
      const reservation = await callSupabaseRpc("reserve_gift", {
        p_gift_id: requireGiftId(body.giftId),
        p_guest_name: requireFullGuestName(body.guestName, "Nome"),
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
        p_buyer_name: requireFullGuestName(body.buyerName, "Nome"),
        p_buyer_email: optionalEmail(body.buyerEmail),
        p_message: optionalText(body.message, "Mensagem", maxGiftMessageLength),
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
    const guestNotInvited = guestNotInvitedMessagePattern.test(String(error.message || ""));
    const statusCode = guestNotInvited ? 403 : error instanceof HttpError ? error.statusCode : 400;
    const headers = error instanceof HttpError ? error.headers : {};
    sendJson(response, statusCode, {
      error: error.message || "Erro ao processar solicitação.",
      ...(guestNotInvited ? { code: "guest_not_invited" } : {}),
      ...(error instanceof HttpError && error.code ? { code: error.code } : {}),
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

  const albumPagePaths = new Set(["/album", "/album/", "/album.html"]);
  const albumLoginPaths = new Set(["/album/login", "/album/login/", "/album-login.html"]);

  if (albumPagePaths.has(pathname)) {
    const session = readAlbumSession(request);
    if (!session) {
      response.writeHead(302, responseHeaders({ Location: "/album/login", "Cache-Control": "no-store" }));
      response.end();
      return;
    }
    if (!canAccessAlbum(session.guestName)) {
      response.writeHead(302, responseHeaders({ Location: "/#album", "Cache-Control": "no-store" }));
      response.end();
      return;
    }
  }

  if (albumLoginPaths.has(pathname)) {
    const session = readAlbumSession(request);
    if (session && canAccessAlbum(session.guestName)) {
      response.writeHead(302, responseHeaders({ Location: "/album", "Cache-Control": "no-store" }));
      response.end();
      return;
    }
  }

  const supportPagePaths = new Set(["/apoio", "/apoio/"]);
  const supportLoginPaths = new Set(["/apoio/login", "/apoio/login/"]);
  const supportAssetPaths = new Set(["/support.css", "/support.js", "/support-login.js"]);

  if (supportPagePaths.has(pathname) || supportLoginPaths.has(pathname) || supportAssetPaths.has(pathname)) {
    if (!hasSupportPanelConfig) {
      response.writeHead(404, responseHeaders({ "Content-Type": "text/plain; charset=utf-8" }));
      response.end("Arquivo não encontrado");
      return;
    }
  }

  if (supportPagePaths.has(pathname)) {
    const session = readSupportSession(request);
    if (!session) {
      response.writeHead(302, responseHeaders({ Location: "/apoio/login", "Cache-Control": "no-store" }));
      response.end();
      return;
    }
  }

  if (supportLoginPaths.has(pathname)) {
    const session = readSupportSession(request);
    if (session) {
      response.writeHead(302, responseHeaders({ Location: "/apoio", "Cache-Control": "no-store" }));
      response.end();
      return;
    }
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
