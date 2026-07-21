import { createReadStream, existsSync, readFileSync, statSync } from "node:fs";
import { createHmac, randomUUID, timingSafeEqual } from "node:crypto";
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
const maxAlbumFileBytes = 500 * 1024 * 1024;
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
const guestNotInvitedMessage = "Infelizmente, seu nome não está na lista de convidados.";
const albumCategories = new Set(["Preparativos", "Cerimônia", "Jantar", "Festa"]);
const albumImageTypes = new Set(["image/jpeg", "image/png", "image/webp", "image/avif", "image/heic", "image/heif"]);
const albumVideoTypes = new Set(["video/mp4", "video/quicktime", "video/webm"]);
const albumR2KeyPrefix = "gab-naia/album/originals/";
const albumUploadUrlTtlSeconds = 30 * 60;
const albumSessionCookieName = "gab_naia_album_session";
const albumSessionTtlMs = 7 * 24 * 60 * 60 * 1000;
const albumMediaSelect = "id,guest_name,category,storage_provider,storage_key,public_id,resource_type,mime_type,format,version,bytes,width,height,duration,backup_status,created_at";
const albumAdminGuestNames = new Set(
  (firstEnv("ALBUM_ADMIN_GUEST_NAMES") || "Gabriel Domingues")
    .split(",")
    .map((name) => name.trim().replace(/\s+/g, " ").toLowerCase())
    .filter(Boolean),
);
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

function normalizeAlbumGuestName(name) {
  return String(name || "").trim().replace(/\s+/g, " ").toLowerCase();
}

function isAlbumAdmin(guestName) {
  return albumAdminGuestNames.has(normalizeAlbumGuestName(guestName));
}

function requireAlbumAdmin(session) {
  if (!isAlbumAdmin(session.guestName)) {
    throw new HttpError(403, "Somente o administrador do álbum pode excluir memórias.");
  }
}

function requireAlbumMediaId(value) {
  const id = String(value || "").trim();
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(id)) {
    throw new HttpError(400, "Identificador de mídia inválido.");
  }
  return id;
}

function albumSessionCookieHeader(token, { clear = false } = {}) {
  if (clear) {
    return `${albumSessionCookieName}=; Path=/; Max-Age=0; HttpOnly; SameSite=Lax`;
  }
  const secureFlag = siteUrl.startsWith("https://") || process.env.VERCEL ? "; Secure" : "";
  return `${albumSessionCookieName}=${encodeURIComponent(token)}; Path=/; Max-Age=${Math.floor(albumSessionTtlMs / 1000)}; HttpOnly; SameSite=Lax${secureFlag}`;
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
      albumConfigured: hasAlbumConfig,
    });
    return true;
  }

  try {
    if (request.method === "GET" && pathname === "/api/album/session") {
      const session = readAlbumSession(request);
      sendJson(response, 200, {
        authenticated: Boolean(session),
        guestName: session?.guestName || null,
        isAlbumAdmin: Boolean(session && isAlbumAdmin(session.guestName)),
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

      sendJson(response, 200, {
        ok: true,
        guestName: row.guest_name,
        isAlbumAdmin: isAlbumAdmin(row.guest_name),
      }, {
        "Set-Cookie": albumSessionCookieHeader(createAlbumSessionToken(row.guest_name)),
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

    if (request.method === "GET" && pathname === "/api/album/media") {
      enforceRateLimit(request, "album-media", 120, 60_000);
      requireAlbumSession(request);
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
      requireAlbumSession(request);
      if (!hasAlbumConfig) throw new HttpError(503, "O armazenamento do álbum ainda não está configurado.");
      const body = await readJsonBody(request);
      requireAlbumAccessCode(body.accessCode);
      const guestName = requireFullGuestName(body.guestName, "Nome");
      const category = requireAlbumCategory(body.category);
      const file = requireAlbumFile(body);
      const storageKey = `${albumR2KeyPrefix}${randomUUID()}.${albumFileExtensions.get(file.fileType)}`;
      const expiresAt = Date.now() + albumUploadUrlTtlSeconds * 1000;
      const uploadToken = createAlbumUploadToken({
        ...file,
        guestName,
        category,
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
      requireAlbumSession(request);
      if (!hasAlbumConfig) throw new HttpError(503, "O armazenamento do álbum ainda não está configurado.");
      const body = await readJsonBody(request);
      const upload = await requireR2UploadResult(body);
      const existing = await readSupabaseTable(
        `album_media?select=${albumMediaSelect}&storage_key=eq.${encodeURIComponent(upload.storageKey)}&limit=1`,
      );
      if (existing?.[0]) {
        sendJson(response, 200, { media: normalizeAlbumMedia(existing[0]) });
        return true;
      }
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
        backup_status: "pending",
      });
      if (!inserted?.[0]) throw new Error("O Supabase não retornou a memória salva.");
      sendJson(response, 201, { media: normalizeAlbumMedia(inserted[0]) });
      return true;
    }

    if (!hasSupabaseConfig) {
      sendJson(response, 503, { error: "Supabase não está configurado no servidor." });
      return true;
    }

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
      const guestName = requireFullGuestName(body.guestName, "Nome");
      const partySize = String(body.partySize ?? "").trim();
      if (!["Somente eu", "Casal", "Responsável e menores"].includes(partySize)) {
        throw new HttpError(400, "Tipo de confirmação inválido.");
      }
      const additionalGuestNames = validateAdditionalGuestNames(
        body.additionalGuestNames ?? [],
        partySize,
        guestName,
      );

      const rsvp = await callSupabaseRpc("confirm_rsvp", {
        p_guest_name: guestName,
        p_party_size: partySize,
        p_additional_guest_names: additionalGuestNames,
      });
      const row = rsvp?.[0];
      sendJson(response, 200, {
        rsvp: row,
        alreadyConfirmed: Boolean(row?.already_confirmed),
      });
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

  const albumPagePaths = new Set(["/album", "/album/", "/album.html"]);
  const albumLoginPaths = new Set(["/album/login", "/album/login/", "/album-login.html"]);

  if (albumPagePaths.has(pathname) && !readAlbumSession(request)) {
    response.writeHead(302, responseHeaders({ Location: "/album/login", "Cache-Control": "no-store" }));
    response.end();
    return;
  }

  if (albumLoginPaths.has(pathname) && readAlbumSession(request)) {
    response.writeHead(302, responseHeaders({ Location: "/album", "Cache-Control": "no-store" }));
    response.end();
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
