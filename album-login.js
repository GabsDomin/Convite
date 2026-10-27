const loginCopy = document.querySelector("[data-album-login-copy]");
const loginError = document.querySelector("[data-album-login-error]");
const steps = document.querySelectorAll("[data-step]");
const rememberedList = document.querySelector("[data-remembered-list]");
const searchForm = document.querySelector('[data-step="search"]');
const searchInput = document.querySelector("[data-guest-search]");
const searchOptions = document.querySelector("[data-guest-options]");
const searchHint = document.querySelector("[data-search-hint]");
const searchSubmit = document.querySelector("[data-search-submit]");
const searchClear = document.querySelector("[data-search-clear]");
const defaultSearchHint = "Comece a digitar e toque no seu nome.";
const newForm = document.querySelector('[data-step="new"]');
const newNameInput = document.querySelector("[data-new-name]");
const newSubmit = document.querySelector("[data-new-submit]");
const passwordField = document.querySelector("[data-password-field]");
const passwordInput = document.querySelector("[data-search-password]");
const newNameLink = document.querySelector("[data-go-new]");

const stepCopy = {
  closed: "O álbum abre no dia 28/11, às 15h. Se você é um dos noivos, digite seu nome.",
  remembered: "Encontramos sua confirmação de presença neste aparelho. Toque no seu nome para entrar.",
  search: "Procure seu nome na lista de convidados para ver e compartilhar as memórias.",
  new: "Sem problema! Digite seu nome e sobrenome para criar seu acesso ao álbum.",
};

let entryState = { publicOpen: false, remembered: [] };
let selectedGuestName = "";
let passwordRequired = false;
let searchTimer;
let searchRequestId = 0;
let activeOptionIndex = -1;

function showLoginError(message = "") {
  loginError.textContent = message;
  loginError.hidden = !message;
}

// Antes da abertura, a busca continua visível para os noivos encontrarem o próprio nome.
function showStep(name) {
  const visible = name === "closed" ? ["closed", "search"] : [name];
  steps.forEach((step) => {
    step.hidden = !visible.includes(step.dataset.step);
  });
  newNameLink.hidden = name === "closed";
  loginCopy.textContent = stepCopy[name] || "";
  showLoginError();
  if (visible.includes("search")) searchInput.focus();
  if (name === "new") {
    if (!newNameInput.value && searchInput.value.trim().includes(" ")) newNameInput.value = searchInput.value.trim();
    newNameInput.focus();
  }
}

function resetPasswordPrompt() {
  passwordRequired = false;
  passwordField.hidden = true;
  passwordInput.value = "";
  searchSubmit.hidden = true;
}

// Nome dos noivos: a senha aparece na própria busca, logo abaixo do nome.
function askPassword(guestName) {
  showStep(entryState.publicOpen ? "search" : "closed");
  selectedGuestName = guestName;
  searchInput.value = guestName;
  searchClear.hidden = false;
  passwordRequired = true;
  passwordField.hidden = false;
  searchSubmit.hidden = false;
  searchSubmit.disabled = false;
  searchSubmit.textContent = "Entrar";
  searchHint.textContent = "Digite a senha dos noivos.";
  passwordInput.focus();
}

async function loginWithPassword() {
  if (!passwordInput.value) {
    showLoginError("Digite a senha.");
    return;
  }
  showLoginError();
  searchSubmit.disabled = true;
  searchSubmit.textContent = "Entrando...";
  try {
    await postJson("/api/album/login", { guestName: selectedGuestName, password: passwordInput.value });
    window.location.replace("/album");
  } catch (error) {
    showLoginError(error.message);
    searchSubmit.disabled = false;
    searchSubmit.textContent = "Entrar";
    passwordInput.select();
  }
}

