"use server";

// Self-service data-subject-rights actions (ADR-0019).
//
// Thin wrappers around the @elc/db helpers. Each resolves the caller's own
// OrgContext and acts only on their own row — the helpers scope through
// withOrg(ctx) + ctx.user_id, so there is no way to target another user.

import { revalidatePath } from "next/cache";
import {
  cancelErasure,
  rectifyMyName as rectifyMyNameDb,
  recordGuardianConsent,
  requestErasure,
  setAgeAssurance,
} from "@elc/db";
import { requireOrgContext } from "@/lib/auth/context";

export async function requestMyErasure(detail?: string): Promise<{ ok: true; alreadyPending: boolean }> {
  const ctx = await requireOrgContext();
  const res = await requestErasure(ctx, { detail: detail ?? null });
  revalidatePath("/profile");
  return { ok: true, alreadyPending: res.alreadyPending };
}

export async function cancelMyErasure(): Promise<{ ok: true; cancelled: number }> {
  const ctx = await requireOrgContext();
  const cancelled = await cancelErasure(ctx);
  revalidatePath("/profile");
  return { ok: true, cancelled };
}

export async function rectifyMyName(name: string): Promise<{ ok: boolean }> {
  const ctx = await requireOrgContext();
  const res = await rectifyMyNameDb(ctx, name);
  if (res.ok) revalidatePath("/profile");
  return res;
}

export async function setMyAge(input: {
  age_assurance: "Adult" | "Minor";
  guardian_email?: string;
}): Promise<{ ok: boolean }> {
  const ctx = await requireOrgContext();
  if (input.age_assurance === "Minor") {
    const email = (input.guardian_email ?? "").trim();
    if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) return { ok: false };
    await setAgeAssurance(ctx, { age_assurance: "Minor", guardian_email: email });
  } else {
    await setAgeAssurance(ctx, { age_assurance: "Adult" });
  }
  revalidatePath("/profile");
  return { ok: true };
}

export async function recordMyGuardianConsent(): Promise<{ ok: true }> {
  const ctx = await requireOrgContext();
  await recordGuardianConsent(ctx);
  revalidatePath("/profile");
  return { ok: true };
}
