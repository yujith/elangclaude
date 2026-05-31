/*
 * eLanguage Center — hand-rolled service worker (no Workbox/Serwist).
 *
 * Design rationale + the deviation record live in docs/adr/0019-pwa-service-worker.md.
 * The short version: a tiny, fully-auditable worker is the only safe way to
 * honour the multi-tenancy rule (`.claude/rules/multi-tenancy.md`) — a cache is
 * a cache key, and a learner from Org A must never be served Org B's data from
 * a stale cache. So this worker caches ONLY public static assets and NEVER
 * stores authenticated HTML, RSC payloads, or any /api response.
 *
 * `cacheStrategy()` below is the single source of truth for what may be cached
 * and is exercised directly by lib/pwa/cache-policy.test.ts against this file.
 */

// Bump this string to invalidate all caches on the next deploy.
const CACHE = "elc-pwa-v1";

// The minimal offline shell. These are public, non-tenant assets.
const PRECACHE_URLS = [
  "/offline",
  "/fonts/rubik-variable.woff2",
  "/fonts/rubik-italic-bold.woff2",
];

/**
 * Classify a request into exactly one caching strategy.
 *   "cache-first"  — public static asset, safe to store and replay.
 *   "navigate"     — page navigation: network-first, /offline fallback, NEVER stored.
 *   "network-only" — everything else: hit the network, cache nothing.
 *
 * SINGLE SOURCE OF TRUTH. Loosening this is a P0 tenant-isolation risk and is
 * guarded by an automated test.
 */
function cacheStrategy(request) {
  const url = new URL(request.url);

  // Only same-origin GETs are ever eligible. Cross-origin (Clerk, OpenAI,
  // Stripe, R2, PostHog) and all non-GET (server actions, mutations) bypass
  // the worker entirely.
  if (request.method !== "GET" || url.origin !== self.location.origin) {
    return "network-only";
  }

  // NEVER cache API / tenant-scoped responses.
  if (url.pathname.startsWith("/api/")) {
    return "network-only";
  }

  // Public, content-addressed or static assets → cache-first.
  if (
    url.pathname.startsWith("/_next/static/") ||
    url.pathname.startsWith("/fonts/") ||
    url.pathname.startsWith("/brand/") ||
    url.pathname.startsWith("/icons/") ||
    url.pathname === "/manifest.webmanifest"
  ) {
    return "cache-first";
  }

  // Page navigations → network-first with an offline fallback. The HTML may
  // carry a signed-in learner's data, so the response is never stored.
  if (request.mode === "navigate") {
    return "navigate";
  }

  // Same-origin RSC/data fetches and anything else → network, no cache.
  return "network-only";
}

// Exposed so the guard test can drive the real shipped logic.
self.__elcCacheStrategy = cacheStrategy;

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches.open(CACHE).then((cache) => cache.addAll(PRECACHE_URLS)),
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) =>
        Promise.all(keys.filter((key) => key !== CACHE).map((key) => caches.delete(key))),
      )
      .then(() => self.clients.claim()),
  );
});

// Lets a freshly-installed worker take over immediately when the page asks.
self.addEventListener("message", (event) => {
  if (event.data === "SKIP_WAITING") {
    self.skipWaiting();
  }
});

self.addEventListener("fetch", (event) => {
  const strategy = cacheStrategy(event.request);

  if (strategy === "network-only") {
    return; // default browser handling — nothing cached
  }

  if (strategy === "cache-first") {
    event.respondWith(
      caches.match(event.request).then((cached) => {
        if (cached) return cached;
        return fetch(event.request).then((response) => {
          if (response && response.ok) {
            const copy = response.clone();
            caches.open(CACHE).then((cache) => cache.put(event.request, copy));
          }
          return response;
        });
      }),
    );
    return;
  }

  if (strategy === "navigate") {
    event.respondWith(
      fetch(event.request).catch(() =>
        caches.match("/offline").then((cached) => cached || Response.error()),
      ),
    );
  }
});
