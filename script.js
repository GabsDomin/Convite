const weddingDate = new Date("2026-11-28T11:30:00-03:00");
const countdown = document.querySelector("#countdown");
const giftGrid = document.querySelector("#gift-grid");
const giftFilters = document.querySelector("#gift-filters");
const modal = document.querySelector("#modal");
const modalContent = document.querySelector("#modal-content");
const weddingAudio = document.querySelector("#wedding-audio");
const musicToggle = document.querySelector("[data-music-toggle]");
const audioStartTime = 11;
const rsvpStorageKey = "gabriel-halanaia-rsvp";
let audioStarted = false;
let audioBlocked = false;
let paymentConfig = null;
let paymentConfigPromise = null;
const localGiftFallbackHosts = new Set(["localhost", "127.0.0.1", "::1"]);
const useLocalGiftFallback = localGiftFallbackHosts.has(window.location.hostname);

let gifts = [
  { id: "panos-prato", type: "fixed", section: "daily", name: "Kit de panos de prato", value: 35, category: "Cozinha", text: "Para deixar nossa cozinha mais prática no dia a dia.", status: "available" },
  { id: "descanso-panelas", type: "fixed", section: "daily", name: "Descanso de panelas", value: 35, category: "Cozinha", text: "Para cuidar da mesa nos almoços em casa.", status: "available" },
  { id: "colheres-pau", type: "fixed", section: "daily", name: "Kit de colheres de pau", value: 40, category: "Cozinha", text: "Para os primeiros preparos na nossa cozinha.", status: "available" },
  { id: "pegadores-cozinha", type: "fixed", section: "daily", name: "Kit de pegadores de cozinha", value: 45, category: "Cozinha", text: "Para ajudar nos preparos e servir com carinho.", status: "available" },
  { id: "organizador-gaveta", type: "fixed", section: "daily", name: "Organizador de gavetas", value: 45, category: "Casa", text: "Para manter nosso novo lar mais arrumado.", status: "available" },
  { id: "tabua-corte", type: "fixed", section: "daily", name: "Tábua de corte", value: 50, category: "Cozinha", text: "Para os preparos do dia a dia na cozinha.", status: "available" },
  { id: "potes-tempero", type: "fixed", section: "daily", name: "Porta-temperos", value: 60, category: "Cozinha", text: "Para organizar os temperos da nossa casa.", status: "available" },
  { id: "escorredor-louca", type: "fixed", section: "daily", name: "Escorredor de louça", value: 65, category: "Cozinha", text: "Para facilitar nossa rotina depois das refeições.", status: "available" },
  { id: "cesto-roupas", type: "fixed", section: "daily", name: "Cesto de roupas", value: 65, category: "Lavanderia", text: "Para ajudar na organização da lavanderia.", status: "available" },
  { id: "jogo-americano", type: "fixed", section: "daily", name: "Jogo americano", value: 70, category: "Mesa", text: "Para montar uma mesa simples e bonita.", status: "available" },
  { id: "lixeira-cozinha", type: "fixed", section: "daily", name: "Lixeira de cozinha", value: 75, category: "Cozinha", text: "Para completar os itens essenciais da casa.", status: "available" },
  { id: "kit-copos-simples", type: "fixed", section: "daily", name: "Kit de copos para o dia a dia", value: 80, category: "Mesa", text: "Para receber visitas e compartilhar bons momentos.", status: "available" },
  { id: "porta-mantimentos", type: "fixed", section: "daily", name: "Porta-mantimentos", value: 85, category: "Cozinha", text: "Para deixar a despensa mais organizada.", status: "available" },
  { id: "utensilios", type: "fixed", section: "daily", name: "Kit de utensílios de cozinha", value: 120, category: "Cozinha", text: "Para ajudar nos primeiros preparos da nossa casa.", status: "available" },
  { id: "potes", type: "fixed", section: "daily", name: "Conjunto de potes herméticos", value: 150, category: "Cozinha", text: "Para manter nossa cozinha mais organizada.", status: "available" },
  { id: "assadeiras", type: "fixed", section: "daily", name: "Kit de assadeiras antiaderentes", value: 150, category: "Cozinha", text: "Para preparar receitas no nosso dia a dia.", status: "available" },
  { id: "grill", type: "fixed", section: "daily", name: "Sanduicheira ou grill", value: 180, category: "Cozinha", text: "Para nossos lanches rápidos.", status: "available" },
  { id: "cafeteira", type: "fixed", section: "daily", name: "Cafeteira elétrica simples", value: 180, category: "Cozinha", text: "Para deixar nossas manhãs mais especiais.", status: "available" },
  { id: "chaleira", type: "fixed", section: "daily", name: "Chaleira elétrica", value: 180, category: "Cozinha", text: "Para cafés, chás e momentos tranquilos.", status: "available" },
  { id: "panela-arroz", type: "fixed", section: "daily", name: "Panela de arroz elétrica", value: 220, category: "Cozinha", text: "Para facilitar nossa rotina na cozinha.", status: "available" },
  { id: "liquidificador", type: "fixed", section: "daily", name: "Liquidificador", value: 250, category: "Cozinha", text: "Para sucos, vitaminas e receitas do dia a dia.", status: "available" },
  { id: "mixer", type: "fixed", section: "daily", name: "Mixer 3 em 1", value: 250, category: "Cozinha", text: "Para deixar os preparos mais práticos.", status: "available" },
  { id: "ferro", type: "fixed", section: "daily", name: "Ferro de passar roupa", value: 250, category: "Lavanderia", text: "Para cuidar das nossas roupas.", status: "available" },
  { id: "cama-casal", type: "fixed", section: "home", name: "Jogo de cama casal", value: 280, category: "Quarto", text: "Para deixar nosso quarto mais completo.", status: "available" },
  { id: "banho", type: "fixed", section: "home", name: "Kit de banho completo", value: 300, category: "Banheiro", text: "Para começar a casa com mais conforto.", status: "available" },
  { id: "air-fryer-compacta", type: "fixed", section: "home", name: "Air Fryer compacta", value: 350, category: "Cozinha", text: "Para facilitar nossas refeições.", status: "available" },
  { id: "aspirador", type: "fixed", section: "home", name: "Aspirador de pó vertical", value: 350, category: "Limpeza", text: "Para ajudar na limpeza da casa nova.", status: "available" },
  { id: "pressao-eletrica", type: "fixed", section: "home", name: "Panela de pressão elétrica", value: 400, category: "Cozinha", text: "Para deixar nossa cozinha mais prática e segura.", status: "available" },
  { id: "faqueiro", type: "fixed", section: "home", name: "Faqueiro inox completo", value: 400, category: "Cozinha", text: "Para montar nossa mesa com carinho.", status: "available" },
  { id: "jantar", type: "fixed", section: "home", name: "Jogo de jantar", value: 450, category: "Cozinha", text: "Para receber pessoas queridas na nossa casa.", status: "available" },
  { id: "panelas", type: "fixed", section: "home", name: "Jogo de panelas antiaderente", value: 500, category: "Cozinha", text: "Para começarmos a cozinhar na nossa casa.", status: "available" },
  { id: "forno", type: "fixed", section: "special", name: "Forno elétrico", value: 550, category: "Cozinha", text: "Para preparar receitas especiais.", status: "available" },
  { id: "cooktop", type: "fixed", section: "special", name: "Cooktop a gás", value: 600, category: "Cozinha", text: "Para ajudar a montar nossa cozinha.", status: "available" },
  { id: "air-fryer-oven", type: "fixed", section: "special", name: "Air Fryer Oven", value: 700, category: "Cozinha", text: "Para deixar nossa rotina ainda mais prática.", status: "available" },
  { id: "microondas", type: "fixed", section: "special", name: "Micro-ondas", value: 750, category: "Eletrodoméstico", text: "Um item essencial para o nosso dia a dia.", status: "available" },
  { id: "purificador", type: "fixed", section: "special", name: "Purificador de água", value: 800, category: "Cozinha", text: "Para termos água filtrada sempre à mão.", status: "available" },
  { id: "panelas-premium", type: "fixed", section: "special", name: "Jogo de panelas premium", value: 900, category: "Cozinha", text: "Para completar nossa cozinha com qualidade.", status: "available" },
  { id: "geladeira", type: "quota", section: "quotas", name: "Cota da geladeira", goal: 5500, options: [150, 250, 500, 1000], text: "Para nos ajudar em um dos principais itens da casa nova.", status: "available" },
  { id: "maquina-lavar", type: "quota", section: "quotas", name: "Cota da máquina de lavar", goal: 2200, options: [150, 250, 500, 1000], text: "Para facilitar nossa rotina com as roupas.", status: "available" },
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
  { id: "quotas", label: "Cotas da casa", match: (gift) => gift.type === "quota" },
];

