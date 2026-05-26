// Plan error copy lives in its own module because Next.js refuses to
// export non-async values from a "use server" file. Shared between the
// three /plans pages and the server-action redirects.

import type { PlanFailureReason } from "@elc/db";

export const PLAN_ERROR_COPY: Record<PlanFailureReason, string> = {
  plan_not_found: "That plan does not exist.",
  invalid_slug:
    "Slug must start with a letter and contain only lowercase letters, digits, and dashes (2–30 chars).",
  invalid_name: "Name must be 2–100 characters.",
  invalid_description: "Description must be 500 characters or fewer.",
  invalid_seat_limit: "Seat limit must be a whole number between 1 and 100,000.",
  invalid_quota_daily:
    "Daily quota must be a whole non-negative number up to 1,000,000.",
  invalid_quota_monthly:
    "Monthly quota must be a whole non-negative number up to 1,000,000.",
  invalid_amount:
    "Monthly amount (USD) must be a non-negative number with up to two decimals.",
  invalid_trial_days: "Trial days must be a whole number between 0 and 90.",
  invalid_sort_order:
    "Sort order must be a whole number between 0 and 10,000.",
  slug_taken: "That slug is already in use.",
  internal_plan_immutable:
    "The internal plan is infrastructure and cannot be edited from the UI.",
};

export function planErrorMessage(raw: string | undefined): string | null {
  if (!raw) return null;
  if (raw in PLAN_ERROR_COPY) {
    return PLAN_ERROR_COPY[raw as PlanFailureReason];
  }
  return raw;
}
