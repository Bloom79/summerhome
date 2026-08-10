// CasaTrova service worker — receives web push notifications for saved alerts.
self.addEventListener('push', (e) => {
  let d = {}
  try { d = e.data ? e.data.json() : {} } catch { /* empty push */ }
  e.waitUntil(self.registration.showNotification(d.title || 'CasaTrova 🔔', {
    body: d.body || 'Novità sulle case che segui',
    data: { url: d.url || self.registration.scope },
    tag: 'casatrova-alerts',
  }))
})

self.addEventListener('notificationclick', (e) => {
  e.notification.close()
  const url = (e.notification.data && e.notification.data.url) || self.registration.scope
  e.waitUntil(self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then((ws) => {
    for (const w of ws) if (w.url.startsWith(self.registration.scope)) return w.focus()
    return self.clients.openWindow(url)
  }))
})
