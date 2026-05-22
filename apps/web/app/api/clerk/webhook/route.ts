// Clerk webhook receiver. Verifies the Svix signature with
// CLERK_WEBHOOK_SIGNING_SECRET and dispatches to the pure sync helpers
// in @elc/db/clerk-sync. The route stays thin so the testable surface
// (everything below the signature gate) lives in packages/db, where
// vitest runs against the real test branch.
//
// Subscribe these events in the Clerk dashboard:
//   user.created            — link by email or no-op (defer to membership)
//   user.updated            — sync name/email
//   user.deleted            — soft-delete (deleted_at)
//   organization.created    — upsert Organization with safe defaults
//   organization.updated    — sync name
//   organization.deleted    — Archive
//   organizationMembership.created  — ensure org + user, set role
//   organizationMembership.updated  — sync role
//   organizationMembership.deleted  — soft-delete user

import { Webhook } from "svix";
import { headers } from "next/headers";
import { NextResponse } from "next/server";
import {
  applyClerkMembershipDeleted,
  applyClerkMembershipUpsert,
  applyClerkOrgDeleted,
  applyClerkOrgUpsert,
  applyClerkUserDeleted,
  applyClerkUserUpsert,
  type ClerkMembershipPayload,
  type ClerkOrgPayload,
  type ClerkUserPayload,
} from "@elc/db";

type ClerkWebhookEvent =
  | { type: "user.created" | "user.updated"; data: ClerkUserPayload }
  | { type: "user.deleted"; data: { id: string; deleted: boolean } }
  | {
      type: "organization.created" | "organization.updated";
      data: ClerkOrgPayload;
    }
  | { type: "organization.deleted"; data: { id: string; deleted: boolean } }
  | {
      type:
        | "organizationMembership.created"
        | "organizationMembership.updated"
        | "organizationMembership.deleted";
      data: ClerkMembershipPayload;
    }
  | { type: string; data: unknown };

export async function POST(req: Request): Promise<Response> {
  const secret = process.env.CLERK_WEBHOOK_SIGNING_SECRET;
  if (!secret) {
    // Loud failure rather than silent 200 so a missing secret can never
    // be mistaken for "webhook is healthy".
    return NextResponse.json(
      { error: "CLERK_WEBHOOK_SIGNING_SECRET not configured" },
      { status: 500 },
    );
  }

  const h = await headers();
  const svixId = h.get("svix-id");
  const svixTimestamp = h.get("svix-timestamp");
  const svixSignature = h.get("svix-signature");
  if (!svixId || !svixTimestamp || !svixSignature) {
    return NextResponse.json({ error: "Missing Svix headers" }, { status: 400 });
  }

  const body = await req.text();
  let event: ClerkWebhookEvent;
  try {
    event = new Webhook(secret).verify(body, {
      "svix-id": svixId,
      "svix-timestamp": svixTimestamp,
      "svix-signature": svixSignature,
    }) as ClerkWebhookEvent;
  } catch {
    return NextResponse.json({ error: "Invalid signature" }, { status: 401 });
  }

  try {
    await dispatch(event);
  } catch (err) {
    // Returning 500 makes Clerk retry. Log to console so the cause is
    // visible in `pnpm dev` and in Vercel logs.
    console.error("[clerk.webhook] handler error", event.type, err);
    return NextResponse.json({ error: "Handler error" }, { status: 500 });
  }

  return NextResponse.json({ ok: true });
}

async function dispatch(event: ClerkWebhookEvent): Promise<void> {
  switch (event.type) {
    case "user.created":
    case "user.updated":
      return applyClerkUserUpsert(event.data as ClerkUserPayload);
    case "user.deleted":
      return applyClerkUserDeleted((event.data as { id: string }).id);
    case "organization.created":
    case "organization.updated":
      return applyClerkOrgUpsert(event.data as ClerkOrgPayload);
    case "organization.deleted":
      return applyClerkOrgDeleted((event.data as { id: string }).id);
    case "organizationMembership.created":
    case "organizationMembership.updated":
      return applyClerkMembershipUpsert(event.data as ClerkMembershipPayload);
    case "organizationMembership.deleted":
      return applyClerkMembershipDeleted(event.data as ClerkMembershipPayload);
    default:
      // Unknown / unsubscribed event — log and return 200 so Clerk does
      // not retry forever.
      return;
  }
}
