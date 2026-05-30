// Single chokepoint for the Stripe SDK (ADR-0017 Phase 2). Every server-
// side path that talks to Stripe — Plan sync, Checkout, Portal, webhook —
// goes through `getStripe()` so the API version, env-var resolution, and
// safety guards live in one place. Mirrors the pattern in
// `packages/ai/src/gateway.ts` (single chokepoint for AI providers).
//
// Env resolution order:
//   1. STRIPE_SECRET_KEY            — preferred in production.
//   2. STRIPE_SECRET_KEY_SANDBOX    — preferred in dev (matches the
//                                     keys committed to packages/db/.env).
//
// Safety: outside production the resolved key MUST start with `sk_test_`.
// Same belt-and-braces shape as `clerk-seed.ts`'s NODE_ENV check — a
// dev env that accidentally points at a live Stripe account would charge
// real cards on the first Checkout.

import Stripe from "stripe";

export class BillingEnvError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "BillingEnvError";
  }
}

// Pinned to the Stripe API version the installed SDK is built against
// (stripe v22 → "2026-04-22.dahlia"). The SDK narrows its `apiVersion`
// to a single literal, so bumping the SDK package also bumps this line.
const STRIPE_API_VERSION = "2026-04-22.dahlia" as const;

type EnvSource = {
  STRIPE_SECRET_KEY?: string;
  STRIPE_SECRET_KEY_SANDBOX?: string;
  NODE_ENV?: string;
};

export function resolveStripeSecretKey(env: EnvSource = process.env): string {
  const candidate = env.STRIPE_SECRET_KEY ?? env.STRIPE_SECRET_KEY_SANDBOX;
  if (!candidate || candidate.length === 0) {
    throw new BillingEnvError(
      "STRIPE_SECRET_KEY (or STRIPE_SECRET_KEY_SANDBOX for dev) must be set. " +
        "Add the key to packages/db/.env for local development, or the " +
        "Vercel project settings for production.",
    );
  }
  if (env.NODE_ENV !== "production" && !candidate.startsWith("sk_test_")) {
    throw new BillingEnvError(
      "Refusing to use a live Stripe key outside production. " +
        "Set STRIPE_SECRET_KEY_SANDBOX to an sk_test_… key in " +
        "packages/db/.env, or run with NODE_ENV=production if you really " +
        "mean to hit the live account.",
    );
  }
  return candidate;
}

let cached: Stripe | null = null;

export function getStripe(env: EnvSource = process.env): Stripe {
  if (cached) return cached;
  const key = resolveStripeSecretKey(env);
  // Stripe's TS types accept the literal API version string; cast keeps
  // a future SDK bump from breaking compilation if the union changes.
  cached = new Stripe(key, {
    apiVersion: STRIPE_API_VERSION,
    appInfo: {
      name: "eLanguage Center",
      url: "https://elanguage.dev",
    },
  });
  return cached;
}

// Exposed for tests: reset the memoised client between test cases that
// twiddle env vars. Production code never calls this.
export function __resetStripeClient(): void {
  cached = null;
}
