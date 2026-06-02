"use client";

// "Your data" panel for /profile. Lets any signed-in user exercise their
// data-subject rights without emailing support: download a copy, correct
// their name, declare age band / guardian consent, and request or cancel
// erasure. All work goes through server actions that scope to the caller.

import { useState, useTransition } from "react";
import {
  cancelMyErasure,
  rectifyMyName,
  requestMyErasure,
  setMyAge,
} from "@/lib/data-rights/actions";

type AgeAssurance = "Unknown" | "Adult" | "Minor";

export function DataRightsSection({
  initialName,
  initialAge,
  guardianConsentGiven,
  hasPendingErasure,
}: {
  initialName: string;
  initialAge: AgeAssurance;
  guardianConsentGiven: boolean;
  hasPendingErasure: boolean;
}) {
  return (
    <div className="space-y-8">
      <ExportRow />
      <RectifyNameRow initialName={initialName} />
      <AgeRow initialAge={initialAge} guardianConsentGiven={guardianConsentGiven} />
      <ErasureRow hasPendingErasure={hasPendingErasure} />
    </div>
  );
}

function Note({ tone, children }: { tone: "ok" | "warn"; children: React.ReactNode }) {
  const cls =
    tone === "ok"
      ? "text-brand-black bg-brand-grey-50 ring-1 ring-brand-grey-200"
      : "text-brand-red-dark bg-brand-red-soft";
  return (
    <p role="status" className={`mt-3 font-body text-sm rounded-md px-4 py-3 ${cls}`}>
      {children}
    </p>
  );
}

function ExportRow() {
  return (
    <div>
      <h3 className="font-heading font-bold text-base text-brand-grey-900">
        Download your data
      </h3>
      <p className="mt-1 font-body text-sm text-brand-grey-500">
        Get a machine-readable copy of your account, practice history, grades
        and consent records.
      </p>
      <a
        href="/api/me/export"
        className="mt-3 inline-flex items-center rounded-pill bg-brand-black px-5 py-2 font-heading font-bold text-white hover:opacity-90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-red focus-visible:ring-offset-2 focus-visible:ring-offset-white"
      >
        Download my data (JSON)
      </a>
    </div>
  );
}

function RectifyNameRow({ initialName }: { initialName: string }) {
  const [name, setName] = useState(initialName);
  const [status, setStatus] = useState<"idle" | "saved" | "error">("idle");
  const [pending, start] = useTransition();

  return (
    <div>
      <h3 className="font-heading font-bold text-base text-brand-grey-900">
        Correct your name
      </h3>
      <p className="mt-1 font-body text-sm text-brand-grey-500">
        Keep your display name accurate (right to rectification).
      </p>
      <form
        className="mt-3 flex flex-col sm:flex-row gap-3 sm:items-center"
        onSubmit={(e) => {
          e.preventDefault();
          setStatus("idle");
          start(async () => {
            const res = await rectifyMyName(name);
            setStatus(res.ok ? "saved" : "error");
          });
        }}
      >
        <label htmlFor="rectify-name" className="sr-only">
          Your name
        </label>
        <input
          id="rectify-name"
          type="text"
          value={name}
          onChange={(e) => setName(e.target.value)}
          className="rounded-md ring-1 ring-brand-grey-200 px-4 py-2 font-body text-brand-grey-900 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-red"
        />
        <button
          type="submit"
          disabled={pending}
          className="rounded-pill bg-brand-red-dark px-5 py-2 font-heading font-bold text-white hover:opacity-90 disabled:opacity-60 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-red focus-visible:ring-offset-2"
        >
          {pending ? "Saving…" : "Save"}
        </button>
      </form>
      {status === "saved" && <Note tone="ok">Name updated.</Note>}
      {status === "error" && <Note tone="warn">Enter a name between 1 and 120 characters.</Note>}
    </div>
  );
}

