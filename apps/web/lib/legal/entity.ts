// Operating entity — single source of truth (ADR-0019 follow-up).
//
// "eLanguage Center" is the product / service name. The legal operator is an
// Australian **sole trader** identified by an ABN, trading as "MustardLabs".
// There is NO incorporated company yet — do NOT add "Pty Ltd", "Ltd", or
// "Inc." anywhere. For a sole trader the legal person is the individual; the
// privacy/terms/DPA copy therefore names that individual plus the ABN.
//
// Entity details are confirmed against the Australian Business Register
// (legal name + ABN, active 25/03/2026). If you ever change the operator,
// update the fields below AND bump the policy version in policies.ts — that
// bump re-prompts users for consent (ADR-0019). Note `pnpm typecheck` cannot
// catch a wrong value here; it's copy, so verify against the ABR.

export const OPERATING_ENTITY = {
  /** Product / trading name shown to users. */
  product: "eLanguage Center",
  /** Registered/used trading name the sole trader operates under. */
  tradingAs: "MustardLabs",
  /** Public site for the trading name. */
  tradingUrl: "https://www.mustardlabs.org",
  /**
   * Full legal name of the sole trader (per the Australian Business Register).
   * INTERNAL / compliance use only (e.g. the ROPA) — intentionally NOT rendered
   * on public pages. The operator is identified publicly by `tradingAs` + `abn`
   * (the ABN resolves to this individual on the ABR), which satisfies the
   * controller-identity duty without printing the personal name. Do not surface
   * this field in Privacy / Terms / DPA copy.
   */
  legalName: "Dilshika Colombage",
  /** Australian Business Number (formatted XX XXX XXX XXX). */
  abn: "91 930 042 126",
  /** Jurisdiction whose law governs the Terms. */
  jurisdiction: "Australia",
  /** General contact. */
  contactEmail: "hello@elanguagecenter.com",
  /** Privacy / data-rights contact. */
  privacyEmail: "privacy@elanguagecenter.com",
} as const;

/**
 * False while LEGAL_NAME / ABN are still placeholders. When you fill the real
 * values, set this to true — it's the guard that says "safe to bump the policy
 * version in policies.ts".
 */
export const ENTITY_DETAILS_COMPLETE = true;
