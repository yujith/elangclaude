// Stripe webhook receiver (ADR-0017 Phase 4). Verifies the Stripe
// signature with STRIPE_WEBHOOK_SIGNING_SECRET and dispatches to the
// pure handlers in @elc/db/stripe-events. The route stays thin so the
// testable surface (everything below the signature gate) lives in
// packages/db, where vitest runs against the real test branch.
//
// Subscribe these events in the Stripe dashboard / `stripe listen`:
//   checkout.session.completed          — stamp stripe_subscription_id
//   customer.subscription.created       — first activation
//   customer.subscription.updated       — status / period changes
//   customer.subscription.deleted       — cancellation → Suspended
//   customer.subscription.trial_will_end — banner trigger only
//   invoice.payment_failed              — PastDue marker
//
// Returning non-2xx tells Stripe to retry. We use 200 for "processed"
// AND for "intentionally ignored" (unknown event type, metadata
// mismatch, stale order) so Stripe stops retrying. Genuine handler
// errors (uncaught exceptions) return 500 so Stripe's Smart Retries
// kick in.

import { headers } from "next/headers";
import { NextResponse } from "next/server";
import Stripe from "stripe";
import {
  dispatchStripeEvent,
  type StripeEventEnvelope,
} from "@elc/db";
import { getStripe } from "@/lib/billing/stripe-client";

export async function POST(req: Request): Promise<Response> {
  const secret =
    process.env.STRIPE_WEBHOOK_SIGNING_SECRET ??
    process.env.STRIPE_WEBHOOK_SECRET ??
    null;
  if (!secret) {
    // Loud failure rather than silent 200 — a missing secret would let
    // a forged request mutate Org state.
    return NextResponse.json(
      {
        error:
          "STRIPE_WEBHOOK_SIGNING_SECRET not configured. Set it from the Stripe dashboard (production) or from the `stripe listen` output (dev).",
      },
      { status: 500 },
    );
  }

  const h = await headers();
  const signature = h.get("stripe-signature");
  if (!signature) {
    return NextResponse.json(
      { error: "Missing Stripe-Signature header" },
      { status: 400 },
    );
  }

  // Read the raw body — required for signature verification. Next 16's
  // request body is web-standard `ReadableStream`; `req.text()` is the
  // canonical way to grab the verbatim bytes.
  const body = await req.text();

  let event: Stripe.Event;
  try {
    event = getStripe().webhooks.constructEvent(body, signature, secret);
  } catch (err) {
    const message = err instanceof Error ? err.message : "unknown";
    console.warn("[stripe.webhook] signature verification failed", message);
    return NextResponse.json({ error: "Invalid signature" }, { status: 401 });
  }

  const envelope: StripeEventEnvelope = {
    id: event.id,
    type: event.type,
    created: event.created,
    data: { object: event.data.object as unknown },
  };

  try {
    const outcome = await dispatchStripeEvent(envelope);
    return NextResponse.json({ ok: true, outcome });
  } catch (err) {
    // 5xx makes Stripe retry. Log so the cause shows up in `pnpm dev`
    // and Vercel logs.
    console.error("[stripe.webhook] handler error", event.type, err);
    return NextResponse.json({ error: "Handler error" }, { status: 500 });
  }
}
