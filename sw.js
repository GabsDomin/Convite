// Service worker dos avisos do álbum: mostra o aviso e abre o álbum ao tocar nele.
self.addEventListener("install", () => self.skipWaiting());
self.addEventListener("activate", (event) => event.waitUntil(self.clients.claim()));

self.addEventListener("push", (event) => {
  let payload = {};
  try {
    payload = event.data ? event.data.json() : {};
  } catch {
    payload = { body: event.data ? event.data.text() : "" };
  }
  const title = payload.title || "Gabriel & Halanaia";
  event.waitUntil(self.registration.showNotification(title, {
    body: payload.body || "",
    // icon: imagem grande ao lado do texto. badge: ícone da barra de status do Android,
    // que precisa ser branco com fundo transparente (senão o Android mostra o ícone do Chrome).
    icon: "/assets/icon-192.png",
    badge: "/assets/notification-badge.png",
    ...(payload.image ? { image: payload.image } : {}),
    vibrate: [120, 60, 120],
    tag: payload.tag || "gab-naia",
    data: { url: payload.url || "/album" },
  }));
});

self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const target = new URL(event.notification.data?.url || "/album", self.location.origin).href;
  event.waitUntil((async () => {
    const windows = await self.clients.matchAll({ type: "window", includeUncontrolled: true });
    const existing = windows.find((client) => client.url.startsWith(self.location.origin));
    if (existing) {
      await existing.focus();
      if ("navigate" in existing) await existing.navigate(target);
      return;
    }
    await self.clients.openWindow(target);
  })());
});
