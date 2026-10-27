const weddingDate = new Date("2026-11-28T00:00:00-03:00");
const countdown = document.querySelector("#countdown");
const giftGrid = document.querySelector("#gift-grid");
const giftFilters = document.querySelector("#gift-filters");
const modal = document.querySelector("#modal");
const modalContent = document.querySelector("#modal-content");
const weddingAudio = document.querySelector("#wedding-audio");
const musicToggle = document.querySelector("[data-music-toggle]");
const audioStartTime = 0;
const rsvpStorageKey = "gabriel-halanaia-rsvp";
const maxGiftMessageLength = 5000;
const minOpenGiftAmount = 1;
const maxOpenGiftAmount = 1_000_000;
const defaultHeroCopy =
  "Com alegria, convidamos você para celebrar conosco esse momento tão especial. Sua presença fará parte da nossa história.";
let audioStarted = false;
let audioBlocked = false;
let audioPausedByVisibility = false;
let audioWasPlayingBeforeVisibilityPause = false;
let userMutedAudio = false;
let rsvpDraft = null;
let paymentConfig = null;
let paymentConfigPromise = null;
let giftLoadPromise = null;
let lastGiftRenderSignature = "";
let lastGiftLoadAt = 0;
const localGiftFallbackHosts = new Set(["localhost", "127.0.0.1", "::1"]);
const useLocalGiftFallback = localGiftFallbackHosts.has(window.location.hostname);

let gifts = [
  { id: "panos-prato", type: "fixed", section: "daily", name: "Kit de panos de prato", value: 35, category: "Cozinha", text: "Para deixar nossa cozinha mais prática no dia a dia.", status: "available" },
  { id: "descanso-panelas", type: "fixed", section: "daily", name: "Descanso de panelas", value: 35, category: "Cozinha", text: "Para cuidar da mesa nos almoços em casa.", status: "available" },
  { id: "calmante-dia-casamento", type: "fixed", section: "daily", name: "Calmante para o dia do casamento", value: 35, category: "Casa", text: "Para respirar fundo e aproveitar cada segundo 😌", status: "available" },
  { id: "colheres-pau", type: "fixed", section: "daily", name: "Kit de colheres de pau", value: 40, category: "Cozinha", text: "Para os primeiros preparos na nossa cozinha.", status: "available" },
  { id: "kit-limpeza", type: "fixed", section: "daily", name: "Kit Limpeza", value: 40, category: "Lavanderia", text: "Para deixar a casa sempre limpa e cheirosa 🧽", status: "available" },
  { id: "so-para-dizer-que-nao-dei-nada", type: "fixed", section: "daily", name: "Só para dizer que eu não dei nada", value: 40, category: "Casa", text: "Para participar da lista sem perder a pose 😄", status: "available" },
  { id: "pegadores-cozinha", type: "fixed", section: "daily", name: "Kit de pegadores de cozinha", value: 45, category: "Cozinha", text: "Para ajudar nos preparos e servir com carinho.", status: "available" },
  { id: "caixa-organizadora", type: "fixed", section: "daily", name: "Caixa organizadora", value: 45, category: "Lavanderia", text: "Para guardar tudo com mais praticidade 📦", status: "available" },
  { id: "organizador-gaveta", type: "fixed", section: "daily", name: "Organizador de gavetas", value: 45, category: "Casa", text: "Para manter nosso novo lar mais arrumado.", status: "available" },
  { id: "tabua-corte", type: "fixed", section: "daily", name: "Tábua de corte", value: 50, category: "Cozinha", text: "Para os preparos do dia a dia na cozinha.", status: "available" },
  { id: "potes-tempero", type: "fixed", section: "daily", name: "Porta-temperos", value: 60, category: "Cozinha", text: "Para organizar os temperos da nossa casa.", status: "available" },
  { id: "cueca-sexy-nupcias", type: "fixed", section: "daily", name: "Cueca Sexy para as nupcias", value: 60, category: "Quarto", text: "Para entrar no clima com bom humor 😎", status: "available" },
  { id: "escorredor-louca", type: "fixed", section: "daily", name: "Escorredor de louça", value: 65, category: "Cozinha", text: "Para facilitar nossa rotina depois das refeições.", status: "available" },
  { id: "cesto-roupas", type: "fixed", section: "daily", name: "Cesto de roupas", value: 65, category: "Lavanderia", text: "Para ajudar na organização da lavanderia.", status: "available" },
  { id: "jogo-americano", type: "fixed", section: "daily", name: "Jogo americano", value: 70, category: "Mesa", text: "Para montar uma mesa simples e bonita.", status: "available" },
  { id: "tampao-ouvido-noivo-roncar", type: "fixed", section: "daily", name: "Tampão de ouvido para não ouvir o noivo roncar", value: 70, category: "Quarto", text: "Para garantir noites de paz no novo lar 😴", status: "available" },
  { id: "lixeira-cozinha", type: "fixed", section: "daily", name: "Lixeira de cozinha", value: 75, category: "Cozinha", text: "Para completar os itens essenciais da casa.", status: "available" },
  { id: "kit-copos-simples", type: "fixed", section: "daily", name: "Kit de copos para o dia a dia", value: 80, category: "Mesa", text: "Para receber visitas e compartilhar bons momentos.", status: "available" },
  { id: "porta-mantimentos", type: "fixed", section: "daily", name: "Porta-mantimentos", value: 85, category: "Cozinha", text: "Para deixar a despensa mais organizada.", status: "available" },
  { id: "curso-culinaria-noiva", type: "fixed", section: "daily", name: "Curso de culinária da noiva", value: 90, category: "Cozinha", text: "Para receitas cheias de carinho e coragem 👩‍🍳", status: "available" },
  { id: "sapateira", type: "fixed", section: "daily", name: "Sapateira", value: 100, category: "Lavanderia", text: "Para manter os calçados organizados no dia a dia 👟", status: "available" },
  { id: "levar-marmita-pra-casa", type: "fixed", section: "daily", name: "Levar marmita pra casa", value: 100, category: "Cozinha", text: "Para garantir comida boa depois da festa 🍱", status: "available" },
  { id: "tres-meses-corte-cabelo-noivo", type: "fixed", section: "daily", name: "3 meses de corte de cabelo do noivo", value: 105, category: "Casa", text: "Para o noivo chegar sempre alinhado ✂️", status: "available" },
  { id: "kit-de-cama", type: "fixed", section: "daily", name: "Kit de Cama", value: 110, category: "Quarto", text: "Para deixar nosso quarto mais aconchegante 🛏️", status: "available" },
  { id: "edredom", type: "fixed", section: "daily", name: "Edredom", value: 120, category: "Quarto", text: "Para deixar nossa cama ainda mais confortável ✨", status: "available" },
  { id: "panela-de-pressao", type: "fixed", section: "daily", name: "Panela de pressão", value: 119, category: "Cozinha", text: "Para preparar refeições práticas com muito carinho 🍲", status: "available" },
  { id: "utensilios", type: "fixed", section: "daily", name: "Kit de utensílios de cozinha", value: 120, category: "Cozinha", text: "Para ajudar nos primeiros preparos da nossa casa.", status: "available" },
  { id: "kit-toalhas", type: "fixed", section: "daily", name: "Kit toalhas", value: 130, category: "Banheiro", text: "Para trazer conforto aos nossos banhos 🛁", status: "available" },
  { id: "potes", type: "fixed", section: "daily", name: "Conjunto de potes herméticos", value: 150, category: "Cozinha", text: "Para manter nossa cozinha mais organizada.", status: "available" },
  { id: "cobertor", type: "fixed", section: "daily", name: "Cobertor", value: 150, category: "Quarto", text: "Para deixar nossas noites mais quentinhas 🛌", status: "available" },
  { id: "assadeiras", type: "fixed", section: "daily", name: "Kit de assadeiras antiaderentes", value: 150, category: "Cozinha", text: "Para preparar receitas no nosso dia a dia.", status: "available" },
  { id: "grill", type: "fixed", section: "daily", name: "Sanduicheira ou grill", value: 180, category: "Cozinha", text: "Para nossos lanches rápidos.", status: "available" },
  { id: "cafeteira", type: "fixed", section: "daily", name: "Cafeteira elétrica simples", value: 180, category: "Cozinha", text: "Para deixar nossas manhãs mais especiais.", status: "available" },
  { id: "chaleira", type: "fixed", section: "daily", name: "Chaleira elétrica", value: 180, category: "Cozinha", text: "Para cafés, chás e momentos tranquilos.", status: "available" },
  { id: "jantar-romantico-noivos", type: "fixed", section: "daily", name: "Jantar romântico dos noivos", value: 200, category: "Mesa", text: "Para celebrar o amor com uma noite especial 🍝", status: "available" },
  { id: "panela-arroz", type: "fixed", section: "daily", name: "Panela de arroz elétrica", value: 220, category: "Cozinha", text: "Para facilitar nossa rotina na cozinha.", status: "available" },
  { id: "liquidificador", type: "fixed", section: "daily", name: "Liquidificador", value: 250, category: "Cozinha", text: "Para sucos, vitaminas e receitas do dia a dia.", status: "available" },
  { id: "mixer", type: "fixed", section: "daily", name: "Mixer 3 em 1", value: 250, category: "Cozinha", text: "Para deixar os preparos mais práticos.", status: "available" },
  { id: "ferro", type: "fixed", section: "daily", name: "Ferro de passar roupa", value: 250, category: "Lavanderia", text: "Para cuidar das nossas roupas.", status: "available" },
  { id: "cama-casal", type: "fixed", section: "home", name: "Jogo de cama casal", value: 280, category: "Quarto", text: "Para deixar nosso quarto mais completo.", status: "available" },
  { id: "banho", type: "fixed", section: "home", name: "Kit de banho completo", value: 300, category: "Banheiro", text: "Para começar a casa com mais conforto.", status: "available" },
  { id: "deus-tocar-coracao", type: "fixed", section: "home", name: "Se Deus tocar no seu coração", value: 300, category: "Casa", text: "Para contribuir com fé, amor e generosidade 🙏", status: "available" },
  { id: "air-fryer-compacta", type: "fixed", section: "home", name: "Air Fryer compacta", value: 350, category: "Cozinha", text: "Para facilitar nossas refeições.", status: "available" },
  { id: "aspirador", type: "fixed", section: "home", name: "Aspirador de pó vertical", value: 350, category: "Limpeza", text: "Para ajudar na limpeza da casa nova.", status: "available" },
  { id: "pressao-eletrica", type: "fixed", section: "home", name: "Panela de pressão elétrica", value: 400, category: "Cozinha", text: "Para deixar nossa cozinha mais prática e segura.", status: "available" },
  { id: "faqueiro", type: "fixed", section: "home", name: "Faqueiro inox completo", value: 400, category: "Cozinha", text: "Para montar nossa mesa com carinho.", status: "available" },
  { id: "jantar", type: "fixed", section: "home", name: "Jogo de jantar", value: 450, category: "Cozinha", text: "Para receber pessoas queridas na nossa casa.", status: "available" },
  { id: "panelas", type: "fixed", section: "home", name: "Jogo de panelas antiaderente", value: 500, category: "Cozinha", text: "Para começarmos a cozinhar na nossa casa.", status: "available" },
  { id: "aviaozinho-tio-silvo", type: "fixed", section: "special", name: "Aviãozinho do tio Silvo", value: 230, category: "Casa", text: "Para animar a festa com estilo e nostalgia ✈️", status: "available" },
  { id: "calvice-do-noivo", type: "fixed", section: "special", name: "Ajuda no tratamento de calvice do noivo", value: 300, category: "Casa", text: "Uma força para manter o brilho no grande dia 💇‍♂️", status: "available" },
  { id: "forno", type: "fixed", section: "special", name: "Forno elétrico", value: 550, category: "Cozinha", text: "Para preparar receitas especiais.", status: "available" },
  { id: "cooktop", type: "fixed", section: "special", name: "Cooktop a gás", value: 600, category: "Cozinha", text: "Para ajudar a montar nossa cozinha.", status: "available" },
  { id: "air-fryer-oven", type: "fixed", section: "special", name: "Air Fryer Oven", value: 700, category: "Cozinha", text: "Para deixar nossa rotina ainda mais prática.", status: "available" },
  { id: "microondas", type: "fixed", section: "special", name: "Micro-ondas", value: 750, category: "Eletrodoméstico", text: "Um item essencial para o nosso dia a dia.", status: "available" },
  { id: "purificador", type: "fixed", section: "special", name: "Purificador de água", value: 800, category: "Cozinha", text: "Para termos água filtrada sempre à mão.", status: "available" },
  { id: "panelas-premium", type: "fixed", section: "special", name: "Jogo de panelas premium", value: 900, category: "Cozinha", text: "Para completar nossa cozinha com qualidade.", status: "available" },
  { id: "contribuicao-livre", type: "open", section: "quotas", name: "Contribua com o valor que quiser", category: "Cota da casa", text: "Presenteie com o valor que fizer sentido para você — quantas vezes quiser, cada gesto nos ajuda a montar nosso cantinho com carinho.", imageUrl: "https://lyuqvwrikfajmcodwous.supabase.co/storage/v1/object/public/gift-images/QuandoQuiser.png", status: "available" },
  { id: "geladeira", type: "quota", section: "quotas", name: "Cota da geladeira", goal: 5500, options: [150, 250, 500, 1000], text: "Para nos ajudar em um dos principais itens da casa nova.", status: "available" },
  { id: "cota-maquina-de-lavar", type: "quota", section: "quotas", name: "Cota da máquina de lavar", goal: 1600, contributed: 0, options: [150, 250, 500, 1000], text: "Para facilitar nossa rotina com as roupas.", status: "available" },
  { id: "sofa", type: "quota", section: "quotas", name: "Cota do sofá", goal: 2500, options: [150, 250, 500, 1000], text: "Para montar nossa sala com conforto.", status: "available" },
  { id: "cama-colchao", type: "quota", section: "quotas", name: "Cota da cama e colchão", goal: 2500, options: [150, 250, 500, 1000], text: "Para montar nosso cantinho de descanso.", status: "available" },
  { id: "guarda-roupa", type: "quota", section: "quotas", name: "Cota do guarda-roupa", goal: 2000, options: [150, 250, 500], text: "Para ajudar na organização do nosso quarto.", status: "available" },
  { id: "mesa-jantar", type: "quota", section: "quotas", name: "Cota da mesa de jantar", goal: 1500, options: [150, 250, 500], text: "Para criarmos momentos especiais à mesa.", status: "available" },
  { id: "eletrodomesticos", type: "quota", section: "quotas", name: "Cota dos eletrodomésticos", goal: 3000, options: [150, 250, 500, 1000], text: "Para completar os itens essenciais da nossa casa.", status: "available" },
  { id: "moveis", type: "quota", section: "quotas", name: "Cota para móveis da casa", goal: 3000, options: [150, 250, 500, 1000], text: "Para nos ajudar a mobiliar nosso novo lar.", status: "available" },
  { id: "casa-nova", type: "quota", section: "quotas", name: "Cota da casa nova", goal: 5000, options: [150, 250, 500, 1000], text: "Para contribuir com esse novo começo.", status: "available" },
];

