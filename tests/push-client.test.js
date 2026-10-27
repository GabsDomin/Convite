// Roda o push-client.js num navegador simulado e confere qual faixa aparece em cada situação:
// com o convite instalado e os avisos ativos, nada pode aparecer.
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { test } from "node:test";
import vm from "node:vm";

const source = await readFile(new URL("../push-client.js", import.meta.url), "utf8");

class FakeElement {
  constructor(tagName) {
    this.tagName = tagName;
    this.children = [];
    this.parent = null;
    this.dataset = {};
    this.attributes = {};
    this.listeners = {};
    this.textContent = "";
    this.innerHTML = "";
    this.className = "";
  }

  append(...nodes) {
    nodes.forEach((node) => {
      node.parent = this;
      this.children.push(node);
    });
  }

  insertBefore(node, reference) {
    node.parent = this;
    const index = this.children.indexOf(reference);
    this.children.splice(index < 0 ? this.children.length : index, 0, node);
  }

  remove() {
    if (!this.parent) return;
    this.parent.children = this.parent.children.filter((child) => child !== this);
    this.parent = null;
  }

  setAttribute(name, value) {
    this.attributes[name] = value;
  }

  addEventListener(type, handler) {
    (this.listeners[type] ||= []).push(handler);
  }

  async click() {
    for (const handler of this.listeners.click || []) await handler();
  }

  *walk() {
    yield this;
    for (const child of this.children) yield* child.walk();
  }
}

function createBrowser({
  userAgent = "Mozilla/5.0 (Linux; Android 14) Chrome/150 Mobile",
  standalone = false,
  pushSupported = true,
  permission = "default",
  subscribed = false,
  dismissedAt = null,
} = {}) {
  const head = new FakeElement("head");
  const body = new FakeElement("body");
  const windowListeners = {};
  const storage = new Map(dismissedAt ? [["gab-naia-push-dismissed-at", String(dismissedAt)]] : []);
  const subscription = { toJSON: () => ({ endpoint: "https://push.example/abc", keys: {} }) };
  let currentSubscription = subscribed ? subscription : null;
  const registration = {
    pushManager: {
      getSubscription: async () => currentSubscription,
      subscribe: async () => {
        currentSubscription = subscription;
        return subscription;
      },
    },
  };

  const window = {
    matchMedia: () => ({ matches: standalone }),
    addEventListener: (type, handler) => (windowListeners[type] ||= []).push(handler),
    setTimeout: (fn, ms) => setTimeout(fn, Math.min(ms, 5)),
    ...(pushSupported ? { PushManager: function PushManager() {}, Notification: { permission } } : {}),
  };
  const navigator = {
    userAgent,
    platform: userAgent.includes("iPhone") ? "iPhone" : "Linux",
    maxTouchPoints: 5,
    standalone,
    ...(pushSupported
      ? { serviceWorker: { register: async () => registration, ready: Promise.resolve(registration) } }
      : {}),
  };
  const document = {
    head,
    body,
    createElement: (tag) => new FakeElement(tag),
    querySelector: (selector) => {
      for (const root of [head, body]) {
        for (const node of root.walk()) {
          if (selector === ".push-banner" && node.className === "push-banner") return node;
          if (selector === "style[data-push-banner]" && node.tagName === "style" && "pushBanner" in node.dataset) return node;
        }
      }
      return null;
    },
  };
  const context = {
    window,
    navigator,
    document,
    localStorage: {
      getItem: (key) => storage.get(key) ?? null,
      setItem: (key, value) => storage.set(key, value),
    },
    fetch: async (url) => ({
      ok: true,
      json: async () => (String(url).includes("/api/push/config") ? { enabled: true, publicKey: "AQAB" } : {}),
    }),
    atob: (value) => Buffer.from(value, "base64").toString("binary"),
    Notification: pushSupported
      ? { get permission() { return window.Notification.permission; }, requestPermission: async () => window.Notification.permission }
      : undefined,
    Uint8Array,
    Date,
    Promise,
    Set,
    Boolean,
    String,
    Number,
    Error,
    console,
  };
  if (!pushSupported) delete context.Notification;
  context.window.navigator = navigator;
  vm.createContext(context);
  vm.runInContext(source, context);

  return {
    api: context.window.GabNaiaPush,
    banner: () => document.querySelector(".push-banner"),
    title: () => {
      const banner = document.querySelector(".push-banner");
      return banner?.children.find((child) => child.tagName === "strong")?.textContent ?? null;
    },
    fireInstallPrompt: () => {
      const event = {
        preventDefault() {},
        prompt: async () => {},
        userChoice: Promise.resolve({ outcome: "accepted" }),
      };
      (windowListeners.beforeinstallprompt || []).forEach((handler) => handler(event));
    },
  };
}

const settle = () => new Promise((resolve) => setTimeout(resolve, 30));

test("Android no navegador, sem avisos: oferece instalar o convite (que também ativa os avisos)", async () => {
  const browser = createBrowser();
  await browser.api.mountBanner();
  assert.equal(browser.title(), "Deseja instalar o convite?");
});

test("app instalado e avisos ativos: nenhuma faixa", async () => {
  const browser = createBrowser({ standalone: true, permission: "granted", subscribed: true });
  await browser.api.mountBanner();
  await settle();
  assert.equal(browser.banner(), null);
});

test("app instalado sem avisos: pede só para ativar os avisos", async () => {
  const browser = createBrowser({ standalone: true });
  await browser.api.mountBanner();
  assert.equal(browser.title(), "Último passo: ative os avisos");
});

test("avisos bloqueados: explica como desbloquear", async () => {
  const browser = createBrowser({ standalone: true, permission: "denied" });
  await browser.api.mountBanner();
  assert.equal(browser.title(), "Os avisos estão bloqueados");
});

test("avisos ativos no navegador: só pede instalação quando o Chrome oferece", async () => {
  const browser = createBrowser({ permission: "granted", subscribed: true });
  await browser.api.mountBanner();
  assert.equal(browser.banner(), null, "sem oferta de instalação (ex.: já instalado), nada aparece");
  browser.fireInstallPrompt();
  await settle();
  assert.equal(browser.title(), "Falta só instalar o convite");
});

test("iPhone no navegador: mostra os passos de instalação do navegador em uso", async () => {
  const browser = createBrowser({
    userAgent: "Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) CriOS/150 Mobile",
    pushSupported: false,
  });
  await browser.api.mountBanner();
  assert.equal(browser.title(), "Deseja instalar o convite?");
  const install = [...browser.banner().walk()].find((node) => node.textContent === "Instalar convite");
  await install.click();
  const steps = [...browser.banner().walk()].find((node) => node.tagName === "ol");
  assert.match(steps.innerHTML, /alto da tela do Chrome/);
});

test("\"Agora não\" esconde a faixa por 2 dias", async () => {
  const browser = createBrowser({ dismissedAt: Date.now() - 60_000 });
  await browser.api.mountBanner();
  assert.equal(browser.banner(), null);
});
