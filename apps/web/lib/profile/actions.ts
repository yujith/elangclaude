"use server";

// Self-service profile actions.
//
// Thin wrapper around the @elc/db helper. Any authenticated user can call
// updateMyTrack on their own row; the helper does the in-progress guard and
// the ActivityLog write.

import { revalidatePath } from "next/cache";
import { updateMyIeltsTrack, type UpdateTrackResult } from "@elc/db";
import { requireOrgContext } from "@/lib/auth/context";

export type { UpdateTrackResult, UpdateTrackFailureReason } from "@elc/db";

export async function updateMyTrack(input: {
  ielts_track: string;
}): Promise<UpdateTrackResult> {
  const ctx = await requireOrgContext();
  const result = await updateMyIeltsTrack(ctx, {
    ielts_track: input.ielts_track,
  });

  if (result.ok && result.changed) {
    revalidatePath("/profile");
    revalidatePath("/home");
    revalidatePath("/practice/reading");
    revalidatePath("/practice/listening");
    revalidatePath("/practice/writing");
    revalidatePath("/practice/speaking");
    revalidatePath("/mock");
  }

  return result;
}
