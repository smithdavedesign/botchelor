// Botchelor's service worker: only browser notifications (lib/push.ts). No caching, no offline mode. It's the same one
// the installed app uses (app/manifest.ts): on an iPhone, web push only reaches the Home Screen app.
// The notification's picture is the PG app tile, and its badge the heart alone: Android draws a badge from its shape, so
// a full-colour icon there is a grey square (lib/pwa.ts NOTIFICATION_ICON / NOTIFICATION_BADGE, scripts/make-icons.mjs).
const ICON = "/icons/icon-192.png";
const BADGE = "/icons/badge-96.png";
self.addEventListener("push", (event) => {
  let data = { title: "Botchelor", body: "", url: "/notifications" };
  try {
    data = { ...data, ...event.data.json() };
  } catch {
    /* a push without a payload still shows the default */
  }
  event.waitUntil(
    self.registration.showNotification(data.title, {
      body: data.body,
      icon: ICON,
      badge: BADGE,
      data: { url: data.url },
    }),
  );
});

self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const url = new URL(event.notification.data?.url || "/notifications", self.location.origin).href;
  event.waitUntil(
    self.clients.matchAll({ type: "window", includeUncontrolled: true }).then((windows) => {
      for (const w of windows) if (w.url === url && "focus" in w) return w.focus();
      return self.clients.openWindow(url);
    }),
  );
});