const giftSections = [
  { id: "daily", title: "Presentes para o dia a dia" },
  { id: "home", title: "Presentes para montar a casa" },
  { id: "special", title: "Presentes especiais" },
  { id: "quotas", title: "Cotas da casa nova" },
];

const filters = [
  { id: "all", label: "Todos", match: () => true },
  { id: "under-200", label: "Até R$ 200", match: (gift) => gift.type === "fixed" && gift.value <= 200 },
  { id: "200-500", label: "R$ 200 a R$ 500", match: (gift) => gift.type === "fixed" && gift.value > 200 && gift.value <= 500 },
  { id: "500-1000", label: "R$ 500 a R$ 1.000", match: (gift) => gift.type === "fixed" && gift.value > 500 && gift.value <= 1000 },
  { id: "quotas", label: "Cotas da casa", match: (gift) => gift.type === "quota" || gift.type === "open" },
  { id: "open", label: "Valor livre", match: (gift) => gift.type === "open" },
];

let activeFilter = "all";

function resolveGiftFormAmount(gift, formData) {
  if (gift?.type === "quota") return Number(formData.get("quotaValue") || 0);
  if (gift?.type === "open") return Number(formData.get("openValue") || 0);
  return Number(gift?.value || 0);
}

function validateOpenGiftAmount(amount) {
  if (!Number.isSafeInteger(amount) || amount < minOpenGiftAmount || amount > maxOpenGiftAmount) {
    showError(`Informe um valor entre ${formatCurrency(minOpenGiftAmount)} e ${formatCurrency(maxOpenGiftAmount)}.`);
    return false;
  }
  return true;
}

function formatCurrency(value) {
  return new Intl.NumberFormat("pt-BR", {
    style: "currency",
    currency: "BRL",
    maximumFractionDigits: 0,
  }).format(value);
}

