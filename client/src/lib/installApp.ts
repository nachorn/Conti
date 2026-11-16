/** Online games still use the live server; the worker caches no private state. */
export function registerInstallableApp() {
  if (!('serviceWorker' in navigator) || !window.isSecureContext || import.meta.env.DEV) return
  window.addEventListener('load', () => {
    void navigator.serviceWorker.register('/sw.js', { scope: '/', updateViaCache: 'none' }).catch(() => {
      // Installing is optional; a worker failure must never prevent a game.
    })
  }, { once: true })
}
