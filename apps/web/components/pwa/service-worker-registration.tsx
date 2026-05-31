"use client";

import { useEffect } from "react";

/**
 * Registers the hand-rolled service worker (public/sw.js) and wires the
 * update flow so a new deploy's shell takes over without a manual hard
 * refresh. Disabled in development to avoid caching ephemeral dev chunks.
 */
export function ServiceWorkerRegistration() {
  useEffect(() => {
    if (process.env.NODE_ENV !== "production") return;
    if (typeof navigator === "undefined" || !("serviceWorker" in navigator)) return;

    // Whether a worker already controlled this page when we registered. On a
    // first-ever visit it's null, and the SW's clients.claim() will fire
    // controllerchange as it takes over — we must NOT reload in that case
    // (it would cause a jarring first-load reload and break in-page tooling).
    // Only a genuine *update* — a new worker replacing an existing controller
    // — warrants the one-time reload to pick up the fresh shell.
    const hadController = !!navigator.serviceWorker.controller;
    let reloading = false;
    const onControllerChange = () => {
      if (!hadController || reloading) return;
      reloading = true;
      window.location.reload();
    };
    navigator.serviceWorker.addEventListener("controllerchange", onControllerChange);

    navigator.serviceWorker
      .register("/sw.js")
      .then((registration) => {
        registration.addEventListener("updatefound", () => {
          const installing = registration.installing;
          if (!installing) return;
          installing.addEventListener("statechange", () => {
            // A new worker finished installing while an old one is in control:
            // ask it to activate immediately (triggers controllerchange above).
            if (installing.state === "installed" && navigator.serviceWorker.controller) {
              installing.postMessage("SKIP_WAITING");
            }
          });
        });
      })
      .catch(() => {
        // Registration is best-effort; the app works fine without the SW.
      });

    return () => {
      navigator.serviceWorker.removeEventListener("controllerchange", onControllerChange);
    };
  }, []);

  return null;
}
