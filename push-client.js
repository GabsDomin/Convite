// Instalar o convite como app e ativar os avisos do casamento.
// Usado pelo convite e pelo álbum; expõe window.GabNaiaPush.
(() => {
  const isIos = /iPad|iPhone|iPod/.test(navigator.userAgent)
    || (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1);
  const isStandalone = window.matchMedia("(display-mode: standalone)").matches || navigator.standalone === true;
  const supported = "serviceWorker" in navigator && "PushManager" in window && "Notification" in window;
  let configPromise;
  let installPrompt = null;
  let installedNow = false;

  // Chrome e Edge avisam quando o site pode ser instalado; guardamos para o botão "Instalar convite".
  const installPromptWaiters = new Set();
  window.addEventListener("beforeinstallprompt", (event) => {
    event.preventDefault();
    installPrompt = event;
    installPromptWaiters.forEach((resolve) => resolve(true));
    installPromptWaiters.clear();
  });

  // O Chrome só libera a instalação depois de alguns segundos de uso; espera um pouco por ela.
  function waitForInstallPrompt(timeoutMs) {
    if (installPrompt) return Promise.resolve(true);
    return new Promise((resolve) => {
      installPromptWaiters.add(resolve);
      window.setTimeout(() => {
        installPromptWaiters.delete(resolve);
        resolve(Boolean(installPrompt));
      }, timeoutMs);
    });
  }
  window.addEventListener("appinstalled", () => {
    installedNow = true;
    installPrompt = null;
  });

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

  // A inscrição só funciona com o service worker já ativo; na primeira visita ele ainda está instalando.
  async function registration() {
    await navigator.serviceWorker.register("/sw.js", { scope: "/" });
    return navigator.serviceWorker.ready;
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

  // Situação dos avisos: "unsupported" | "off" | "denied" | "enabled" | "available".
  // No iPhone, avisos só existem com o convite instalado na tela de início.
  async function getState() {
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
    if (permission === "denied") {
      // Bloqueio do site, da aba anônima ou de uma política do computador (comum em computadores de empresa).
      throw new Error("Os avisos estão bloqueados neste navegador. Clique no cadeado ao lado do endereço, em Notificações escolha Permitir e recarregue a página. Em computador de empresa ou aba anônima, use o celular.");
    }
    if (permission !== "granted") {
      // Janela fechada sem resposta, ou o pedido "silencioso" (sininho na barra de endereço).
      throw new Error("A janela de permissão foi fechada ou ficou escondida. Procure um sininho na barra de endereço e escolha Permitir, ou toque em Tentar de novo.");
    }
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

  // Abre a janela "Instalar app" do navegador. Retorna true se instalou.
  // Se o navegador recusar (exige um toque novo), o pedido fica guardado para tentar de novo.
  async function promptInstall() {
    if (!installPrompt) return false;
    const prompt = installPrompt;
    await prompt.prompt();
    installPrompt = null;
    const choice = await prompt.userChoice;
    return choice?.outcome === "accepted";
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
    .push-banner-icon{grid-row:span 2;width:2.75rem;height:2.75rem;border-radius:12px;background:#fff;
      box-shadow:0 0 0 1px rgba(0,63,152,.14)}
    .push-banner strong{color:#002f73;font-size:.95rem;line-height:1.25}
    .push-banner p{margin:0;color:#626b7a;font-size:.8rem;line-height:1.4}
    .push-banner-steps{grid-column:1/-1;display:grid;gap:.45rem;margin:.35rem 0 0;padding:0;list-style:none;counter-reset:step}
    .push-banner-steps li{display:grid;grid-template-columns:1.6rem 1fr;align-items:center;gap:.5rem;color:#172033;
      font-size:.84rem;line-height:1.35;counter-increment:step}
    .push-banner-steps li::before{content:counter(step);display:grid;place-items:center;width:1.6rem;height:1.6rem;
      border-radius:50%;color:#fff;background:#003f98;font-size:.75rem;font-weight:800}
    .push-banner-steps svg{display:inline-block;width:1.05rem;height:1.05rem;margin:0 .1rem;vertical-align:-.2rem;
      fill:none;stroke:#003f98;stroke-width:2;stroke-linecap:round;stroke-linejoin:round}
    .push-banner-actions{grid-column:1/-1;display:flex;justify-content:flex-end;gap:.5rem;margin-top:.35rem}
    .push-banner-actions button{min-height:2.5rem;border-radius:10px;padding:.5rem .95rem;font:inherit;font-size:.85rem;
      font-weight:750;cursor:pointer}
    .push-banner-later{border:1px solid rgba(0,63,152,.2);color:#002f73;background:#fff}
    .push-banner-allow{border:0;color:#fff;background:linear-gradient(135deg,#003f98,#002f73)}
    .push-banner-allow:disabled{opacity:.6;cursor:wait}
    @media (prefers-reduced-motion: reduce){.push-banner{animation:none}}`;
  const shareIcon = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 15V3M7 8l5-5 5 5M5 12v8h14v-8"/></svg>';
  const addIcon = '<svg viewBox="0 0 24 24" aria-hidden="true"><rect x="4" y="4" width="16" height="16" rx="4"/><path d="M12 8v8M8 12h8"/></svg>';

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

  function createButton(className, label, onClick) {
    const button = document.createElement("button");
    button.type = "button";
    button.className = className;
    button.textContent = label;
    button.addEventListener("click", onClick);
    return button;
  }

  // Faixa "Deseja instalar o convite?". Um toque instala e ativa os avisos
  // (navegadores só abrem essas janelas a partir de um toque da pessoa).
  async function mountBanner() {
    const pushState = await getState().catch(() => "unsupported");
    if (pushState === "enabled") refresh();

    const iosInBrowser = isIos && !isStandalone;
    const needsPush = pushState === "available";
    // Fora do iPhone, quem já tem os avisos não precisa da faixa (instalar é opcional).
    if (!iosInBrowser && !needsPush) return;
    if (recentlyDismissed()) return;

    const style = document.createElement("style");
    style.textContent = bannerStyles;
    document.head.append(style);

    const banner = document.createElement("aside");
    banner.className = "push-banner";
    banner.setAttribute("role", "dialog");
    banner.setAttribute("aria-label", "Instalar o convite");
    const icon = document.createElement("img");
    icon.className = "push-banner-icon";
    icon.src = "/assets/icon-192.png";
    icon.alt = "";
    const title = document.createElement("strong");
    const text = document.createElement("p");
    const actions = document.createElement("div");
    actions.className = "push-banner-actions";
    const later = createButton("push-banner-later", "Agora não", () => {
      rememberDismiss();
      banner.remove();
    });
    actions.append(later);
    banner.append(icon, title, text);

    function finish(message) {
      title.textContent = "Tudo pronto! 🎉";
      text.textContent = message;
      actions.remove();
      window.setTimeout(() => banner.remove(), 4000);
    }

    if (iosInBrowser) {
      // A Apple não deixa sites se instalarem sozinhos: mostramos o caminho no Safari.
      title.textContent = "Deseja instalar o convite?";
      text.textContent = "No iPhone, os avisos do casamento só chegam com o convite instalado.";
      const install = createButton("push-banner-allow", "Instalar convite", () => {
        title.textContent = "Instale em 3 passos";
        text.textContent = "Depois disso, os avisos do casamento chegam no seu iPhone.";
        const steps = document.createElement("ol");
        steps.className = "push-banner-steps";
        // Cada navegador do iPhone guarda o "Compartilhar" num lugar diferente.
        const userAgent = navigator.userAgent;
        const shareStep = /CriOS/.test(userAgent)
          ? `Toque em ${shareIcon} <b>Compartilhar</b>, ao lado do endereço, no alto da tela do Chrome.`
          : /EdgiOS/.test(userAgent)
            ? `Toque no menu <b>⋯</b> do Edge e depois em ${shareIcon} <b>Compartilhar</b>.`
            : /FxiOS/.test(userAgent)
              ? `Toque no menu <b>☰</b> do Firefox e depois em ${shareIcon} <b>Compartilhar</b>.`
              : `Toque em ${shareIcon} <b>Compartilhar</b>, na barra do Safari.`;
        steps.innerHTML = `
          <li><span>${shareStep}</span></li>
          <li><span>Role e escolha ${addIcon} <b>Adicionar à Tela de Início</b>. Depois toque em <b>Adicionar</b>.</span></li>
          <li><span>Abra o convite pelo <b>ícone novo</b> e toque em <b>Ativar avisos</b>.</span></li>`;
        banner.insertBefore(steps, actions);
        install.remove();
        later.textContent = "Entendi";
      });
      actions.append(install);
    } else if (isStandalone) {
      // Já instalado (inclusive o iPhone aberto pelo ícone): falta só um toque para os avisos.
      title.textContent = "Último passo: ative os avisos";
      text.textContent = "Assim você fica sabendo quando o álbum abrir e quando chegar um novo desafio.";
      const allow = createButton("push-banner-allow", "Ativar avisos", async () => {
        allow.disabled = true;
        allow.textContent = "Ativando...";
        try {
          await enable();
          finish("Os avisos do casamento vão chegar por aqui.");
        } catch (error) {
          text.textContent = error.message || "Não foi possível ativar os avisos.";
          allow.disabled = false;
          allow.textContent = "Tentar de novo";
        }
      });
      actions.append(allow);
    } else {
      title.textContent = "Deseja instalar o convite?";
      text.textContent = "Instalando, você recebe os avisos do casamento: quando o álbum abrir e quando chegar um novo desafio.";
      const install = createButton("push-banner-allow", "Instalar convite", async () => {
        install.disabled = true;
        install.textContent = "Instalando...";
        let pushError = null;
        try {
          await enable();
        } catch (error) {
          pushError = error;
        }
        let installed = installedNow;
        try {
          installed = (await promptInstall()) || installedNow;
        } catch {
          // O navegador exigiu um toque novo para a janela de instalação: "Instalar agora" resolve.
        }
        if (pushError) {
          text.textContent = pushError.message;
          install.disabled = false;
          install.textContent = "Tentar de novo";
          return;
        }
        if (installed) {
          finish("O convite foi instalado e os avisos estão ativados.");
          return;
        }
        // A janela de instalação não abriu junto (exige outro toque, ou o navegador ainda não liberou).
        text.textContent = "Avisos ativados! Falta só colocar o convite na tela inicial.";
        install.textContent = "Preparando...";
        const canInstall = await waitForInstallPrompt(30_000);
        install.remove();
        if (!canInstall) {
          finish("Os avisos estão ativados. Para instalar, use o menu do navegador e escolha Instalar app ou Adicionar à tela inicial.");
          return;
        }
        const again = createButton("push-banner-allow", "Instalar agora", async () => {
          again.disabled = true;
          const ok = await promptInstall().catch(() => false);
          finish(ok ? "O convite foi instalado e os avisos estão ativados." : "Os avisos estão ativados. Você pode instalar depois pelo menu do navegador.");
        });
        actions.append(again);
      });
      actions.append(install);
    }

    banner.append(actions);
    document.body.append(banner);
  }

  window.GabNaiaPush = { getState, enable, refresh, mountBanner, promptInstall, isIos, isStandalone };
})();
