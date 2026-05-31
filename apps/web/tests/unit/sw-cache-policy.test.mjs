// Guard test for the service worker's caching policy.
//
// This is a TENANT-ISOLATION guard (.claude/rules/multi-tenancy.md): a cache is
// a cache key, and the SW must never store authenticated/tenant-scoped data. We
// load the REAL shipped public/sw.js into a sandbox and drive its exported
// `cacheStrategy()` so the test can never drift from what actually ships.
//
// Zero deps on purpose — runs under `node --test`, wired as apps/web's `test`.

import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";
import vm from "node:vm";

const here = dirname(fileURLToPath(import.meta.url));
const swSource = readFileSync(resolve(here, "../../public/sw.js"), "utf8");

const ORIGIN = "https://app.elanguagecenter.com";

function loadStrategy() {
  const self = { location: { origin: ORIGIN }, addEventListener() {} };
  const sandbox = { self, URL, console };
  vm.createContext(sandbox);
  vm.runInContext(swSource, sandbox);
  assert.equal(typeof self.__elcCacheStrategy, "function", "sw.js must export cacheStrategy on self");
  return self.__elcCacheStrategy;
}

function req(path, { method = "GET", mode = "cors", origin = ORIGIN } = {}) {
  const url = path.startsWith("http") ? path : origin + path;
  return { url, method, mode };
}

const strategy = loadStrategy();

test("public static assets are cache-first", () => {
  for (const p of [
    "/_next/static/chunks/main-abc123.js",
    "/fonts/rubik-variable.woff2",
    "/brand/icon.svg",
    "/icons/icon-192",
    "/manifest.webmanifest",
  ]) {
    assert.equal(strategy(req(p)), "cache-first", `${p} should be cache-first`);
  }
});

test("page navigations are network-first with offline fallback (never stored)", () => {
  assert.equal(strategy(req("/home", { mode: "navigate" })), "navigate");
  assert.equal(strategy(req("/admin/billing", { mode: "navigate" })), "navigate");
});

test("API routes are NEVER cached (tenant-scoped)", () => {
  for (const p of ["/api/clerk/webhook", "/api/stripe/webhook", "/api/anything"]) {
    assert.equal(strategy(req(p)), "network-only", `${p} must be network-only`);
  }
  // even when fetched as a navigation
  assert.equal(strategy(req("/api/x", { mode: "navigate" })), "network-only");
});

test("non-GET requests (server actions / mutations) are never cached", () => {
  assert.equal(strategy(req("/home", { method: "POST", mode: "navigate" })), "network-only");
  assert.equal(strategy(req("/_next/static/x.js", { method: "POST" })), "network-only");
});

test("cross-origin requests bypass the worker entirely", () => {
  for (const origin of [
    "https://clerk.elanguagecenter.com",
    "https://api.openai.com",
    "https://api.stripe.com",
    "https://r2.cloudflarestorage.com",
  ]) {
    assert.equal(strategy(req("/anything", { origin })), "network-only", `${origin} must be network-only`);
  }
});

test("same-origin RSC/data fetches are not cached", () => {
  // A page-data fetch that isn't a navigation and isn't a known static path.
  assert.equal(strategy(req("/home?_rsc=abc", { mode: "cors" })), "network-only");
});
