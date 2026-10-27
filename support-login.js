const rsvpStorageKey = "gabriel-halanaia-rsvp";
const loginForm = document.querySelector("[data-support-login-form]");
const loginCard = document.querySelector(".support-login-card");
const loginError = document.querySelector("[data-support-login-error]");
const loginErrorTitle = document.querySelector("[data-support-login-error-title]");
const loginErrorText = document.querySelector("[data-support-login-error-text]");
const loginSubmit = document.querySelector("[data-support-login-submit]");
const nameInput = document.querySelector("[data-support-name-input]");
const passwordInput = document.querySelector("[data-support-password-input]");

function getSavedRsvpName() {
  try {
    const saved = JSON.parse(localStorage.getItem(rsvpStorageKey));
    const name = String(saved?.name || "").trim().replace(/\s+/g, " ");
    return name.length >= 2 ? name : "";
  } catch {
    return "";
  }
}

function showLoginError(title, message, { focusField = "password" } = {}) {
  if (loginErrorTitle) loginErrorTitle.textContent = title;
  if (loginErrorText) loginErrorText.textContent = message;
  loginError.hidden = false;
  loginForm?.classList.add("has-error");
  loginCard?.classList.remove("is-shake");
  void loginCard?.offsetWidth;
  loginCard?.classList.add("is-shake");

  nameInput?.removeAttribute("aria-invalid");
  passwordInput?.removeAttribute("aria-invalid");

  if (focusField === "name") {
    nameInput?.setAttribute("aria-invalid", "true");
    nameInput?.focus();
  } else {
    passwordInput?.setAttribute("aria-invalid", "true");
    passwordInput?.focus();
    passwordInput?.select();
  }
}

function clearLoginError() {
  loginError.hidden = true;
  if (loginErrorText) loginErrorText.textContent = "";
  loginForm?.classList.remove("has-error");
  nameInput?.removeAttribute("aria-invalid");
  passwordInput?.removeAttribute("aria-invalid");
}

function loginErrorFromResponse(status, message) {
  const text = String(message || "");
  if (/senha incorreta/i.test(text)) {
    return {
      title: "Senha incorreta",
      detail: "A senha do álbum não confere. Verifique Caps Lock e tente de novo.",
      focusField: "password",
    };
  }
  if (/nome não encontrado/i.test(text)) {
    return {
      title: "Nome não encontrado",
      detail: "Use o mesmo nome da sua confirmação ou do álbum (ex.: Gabriel Domingues Fernandes).",
      focusField: "name",
    };
  }
  if (/somente gabriel/i.test(text)) {
    return {
      title: "Acesso restrito",
      detail: text,
      focusField: "name",
    };
  }
  if (status === 429) {
    return {
      title: "Muitas tentativas",
      detail: "Aguarde um minuto e tente novamente.",
      focusField: "password",
    };
  }
  return {
    title: "Não foi possível entrar",
    detail: text || "Confira nome e senha e tente de novo.",
    focusField: "password",
  };
}

async function ensureLoggedOutOrRedirect() {
  try {
    const response = await fetch("/api/support/session", { credentials: "same-origin" });
    const payload = await response.json().catch(() => ({}));
    if (response.ok && payload.authenticated) {
      window.location.replace("/apoio");
    }
  } catch {
    // Mantém a tela de login.
  }
}

loginForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  clearLoginError();
  loginSubmit.disabled = true;
  loginSubmit.textContent = "Entrando…";

  const formData = new FormData(loginForm);
  const guestName = String(formData.get("guestName") || "").trim().replace(/\s+/g, " ");
  const password = String(formData.get("password") || "");

  if (!guestName || guestName.length < 2) {
    showLoginError("Informe seu nome", "Digite nome e sobrenome como no álbum.", { focusField: "name" });
    loginSubmit.disabled = false;
    loginSubmit.textContent = "Entrar";
    return;
  }
  if (!password) {
    showLoginError("Senha obrigatória", "Digite a senha do álbum.", { focusField: "password" });
    loginSubmit.disabled = false;
    loginSubmit.textContent = "Entrar";
    return;
  }

  try {
    const response = await fetch("/api/support/login", {
      method: "POST",
      credentials: "same-origin",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ guestName, password }),
    });
    const payload = await response.json().catch(() => ({}));

    if (!response.ok) {
      const err = loginErrorFromResponse(response.status, payload.error);
      showLoginError(err.title, err.detail, { focusField: err.focusField });
      return;
    }

    window.location.replace("/apoio");
  } catch {
    showLoginError("Falha de conexão", "Não foi possível falar com o servidor. Verifique a internet e tente de novo.", {
      focusField: "password",
    });
  } finally {
    loginSubmit.disabled = false;
    loginSubmit.textContent = "Entrar";
  }
});

passwordInput?.addEventListener("input", () => {
  if (passwordInput.getAttribute("aria-invalid") === "true") clearLoginError();
});
nameInput?.addEventListener("input", () => {
  if (nameInput.getAttribute("aria-invalid") === "true") clearLoginError();
});

const savedName = getSavedRsvpName();
if (savedName) nameInput.value = savedName;

ensureLoggedOutOrRedirect();
(nameInput.value ? passwordInput : nameInput).focus();
