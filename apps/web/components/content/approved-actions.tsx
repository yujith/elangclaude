// Lifecycle action bar shown on a section review page when a test is already
// Approved. Server Component — the three forms post to the shared lifecycle
// Server Actions; the buttons themselves are the client Submit/Confirm
// primitives. Rendered identically across all four sections.
//
// Brand note: red is reserved for the single primary action per view, which on
// this surface is "Reopen" (the constructive path back into review). Retire is
// a bordered secondary; Delete lives in a separate, visually-quiet danger zone
// and only renders when the test has zero learner attempts.

import { SubmitButton } from "@/components/ui/submit-button";
import { ConfirmSubmitButton } from "@/components/ui/confirm-submit-button";
import {
  deleteApprovedTest,
  reopenApprovedTest,
  retireApprovedTest,
} from "@/lib/content/lifecycle-actions";

type Section = "Reading" | "Listening" | "Writing" | "Speaking";

export function ApprovedContentActions({
  testId,
  section,
  attemptCount,
}: {
  testId: string;
  section: Section;
  attemptCount: number;
}) {
  const deletable = attemptCount === 0;

  return (
    <section className="rounded-lg bg-brand-white ring-1 ring-brand-grey-200 p-6 space-y-5">
      <div>
        <h2 className="font-heading font-bold text-xl text-brand-black">
          Manage this approved test
        </h2>
        <p className="mt-1 font-body text-sm text-brand-grey-700">
          This test is live. Retiring pulls it from learner pickers immediately;
          reopening sends it back to review so it can be edited and re-approved.
        </p>
      </div>

      <div className="flex flex-wrap items-start gap-3">
        <form action={reopenApprovedTest}>
          <input type="hidden" name="testId" value={testId} />
          <input type="hidden" name="section" value={section} />
          <SubmitButton
            pendingLabel="Reopening…"
            className="inline-flex items-center rounded-pill bg-brand-red px-6 py-3 font-heading font-bold text-white border border-brand-red transition-colors hover:bg-brand-red-dark focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-red focus-visible:ring-offset-2 disabled:opacity-60 disabled:cursor-not-allowed"
          >
            Reopen for review
          </SubmitButton>
        </form>

        <form action={retireApprovedTest}>
          <input type="hidden" name="testId" value={testId} />
          <input type="hidden" name="section" value={section} />
          <ConfirmSubmitButton
            confirmMessage="Retire this test? It will stop being served to learners immediately. You can reopen and re-approve it later."
            pendingLabel="Retiring…"
            className="inline-flex items-center rounded-pill bg-brand-white px-6 py-3 font-heading font-bold text-brand-black border border-brand-grey-300 transition-colors hover:bg-brand-grey-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-red focus-visible:ring-offset-2 disabled:opacity-60 disabled:cursor-not-allowed"
          >
            Retire — pull from learners
          </ConfirmSubmitButton>
        </form>
      </div>

      <div className="border-t border-brand-grey-200 pt-5">
        <h3 className="font-heading font-bold text-sm uppercase tracking-wide text-brand-grey-600">
          Danger zone
        </h3>
        {deletable ? (
          <div className="mt-2 space-y-2">
            <p className="font-body text-sm text-brand-grey-700">
              No learner has attempted this test, so it can be permanently
              deleted. This removes the test and its questions for good.
            </p>
            <form action={deleteApprovedTest}>
              <input type="hidden" name="testId" value={testId} />
              <input type="hidden" name="section" value={section} />
              <ConfirmSubmitButton
                confirmMessage="Permanently delete this test and its questions? This cannot be undone."
                pendingLabel="Deleting…"
                className="inline-flex items-center rounded-pill bg-brand-black px-6 py-3 font-heading font-bold text-white transition-colors hover:bg-brand-grey-900 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-red focus-visible:ring-offset-2 disabled:opacity-60 disabled:cursor-not-allowed"
              >
                Delete permanently
              </ConfirmSubmitButton>
            </form>
          </div>
        ) : (
          <p className="mt-2 font-body text-sm text-brand-grey-700">
            This test has{" "}
            <strong className="text-brand-black">{attemptCount}</strong> learner
            attempt{attemptCount === 1 ? "" : "s"}, so it can&rsquo;t be deleted
            — that would destroy their history. Retire it instead to take it out
            of circulation.
          </p>
        )}
      </div>
    </section>
  );
}