function escapeHtml(value) {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

const escapeAttribute = escapeHtml;

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

function renderGiftImage(gift) {
  if (!gift.imageUrl) return "";

  return `
    <figure class="gift-image">
      <img src="${escapeAttribute(gift.imageUrl)}" alt="${escapeAttribute(gift.name)}" loading="lazy">
    </figure>
  `;
}

const maxVisibleGivers = 4;

function renderGiftGivers(gift) {
  const givers = Array.isArray(gift.givers) ? gift.givers.filter(Boolean) : [];
  if (!givers.length) return "";

  const visibleGivers = givers.slice(0, maxVisibleGivers);
  const hiddenCount = givers.length - visibleGivers.length;

  return `
    <div class="gift-givers" aria-label="Presenteado com carinho por ${escapeAttribute(givers.join(", "))}">
      <span class="gift-givers-label">Com carinho de</span>
      <ul class="gift-givers-list">
        ${visibleGivers.map((name) => `
          <li class="gift-giver">
            <span class="gift-giver-initial" aria-hidden="true">${escapeHtml(name.charAt(0))}</span>
            <span class="gift-giver-name">${escapeHtml(name)}</span>
          </li>
        `).join("")}
        ${hiddenCount > 0 ? `<li class="gift-giver gift-giver-more">+${hiddenCount}</li>` : ""}
      </ul>
    </div>
  `;
}

function renderGiftDescription(gift) {
  const className = gift.imageUrl ? "gift-description image-description" : "gift-description";
  return `<p class="${className}">${escapeHtml(gift.text)}</p>`;
}

async function requestJson(url, options = {}) {
  const response = await fetch(url, {
    credentials: "same-origin",
    headers: { "Content-Type": "application/json" },
    ...options,
  });
  const payload = await response.json().catch(() => ({}));

  if (!response.ok) {
    const requestError = new Error(payload.error || "Não foi possível salvar agora.");
    requestError.code = payload.code || "request_failed";
    throw requestError;
  }

  return payload;
}

async function loadPaymentConfig() {
  if (paymentConfig) return paymentConfig;
  if (!paymentConfigPromise) {
    paymentConfigPromise = requestJson("/api/config")
      .then((config) => {
        paymentConfig = config;
        return config;
      })
      .catch(() => {
        paymentConfig = {};
        return paymentConfig;
      });
  }

  return paymentConfigPromise;
}

function getCardPaymentUrl() {
  return "";
}

function hasOnlinePaymentConfigured() {
  return Boolean(paymentConfig?.mercadoPagoConfigured);
}

function paymentMethodIcon(kind) {
  if (kind === "online") {
    return `
      <svg viewBox="0 0 24 24" aria-hidden="true">
        <path d="M3 7h18v10a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V7Z" />
        <path d="M3 10h18" />
        <path d="M7 15h3" />
      </svg>
    `;
  }

  return `
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <path d="M12 3 5 10l7 7 7-7-7-7Z" />
      <path d="m5 14 7 7 7-7" />
    </svg>
  `;
}

function updateCountdown() {
  if (!countdown) return;

  const today = new Date();
  const diff = weddingDate - today;
  const days = Math.max(0, Math.ceil(diff / (1000 * 60 * 60 * 24)));
  countdown.textContent = days === 1 ? "Falta 1 dia" : `Faltam ${days} dias`;
}

function hasFullGuestName(value) {
  const parts = String(value || "")
    .trim()
    .replace(/\s+/g, " ")
    .split(" ")
    .filter(Boolean);
  return parts.length >= 2 && parts.every((part) => part.length >= 2);
}

function getSavedRsvp() {
  try {
    return JSON.parse(localStorage.getItem(rsvpStorageKey));
  } catch (error) {
    return null;
  }
}

function getKnownGuestName() {
  const savedName = getSavedRsvp()?.name?.trim().replace(/\s+/g, " ");
  return savedName && hasFullGuestName(savedName) ? savedName : "";
}

const engagementSessionStorageKey = "gab-naia-engagement-session";
const trackedEngagementEvents = new Set();

function getEngagementSessionKey() {
  try {
    let key = sessionStorage.getItem(engagementSessionStorageKey);
    if (!key) {
      key = crypto.randomUUID();
      sessionStorage.setItem(engagementSessionStorageKey, key);
    }
    return key;
  } catch {
    return crypto.randomUUID();
  }
}

function trackSiteEngagement(eventType, giftId = null) {
  const dedupeKey = giftId ? `${eventType}:${giftId}:${getKnownGuestName() || ""}` : `${eventType}:${getKnownGuestName() || ""}`;
  if (trackedEngagementEvents.has(dedupeKey)) return;
  trackedEngagementEvents.add(dedupeKey);

  const payload = {
    eventType,
    sessionKey: getEngagementSessionKey(),
    guestName: getKnownGuestName() || null,
    ...(giftId ? { giftId } : {}),
  };

  fetch("/api/engagement", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
    keepalive: true,
  }).catch(() => {});
}

function setupGiftsEngagementTracking() {
  const giftsSection = document.querySelector("#presentes");
  if (!giftsSection || typeof IntersectionObserver !== "function") return;

  const observer = new IntersectionObserver(
    (entries) => {
      if (!entries.some((entry) => entry.isIntersecting)) return;
      trackSiteEngagement("gifts_area_view");
      observer.disconnect();
    },
    { threshold: 0.25 },
  );
  observer.observe(giftsSection);
}

const albumPublicOpenAtMs = Date.parse("2026-11-28T15:00:00-03:00");

const albumEarlyAccessGuestNames = new Set(["gabriel domingues", "gabriel domingues fernandes", "halanaia vitoria"]);

function normalizeAlbumGuestName(name) {
  return String(name || "")
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .trim()
    .replace(/\s+/g, " ")
    .toLowerCase();
}

function isAlbumEarlyAccessGuest(name) {
  return albumEarlyAccessGuestNames.has(normalizeAlbumGuestName(name));
}

function isAlbumPubliclyOpen(now = Date.now()) {
  return now >= albumPublicOpenAtMs;
}

async function setupAlbumEntryButton() {
  const button = document.querySelector("[data-album-entry]");
  const note = document.querySelector("[data-album-entry-note]");
  if (!button) return;

  let albumPublicOpen = isAlbumPubliclyOpen();
  try {
    const config = await loadPaymentConfig();
    if (typeof config.albumPublicOpen === "boolean") {
      albumPublicOpen = config.albumPublicOpen;
    }
  } catch (error) {
    /* mantém horário local */
  }

  const earlyAccess = isAlbumEarlyAccessGuest(getKnownGuestName());
  if (!albumPublicOpen && !earlyAccess) {
    button.addEventListener("click", (event) => {
      event.preventDefault();
    });
    if (note) note.hidden = false;
    return;
  }

  const link = document.createElement("a");
  link.className = "button primary";
  link.href = "/album";
  link.textContent = button.textContent.trim();
  button.replaceWith(link);

  if (note) {
    if (earlyAccess && !albumPublicOpen) {
      note.textContent = "Você tem acesso antecipado ao álbum.";
      note.hidden = false;
    } else {
      note.hidden = true;
    }
  }
}

function saveRsvp(name, partySize, additionalGuestNames = []) {
  const guestName = name.trim().replace(/\s+/g, " ");
  if (!guestName) return;

  localStorage.setItem(
    rsvpStorageKey,
    JSON.stringify({
      name: guestName,
      partySize,
      additionalGuestNames,
      confirmedAt: new Date().toISOString(),
    }),
  );
}

function clearSavedRsvp() {
  localStorage.removeItem(rsvpStorageKey);
}

function resetRsvpHeroState() {
  const heroCopy = document.querySelector(".hero-copy");
  const heroActions = document.querySelector(".hero-actions");
  const adjustButton = document.querySelector("[data-open-rsvp-adjust]");
  const detailsButton = document.querySelector("[data-scroll-details]");

  if (heroCopy) {
    heroCopy.textContent = defaultHeroCopy;
    heroCopy.classList.remove("confirmed");
  }
  heroActions?.classList.remove("is-rsvp-confirmed");
  adjustButton?.setAttribute("hidden", "");
  if (detailsButton) detailsButton.hidden = true;
}

function rsvpFromApiRow(row, fallbackGuestNames = []) {
  if (!row?.guest_name) return null;
  // O servidor omite acompanhantes para aparelhos que não fizeram a confirmação.
  return {
    name: row.guest_name,
    partySize: row.party_size,
    additionalGuestNames: Array.isArray(row.additional_guest_names) ? row.additional_guest_names : fallbackGuestNames,
  };
}

function isRsvpLookupNotFound(error) {
  const message = String(error?.message || "");
  return /confirmação não encontrada|não encontrad/i.test(message);
}

async function restoreRsvpFromRememberCookie() {
  if (getSavedRsvp()?.name) return;

  try {
    const remote = await requestJson("/api/rsvp/session");
    if (!remote?.authenticated) return;
    const synced = rsvpFromApiRow(remote?.rsvp);
    if (!synced) return;
    saveRsvp(synced.name, synced.partySize, synced.additionalGuestNames);
  } catch {
    /* cookie ausente ou inválido */
  }
}

async function syncSavedRsvpFromServer() {
  const savedRsvp = getSavedRsvp();
  if (!savedRsvp?.name) return;

  try {
    const remote = await requestJson("/api/rsvp/lookup", {
      method: "POST",
      body: JSON.stringify({ guestName: savedRsvp.name }),
    });
    const synced = rsvpFromApiRow(remote?.rsvp, savedRsvp.additionalGuestNames);
    if (!synced) {
      clearSavedRsvp();
      resetRsvpHeroState();
      return;
    }
    saveRsvp(synced.name, synced.partySize, synced.additionalGuestNames);
  } catch (error) {
    if (isRsvpLookupNotFound(error)) {
      clearSavedRsvp();
      resetRsvpHeroState();
    }
  }
}

async function initRsvpHeroState() {
  await restoreRsvpFromRememberCookie();
  if (!getSavedRsvp()?.name) return;
  await syncSavedRsvpFromServer();
  if (getSavedRsvp()?.name) renderRsvpState();
}

