// Display-name helpers shared by every role's landing greeting. Pure
// string transforms — kept in @elc/db so the unit tests run against the
// same vitest suite as the rest of the package; no DB access here.

/**
 * The first name we should greet a user by. Tries the User.name field
 * first (stripping any parenthetical org tag the seed/admin attached for
 * disambiguation, e.g. "Anika (Demo English)" → "Anika"), then falls
 * back to a prettified email local-part so a user we don't have a name
 * for still gets a friendly greeting.
 *
 * Returns "there" only in the extreme case where both name and email
 * yield nothing usable, so callers can safely interpolate without a
 * "Welcome back, ." rendering bug.
 */
export function firstNameFrom(user: {
  name: string | null;
  email: string;
}): string {
  const fullName = (user.name ?? "").trim();
  if (fullName) {
    const cleaned = fullName.replace(/\s*\(.*?\)\s*$/, "").trim();
    const first = cleaned.split(/\s+/)[0];
    if (first && first.length > 0) return first;
  }

  const local = user.email.split("@")[0] ?? "";
  const token = local.split(/[._+-]/)[0] ?? "";
  if (token.length === 0) return "there";
  return token.charAt(0).toUpperCase() + token.slice(1);
}
