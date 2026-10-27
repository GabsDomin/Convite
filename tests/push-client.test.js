// Roda o push-client.js num navegador simulado e confere quando a faixa "Permitir avisos" aparece:
// só onde os avisos funcionam e ainda não foram ativados.
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
    this.className = "";
  }

  append(...nodes) {
    nodes.forEach((node) => {
      node.parent = this;
      this.children.push(node);
    });
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

function createBrowser({ pushSupported = true, permission = "default", grantOnRequest = "granted", subscribed = false, dismissedAt = null } = {}) {
  const head = new FakeElement("head");
  const body = new FakeElement("body");
  const storage = new Map(dismissedAt ? [["gab-naia-push-dismissed-at", String(dismissedAt)]] : []);
  const requests = [];
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
  const notification = {
    permission,
    requestPermission: async () => {
      notification.permission = grantOnRequest;
      return grantOnRequest;
    },
  };

  const window = {
    setTimeout: (fn, ms) => setTimeout(fn, Math.min(ms, 5)),
    ...(pushSupported ? { PushManager: function PushManager() {}, Notification: notification } : {}),
  };
  const navigator = pushSupported
    ? { serviceWorker: { register: async () => registration, ready: Promise.resolve(registration) } }
    : {};
  const document = {
    head,
    body,
    createElement: (tag) => new FakeElement(tag),
    querySelector: (selector) => [...body.walk()].find((node) => selector === ".push-banner" && node.className === "push-banner") ?? null,
  };
  const context = {
    window,
    navigator,
    document,
    localStorage: { getItem: (key) => storage.get(key) ?? null, setItem: (key, value) => storage.set(key, value) },
    fetch: async (url, options = {}) => {
      requests.push({ url: String(url), method: options.method || "GET" });
      return {
        ok: true,
        json: async () => (String(url).includes("/api/push/config") ? { enabled: true, publicKey: "AQAB" } : { ok: true }),
      };
    },
    atob: (value) => Buffer.from(value, "base64").toString("binary"),
    ...(pushSupported ? { Notification: notification } : {}),
    Uint8Array,
    Date,
    Promise,
    String,
    Number,
    Error,
  };
  vm.createContext(context);
  vm.runInContext(source, context);

  const find = (label) => [...body.walk()].find((node) => node.textContent === label);
  return {
    api: context.window.GabNaiaPush,
    requests,
    banner: () => document.querySelector(".push-banner"),
    title: () => document.querySelector(".push-banner")?.children.find((child) => child.tagName === "strong")?.textContent ?? null,
    find,
    storage,
  };
}

test("Android sem avisos: mostra \"Permitir avisos\" e ativa com um toque", async () => {
  const browser = createBrowser();
  await browser.api.mountBanner();
  assert.equal(browser.title(), "Quer receber os avisos do casamento?");
  await browser.find("Permitir avisos").click();
  assert.equal(browser.title(), "Avisos ativados! 🎉");
  assert.ok(browser.requests.some((request) => request.url === "/api/push/subscribe" && request.method === "POST"));
});

test("não existe mais nada de instalar o convite", async () => {
  const browser = createBrowser();
  await browser.api.mountBanner();
  const labels = [...browser.banner().walk()].map((node) => node.textContent);
  assert.equal(labels.some((label) => /instal/i.test(label)), false);
  assert.equal("promptInstall" in browser.api, false);
});

test("avisos já ativos: nenhuma faixa", async () => {
  const browser = createBrowser({ permission: "granted", subscribed: true });
  await browser.api.mountBanner();
  assert.equal(browser.banner(), null);
});

test("iPhone (navegador sem avisos de sites): nenhuma faixa", async () => {
  const browser = createBrowser({ pushSupported: false });
  await browser.api.mountBanner();
  assert.equal(browser.banner(), null);
});

test("avisos bloqueados pela pessoa: não insiste", async () => {
  const browser = createBrowser({ permission: "denied" });
  await browser.api.mountBanner();
  assert.equal(browser.banner(), null);
});

test("permissão recusada na hora: explica e deixa tentar de novo", async () => {
  const browser = createBrowser({ grantOnRequest: "denied" });
  await browser.api.mountBanner();
  await browser.find("Permitir avisos").click();
  assert.ok(browser.find("Tentar de novo"));
  assert.match([...browser.banner().walk()].find((node) => node.tagName === "p").textContent, /bloqueados/);
});

test("\"Agora não\" esconde a faixa por 2 dias", async () => {
  const browser = createBrowser();
  await browser.api.mountBanner();
  await browser.find("Agora não").click();
  assert.equal(browser.banner(), null);
  assert.ok(browser.storage.get("gab-naia-push-dismissed-at"));

  const later = createBrowser({ dismissedAt: Date.now() - 60_000 });
  await later.api.mountBanner();
  assert.equal(later.banner(), null);
});
