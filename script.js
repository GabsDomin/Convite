const weddingDate = new Date("2026-11-14T11:30:00-03:00");
const countdown = document.querySelector("#countdown");
const giftGrid = document.querySelector("#gift-grid");
const giftFilters = document.querySelector("#gift-filters");
const modal = document.querySelector("#modal");
const modalContent = document.querySelector("#modal-content");
const weddingAudio = document.querySelector("#wedding-audio");
const musicToggle = document.querySelector("[data-music-toggle]");
const audioStartTime = 11;
let audioStarted = false;

const gifts = [
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

function updateCountdown() {
  const today = new Date();
  const diff = weddingDate - today;
  const days = Math.max(0, Math.ceil(diff / (1000 * 60 * 60 * 24)));
  countdown.textContent = days === 1 ? "Falta 1 dia" : `Faltam ${days} dias`;
}

function syncMusicButton() {
  if (!musicToggle || !weddingAudio) return;

  musicToggle.classList.toggle("is-muted", weddingAudio.muted || weddingAudio.paused);
  musicToggle.setAttribute("aria-pressed", String(weddingAudio.muted));

  const label = musicToggle.querySelector("span");
  if (!audioStarted && weddingAudio.paused) {
    musicToggle.setAttribute("aria-label", "Tocar música");
    if (label) label.textContent = "Tocar";
    return;
  }

  musicToggle.setAttribute("aria-label", weddingAudio.muted ? "Ativar música" : "Mutar música");
  if (label) label.textContent = weddingAudio.muted ? "Som" : "Mutar";
}

async function startWeddingAudio() {
  if (!weddingAudio || audioStarted) return;

  try {
    weddingAudio.currentTime = audioStartTime;
    weddingAudio.volume = 0.55;
    await weddingAudio.play();
    audioStarted = true;
  } catch (error) {
    audioStarted = false;
  }

  syncMusicButton();
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

function renderGiftCard(gift) {
  const reserved = gift.status === "reserved";
  const valueText = gift.type === "quota" ? `Meta: ${formatCurrency(gift.goal)}` : formatCurrency(gift.value);
  const buttonText = gift.type === "quota" ? "Contribuir via Pix" : "Presentear via Pix";

  return `
    <article class="gift-card ${gift.type === "quota" ? "quota-card" : ""}">
      <div class="gift-icon">${giftIcon()}</div>
      <div class="gift-card-main">
        <span class="gift-category">${gift.type === "quota" ? "Cota da casa" : gift.category}</span>
        <h4>${gift.name}</h4>
        <p class="gift-price">${valueText}</p>
        <p class="gift-description">${gift.text}</p>
      </div>
      ${gift.type === "quota" ? `
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
          <option>Eu + 1 acompanhante</option>
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

  openModal(`
    <div class="modal-icon">${giftIcon()}</div>
    <h2 id="modal-title">${isQuota ? "Contribuir com cota" : "Escolher presente"}</h2>
    <p>${isQuota ? `Escolha uma cota e informe seu nome para contribuir com: <strong>${gift.name}</strong>.` : `Informe seu nome para reservar: <strong>${gift.name}</strong>.`}</p>
    <form data-gift-form="${gift.id}">
      <label>
        Seu nome
        <input name="guestName" required autocomplete="name" placeholder="Digite seu nome" />
      </label>
      ${isQuota ? `
        <label>
          Valor da cota
          <select name="quotaValue" required>
            ${gift.options.map((option) => `<option value="${option}">${formatCurrency(option)}</option>`).join("")}
          </select>
        </label>
      ` : `
        <p class="modal-value">Valor Pix: <strong>${formatCurrency(gift.value)}</strong></p>
      `}
      <div class="modal-actions">
        <button class="button secondary" type="button" data-close-modal>Cancelar</button>
        <button class="button primary" type="submit">Enviar</button>
      </div>
    </form>
  `);
}

document.addEventListener("click", (event) => {
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

  const giftButton = event.target.closest("[data-gift-id]");
  if (giftButton) {
    const gift = gifts.find((item) => item.id === giftButton.dataset.giftId);
    if (gift && (gift.status === "available" || gift.type === "quota")) openGiftModal(gift);
  }
});

document.addEventListener("submit", (event) => {
  const rsvpForm = event.target.closest("[data-rsvp-form]");
  const giftForm = event.target.closest("[data-gift-form]");

  if (rsvpForm) {
    event.preventDefault();
    showSuccess("Presença confirmada com sucesso.");
  }

  if (giftForm) {
    event.preventDefault();
    const gift = gifts.find((item) => item.id === giftForm.dataset.giftForm);
    if (gift && gift.type === "fixed") {
      gift.status = "reserved";
      renderGifts();
    }
    showSuccess(gift?.type === "quota" ? "Sua contribuição foi registrada para os noivos." : "Seu presente foi registrado para os noivos.");
  }
});

modal.addEventListener("click", (event) => {
  if (event.target === modal) closeModal();
});

document.addEventListener("keydown", (event) => {
  if (event.key === "Escape" && modal.classList.contains("open")) closeModal();
});

updateCountdown();
renderGifts();
syncMusicButton();
startWeddingAudio();