async function postJson(url, body) {
  const response = await fetch(url, {
    method: "POST",
    credentials: "same-origin",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) {
    const error = new Error(payload.error || "Não foi possível entrar no álbum.");
    error.code = payload.code;
    throw error;
  }
  return payload;
}

async function enterAlbum(guestName, source, button) {
  showLoginError();
  const originalLabel = button?.textContent;
  if (button) {
    button.disabled = true;
    button.textContent = "Entrando...";
  }
  try {
    await postJson("/api/album/enter", { guestName, source });
    window.location.replace("/album");
    return true;
  } catch (error) {
    if (button) {
      button.disabled = false;
      button.textContent = originalLabel;
    }
    if (error.code === "admin_password") {
      askPassword(guestName);
      return true;
    }
    showLoginError(error.message);
    return false;
  }
}

// Confirmações antigas ficaram só no navegador, sem o cookie do aparelho.
function getSavedRsvpName() {
  try {
    const saved = JSON.parse(localStorage.getItem("gabriel-halanaia-rsvp"));
    const name = String(saved?.name || "").trim().replace(/\s+/g, " ");
    return name.split(" ").length >= 2 ? name : "";
  } catch {
    return "";
  }
}

function renderRemembered(names, source = "remembered") {
  rememberedList.replaceChildren(...names.map((name) => {
    const button = document.createElement("button");
    button.type = "button";
    button.className = "album-login-person";
    button.setAttribute("role", "listitem");
    const label = document.createElement("span");
    label.textContent = "Entrar como";
    const strong = document.createElement("strong");
    strong.textContent = name;
    button.append(label, strong);
    button.addEventListener("click", () => enterAlbum(name, source, button));
    return button;
  }));
}

function setOptionsExpanded(expanded) {
  searchOptions.hidden = !expanded;
  searchInput.setAttribute("aria-expanded", String(expanded));
  if (!expanded) {
    activeOptionIndex = -1;
    searchInput.removeAttribute("aria-activedescendant");
  }
}

// Tocar no nome já entra; se for um dos noivos, o servidor pede a senha.
async function selectGuest(name) {
  selectedGuestName = name;
  searchInput.value = name;
  searchClear.hidden = false;
  setOptionsExpanded(false);
  searchHint.textContent = `Entrando como ${name}...`;
  const handled = await enterAlbum(name, "list", searchSubmit);
  if (!handled) searchHint.textContent = defaultSearchHint;
}

function getInitials(name) {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  return ((parts[0]?.[0] || "") + (parts.length > 1 ? parts.at(-1)[0] : "")).toUpperCase();
}

function foldAccents(value) {
  return value.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();
}

// Destaca o começo de cada palavra que bate com o que foi digitado, ignorando acentos.
function appendHighlightedName(target, name, query) {
  const terms = foldAccents(query).split(/\s+/).filter(Boolean);
  name.split(/(\s+)/).forEach((word) => {
    const term = /\S/.test(word) ? terms.find((candidate) => foldAccents(word).startsWith(candidate)) : null;
    if (!term) {
      target.append(word);
      return;
    }
    const mark = document.createElement("mark");
    mark.textContent = word.slice(0, term.length);
    target.append(mark, word.slice(term.length));
  });
}

function highlightOption(index) {
  const options = Array.from(searchOptions.children);
  if (!options.length) return;
  activeOptionIndex = (index + options.length) % options.length;
  options.forEach((option, optionIndex) => {
    option.setAttribute("aria-selected", String(optionIndex === activeOptionIndex));
  });
  searchInput.setAttribute("aria-activedescendant", options[activeOptionIndex].id);
  options[activeOptionIndex].scrollIntoView({ block: "nearest" });
}

function renderOptions(names, query) {
  searchOptions.replaceChildren(...names.map((name, index) => {
    const option = document.createElement("li");
    option.id = `album-guest-option-${index}`;
    option.dataset.name = name;
    option.setAttribute("role", "option");
    option.setAttribute("aria-selected", "false");
    const avatar = document.createElement("span");
    avatar.className = "album-login-option-avatar";
    avatar.setAttribute("aria-hidden", "true");
    avatar.textContent = getInitials(name);
    const label = document.createElement("span");
    label.className = "album-login-option-name";
    appendHighlightedName(label, name, query);
    option.append(avatar, label);
    // mousedown evita perder o foco do campo antes do clique ser registrado.
    option.addEventListener("mousedown", (event) => {
      event.preventDefault();
      selectGuest(name);
    });
    return option;
  }));
  setOptionsExpanded(names.length > 0);
}

async function searchGuests(query) {
  const requestId = ++searchRequestId;
  try {
    const response = await fetch(`/api/album/guests?q=${encodeURIComponent(query)}`, { credentials: "same-origin" });
    const payload = await response.json().catch(() => ({}));
    if (requestId !== searchRequestId) return;
    if (!response.ok) throw new Error(payload.error || "Não foi possível buscar os nomes.");
    const guests = Array.isArray(payload.guests) ? payload.guests : [];
    renderOptions(guests, query);
    if (guests.length) searchHint.textContent = guests.length >= 8 ? "Continue digitando para achar mais rápido." : "Toque no seu nome.";
    else if (!entryState.publicOpen) searchHint.textContent = "O álbum ainda não abriu para os convidados.";
    else searchHint.textContent = "Nenhum nome encontrado. Confira a grafia ou toque em \"Não achei meu nome\".";
  } catch (error) {
    if (requestId !== searchRequestId) return;
    setOptionsExpanded(false);
    searchHint.textContent = error.message;
  }
}

searchInput.addEventListener("input", () => {
  selectedGuestName = "";
  resetPasswordPrompt();
  showLoginError();
  window.clearTimeout(searchTimer);
  const query = searchInput.value.trim();
  searchClear.hidden = !searchInput.value;
  if (!query) {
    searchRequestId += 1;
    setOptionsExpanded(false);
    searchHint.textContent = defaultSearchHint;
    return;
  }
  searchTimer = window.setTimeout(() => searchGuests(query), 120);
});

searchInput.addEventListener("focus", () => {
  if (searchOptions.children.length && searchInput.value.trim() && !selectedGuestName) setOptionsExpanded(true);
});

searchClear.addEventListener("click", () => {
  searchInput.value = "";
  searchInput.dispatchEvent(new Event("input"));
  searchInput.focus();
});

searchInput.addEventListener("keydown", (event) => {
  if (searchOptions.hidden) return;
  if (event.key === "ArrowDown") {
    event.preventDefault();
    highlightOption(activeOptionIndex + 1);
  } else if (event.key === "ArrowUp") {
    event.preventDefault();
    highlightOption(activeOptionIndex - 1);
  } else if (event.key === "Enter" && activeOptionIndex >= 0) {
    event.preventDefault();
    selectGuest(searchOptions.children[activeOptionIndex].dataset.name);
  } else if (event.key === "Escape") {
    setOptionsExpanded(false);
  }
});

searchInput.addEventListener("blur", () => setOptionsExpanded(false));

searchForm.addEventListener("submit", (event) => {
  event.preventDefault();
  if (passwordRequired) {
    loginWithPassword();
    return;
  }
  if (!selectedGuestName) {
    const firstOption = searchOptions.firstElementChild;
    if (firstOption && !searchOptions.hidden && searchOptions.children.length === 1) {
      selectGuest(firstOption.dataset.name);
      return;
    }
    showLoginError("Escolha seu nome na lista ou toque em \"Não achei meu nome\".");
    return;
  }
  enterAlbum(selectedGuestName, "list", searchSubmit);
});

newForm.addEventListener("submit", (event) => {
  event.preventDefault();
  const guestName = newNameInput.value.trim().replace(/\s+/g, " ");
  const parts = guestName.split(" ").filter(Boolean);
  if (parts.length < 2 || parts.some((part) => part.length < 2)) {
    showLoginError("Informe nome e sobrenome.");
    return;
  }
  enterAlbum(guestName, "new", newSubmit);
});

document.querySelectorAll("[data-go-search]").forEach((button) => {
  button.addEventListener("click", () => showStep("search"));
});
newNameLink.addEventListener("click", () => showStep("new"));

async function prepareEntry() {
  try {
    const sessionResponse = await fetch("/api/album/session", { credentials: "same-origin" });
    const session = await sessionResponse.json().catch(() => ({}));
    if (sessionResponse.ok && session.authenticated && session.albumAvailable) {
      window.location.replace("/album");
      return;
    }

    const response = await fetch("/api/album/entry", { credentials: "same-origin" });
    if (response.ok) entryState = await response.json();
  } catch {
    // Sem resposta do servidor, a busca ainda é oferecida e mostrará o erro.
    entryState = { publicOpen: true, remembered: [] };
  }

  if (entryState.albumTestMode) {
    const banner = document.createElement("p");
    banner.className = "album-test-banner";
    banner.textContent = "Ambiente de teste: o álbum está liberado aqui antes do casamento.";
    document.body.prepend(banner);
  }

  if (!entryState.publicOpen) {
    showStep("closed");
    return;
  }

  const cookieNames = Array.isArray(entryState.remembered) ? entryState.remembered : [];
  const savedName = getSavedRsvpName();
  const remembered = cookieNames.length ? cookieNames : savedName ? [savedName] : [];
  const source = cookieNames.length ? "remembered" : "list";
  const switchingPerson = new URLSearchParams(window.location.search).has("trocar");
  if (!remembered.length) {
    showStep("search");
    return;
  }
  renderRemembered(remembered, source);
  if (remembered.length === 1 && !switchingPerson) {
    loginCopy.textContent = `Entrando como ${remembered[0]}...`;
    if (await enterAlbum(remembered[0], source)) return;
    const message = loginError.textContent;
    showStep("remembered");
    showLoginError(message);
    return;
  }
  showStep("remembered");
}

prepareEntry();
