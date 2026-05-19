// Module-scope constants for the Full Mock Test orchestrator.
//
// Lives in its own file (no "use server") because Next.js 16 forbids
// non-async exports from "use server" modules — a runtime const collides
// with that rule even though every caller is on the server. Keep types
// here too only if they need to be co-located; otherwise they can stay
// alongside the actions (types are erased and don't trip the rule).

import type { Section } from "@elc/db";

// Section order is hard-coded — see ADR 0008 D4. Speaking is the
// optional fourth leg; the orchestrator marks it skipped if no approved
// Test exists or the runner refuses to start.
export const MOCK_SECTION_ORDER = [
  "Listening",
  "Reading",
  "Writing",
  "Speaking",
] as const satisfies readonly Section[];
