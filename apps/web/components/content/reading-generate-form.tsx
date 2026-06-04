"use client";

// "Generate a new passage" form for the Reading moderation queue.
//
// A client island only because the Part selector is meaningful for
// Academic and meaningless for General Training (GT derives its part from
// gt_context). Showing a dead "Part" dropdown for GT confused reviewers, so
// we hide it when Track = GT. The server action is passed in from the
// server page; everything else is plain uncontrolled inputs.

import { useState } from "react";
import { SubmitButton } from "@/components/ui/submit-button";

const FIELD =
  "rounded-md ring-1 ring-brand-grey-300 bg-white px-3 py-2 font-body text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-red";
const FIELD_LABEL =
  "block font-heading font-bold text-xs uppercase tracking-wide text-brand-grey-600 mb-1";

export function ReadingGenerateForm({
  action,
  returnTo,
}: {
  action: (formData: FormData) => void | Promise<void>;
  returnTo: string;
}) {
  const [track, setTrack] = useState<"Academic" | "GeneralTraining">(
    "Academic",
  );
  const isAcademic = track === "Academic";

  return (
    <form action={action} className="flex flex-wrap items-end gap-4">
      <input type="hidden" name="returnTo" value={returnTo} />
      <div>
        <label htmlFor="track" className={FIELD_LABEL}>
          Track
        </label>
        <select
          id="track"
          name="track"
          value={track}
          onChange={(e) =>
            setTrack(e.target.value as "Academic" | "GeneralTraining")
          }
          className={FIELD}
        >
          <option value="Academic">Academic</option>
          <option value="GeneralTraining">General Training</option>
        </select>
      </div>
      <div>
        <label htmlFor="difficulty" className={FIELD_LABEL}>
          Difficulty
        </label>
        <input
          id="difficulty"
          name="difficulty"
          type="number"
          min={1}
          max={5}
          defaultValue={5}
          className={`w-20 ${FIELD}`}
        />
      </div>
      {isAcademic ? (
        <div>
          <label htmlFor="part" className={FIELD_LABEL}>
            Part
          </label>
          <select id="part" name="part" defaultValue="" className={FIELD}>
            <option value="">Any</option>
            <option value="1">Part 1</option>
            <option value="2">Part 2</option>
            <option value="3">Part 3</option>
          </select>
        </div>
      ) : null}
      <div className="flex-1 min-w-[16rem]">
        <label htmlFor="topicHint" className={FIELD_LABEL}>
          Topic hint (optional)
        </label>
        <input
          id="topicHint"
          name="topicHint"
          type="text"
          placeholder="e.g. the history of refrigeration"
          className={`w-full ${FIELD}`}
        />
      </div>
      <SubmitButton
        pendingLabel="Generating…"
        className="inline-flex items-center rounded-pill bg-brand-red px-5 py-2.5 font-heading font-bold text-white border border-brand-red transition-colors hover:bg-brand-red-dark focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-red focus-visible:ring-offset-2 disabled:opacity-60 disabled:cursor-not-allowed"
      >
        Generate
      </SubmitButton>
    </form>
  );
}