function formatSavedRsvpNames(savedRsvp) {
  const extras = Array.isArray(savedRsvp?.additionalGuestNames) ? savedRsvp.additionalGuestNames : [];
  if (!extras.length) return savedRsvp?.name || "";
  return [savedRsvp.name, ...extras].join(" · ");
}

function renderRsvpState() {
  const savedRsvp = getSavedRsvp();
  const heroCopy = document.querySelector(".hero-copy");
  const heroActions = document.querySelector(".hero-actions");
  const rsvpButton = document.querySelector("[data-open-rsvp]");
  const adjustButton = document.querySelector("[data-open-rsvp-adjust]");
  const detailsButton = document.querySelector("[data-scroll-details]");

  if (!heroCopy || !rsvpButton || !savedRsvp?.name) return;

  const guestList = formatSavedRsvpNames(savedRsvp);
  const companionsNote = guestList !== savedRsvp.name
    ? ` Confirmamos: ${guestList}.`
    : "";
  heroCopy.textContent = `Olá, ${savedRsvp.name}! Sua presença já foi confirmada.${companionsNote} Se esqueceu de incluir alguém, use “Ajustar confirmação”. Confira os detalhes da cerimônia e, se desejar, nossa lista de presentes.`;
  heroCopy.classList.add("confirmed");
  heroActions?.classList.add("is-rsvp-confirmed");
  adjustButton?.removeAttribute("hidden");
  if (detailsButton) detailsButton.hidden = false;
}

function syncMusicButton() {
  if (!musicToggle || !weddingAudio) return;

  musicToggle.classList.toggle("is-muted", weddingAudio.muted || audioBlocked);
  musicToggle.setAttribute("aria-pressed", String(weddingAudio.muted));

  const label = musicToggle.querySelector("span");
  if (document.hidden) {
    musicToggle.setAttribute("aria-label", "Música pausada");
    if (label) label.textContent = "Pausado";
    return;
  }

  if ((audioBlocked || weddingAudio.muted || weddingAudio.paused) && !userMutedAudio) {
    musicToggle.setAttribute("aria-label", "Tocar música");
    if (label) label.textContent = "Tocar";
    return;
  }

  musicToggle.setAttribute("aria-label", weddingAudio.muted ? "Ativar música" : "Mutar música");
  if (label) label.textContent = weddingAudio.muted ? "Som" : "Mutar";
}

function prepareWeddingAudio() {
  if (!weddingAudio) return;

  if (weddingAudio.currentTime < audioStartTime) {
    weddingAudio.currentTime = audioStartTime;
  }
  weddingAudio.volume = 0.55;
}

async function startWeddingAudio({ unmute = true, allowMutedFallback = true } = {}) {
  if (!weddingAudio || document.hidden) return false;

  prepareWeddingAudio();

  if (unmute && !userMutedAudio) {
    weddingAudio.muted = false;
  }

  try {
    await weddingAudio.play();
    audioStarted = true;
    audioBlocked = false;
    audioPausedByVisibility = false;
    syncMusicButton();
    return true;
  } catch (error) {
    if (allowMutedFallback) {
      try {
        weddingAudio.muted = true;
        await weddingAudio.play();
        audioStarted = true;
        audioBlocked = true;
        audioPausedByVisibility = false;
        syncMusicButton();
        return false;
      } catch (mutedError) {
        audioStarted = false;
        audioBlocked = true;
      }
    } else {
      audioStarted = false;
      audioBlocked = true;
    }
  }

  syncMusicButton();
  return false;
}

function enableAudioAfterInteraction() {
  if (!weddingAudio || document.hidden) return;
  if (!weddingAudio.paused && !weddingAudio.muted && !audioBlocked) return;

  userMutedAudio = false;
  startWeddingAudio({ unmute: true, allowMutedFallback: false });
}

async function toggleMusic() {
  if (!weddingAudio) return;

  if (!audioStarted || weddingAudio.paused || weddingAudio.muted || audioBlocked) {
    userMutedAudio = false;
    weddingAudio.muted = false;
    await startWeddingAudio({ unmute: true, allowMutedFallback: false });
    syncMusicButton();
    return;
  }

  userMutedAudio = true;
  weddingAudio.muted = true;
  syncMusicButton();
}

function handleAudioVisibility() {
  if (!weddingAudio) return;

  if (document.hidden) {
    audioWasPlayingBeforeVisibilityPause = !weddingAudio.paused && !userMutedAudio;
    if (!weddingAudio.paused) {
      weddingAudio.pause();
      audioPausedByVisibility = true;
    }
    syncMusicButton();
    return;
  }

  if (audioPausedByVisibility && audioWasPlayingBeforeVisibilityPause) {
    startWeddingAudio({ unmute: !userMutedAudio, allowMutedFallback: true });
  } else {
    syncMusicButton();
  }
}

function giftIcon() {
  return `
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <path d="M20 12v8a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1v-8M2 8h20v4H2zM12 21V8" />
      <path d="M12 8H7.5A2.5 2.5 0 1 1 10 5.5C10 7 12 8 12 8ZM12 8h4.5A2.5 2.5 0 1 0 14 5.5C14 7 12 8 12 8Z" />
    </svg>
  `;
}

function renderGifts() {
  if (!giftFilters || !giftGrid) return;

  const currentFilter = filters.find((filter) => filter.id === activeFilter) || filters[0];
  const filteredGifts = gifts.filter(currentFilter.match);
  const renderSignature = JSON.stringify({
    filter: activeFilter,
    gifts: filteredGifts.map((gift) => [
      gift.id,
      gift.name,
      gift.text,
      gift.status,
      gift.category,
      gift.imageUrl,
      gift.value,
      gift.goal,
      gift.contributed,
      Array.isArray(gift.options) ? gift.options.join(",") : "",
      Array.isArray(gift.givers) ? gift.givers.join(",") : "",
    ]),
  });

  if (renderSignature === lastGiftRenderSignature) return;
  lastGiftRenderSignature = renderSignature;

  giftFilters.innerHTML = filters
    .map((filter) => `
      <button class="filter-button ${filter.id === activeFilter ? "active" : ""}" type="button" data-gift-filter="${filter.id}">
        ${filter.label}
      </button>
    `)
    .join("");

  giftGrid.innerHTML = giftSections
    .map((section) => {
      const sectionGifts = filteredGifts.filter((gift) => gift.section === section.id);
      if (!sectionGifts.length) return "";

      return `
        <section class="gift-section" aria-labelledby="gift-section-${section.id}">
          <h3 id="gift-section-${section.id}">${section.title}</h3>
          <div class="gift-grid">
            ${sectionGifts.map(renderGiftCard).join("")}
          </div>
        </section>
      `;
    })
    .join("");
}

function renderGiftMessage(title, text) {
  if (!giftFilters || !giftGrid) return;

  giftFilters.innerHTML = "";
  giftGrid.innerHTML = `
    <div class="gift-message">
      <h3>${escapeHtml(title)}</h3>
      <p>${escapeHtml(text)}</p>
    </div>
  `;
}

async function loadGifts() {
  if (giftLoadPromise) return giftLoadPromise;

  giftLoadPromise = (async () => {
  try {
    const payload = await requestJson("/api/gifts");
    if (Array.isArray(payload.gifts) && payload.gifts.length) {
      gifts = payload.gifts.map(normalizeGiftForUi);
      lastGiftLoadAt = Date.now();
      renderGifts();
      trackSiteEngagement("gifts_list_opened");
      return;
    }

    if (!useLocalGiftFallback) {
      renderGiftMessage("Lista indisponivel", "Nao encontramos presentes cadastrados no Supabase agora.");
    }
  } catch (error) {
    if (useLocalGiftFallback) {
      renderGifts();
      return;
    }

    renderGiftMessage("Lista indisponivel", error.message || "Nao foi possivel carregar os presentes do Supabase. Tente novamente em alguns instantes.");
  }
  })();

  try {
    return await giftLoadPromise;
  } finally {
    giftLoadPromise = null;
  }
}

function normalizeGiftForUi(gift) {
  return {
    ...gift,
    value: Number(gift.value || 0),
    goal: Number(gift.goal || 0),
    contributed: Number(gift.contributed || 0),
    options: Array.isArray(gift.options) ? gift.options.map(Number) : [],
    status: gift.status || "available",
    imageUrl: normalizeImageUrl(gift.imageUrl),
    givers: Array.isArray(gift.givers) ? gift.givers.map(String) : [],
  };
}

