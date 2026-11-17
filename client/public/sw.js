/* Only a public offline notice is cached. Never cache identities, payments,
 * room HTML, API responses, invitations, handoffs, or advertising resources. */
const CACHE = 'nrn-offline-v1'
const PUBLIC_FILES = ['/offline.html', '/offline.css', '/brand/nrn-play-selected-mark.svg']
self.addEventListener('install', event => {
  event.waitUntil(caches.open(CACHE).then(cache => cache.addAll(PUBLIC_FILES)))
  // Do not replace the worker in the middle of a game; activate on next visit.
})
self.addEventListener('activate', event => {
  event.waitUntil(caches.keys().then(keys => Promise.all(keys.filter(key => key.startsWith('nrn-offline-') && key !== CACHE).map(key => caches.delete(key)))))
})
self.addEventListener('fetch', event => {
  const request = event.request
  const url = new URL(request.url)
  if (request.method !== 'GET' || url.origin !== self.location.origin) return
  if (PUBLIC_FILES.includes(url.pathname) && !url.search) {
    event.respondWith(caches.match(request).then(cached => cached || fetch(request)))
    return
  }
  // All other fetches pass through unchanged, including account/connect pages.
  if (request.mode !== 'navigate' || /^\/(?:api|account|connect|dashboard)(?:\/|$)/.test(url.pathname)) return
  event.respondWith(fetch(request).catch(async () => (await caches.match('/offline.html')) || Response.error()))
})
