// Avisos do álbum no navegador: pede permissão, registra o aparelho e diz em que situação ele está.
// Usado pelo convite e pelo álbum; expõe window.GabNaiaPush.
(() => {
  const isIos = /iPad|iPhone|iPod/.test(navigator.userAgent)
    || (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1);
  const isStandalone = window.matchMedia("(display-mode: standalone)").matches || navigator.standalone === true;
  const supported = "serviceWorker" in navigator && "PushManager" in window && "Notification" in window;
  let configPromise;

  function loadConfig() {
    configPromise ||= fetch("/api/push/config", { credentials: "same-origin" })
      .then((response) => (response.ok ? response.json() : { enabled: false }))
      .catch(() => ({ enabled: false }));
    return configPromise;
  }

  function decodeKey(base64Url) {
    const base64 = `${base64Url}${"=".repeat((4 - (base64Url.length % 4)) % 4)}`.replace(/-/g, "+").replace(/_/g, "/");
    return Uint8Array.from(atob(base64), (char) => char.charCodeAt(0));
  }

  async function registration() {
    return navigator.serviceWorker.register("/sw.js", { scope: "/" });
  }

  async function sendSubscription(subscription) {
    const response = await fetch("/api/push/subscribe", {
      method: "POST",
      credentials: "same-origin",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ subscription: subscription.toJSON() }),
    });
    if (!response.ok) {
      const payload = await response.json().catch(() => ({}));
      throw new Error(payload.error || "Não foi possível ativar os avisos.");
    }
  }

  // "unsupported" | "ios-install" | "off" | "denied" | "enabled" | "available"
  async function getState() {
    if (isIos && !isStandalone) return "ios-install";
    if (!supported) return "unsupported";
    const config = await loadConfig();
    if (!config.enabled) return "off";
    if (Notification.permission === "denied") return "denied";
    if (Notification.permission !== "granted") return "available";
    const existing = await (await registration()).pushManager.getSubscription();
    return existing ? "enabled" : "available";
  }

  async function enable() {
    const config = await loadConfig();
    if (!supported || !config.enabled) throw new Error("Este navegador não recebe avisos.");
    const permission = await Notification.requestPermission();
    if (permission !== "granted") throw new Error("Você não permitiu os avisos. Dá para mudar nas configurações do navegador.");
    const reg = await registration();
    const subscription = await reg.pushManager.getSubscription()
      || await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: decodeKey(config.publicKey) });
    await sendSubscription(subscription);
    return "enabled";
  }

  // Quem já ativou continua ligado ao próprio nome (ex.: ativou no convite e depois entrou no álbum).
  async function refresh() {
    if (!supported || Notification.permission !== "granted") return;
    const config = await loadConfig();
    if (!config.enabled) return;
    const subscription = await (await registration()).pushManager.getSubscription();
    if (subscription) await sendSubscription(subscription).catch(() => {});
  }

  const dismissKey = "gab-naia-push-dismissed-at";
  const dismissForMs = 2 * 24 * 60 * 60 * 1000;
  const bannerStyles = `
    .push-banner{position:fixed;z-index:60;left:50%;bottom:var(--push-banner-bottom,1rem);transform:translateX(-50%);
      display:grid;grid-template-columns:auto minmax(0,1fr);gap:.35rem .75rem;align-items:center;
      width:min(calc(100% - 1.5rem),460px);padding:.9rem 1rem;border:1px solid rgba(0,63,152,.16);border-radius:16px;
      color:#172033;background:#fffdfb;box-shadow:0 18px 48px rgba(0,47,115,.22);font:inherit;
      animation:push-banner-in .25s ease-out}
    @keyframes push-banner-in{from{opacity:0;transform:translate(-50%,12px)}}
    .push-banner[hidden]{display:none}
    .push-banner-icon{grid-row:span 2;display:grid;place-items:center;width:2.6rem;height:2.6rem;border-radius:50%;
      color:#fff;background:linear-gradient(145deg,#003f98,#002f73);font-size:1.2rem}
    .push-banner strong{color:#002f73;font-size:.95rem;line-height:1.25}
    .push-banner p{margin:0;color:#626b7a;font-size:.8rem;line-height:1.4}
    .push-banner-actions{grid-column:1/-1;display:flex;justify-content:flex-end;gap:.5rem;margin-top:.35rem}
    .push-banner-actions button{min-height:2.5rem;border-radius:10px;padding:.5rem .95rem;font:inherit;font-size:.85rem;
      font-weight:750;cursor:pointer}
    .push-banner-later{border:1px solid rgba(0,63,152,.2);color:#002f73;background:#fff}
    .push-banner-allow{border:0;color:#fff;background:linear-gradient(135deg,#003f98,#002f73)}
    .push-banner-allow:disabled{opacity:.6;cursor:wait}
    @media (prefers-reduced-motion: reduce){.push-banner{animation:none}}`;

  function recentlyDismissed() {
    try {
      return Date.now() - Number(localStorage.getItem(dismissKey) || 0) < dismissForMs;
    } catch {
      return false;
    }
  }

  function rememberDismiss() {
    try {
      localStorage.setItem(dismissKey, String(Date.now()));
    } catch {
      // Sem armazenamento (aba anônima): a faixa volta na próxima visita.
    }
  }

  // Faixa "Permitir avisos": o navegador só abre a janela de permissão a partir de um toque da pessoa.
  async function mountBanner() {
    const state = await getState().catch(() => "unsupported");
    if (state === "enabled") {
      refresh();
      return;
    }
    if (!["available", "ios-install"].includes(state) || recentlyDismissed()) return;

    const style = document.createElement("style");
    style.textContent = bannerStyles;
    document.head.append(style);

    const banner = document.createElement("aside");
    banner.className = "push-banner";
    banner.setAttribute("role", "dialog");
    banner.setAttribute("aria-label", "Receber avisos do casamento");
    const icon = document.createElement("span");
    icon.className = "push-banner-icon";
    icon.setAttribute("aria-hidden", "true");
    icon.textContent = "🔔";
    const title = document.createElement("strong");
    const text = document.createElement("p");
    const actions = document.createElement("div");
    actions.className = "push-banner-actions";
    const later = document.createElement("button");
    later.type = "button";
    later.className = "push-banner-later";
    later.textContent = "Agora não";
    later.addEventListener("click", () => {
      rememberDismiss();
      banner.remove();
    });
    actions.append(later);

    if (state === "ios-install") {
      title.textContent = "Quer receber os avisos do casamento?";
      text.textContent = "No iPhone: toque em Compartilhar e depois em \"Adicionar à Tela de Início\". Abra o site pelo novo ícone para permitir os avisos.";
      later.textContent = "Entendi";
    } else {
      title.textContent = "Quer receber os avisos do casamento?";
      text.textContent = "A gente avisa quando o álbum abrir e chama você para os desafios, mesmo com o site fechado.";
      const allow = document.createElement("button");
      allow.type = "button";
      allow.className = "push-banner-allow";
      allow.textContent = "Permitir avisos";
      allow.addEventListener("click", async () => {
        allow.disabled = true;
        allow.textContent = "Ativando...";
        try {
          await enable();
          title.textContent = "Avisos ativados! 🎉";
          text.textContent = "Você vai receber as novidades do casamento por aqui.";
          actions.remove();
          window.setTimeout(() => banner.remove(), 3500);
        } catch (error) {
          text.textContent = error.message || "Não foi possível ativar os avisos.";
          allow.disabled = false;
          allow.textContent = "Tentar de novo";
        }
      });
      actions.append(allow);
    }

    banner.append(icon, title, text, actions);
    document.body.append(banner);
  }

  window.GabNaiaPush = { getState, enable, refresh, mountBanner, isIos, isStandalone };
})();