let activeFilter = "all";

function formatCurrency(value) {
  return new Intl.NumberFormat("pt-BR", {
    style: "currency",
    currency: "BRL",
    maximumFractionDigits: 0,
  }).format(value);
}

async function requestJson(url, options = {}) {
  const response = await fetch(url, {
    headers: { "Content-Type": "application/json" },
    ...options,
  });
  const payload = await response.json().catch(() => ({}));

  if (!response.ok) {
    throw new Error(payload.error || "Não foi possível salvar agora.");
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

function getSavedRsvp() {
  try {
    return JSON.parse(localStorage.getItem(rsvpStorageKey));
  } catch (error) {
    return null;
  }
}

function saveRsvp(name, partySize) {
  const guestName = name.trim().replace(/\s+/g, " ");
  if (!guestName) return;

  localStorage.setItem(
    rsvpStorageKey,
    JSON.stringify({
      name: guestName,
      partySize,
      confirmedAt: new Date().toISOString(),
    }),
  );
}

function renderRsvpState() {
  const savedRsvp = getSavedRsvp();
  const heroCopy = document.querySelector(".hero-copy");
  const rsvpButton = document.querySelector("[data-open-rsvp]");

  if (!heroCopy || !rsvpButton || !savedRsvp?.name) return;

  heroCopy.textContent = `Olá, ${savedRsvp.name}! Sua presença já foi confirmada. Te esperamos lá. Se entrou aqui procurando um presentinho, a lista de presentes está logo abaixo.`;
  heroCopy.classList.add("confirmed");
  rsvpButton.hidden = true;
}

function syncMusicButton() {
  if (!musicToggle || !weddingAudio) return;

  musicToggle.classList.toggle("is-muted", weddingAudio.muted || audioBlocked);
  musicToggle.setAttribute("aria-pressed", String(weddingAudio.muted));

  const label = musicToggle.querySelector("span");
  if (audioBlocked && weddingAudio.paused) {
    musicToggle.setAttribute("aria-label", "Tocar música");
    if (label) label.textContent = "Tocar";
    return;
  }

  musicToggle.setAttribute("aria-label", weddingAudio.muted ? "Ativar música" : "Mutar música");
  if (label) label.textContent = weddingAudio.muted ? "Som" : "Mutar";
}

async function startWeddingAudio() {
  if (!weddingAudio || audioStarted) return;

  weddingAudio.muted = false;

  try {
    if (weddingAudio.currentTime < audioStartTime) {
      weddingAudio.currentTime = audioStartTime;
    }
    weddingAudio.volume = 0.55;
    await weddingAudio.play();
    audioStarted = true;
    audioBlocked = false;
  } catch (error) {
    audioStarted = false;
    audioBlocked = true;
  }

  syncMusicButton();
}

function enableAudioAfterInteraction() {
  if (audioStarted || !audioBlocked) return;
  startWeddingAudio();
}

async function toggleMusic() {
  if (!weddingAudio) return;

  if (!audioStarted || weddingAudio.paused) {
    weddingAudio.muted = false;
    await startWeddingAudio();
    syncMusicButton();
    return;
  }

  weddingAudio.muted = !weddingAudio.muted;
  syncMusicButton();
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
      <h3>${title}</h3>
      <p>${text}</p>
    </div>
  `;
}

async function loadGifts() {
  try {
    const payload = await requestJson("/api/gifts");
    if (Array.isArray(payload.gifts) && payload.gifts.length) {
      gifts = payload.gifts.map(normalizeGiftForUi);
      renderGifts();
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
}

function normalizeGiftForUi(gift) {
  return {
    ...gift,
    value: Number(gift.value || 0),
    goal: Number(gift.goal || 0),
    options: Array.isArray(gift.options) ? gift.options.map(Number) : [],
    status: gift.status || "available",
  };
}

function renderGiftCard(gift) {
  const reserved = gift.status === "reserved";
  const valueText = gift.type === "quota" ? `Meta: ${formatCurrency(gift.goal)}` : formatCurrency(gift.value);
  const buttonText = gift.type === "quota" ? "Contribuir" : "Presentear";

  return `
    <article class="gift-card ${gift.type === "quota" ? "quota-card" : ""}">
      <div class="gift-icon">${giftIcon()}</div>
      <div class="gift-card-main">
        <span class="gift-category">${gift.type === "quota" ? "Cota da casa" : gift.category}</span>
        <h4>${gift.name}</h4>
        <p class="gift-price">${valueText}</p>
        <p class="gift-description">${gift.text}</p>
      </div>
      ${gift.type === "quota" && gift.options.length ? `
        <div class="quota-options" aria-label="Opções de cota para ${gift.name}">
          ${gift.options.map((option) => `<span>${formatCurrency(option)}</span>`).join("")}
        </div>
      ` : ""}
      <div class="gift-footer">
        <span class="badge ${reserved ? "reserved" : "available"}">${reserved ? "Reservado" : "Disponível"}</span>
        <button class="button ${reserved ? "secondary" : "primary"}" data-gift-id="${gift.id}" ${reserved && gift.type === "fixed" ? "disabled" : ""}>
          ${reserved && gift.type === "fixed" ? "Já escolhido" : buttonText}
        </button>
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
    <p>${message}</p>
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
    <p>${message}</p>
    <div class="modal-actions">
      <button class="button primary" data-close-modal>Fechar</button>
    </div>
  `);
}

function openRsvpModal() {
  openModal(`
    <div class="modal-icon">
      <svg viewBox="0 0 24 24" aria-hidden="true">
        <path d="M20.8 4.6a5.5 5.5 0 0 0-7.8 0L12 5.6l-1-1a5.5 5.5 0 0 0-7.8 7.8l1 1L12 21l7.8-7.6 1-1a5.5 5.5 0 0 0 0-7.8Z" />
      </svg>
    </div>
    <h2 id="modal-title">Confirmar presença</h2>
    <p>Informe seu nome para confirmar sua presença no casamento.</p>
    <form data-rsvp-form>
      <label>
        Seu nome
        <input name="guestName" required autocomplete="name" placeholder="Digite seu nome" />
      </label>
      <label>
        Quantidade de pessoas
        <select name="partySize" required>
          <option>Somente eu</option>
          <option>Eu e meus filhos</option>
        </select>
      </label>
      <div class="modal-actions">
        <button class="button secondary" type="button" data-close-modal>Cancelar</button>
        <button class="button primary" type="submit">Enviar</button>
      </div>
    </form>
  `);
}

function openGiftModal(gift) {
  const isQuota = gift.type === "quota";
  const hasOnlinePayment = hasOnlinePaymentConfigured();

  openModal(`
    <div class="modal-icon">${giftIcon()}</div>
    <h2 id="modal-title">${isQuota ? "Contribuir com cota" : "Escolher presente"}</h2>
    <p>${isQuota ? `Escolha uma cota, informe seu nome e siga com a forma de pagamento que preferir para: <strong>${gift.name}</strong>.` : `Informe seu nome e escolha como deseja presentear: <strong>${gift.name}</strong>.`}</p>
    <form data-gift-form="${gift.id}">
      <label>
        Seu nome
        <input name="guestName" required autocomplete="name" placeholder="Digite seu nome" />
      </label>
      <label>
        Seu e-mail <span class="optional-label">opcional</span>
        <input name="buyerEmail" type="email" autocomplete="email" placeholder="seu@email.com" />
      </label>
      <label>
        Mensagem para os noivos <span class="optional-label">opcional</span>
        <textarea name="message" rows="3" placeholder="Escreva uma mensagem com carinho"></textarea>
      </label>
      ${isQuota ? `
        <label>
          Valor da cota
          <select name="quotaValue" required>
            ${gift.options.map((option) => `<option value="${option}">${formatCurrency(option)}</option>`).join("")}
          </select>
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
}

document.addEventListener("click", async (event) => {
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

  if (event.target.matches("[data-scroll-gifts]")) {
    document.querySelector("#presentes").scrollIntoView({ behavior: "smooth" });
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
    const formData = new FormData(rsvpForm);
    const guestName = String(formData.get("guestName") || "");
    const partySize = String(formData.get("partySize") || "");

    try {
      await requestJson("/api/rsvp", {
        method: "POST",
        body: JSON.stringify({ guestName, partySize }),
      });
      saveRsvp(guestName, partySize);
      renderRsvpState();
      showSuccess("Presença confirmada com sucesso. Quando você voltar ao convite, vamos lembrar da sua confirmação.");
    } catch (error) {
      showError(error.message);
    }
  }

  if (giftForm) {
    event.preventDefault();
    const formData = new FormData(giftForm);
    const gift = gifts.find((item) => item.id === giftForm.dataset.giftForm);
    const guestName = String(formData.get("guestName") || "");
    const buyerEmail = String(formData.get("buyerEmail") || "");
    const message = String(formData.get("message") || "");
    const quotaValue = Number(formData.get("quotaValue") || 0);
    const paymentMethod = String(formData.get("paymentMethod") || "in_person") === "online" ? "online" : "in_person";

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
            giftName: gift?.name,
            amount: gift?.type === "quota" ? quotaValue : gift?.value,
            buyerName: guestName,
            buyerEmail,
            message,
          }),
        });

        if (!checkout.init_point) {
          throw new Error("Não foi possível iniciar o pagamento online.");
        }

        window.location.href = checkout.init_point;
        return;
      }

      await requestJson("/api/gifts/reserve", {
        method: "POST",
        body: JSON.stringify({
          giftId: gift?.id,
          guestName,
          amount: gift?.type === "quota" ? quotaValue : undefined,
        }),
      });

      if (gift && gift.type === "fixed") {
        gift.status = "reserved";
        renderGifts();
      }

      showSuccess(gift?.type === "quota" ? "Sua contribuição foi registrada para os noivos." : "Seu presente foi registrado para os noivos.");
    } catch (error) {
      showError(error.message);
    }
  }
});

modal.addEventListener("click", (event) => {
  if (event.target === modal) closeModal();
});

document.addEventListener("keydown", (event) => {
  if (event.key === "Escape" && modal.classList.contains("open")) closeModal();
});

["pointerdown", "touchstart", "keydown", "scroll"].forEach((eventName) => {
  window.addEventListener(eventName, enableAudioAfterInteraction, { passive: true, once: false });
});

updateCountdown();
if (useLocalGiftFallback) {
  renderGifts();
} else {
  renderGiftMessage("Carregando lista...", "Buscando os presentes cadastrados no Supabase.");
}
renderRsvpState();
syncMusicButton();

window.addEventListener("load", () => {
  loadPaymentConfig();
  loadGifts();
  startWeddingAudio();
});

document.addEventListener("visibilitychange", () => {
  if (!document.hidden) loadGifts();
});
