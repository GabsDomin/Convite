// Os avisos do site foram desligados (os avisos do casamento agora vão pela comunidade do WhatsApp).
// Este service worker substitui o antigo nos aparelhos que tinham permitido os avisos:
// cancela a inscrição e se remove, para não sobrar nada no navegador.
self.addEventListener("install", () => self.skipWaiting());

self.addEventListener("activate", (event) => {
  event.waitUntil((async () => {
    const subscription = await self.registration.pushManager?.getSubscription().catch(() => null);
    await subscription?.unsubscribe().catch(() => {});
    await self.registration.unregister();
  })());
});
