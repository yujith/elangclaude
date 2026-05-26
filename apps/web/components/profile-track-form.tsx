"use client";

// IELTS track preference form for /profile.
//
// Calls updateMyTrack() (server action wrapping @elc/db). The page passes
// hasInProgressWork from a server-side hasInProgressWork(ctx) read so the
// disabled state is correct on first paint; if the server still reports
// in_progress_work on submit (a race), we surface the same copy inline.

import { useState, useTransition } from "react";
import {
  updateMyTrack,
  type UpdateTrackFailureReason,
} from "@/lib/profile/actions";

type Track = "Academic" | "GeneralTraining";

const OPTIONS: { value: Track; label: string; hint: string }[] = [
  {
    value: "Academic",
    label: "Academic",
    hint: "For university entry. Academic Reading, Writing Task 1 visuals, longer texts.",
  },
  {
    value: "GeneralTraining",
    label: "General Training",
    hint: "For migration and work. Workplace texts, GT Writing Task 1 letters.",
  },
];

const ERROR_COPY: Record<UpdateTrackFailureReason, string> = {
  invalid_track: "That isn't a valid track. Reload the page and try again.",
  in_progress_work:
    "Finish or abandon your in-progress session before switching tracks.",
};

export function ProfileTrackForm({
  initialTrack,
  hasInProgressWork,
}: {
  initialTrack: Track;
  hasInProgressWork: boolean;
}) {
  const [selected, setSelected] = useState<Track>(initialTrack);
  const [savedTrack, setSavedTrack] = useState<Track>(initialTrack);
  const [status, setStatus] = useState<"idle" | "saved" | "error">("idle");
  const [errorReason, setErrorReason] = useState<UpdateTrackFailureReason | null>(
    null,
  );
  const [pending, startTransition] = useTransition();

  const disabled = hasInProgressWork || pending;
  const changed = selected !== savedTrack;

  function submit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (!changed) return;
    setStatus("idle");
    setErrorReason(null);
    startTransition(async () => {
      const result = await updateMyTrack({ ielts_track: selected });
      if (result.ok) {
        setSavedTrack(result.ielts_track);
        setStatus("saved");
      } else {
        setStatus("error");
        setErrorReason(result.reason);
        setSelected(savedTrack);
      }
    });
  }

  return (
    <form onSubmit={submit} className="space-y-4" aria-describedby="track-help">
      <p id="track-help" className="sr-only">
        Switch between the Academic and General Training versions of the IELTS
        test.
      </p>
      <fieldset disabled={disabled}>
        <legend className="sr-only">IELTS track</legend>
        <div className="grid gap-3 sm:grid-cols-2">
          {OPTIONS.map((opt) => {
            const id = `track-${opt.value}`;
            const isChecked = selected === opt.value;
            return (
              <label
                key={opt.value}
                htmlFor={id}
                className={`flex flex-col gap-2 rounded-md ring-1 ring-brand-grey-200 px-4 py-3 transition-colors hover:bg-brand-grey-50 has-[:checked]:ring-brand-red has-[:checked]:bg-brand-red-soft ${
                  disabled ? "opacity-60 cursor-not-allowed" : "cursor-pointer"
                }`}
              >
                <div className="flex items-center gap-3">
                  <input
                    id={id}
                    type="radio"
                    name="ielts_track"
                    value={opt.value}
                    checked={isChecked}
                    onChange={() => setSelected(opt.value)}
                    className="accent-brand-red"
                  />
                  <span className="font-heading font-bold text-base text-brand-grey-900">
                    {opt.label}
                  </span>
                </div>
                <p className="font-body text-sm text-brand-grey-500 pl-7">
                  {opt.hint}
                </p>
              </label>
            );
          })}
        </div>
      </fieldset>

      {hasInProgressWork && (
        <p
          role="status"
          className="font-body text-sm text-brand-grey-900 rounded-md bg-brand-red-soft px-4 py-3"
        >
          {ERROR_COPY.in_progress_work}
        </p>
      )}

      {status === "error" && errorReason && (
        <p
          role="alert"
          className="font-body text-sm text-brand-red rounded-md bg-brand-red-soft px-4 py-3"
        >
          {ERROR_COPY[errorReason]}
        </p>
      )}

      {status === "saved" && (
        <p
          role="status"
          className="font-body text-sm text-brand-black rounded-md bg-brand-grey-50 ring-1 ring-brand-grey-200 px-4 py-3"
        >
          Saved. Section pickers will show your new track on the next page
          load.
        </p>
      )}

      <div className="pt-2">
        <button
          type="submit"
          disabled={disabled || !changed}
          className="inline-flex items-center justify-center rounded-pill bg-brand-red text-white font-heading font-bold px-5 py-2 hover:bg-brand-red/90 disabled:opacity-60 disabled:cursor-not-allowed focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-red focus-visible:ring-offset-2 focus-visible:ring-offset-white transition-colors"
        >
          {pending ? "Saving…" : "Save preference"}
        </button>
      </div>
    </form>
  );
}
