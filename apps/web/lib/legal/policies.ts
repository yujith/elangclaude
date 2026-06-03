// Policy version registry (ADR-0019).
//
// Policy *content* is authored as brand-styled React in components/legal/*.
// This file is the single source of truth for each document's metadata —
// slug, title, version, effective date — and for the version strings that
// ConsentRecord rows bind to. Bumping a version here is the signal that a
// material policy change happened; downstream we can re-prompt for consent
// when a user's stored version is older than the current one.
//
// Versions are date-stamped (YYYY-MM-DD) so they sort and read naturally.

export type PolicySlug =
  | "privacy"
  | "terms"
  | "cookies"
  | "dpa"
  | "sub-processors";

export type PolicyMeta = {
  slug: PolicySlug;
  title: string;
  /** One-line description for the /legal index + page metadata. */
  summary: string;
  /** Date-stamped version, e.g. "2026-06-01". */
  version: string;
  /** Human-facing effective date. */
  effectiveDate: string;
};

const VERSION = "2026-06-03";
const EFFECTIVE = "3 June 2026";

export const POLICIES: Record<PolicySlug, PolicyMeta> = {
  privacy: {
    slug: "privacy",
    title: "Privacy Policy",
    summary:
      "What personal data we collect, why, the legal basis, how long we keep it, and your rights.",
    version: VERSION,
    effectiveDate: EFFECTIVE,
  },
  terms: {
    slug: "terms",
    title: "Terms of Service",
    summary: "The agreement that governs your use of eLanguage Center.",
    version: VERSION,
    effectiveDate: EFFECTIVE,
  },
  cookies: {
    slug: "cookies",
    title: "Cookie Policy",
    summary: "The cookies and similar technologies we use, and how to control them.",
    version: VERSION,
    effectiveDate: EFFECTIVE,
  },
  dpa: {
    slug: "dpa",
    title: "Data Processing Addendum",
    summary:
      "For organisations: the terms under which we process learner data as your processor.",
    version: VERSION,
    effectiveDate: EFFECTIVE,
  },
  "sub-processors": {
    slug: "sub-processors",
    title: "Sub-processors",
    summary: "The third parties we rely on to deliver the service, and what they handle.",
    version: VERSION,
    effectiveDate: EFFECTIVE,
  },
};

export const POLICY_LIST: PolicyMeta[] = Object.values(POLICIES);

/**
 * The composite version string a sign-up consent binds to (accepting Terms +
 * Privacy at once). Stored on the ConsentRecord so we can detect when a user
 * consented to an older revision.
 */
export function termsPrivacyVersion(): string {
  return `terms@${POLICIES.terms.version}+privacy@${POLICIES.privacy.version}`;
}

export function cookiesVersion(): string {
  return `cookies@${POLICIES.cookies.version}`;
}