function renderGiftCard(gift) {
  const isOpen = gift.type === "open";
  const reserved = gift.status === "reserved";
  const contributed = Number.isFinite(Number(gift.contributed)) ? Number(gift.contributed) : 0;
  const valueText = isOpen
    ? "Valor livre"
    : gift.type === "quota"
      ? `Meta: ${formatCurrency(gift.goal)}`
      : formatCurrency(gift.value);
  const buttonText = gift.type === "quota" || isOpen ? "Contribuir" : "Presentear";
  const displayContributed = gift.type === "quota" && reserved ? Math.max(contributed, gift.goal) : contributed;
  const progressValue = gift.goal > 0 ? Math.min(100, Math.round((displayContributed / gift.goal) * 100)) : 0;
  const quotaCompleted = gift.type === "quota" && progressValue >= 100;
  const showReserved = gift.type === "quota" ? quotaCompleted : isOpen ? false : reserved;
  const showActionButton = gift.type === "quota" ? !quotaCompleted : true;

  return `
    <article class="gift-card ${gift.type === "quota" ? "quota-card" : ""} ${isOpen ? "open-card" : ""} ${gift.imageUrl ? "has-image" : ""}">
      <div class="gift-icon">${giftIcon()}</div>
      ${renderGiftImage(gift)}
      <div class="gift-card-main">
        <span class="gift-category">${isOpen ? "Contribuição livre" : gift.type === "quota" ? "Cota da casa" : escapeHtml(gift.category)}</span>
        <h4>${escapeHtml(gift.name)}</h4>
        <p class="gift-price">${valueText}</p>
        ${gift.imageUrl ? "" : renderGiftDescription(gift)}
      </div>
      ${gift.imageUrl ? renderGiftDescription(gift) : ""}
      ${isOpen && contributed > 0 ? `
        <p class="gift-open-total">${formatCurrency(contributed)} já contribuídos com carinho</p>
      ` : ""}
      ${gift.type === "quota" && gift.options.length ? `
        <div class="quota-progress ${quotaCompleted ? "completed" : ""}" aria-label="Progresso da cota de ${escapeAttribute(gift.name)}">
          <div class="quota-progress-text">
            <span>${formatCurrency(Math.min(displayContributed, gift.goal))} arrecadados</span>
            <strong>${quotaCompleted ? "Concluída" : `${progressValue}%`}</strong>
          </div>
          <div class="quota-progress-bar" aria-hidden="true">
            <span style="width: ${progressValue}%"></span>
          </div>
          <p>${quotaCompleted ? "Todas as cotas foram presenteadas." : `Faltam ${formatCurrency(Math.max(gift.goal - displayContributed, 0))}`}</p>
        </div>
        <div class="quota-options" aria-label="Opções de cota para ${escapeAttribute(gift.name)}">
          ${gift.options.map((option) => `<span>${formatCurrency(option)}</span>`).join("")}
        </div>
      ` : ""}
      ${renderGiftGivers(gift)}
      <div class="gift-footer">
        <span class="badge available">${isOpen ? "Sempre disponível" : showReserved ? "Reservado" : "Disponível"}</span>
        ${showActionButton ? `
          <button class="button ${reserved ? "secondary" : "primary"}" data-gift-id="${escapeAttribute(gift.id)}" ${reserved ? "disabled" : ""}>
            ${reserved ? "Já escolhido" : buttonText}
          </button>
        ` : ""}
      </div>
    </article>
  `;
}

function openModal(html) {
  modalContent.innerHTML = html;
  modal.classList.add("open");
  modal.setAttribute("aria-hidden", "false");
  const focusTarget = modal.querySelector("input, select, button");
  focusTarget?.focus();
}

function closeModal() {
  modal.classList.remove("open");
  modal.setAttribute("aria-hidden", "true");
  modalContent.innerHTML = "";
}

function showSuccess(message) {
  openModal(`
    <div class="modal-icon">
      <svg viewBox="0 0 24 24" aria-hidden="true"><path d="m20 6-11 11-5-5" /></svg>
    </div>
    <h2 id="modal-title" class="success-title">Recebido com carinho!</h2>
    <p>${escapeHtml(message)}</p>
    <div class="modal-actions">
      <button class="button primary" data-close-modal>Fechar</button>
    </div>
  `);
}

function showError(message) {
  openModal(`
    <div class="modal-icon">
      <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 9v4" /><path d="M12 17h.01" /><path d="M10.3 3.9 1.8 18a2 2 0 0 0 1.7 3h17a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0Z" /></svg>
    </div>
    <h2 id="modal-title" class="success-title">Não foi possível salvar</h2>
    <p>${escapeHtml(message)}</p>
    <div class="modal-actions">
      <button class="button primary" data-close-modal>Fechar</button>
    </div>
  `);
}

function showRsvpIssue({ title, message, draft }) {
  rsvpDraft = draft;
  openModal(`
    <div class="modal-icon">
      <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 9v4" /><path d="M12 17h.01" /><path d="M10.3 3.9 1.8 18a2 2 0 0 0 1.7 3h17a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0Z" /></svg>
    </div>
    <h2 id="modal-title" class="success-title">${escapeHtml(title)}</h2>
    <p>${escapeHtml(message)}</p>
    <div class="modal-actions rsvp-error-actions">
      <button class="button secondary" type="button" data-rsvp-restore>Voltar</button>
      <button class="button primary" type="button" data-close-modal>Fechar</button>
    </div>
  `);
}

function showRsvpError(message, draft) {
  showRsvpIssue({
    title: "Não foi possível salvar",
    message,
    draft,
  });
}

function captureRsvpDraft(form) {
  return {
    step: Number(form.dataset.rsvpStep || 1),
    guestName: String(form.querySelector('[name="guestName"]')?.value || ""),
    includePartner: Boolean(form.querySelector("[data-rsvp-include-partner]")?.checked),
    includeChildren: Boolean(form.querySelector("[data-rsvp-include-children]")?.checked),
    partnerName: String(form.querySelector('[name="partnerName"]')?.value || ""),
    childrenNames: Array.from(form.querySelectorAll('[name="childrenNames"]')).map((input) => String(input.value || "")),
  };
}

function restoreRsvpDraft(form, draft) {
  form.querySelector('[name="guestName"]').value = draft.guestName;
  form.querySelector("[data-rsvp-include-partner]").checked = draft.includePartner;
  form.querySelector("[data-rsvp-include-children]").checked = draft.includeChildren;

  const partnerInput = form.querySelector('[name="partnerName"]');
  if (partnerInput) partnerInput.value = draft.partnerName;

  const childFields = form.querySelector("[data-rsvp-child-fields]");
  if (childFields) {
    childFields.replaceChildren();
    if (draft.includeChildren) {
      const names = draft.childrenNames.length ? draft.childrenNames : [""];
      names.forEach((name) => {
        appendRsvpChildField(form, { focus: false });
        const inputs = form.querySelectorAll('[name="childrenNames"]');
        inputs[inputs.length - 1].value = name;
      });
    }
  }

  rsvpWizardSetStep(form, draft.step);
  updateRsvpSections(form);
  updateRsvpSummary(form);
  form.querySelector('[name="guestName"]')?.focus();
}

function showGuestNotInvited(draft = null, message = "") {
  const copy = String(message || "").trim()
    || "Infelizmente, este nome não está na lista de convidados.";
  if (draft) {
    showRsvpIssue({
      title: "Lista de convidados",
      message: copy,
      draft,
    });
    return;
  }

  openModal(`
    <div class="modal-icon">
      <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 9v4" /><path d="M12 17h.01" /><path d="M10.3 3.9 1.8 18a2 2 0 0 0 1.7 3h17a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0Z" /></svg>
    </div>
    <h2 id="modal-title">Lista de convidados</h2>
    <p>${escapeHtml(copy)}</p>
    <div class="modal-actions">
      <button class="button primary" data-close-modal>Fechar</button>
    </div>
  `);
}

function updateRsvpChildButton(form) {
  const addButton = form.querySelector("[data-add-rsvp-child]");
  const childCount = form.querySelectorAll('[name="childrenNames"]').length;
  if (!addButton) return;

  addButton.disabled = childCount >= 6;
  addButton.textContent = childCount >= 6 ? "Limite de seis filhos" : "+ Adicionar outro filho(a)";
}

function appendRsvpChildField(form, { focus = true } = {}) {
  const fields = form.querySelector("[data-rsvp-child-fields]");
  if (!fields || fields.querySelectorAll('[name="childrenNames"]').length >= 6) return;

  const row = document.createElement("div");
  row.className = "additional-guest-row";

  const label = document.createElement("label");
  const labelText = document.createElement("span");
  const childIndex = fields.querySelectorAll('[name="childrenNames"]').length + 1;
  labelText.textContent = childIndex === 1 ? "Nome do filho(a)" : `Nome do ${childIndex}º filho(a)`;

  const input = document.createElement("input");
  input.name = "childrenNames";
  input.required = true;
  input.autocomplete = "off";
  input.placeholder = "Ex.: Ana Souza";

  label.append(labelText, input);
  row.append(label);

  if (childIndex > 1) {
    const removeButton = document.createElement("button");
    removeButton.className = "remove-guest-button";
    removeButton.type = "button";
    removeButton.dataset.removeRsvpChild = "";
    removeButton.setAttribute("aria-label", "Remover este filho");
    removeButton.textContent = "×";
    row.append(removeButton);
  }

  fields.append(row);
  updateRsvpChildButton(form);
  if (focus) input.focus();
}

