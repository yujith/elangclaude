// Reviewer-rejection revision context (ADR-0024).
//
// The automation orchestrator regenerates a unit after the content
// reviewer rejects it. Rather than inventing a new channel, the
// generators reuse their existing multi-turn repair pattern: the
// conversation is seeded as if a previous attempt had produced
// `previousResponseText` and a reviewer had rejected it with `feedback`.
// The model sees its own prior output and a targeted fix list — the same
// shape as the validators' retry nudges, so prompt behaviour stays
// consistent across both repair paths.

export type GenerationRevision = {
  // The prior unit, serialised — typically JSON.stringify of the parsed
  // generation the reviewer rejected.
  previousResponseText: string;
  // The reviewer's feedback_for_regeneration, verbatim.
  feedback: string;
};

export function reviewerRevisionNudge(feedback: string): string {
  return [
    "An expert IELTS content reviewer rejected your previous unit for the reasons below.",
    "Generate a complete replacement JSON object — not a patch — that fixes every problem:",
    "",
    feedback,
    "",
    "Keep the replacement within all schema and structural rules above.",
    "Return ONLY the corrected JSON object. No prose, no markdown fences.",
  ].join("\n");
}

// Builds the seed message history for a generation call: the original
// user turn, optionally followed by the rejected attempt + the reviewer
// nudge when a revision is in play.
export function seedMessages(
  turn1: string,
  revision: GenerationRevision | undefined,
): { role: "user" | "assistant"; content: string }[] {
  const messages: { role: "user" | "assistant"; content: string }[] = [
    { role: "user", content: turn1 },
  ];
  if (revision) {
    messages.push(
      { role: "assistant", content: revision.previousResponseText },
      { role: "user", content: reviewerRevisionNudge(revision.feedback) },
    );
  }
  return messages;
}
