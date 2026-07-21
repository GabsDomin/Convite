const rsvpStorageKey = "gabriel-halanaia-rsvp";
const loginForm = document.querySelector("[data-album-login-form]");
const loginError = document.querySelector("[data-album-login-error]");
const loginSubmit = document.querySelector("[data-album-login-submit]");
const loginCopy = document.querySelector("[data-album-login-copy]");
const knownNameBox = document.querySelector("[data-album-known-name]");
const knownNameLabel = document.querySelector("[data-album-known-label]");
const nameField = document.querySelector("[data-album-name-field]");
const nameInput = document.querySelector("[data-album-name-input]");
const passwordInput = document.querySelector("[data-album-password-input]");
const useOtherNameButton = document.querySelector("[data-album-use-other-name]");

function getSavedRsvpName() {
  try {
    const saved = JSON.parse(localStorage.getItem(rsvpStorageKey));
    const name = String(saved?.name || "").trim().replace(/\s+/g, " ");
    return name.length >= 2 ? name : "";
  } catch {
    return "";
  }
}

function showLoginError(message) {
  loginError.hidden = false;
  loginError.textContent = message;
}

function clearLoginError() {
  loginError.hidden = true;
  loginError.textContent = "";
}

function applyKnownNameMode(guestName) {
  knownNameBox.hidden = false;
  knownNameLabel.textContent = guestName;
  nameField.hidden = true;
  nameInput.required = false;
  nameInput.value = guestName;
  loginCopy.textContent = "Encontramos sua confirmação neste aparelho. Digite só a senha do álbum para continuar.";
  passwordInput.focus();
}

function applyManualNameMode({ clearName = false } = {}) {
  knownNameBox.hidden = true;
  nameField.hidden = false;
  nameInput.required = true;
  if (clearName) nameInput.value = "";
  loginCopy.textContent = "Use o mesmo nome da confirmação de presença e a senha do álbum para ver e compartilhar as memórias.";
  nameInput.focus();
}

function prepareLoginForm() {
  const savedName = getSavedRsvpName();
  if (savedName) applyKnownNameMode(savedName);
  else applyManualNameMode();
}

async function ensureLoggedOutOrRedirect() {
  try {
    const response = await fetch("/api/album/session", { credentials: "same-origin" });
    const payload = await response.json().catch(() => ({}));
    if (response.ok && payload.authenticated) {
      window.location.replace("/album");
    }
  } catch {
    // Mantém a tela de login se a verificação falhar.
  }
}

useOtherNameButton.addEventListener("click", () => {
  clearLoginError();
  applyManualNameMode({ clearName: true });
});

loginForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  clearLoginError();

  const formData = new FormData(loginForm);
  const guestName = String(formData.get("guestName") || "").trim();
  const password = String(formData.get("password") || "");

  if (guestName.length < 2) {
    showLoginError("Informe o nome usado na confirmação de presença.");
    return;
  }
  const nameParts = guestName.split(/\s+/).filter(Boolean);
  if (nameParts.length < 2 || nameParts.some((part) => part.length < 2)) {
    showLoginError("Informe nome e sobrenome, como na confirmação de presença.");
    return;
  }
  if (!password) {
    showLoginError("Informe a senha do álbum.");
    return;
  }

  loginSubmit.disabled = true;
  loginSubmit.textContent = "Entrando...";

  try {
    const response = await fetch("/api/album/login", {
      method: "POST",
      credentials: "same-origin",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ guestName, password }),
    });
    const payload = await response.json().catch(() => ({}));
    if (!response.ok) {
      throw new Error(payload.error || "Não foi possível entrar no álbum.");
    }
    window.location.replace("/album");
  } catch (error) {
    showLoginError(error.message || "Não foi possível entrar no álbum.");
    loginSubmit.disabled = false;
    loginSubmit.textContent = "Entrar no álbum";
  }
});

prepareLoginForm();
ensureLoggedOutOrRedirect();