function updateRsvpSections(form) {
  const includePartner = form.querySelector("[data-rsvp-include-partner]")?.checked;
  const includeChildren = form.querySelector("[data-rsvp-include-children]")?.checked;
  const partnerSection = form.querySelector("[data-rsvp-partner]");
  const childrenSection = form.querySelector("[data-rsvp-children]");
  const childFields = form.querySelector("[data-rsvp-child-fields]");
  const partnerInput = form.querySelector('[name="partnerName"]');
  const stepCopy = form.querySelector("[data-rsvp-step-copy]");

  if (partnerSection) partnerSection.hidden = !includePartner;
  if (partnerInput) partnerInput.required = Boolean(includePartner);

  if (childrenSection) childrenSection.hidden = !includeChildren;
  if (includeChildren && childFields && childFields.children.length === 0) {
    appendRsvpChildField(form, { focus: false });
  }
  if (!includeChildren && childFields) childFields.replaceChildren();

  if (stepCopy) {
    if (includePartner && includeChildren) {
      stepCopy.textContent = "Informe o nome do seu parceiro ou parceira e de cada filho(a).";
    } else if (includePartner) {
      stepCopy.textContent = "Informe o nome completo do seu parceiro ou parceira.";
    } else if (includeChildren) {
      stepCopy.textContent = "Informe o nome completo de cada filho(a) que virá com você.";
    }
  }

  updateRsvpChildButton(form);
  updateRsvpSummary(form);
}

function updateRsvpSummary(form) {
  const summary = form.querySelector("[data-rsvp-summary]");
  if (!summary) return;

  const guestName = String(form.querySelector('[name="guestName"]')?.value || "").trim();
  const includePartner = form.querySelector("[data-rsvp-include-partner]")?.checked;
  const includeChildren = form.querySelector("[data-rsvp-include-children]")?.checked;
  const partnerName = String(form.querySelector('[name="partnerName"]')?.value || "").trim();
  const childrenNames = Array.from(form.querySelectorAll('[name="childrenNames"]'))
    .map((input) => String(input.value || "").trim())
    .filter(Boolean);

  const people = [guestName];
  if (includePartner && partnerName) people.push(partnerName);
  if (includeChildren) people.push(...childrenNames);

  summary.innerHTML = `
    <span class="rsvp-summary-label">Confirmando presença de</span>
    <strong>${escapeHtml(people.filter(Boolean).join(" · ") || guestName || "—")}</strong>
  `;
}

function rsvpWizardSetStep(form, step) {
  form.dataset.rsvpStep = String(step);

  form.querySelectorAll("[data-rsvp-step]").forEach((panel) => {
    panel.hidden = panel.dataset.rsvpStep !== String(step);
  });

  form.querySelectorAll("[data-rsvp-progress]").forEach((item) => {
    const itemStep = Number(item.dataset.rsvpProgress);
    item.classList.toggle("is-active", itemStep === step);
    item.classList.toggle("is-complete", itemStep < step);
  });

  const backButton = form.querySelector("[data-rsvp-back]");
  const nextButton = form.querySelector("[data-rsvp-next]");
  const submitButton = form.querySelector("[data-rsvp-submit]");
  const cancelButton = form.querySelector("[data-rsvp-cancel]");

  if (backButton) backButton.hidden = step === 1;
  if (cancelButton) cancelButton.hidden = step !== 1;
  if (nextButton) nextButton.hidden = step === 3;
  if (submitButton) submitButton.hidden = step !== 3;

  if (step === 3) {
    updateRsvpSections(form);
    const focusTarget = form.querySelector('[data-rsvp-partner]:not([hidden]) input, [data-rsvp-children]:not([hidden]) input');
    (focusTarget || submitButton)?.focus();
  } else if (step === 1) {
    form.querySelector('[name="guestName"]')?.focus();
  }
}

function validateRsvpWizardStep(form, step) {
  if (step === 1) {
    const guestName = String(form.querySelector('[name="guestName"]')?.value || "").trim().replace(/\s+/g, " ");
    if (!hasFullGuestName(guestName)) {
      return "Informe seu nome e sobrenome.";
    }
    return null;
  }

  if (step === 2) return null;

  const payload = buildRsvpPayload(new FormData(form));
  return payload.error || null;
}

function rsvpWizardContinue(form) {
  const step = Number(form.dataset.rsvpStep || 1);
  const error = validateRsvpWizardStep(form, step);
  if (error) {
    showRsvpError(error, captureRsvpDraft(form));
    return;
  }

  if (step === 1) {
    rsvpWizardSetStep(form, 2);
    return;
  }

  if (step === 2) {
    const includePartner = form.querySelector("[data-rsvp-include-partner]")?.checked;
    const includeChildren = form.querySelector("[data-rsvp-include-children]")?.checked;
    if (!includePartner && !includeChildren) {
      if (form.dataset.rsvpMode === "adjust") {
        showRsvpError(
          "Marque parceiro(a) ou filho(s) para incluir alguém. Se não precisa alterar, feche esta janela.",
          captureRsvpDraft(form),
        );
        return;
      }
      form.requestSubmit();
      return;
    }
    rsvpWizardSetStep(form, 3);
  }
}

function buildRsvpPayload(formData) {
  const guestName = String(formData.get("guestName") || "").trim().replace(/\s+/g, " ");
  const includePartner = formData.get("includePartner") === "on";
  const includeChildren = formData.get("includeChildren") === "on";
  const partnerName = String(formData.get("partnerName") || "").trim().replace(/\s+/g, " ");
  const childrenNames = formData
    .getAll("childrenNames")
    .map((name) => String(name || "").trim().replace(/\s+/g, " "))
    .filter(Boolean);

  if (!hasFullGuestName(guestName)) {
    return { error: "Informe seu nome e sobrenome." };
  }

  if (includePartner) {
    if (!hasFullGuestName(partnerName)) {
      return { error: "Informe o nome e sobrenome do seu parceiro ou parceira." };
    }
    if (includeChildren && childrenNames.length === 0) {
      return { error: "Informe o nome de pelo menos um filho." };
    }
    const additionalGuestNames = includeChildren ? [partnerName, ...childrenNames] : [partnerName];
    if (additionalGuestNames.some((name) => !hasFullGuestName(name))) {
      return { error: "Informe nome e sobrenome de cada pessoa." };
    }
    if (includeChildren) {
      return { guestName, partySize: "Família", additionalGuestNames };
    }
    return { guestName, partySize: "Casal", additionalGuestNames };
  }

  if (includeChildren) {
    if (childrenNames.length === 0) {
      return { error: "Informe o nome de pelo menos um filho." };
    }
    if (childrenNames.some((name) => !hasFullGuestName(name))) {
      return { error: "Informe nome e sobrenome de cada filho." };
    }
    return { guestName, partySize: "Responsável e menores", additionalGuestNames: childrenNames };
  }

  return { guestName, partySize: "Somente eu", additionalGuestNames: [] };
}

function buildRsvpDraftFromSaved(savedRsvp) {
  const additionalGuestNames = Array.isArray(savedRsvp.additionalGuestNames)
    ? savedRsvp.additionalGuestNames
    : [];
  const draft = {
    step: 2,
    guestName: savedRsvp.name || "",
    includePartner: false,
    includeChildren: false,
    partnerName: "",
    childrenNames: [],
  };

  if (savedRsvp.partySize === "Família") {
    draft.includePartner = true;
    draft.includeChildren = true;
    draft.partnerName = additionalGuestNames[0] || "";
    draft.childrenNames = additionalGuestNames.length > 1
      ? additionalGuestNames.slice(1)
      : [""];
  } else if (savedRsvp.partySize === "Casal") {
    draft.includePartner = true;
    draft.partnerName = additionalGuestNames[0] || "";
  } else if (savedRsvp.partySize === "Responsável e menores") {
    draft.includeChildren = true;
    draft.childrenNames = additionalGuestNames.length ? [...additionalGuestNames] : [""];
  }

  return draft;
}

function openRsvpAdjustModal() {
  openRsvpAdjustModalAsync().catch(() => openRsvpModal());
}

async function openRsvpAdjustModalAsync() {
  const savedRsvp = getSavedRsvp();
  if (!savedRsvp?.name) {
    openRsvpModal();
    return;
  }

  let synced = savedRsvp;
  try {
    const remote = await requestJson("/api/rsvp/lookup", {
      method: "POST",
      body: JSON.stringify({ guestName: savedRsvp.name }),
    });
    const fromApi = rsvpFromApiRow(remote?.rsvp, savedRsvp.additionalGuestNames);
    if (fromApi) {
      synced = fromApi;
      saveRsvp(synced.name, synced.partySize, synced.additionalGuestNames);
    }
  } catch (error) {
    if (isRsvpLookupNotFound(error)) {
      clearSavedRsvp();
      resetRsvpHeroState();
      setupAlbumEntryButton();
      openRsvpModal();
      return;
    }
  }

  openRsvpModal(buildRsvpDraftFromSaved(synced), { adjust: true });
}

