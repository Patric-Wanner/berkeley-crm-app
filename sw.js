/**
 * Berkeley CRM — Service Worker
 * Minimal SW to enable PWA standalone mode.
 * Network-first strategy (no offline caching).
 */

self.addEventListener('fetch', () => {
  /* Let all requests pass through to network */
});