function AgeRow({
  initialAge,
  guardianConsentGiven,
}: {
  initialAge: AgeAssurance;
  guardianConsentGiven: boolean;
}) {
  const [age, setAge] = useState<AgeAssurance>(initialAge);
  const [guardianEmail, setGuardianEmail] = useState("");
  const [status, setStatus] = useState<"idle" | "saved" | "error">("idle");
  const [pending, start] = useTransition();

  return (
    <div>
      <h3 className="font-heading font-bold text-base text-brand-grey-900">
        Age &amp; guardian consent
      </h3>
      <p className="mt-1 font-body text-sm text-brand-grey-500">
        Learners under 18 need a parent or guardian&rsquo;s consent. We only
        store your age band, never your date of birth.
      </p>
      <div className="mt-3 flex flex-col gap-3 sm:flex-row sm:items-end">
        <fieldset>
          <legend className="sr-only">Age band</legend>
          <div className="flex gap-4">
            {(["Adult", "Minor"] as const).map((v) => (
              <label key={v} className="flex items-center gap-2 font-body text-sm text-brand-grey-900">
                <input
                  type="radio"
                  name="age-band"
                  value={v}
                  checked={age === v}
                  onChange={() => setAge(v)}
                  className="accent-brand-red"
                />
                {v === "Adult" ? "18 or older" : "Under 18"}
              </label>
            ))}
          </div>
        </fieldset>
        {age === "Minor" && (
          <div className="flex flex-col">
            <label htmlFor="guardian-email" className="font-body text-xs text-brand-grey-500">
              Parent/guardian email
            </label>
            <input
              id="guardian-email"
              type="email"
              value={guardianEmail}
              onChange={(e) => setGuardianEmail(e.target.value)}
              className="mt-1 rounded-md ring-1 ring-brand-grey-200 px-4 py-2 font-body text-brand-grey-900 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-red"
            />
          </div>
        )}
        <button
          type="button"
          disabled={pending}
          onClick={() => {
            setStatus("idle");
            start(async () => {
              const res = await setMyAge(
                age === "Minor"
                  ? { age_assurance: "Minor", guardian_email: guardianEmail }
                  : { age_assurance: "Adult" },
              );
              setStatus(res.ok ? "saved" : "error");
            });
          }}
          className="rounded-pill border-2 border-brand-black px-5 py-2 font-heading font-bold text-brand-black hover:bg-brand-grey-50 disabled:opacity-60 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-red focus-visible:ring-offset-2"
        >
          {pending ? "Saving…" : "Save"}
        </button>
      </div>
      {status === "saved" && age === "Minor" && !guardianConsentGiven && (
        <Note tone="warn">
          Saved. We&rsquo;ll email your guardian to confirm consent before full access.
        </Note>
      )}
      {status === "saved" && age === "Adult" && <Note tone="ok">Saved.</Note>}
      {status === "error" && <Note tone="warn">Enter a valid guardian email address.</Note>}
    </div>
  );
}

function ErasureRow({ hasPendingErasure }: { hasPendingErasure: boolean }) {
  const [pendingState, setPendingState] = useState(hasPendingErasure);
  const [confirming, setConfirming] = useState(false);
  const [pending, start] = useTransition();

  if (pendingState) {
    return (
      <div className="rounded-xl border border-brand-grey-200 p-5">
        <h3 className="font-heading font-bold text-base text-brand-grey-900">
          Erasure requested
        </h3>
        <p className="mt-1 font-body text-sm text-brand-grey-500">
          Your account is scheduled for deletion. You can cancel this until it
          is processed.
        </p>
        <button
          type="button"
          disabled={pending}
          onClick={() =>
            start(async () => {
              await cancelMyErasure();
              setPendingState(false);
            })
          }
          className="mt-3 rounded-pill border-2 border-brand-black px-5 py-2 font-heading font-bold text-brand-black hover:bg-brand-grey-50 disabled:opacity-60 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-red focus-visible:ring-offset-2"
        >
          {pending ? "Cancelling…" : "Cancel erasure"}
        </button>
      </div>
    );
  }

  return (
    <div className="rounded-xl border border-brand-red/30 p-5">
      <h3 className="font-heading font-bold text-base text-brand-red-dark">Erase my account</h3>
      <p className="mt-1 font-body text-sm text-brand-grey-500">
        Permanently delete your account, recordings, and practice history (right
        to be forgotten). This cannot be undone once processed.
      </p>
      {confirming ? (
        <div className="mt-3 flex flex-col sm:flex-row gap-3">
          <button
            type="button"
            disabled={pending}
            onClick={() =>
              start(async () => {
                await requestMyErasure();
                setPendingState(true);
                setConfirming(false);
              })
            }
            className="rounded-pill bg-brand-red-dark px-5 py-2 font-heading font-bold text-white hover:opacity-90 disabled:opacity-60 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-red focus-visible:ring-offset-2"
          >
            {pending ? "Submitting…" : "Yes, erase my account"}
          </button>
          <button
            type="button"
            onClick={() => setConfirming(false)}
            className="rounded-pill border-2 border-brand-black px-5 py-2 font-heading font-bold text-brand-black hover:bg-brand-grey-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-red focus-visible:ring-offset-2"
          >
            Keep my account
          </button>
        </div>
      ) : (
        <button
          type="button"
          onClick={() => setConfirming(true)}
          className="mt-3 rounded-pill border-2 border-brand-red-dark px-5 py-2 font-heading font-bold text-brand-red-dark hover:bg-brand-red-soft focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-red focus-visible:ring-offset-2"
        >
          Request erasure
        </button>
      )}
    </div>
  );
}