function openRsvpModal(restoreDraft = null, options = {}) {
  const isAdjust = Boolean(options.adjust);
  openModal(`
    <div class="modal-icon">
      <svg viewBox="0 0 24 24" aria-hidden="true">
        <path d="M20.8 4.6a5.5 5.5 0 0 0-7.8 0L12 5.6l-1-1a5.5 5.5 0 0 0-7.8 7.8l1 1L12 21l7.8-7.6 1-1a5.5 5.5 0 0 0 0-7.8Z" />
      </svg>
    </div>
    <h2 id="modal-title">${isAdjust ? "Ajustar confirmação" : "Confirmar presença"}</h2>
    <p class="rsvp-intro">${isAdjust
    ? "Inclua ou corrija quem vem com você. Use o mesmo nome da confirmação original."
    : "Que alegria saber que você vem! Cada casal pode confirmar pelo par, e cada pai ou mãe pode confirmar pelo filho."}</p>
    <form data-rsvp-form data-rsvp-step="1"${isAdjust ? ' data-rsvp-mode="adjust"' : ""}>
      <div class="rsvp-progress" aria-hidden="true">
        <span class="is-active" data-rsvp-progress="1">1. Você</span>
        <span data-rsvp-progress="2">2. Quem vem</span>
        <span data-rsvp-progress="3">3. Revisar</span>
      </div>

      <section class="rsvp-step" data-rsvp-step="1">
        <p class="rsvp-step-title">Como você se chama?</p>
        <p class="rsvp-step-copy">Use nome e sobrenome, como no convite.</p>
        <label>
          Seu nome completo
          <input name="guestName" required autocomplete="name" placeholder="Ex.: Maria Silva" />
        </label>
      </section>

      <section class="rsvp-step" data-rsvp-step="2" hidden>
        <p class="rsvp-step-title">Alguém vem com você?</p>
        <p class="rsvp-step-copy">Se for só você, toque em continuar. Caso contrário, marque quem também estará presente.</p>
        <div class="rsvp-option-grid">
          <label class="rsvp-option-card">
            <input type="checkbox" name="includePartner" data-rsvp-include-partner />
            <span class="rsvp-option-icon" aria-hidden="true">♡</span>
            <strong>Parceiro(a)</strong>
            <small>Incluir meu(minha) companheiro(a) na confirmação</small>
          </label>
          <label class="rsvp-option-card">
            <input type="checkbox" name="includeChildren" data-rsvp-include-children />
            <span class="rsvp-option-icon" aria-hidden="true">✦</span>
            <strong>Filho(s)</strong>
            <small>Incluir filho(s) na confirmação</small>
          </label>
        </div>
      </section>

      <section class="rsvp-step" data-rsvp-step="3" hidden>
        <p class="rsvp-step-title">Só falta um detalhe</p>
        <p class="rsvp-step-copy" data-rsvp-step-copy>Informe os nomes de quem vem com você.</p>
        <div class="rsvp-summary" data-rsvp-summary></div>
        <div class="rsvp-partner" data-rsvp-partner hidden>
          <label>
            Nome do(a) parceiro(a)
            <input name="partnerName" autocomplete="off" placeholder="Ex.: João Souza" />
          </label>
        </div>
        <div class="rsvp-children" data-rsvp-children hidden>
          <div class="additional-guest-fields" data-rsvp-child-fields></div>
          <button class="add-guest-button" type="button" data-add-rsvp-child>+ Adicionar outro filho(a)</button>
        </div>
      </section>

      <div class="modal-actions rsvp-actions">
        <button class="button secondary" type="button" data-rsvp-back hidden>Voltar</button>
        <button class="button secondary" type="button" data-rsvp-cancel data-close-modal>Cancelar</button>
        <button class="button primary" type="button" data-rsvp-next>Continuar</button>
        <button class="button primary" type="submit" data-rsvp-submit hidden>${isAdjust ? "Salvar ajuste" : "Confirmar presença"}</button>
      </div>
    </form>
  `);

  const form = modalContent.querySelector("[data-rsvp-form]");
  if (!form) return;
  if (restoreDraft) restoreRsvpDraft(form, restoreDraft);
  else rsvpWizardSetStep(form, 1);

  if (isAdjust) {
    const nameInput = form.querySelector('[name="guestName"]');
    if (nameInput) nameInput.readOnly = true;
  }
}

function openGiftModal(gift) {
  trackSiteEngagement("gift_modal_opened", gift.id);
  const isQuota = gift.type === "quota";
  const isOpen = gift.type === "open";
  const hasOnlinePayment = hasOnlinePaymentConfigured();
  const giftName = escapeHtml(gift.name);
  const knownGuestName = getKnownGuestName();
  const modalTitle = isQuota || isOpen ? "Contribuir" : "Escolher presente";
  const modalLead = isOpen
    ? `Informe seu nome e o valor que deseja presentear para: <strong>${giftName}</strong>.`
    : isQuota
      ? `Escolha uma cota, informe seu nome e sobrenome e siga com a forma de pagamento que preferir para: <strong>${giftName}</strong>.`
      : `Informe seu nome e sobrenome e escolha como deseja presentear: <strong>${giftName}</strong>.`;

  openModal(`
    <div class="modal-icon">${giftIcon()}</div>
    <h2 id="modal-title">${modalTitle}</h2>
    <p>${modalLead}</p>
    <form data-gift-form="${escapeAttribute(gift.id)}">
      <label>
        Seu nome e sobrenome
        <input name="guestName" required autocomplete="name" placeholder="Ex.: Maria Silva" value="${knownGuestName ? escapeAttribute(knownGuestName) : ""}" />
      </label>
      <label>
        Seu e-mail <span class="optional-label">opcional</span>
        <input name="buyerEmail" type="email" autocomplete="email" placeholder="Para o comprovante do pagamento online" />
      </label>
      <label>
        Mensagem para os noivos <span class="optional-label">opcional</span>
        <textarea name="message" rows="4" maxlength="5000" placeholder="Escreva uma mensagem com carinho"></textarea>
      </label>
      ${isQuota ? `
        <label>
          Valor da cota
          <select name="quotaValue" required>
            ${gift.options.map((option) => `<option value="${option}">${formatCurrency(option)}</option>`).join("")}
          </select>
        </label>
      ` : isOpen ? `
        <label>
          Valor do presente
          <input name="openValue" type="number" min="${minOpenGiftAmount}" max="${maxOpenGiftAmount}" step="1" required placeholder="Ex.: 150" inputmode="numeric" />
        </label>
      ` : `
        <p class="modal-value">Valor do presente: <strong>${formatCurrency(gift.value)}</strong></p>
      `}
      <input type="hidden" name="paymentMethod" value="in_person" />
      <div class="payment-methods" aria-label="Como deseja presentear">
        <button class="payment-method selected" type="button" data-payment-method="in_person" aria-pressed="true">
          <span>${paymentMethodIcon("in_person")}</span>
          <strong>Pessoalmente</strong>
          <small>Combinar com os noivos e pagar por Pix, cartão ou como preferir</small>
        </button>
        <button class="payment-method" type="button" data-payment-method="online" aria-pressed="false" ${hasOnlinePayment ? "" : "disabled"}>
          <span>${paymentMethodIcon("online")}</span>
          <strong>Online</strong>
          <small>${hasOnlinePayment ? "Pagar agora pelo Mercado Pago com Pix, cartão ou outros meios" : "Pagamento online em configuração"}</small>
        </button>
      </div>
      <p class="payment-note">Nas duas opções você pode usar Pix ou cartão. No online, o pagamento acontece em uma página segura do Mercado Pago.</p>
      <div class="modal-actions">
        <button class="button secondary" type="button" data-close-modal>Cancelar</button>
        <button class="button primary" type="submit">Confirmar</button>
      </div>
    </form>
  `);

  if (knownGuestName) {
    const form = modalContent.querySelector("[data-gift-form]");
    const nextFocus = form?.querySelector('input[name="buyerEmail"], input[name="openValue"], select[name="quotaValue"], textarea[name="message"], button[data-payment-method]');
    nextFocus?.focus();
  }
}

document.addEventListener("change", (event) => {
  if (event.target.matches("[data-rsvp-include-partner], [data-rsvp-include-children]")) {
    const form = event.target.closest("[data-rsvp-form]");
    if (form) updateRsvpSections(form);
  }
});

document.addEventListener("input", (event) => {
  const form = event.target.closest("[data-rsvp-form]");
  if (!form || Number(form.dataset.rsvpStep) !== 3) return;
  if (event.target.matches('[name="guestName"], [name="partnerName"], [name="childrenNames"]')) {
    updateRsvpSummary(form);
  }
});

document.addEventListener("click", async (event) => {
  const rsvpRestoreButton = event.target.closest("[data-rsvp-restore]");
  if (rsvpRestoreButton) {
    openRsvpModal(rsvpDraft);
    return;
  }

  const closeButton = event.target.closest("[data-close-modal]");
  if (closeButton) {
    closeModal();
    return;
  }

  if (event.target.closest("[data-music-toggle]")) {
    toggleMusic();
    return;
  }

  if (event.target.matches("[data-open-rsvp]")) {
    openRsvpModal();
    return;
  }

  if (event.target.matches("[data-open-rsvp-adjust]")) {
    openRsvpAdjustModal();
    return;
  }

  const rsvpNextButton = event.target.closest("[data-rsvp-next]");
  if (rsvpNextButton) {
    const form = rsvpNextButton.closest("[data-rsvp-form]");
    if (form) rsvpWizardContinue(form);
    return;
  }

  const rsvpBackButton = event.target.closest("[data-rsvp-back]");
  if (rsvpBackButton) {
    const form = rsvpBackButton.closest("[data-rsvp-form]");
    if (form) rsvpWizardSetStep(form, Math.max(1, Number(form.dataset.rsvpStep || 1) - 1));
    return;
  }

  const addRsvpChildButton = event.target.closest("[data-add-rsvp-child]");
  if (addRsvpChildButton) {
    const form = addRsvpChildButton.closest("[data-rsvp-form]");
    if (form) appendRsvpChildField(form);
    return;
  }

  const removeRsvpChildButton = event.target.closest("[data-remove-rsvp-child]");
  if (removeRsvpChildButton) {
    const form = removeRsvpChildButton.closest("[data-rsvp-form]");
    removeRsvpChildButton.closest(".additional-guest-row")?.remove();
    if (form) {
      updateRsvpChildButton(form);
      updateRsvpSummary(form);
    }
    return;
  }

  if (event.target.matches("[data-scroll-gifts]")) {
    document.querySelector("#presentes").scrollIntoView({ behavior: "smooth" });
    trackSiteEngagement("gifts_area_view");
    return;
  }

  if (event.target.matches("[data-scroll-details]")) {
    document.querySelector("#detalhes").scrollIntoView({ behavior: "smooth" });
    return;
  }

  const filterButton = event.target.closest("[data-gift-filter]");
  if (filterButton) {
    activeFilter = filterButton.dataset.giftFilter;
    renderGifts();
    return;
  }

  const paymentButton = event.target.closest("[data-payment-method]");
  if (paymentButton) {
    const paymentForm = paymentButton.closest("[data-gift-form]");
    const paymentInput = paymentForm?.querySelector('input[name="paymentMethod"]');
    if (!paymentForm || !paymentInput || paymentButton.disabled) return;

    paymentInput.value = paymentButton.dataset.paymentMethod;
    paymentForm.querySelectorAll("[data-payment-method]").forEach((button) => {
      const selected = button === paymentButton;
      button.classList.toggle("selected", selected);
      button.setAttribute("aria-pressed", String(selected));
    });
    return;
  }

  const giftButton = event.target.closest("[data-gift-id]");
  if (giftButton) {
    const gift = gifts.find((item) => item.id === giftButton.dataset.giftId);
    if (gift && (gift.status === "available" || gift.type === "quota")) {
      await loadPaymentConfig();
      openGiftModal(gift);
    }
  }
});

document.addEventListener("submit", async (event) => {
  const rsvpForm = event.target.closest("[data-rsvp-form]");
  const giftForm = event.target.closest("[data-gift-form]");

  if (rsvpForm) {
    event.preventDefault();
    const draft = captureRsvpDraft(rsvpForm);
    const payload = buildRsvpPayload(new FormData(rsvpForm));
    if (payload.error) {
      showRsvpError(payload.error, draft);
      return;
    }

    const { guestName, partySize, additionalGuestNames } = payload;
    const isAdjust = rsvpForm.dataset.rsvpMode === "adjust";

    try {
      const result = await requestJson("/api/rsvp", {
        method: "POST",
        body: JSON.stringify({ guestName, partySize, additionalGuestNames }),
      });
      const savedRow = result.rsvp;
      saveRsvp(
        savedRow?.guest_name || guestName,
        savedRow?.party_size || partySize,
        Array.isArray(savedRow?.additional_guest_names)
          ? savedRow.additional_guest_names
          : additionalGuestNames,
      );
      renderRsvpState();
      setupAlbumEntryButton();
      rsvpDraft = null;
      const savedNames = formatSavedRsvpNames(getSavedRsvp());
      if (result.alreadyConfirmed) {
        showSuccess(isAdjust
          ? "Nada mudou: sua confirmação já estava assim."
          : "Sua presença já estava confirmada. Que alegria ter você conosco!");
      } else if (isAdjust) {
        showSuccess(savedNames.includes(" · ")
          ? `Confirmação atualizada: ${savedNames}.`
          : "Confirmação atualizada com sucesso.");
      } else {
        showSuccess(savedNames.includes(" · ")
          ? `Presença confirmada para ${savedNames}.`
          : `${additionalGuestNames.length ? "Presenças confirmadas" : "Presença confirmada"} com sucesso. Quando você voltar ao convite, vamos lembrar da sua confirmação.`);
      }
    } catch (error) {
      if (error.code === "guest_not_invited") showGuestNotInvited(draft, error.message);
      else showRsvpError(error.message, draft);
    }
  }

  if (giftForm) {
    event.preventDefault();
    const formData = new FormData(giftForm);
    const gift = gifts.find((item) => item.id === giftForm.dataset.giftForm);
    const guestName = String(formData.get("guestName") || "").trim().replace(/\s+/g, " ");
    const buyerEmail = String(formData.get("buyerEmail") || "");
    const message = String(formData.get("message") || "");
    const quotaValue = Number(formData.get("quotaValue") || 0);
    const openValue = Number(formData.get("openValue") || 0);
    const paymentMethod = String(formData.get("paymentMethod") || "in_person") === "online" ? "online" : "in_person";
    const giftAmount = resolveGiftFormAmount(gift, formData);

    if (!hasFullGuestName(guestName)) {
      showError("Informe seu nome e sobrenome.");
      return;
    }

    if (gift?.type === "open" && !validateOpenGiftAmount(giftAmount)) {
      return;
    }

    if (paymentMethod === "online" && message.length > maxGiftMessageLength) {
      showError(`A mensagem pode ter no máximo ${maxGiftMessageLength} caracteres.`);
      return;
    }

    if (paymentMethod === "online" && !hasOnlinePaymentConfigured()) {
      showError("O pagamento online ainda não está configurado. Por enquanto, escolha pessoalmente.");
      return;
    }

    try {
      if (paymentMethod === "online") {
        const checkout = await requestJson("/api/mercadopago/create-preference", {
          method: "POST",
          body: JSON.stringify({
            giftId: gift?.id,
            amount: gift?.type === "quota" ? quotaValue : gift?.type === "open" ? openValue : gift?.value,
            buyerName: guestName,
            buyerEmail,
            message,
          }),
        });

        const checkoutUrl = checkout.checkoutUrl || checkout.init_point;

        if (!checkoutUrl) {
          throw new Error("Não foi possível iniciar o pagamento online.");
        }

        window.location.href = checkoutUrl;
        return;
      }

      await requestJson("/api/gifts/reserve", {
        method: "POST",
        body: JSON.stringify({
          giftId: gift?.id,
          guestName,
          amount: gift?.type === "quota" || gift?.type === "open" ? giftAmount : undefined,
        }),
      });

      if (gift && gift.type === "fixed") {
        gift.status = "reserved";
        renderGifts();
      } else if (gift && (gift.type === "quota" || gift.type === "open")) {
        gift.contributed = (Number(gift.contributed) || 0) + giftAmount;
        if (gift.type === "quota" && gift.goal > 0 && gift.contributed >= gift.goal) {
          gift.status = "reserved";
        }
        renderGifts();
      }

      showSuccess(gift?.type === "quota" || gift?.type === "open" ? "Sua contribuição foi registrada para os noivos." : "Seu presente foi registrado para os noivos.");
    } catch (error) {
      showError(error.message);
    }
  }
});

modal.addEventListener("click", (event) => {
  if (event.target === modal) closeModal();
});

document.addEventListener("error", (event) => {
  const image = event.target instanceof HTMLImageElement
    ? event.target.closest(".gift-image img")
    : null;
  if (!image) return;

  const card = image.closest(".gift-card");
  image.closest(".gift-image")?.remove();
  card?.classList.remove("has-image");
}, true);

document.addEventListener("keydown", (event) => {
  if (event.key === "Escape" && modal.classList.contains("open")) closeModal();
});

["pointerdown", "touchstart", "keydown"].forEach((eventName) => {
  window.addEventListener(eventName, enableAudioAfterInteraction, { passive: true, once: false });
});

updateCountdown();
if (useLocalGiftFallback) {
  renderGifts();
} else {
  renderGiftMessage("Carregando lista...", "Buscando os presentes cadastrados no Supabase.");
}
initRsvpHeroState().then(() => {
  setupAlbumEntryButton();
  if (!useLocalGiftFallback) setupGiftsEngagementTracking();
});
syncMusicButton();
startWeddingAudio({ unmute: true, allowMutedFallback: false });

window.addEventListener("load", () => {
  loadPaymentConfig();
  loadGifts();
  startWeddingAudio({ unmute: true, allowMutedFallback: false });
});

document.addEventListener("visibilitychange", () => {
  handleAudioVisibility();
  if (!document.hidden && Date.now() - lastGiftLoadAt > 120000) loadGifts();
});
