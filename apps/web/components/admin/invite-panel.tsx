"use client";

// Single-invite + CSV bulk-invite controls for /admin/invite. Calls
// the server actions and renders the structured result inline (no
// redirect dance, so per-row CSV failures stay visible).

import { useState, useTransition } from "react";
import {
  inviteLearner,
  inviteLearnersFromCsv,
  type CsvInviteResult,
  type InviteFailureReason,
} from "@/lib/admin/invite-actions";
import { PendingButton } from "@/components/ui/pending-button";

type SingleStatus =
  | { kind: "idle" }
  | {
      kind: "ok";
      email: string;
      alreadyExisted: boolean;
      invitationSent: boolean;
    }
  | { kind: "fail"; email: string; reason: InviteFailureReason };

type CsvStatus =
  | { kind: "idle" }
  | { kind: "ok"; result: CsvInviteResult };

function failReasonCopy(reason: InviteFailureReason): string {
  switch (reason) {
    case "seat_limit_reached":
      return "Your organisation has used every seat.";
    case "cannot_invite":
      return "Could not invite that email.";
    case "invalid_email":
      return "That doesn't look like a valid email.";
    case "clerk_rate_limited":
      return "Too many invites just now — wait a moment and try again.";
  }
}

export function InvitePanel() {
  const [email, setEmail] = useState("");
  const [name, setName] = useState("");
  const [singleStatus, setSingleStatus] = useState<SingleStatus>({
    kind: "idle",
  });
  const [csvText, setCsvText] = useState("");
  const [csvStatus, setCsvStatus] = useState<CsvStatus>({ kind: "idle" });
  const [pending, startTransition] = useTransition();

  function onSingleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const submittedEmail = email.trim();
    const submittedName = name.trim();
    startTransition(async () => {
      const res = await inviteLearner({
        email: submittedEmail,
        name: submittedName.length ? submittedName : null,
      });
      if (res.ok) {
        setSingleStatus({
          kind: "ok",
          email: submittedEmail,
          alreadyExisted: res.alreadyExisted,
          invitationSent: res.invitationSent,
        });
        setEmail("");
        setName("");
      } else {
        setSingleStatus({
          kind: "fail",
          email: submittedEmail,
          reason: res.reason,
        });
      }
    });
  }

  function onCsvSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (!csvText.trim()) return;
    const text = csvText;
    startTransition(async () => {
      const result = await inviteLearnersFromCsv(text);
      setCsvStatus({ kind: "ok", result });
      setCsvText("");
    });
  }

  return (
    <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
      <section className="rounded-lg bg-brand-white ring-1 ring-brand-grey-200 p-6">
        <h3 className="font-heading font-bold text-lg text-brand-black">
          Invite a learner
        </h3>
        <p className="mt-1 font-body text-sm text-brand-grey-700">
          We&rsquo;ll create a seat for this email and send a Clerk invitation.
        </p>
        <form onSubmit={onSingleSubmit} className="mt-4 space-y-3">
          <label className="block">
            <span className="font-body text-xs uppercase tracking-widest text-brand-grey-500">
              Email
            </span>
            <input
              type="email"
              required
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              className="mt-1 block w-full rounded-md border-0 ring-1 ring-brand-grey-200 px-3 py-2 font-body text-base text-brand-black focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-red"
              placeholder="learner@example.com"
            />
          </label>
          <label className="block">
            <span className="font-body text-xs uppercase tracking-widest text-brand-grey-500">
              Name (optional)
            </span>
            <input
              type="text"
              value={name}
              onChange={(e) => setName(e.target.value)}
              className="mt-1 block w-full rounded-md border-0 ring-1 ring-brand-grey-200 px-3 py-2 font-body text-base text-brand-black focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-red"
              placeholder="Asha Perera"
            />
          </label>
          <PendingButton
            type="submit"
            pending={pending}
            pendingLabel="Inviting…"
            className="inline-flex items-center rounded-pill bg-brand-red px-5 py-2 font-heading font-bold text-white border border-brand-red transition-colors hover:bg-brand-red-dark focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-red focus-visible:ring-offset-2 disabled:opacity-50 disabled:cursor-not-allowed"
          >
            Invite learner
          </PendingButton>
        </form>
        {singleStatus.kind === "ok" ? (
          <p
            role="status"
            className="mt-4 font-body text-sm text-brand-black"
          >
            {singleStatus.alreadyExisted
              ? singleStatus.invitationSent
                ? `${singleStatus.email} was already on your roster, so we sent a fresh invitation.`
                : `${singleStatus.email} was already on your roster.`
              : `Invited ${singleStatus.email}.`}
          </p>
        ) : null}
        {singleStatus.kind === "fail" ? (
          <p
            role="alert"
            className="mt-4 font-body text-sm text-brand-red"
          >
            {failReasonCopy(singleStatus.reason)}
          </p>
        ) : null}
      </section>

      <section className="rounded-lg bg-brand-white ring-1 ring-brand-grey-200 p-6">
        <h3 className="font-heading font-bold text-lg text-brand-black">
          Bulk invite (CSV)
        </h3>
        <p className="mt-1 font-body text-sm text-brand-grey-700">
          Paste one email per line, optional name after a comma. Up to 500
          rows per upload.
        </p>
        <form onSubmit={onCsvSubmit} className="mt-4 space-y-3">
          <label className="block">
            <span className="font-body text-xs uppercase tracking-widest text-brand-grey-500">
              CSV
            </span>
            <textarea
              required
              value={csvText}
              onChange={(e) => setCsvText(e.target.value)}
              rows={8}
              className="mt-1 block w-full rounded-md border-0 ring-1 ring-brand-grey-200 px-3 py-2 font-body font-mono text-sm text-brand-black focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-red"
              placeholder={"email,name\nasha@example.com,Asha P\nben@example.com,Ben K"}
            />
          </label>
          <PendingButton
            type="submit"
            pending={pending}
            pendingLabel="Inviting…"
            className="inline-flex items-center rounded-pill bg-brand-red px-5 py-2 font-heading font-bold text-white border border-brand-red transition-colors hover:bg-brand-red-dark focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-red focus-visible:ring-offset-2 disabled:opacity-50 disabled:cursor-not-allowed"
          >
            Invite all
          </PendingButton>
        </form>
        {csvStatus.kind === "ok" ? (
          <CsvSummary result={csvStatus.result} />
        ) : null}
      </section>
    </div>
  );
}

function CsvSummary({
  result,
}: {
  result: CsvInviteResult;
}) {
  return (
    <div className="mt-4 space-y-2" role="status">
      <p className="font-body text-sm text-brand-black">
        Invited <strong>{result.invited}</strong>, already on roster{" "}
        <strong>{result.skipped}</strong>, failed{" "}
        <strong>{result.failed.length}</strong>.
      </p>
      {result.truncatedAt !== null ? (
        <p className="font-body text-sm text-brand-red">
          Stopped at row {result.truncatedAt} — upload was over the 500-row
          limit.
        </p>
      ) : null}
      {result.failed.length > 0 ? (
        <ul className="rounded-md ring-1 ring-brand-grey-200 divide-y divide-brand-grey-200 overflow-hidden">
          {result.failed.slice(0, 20).map((row) => (
            <li
              key={`${row.row}-${row.email}`}
              className="px-3 py-2 flex items-center justify-between gap-3"
            >
              <span className="font-body text-xs text-brand-grey-700">
                Row {row.row}
              </span>
              <span className="font-body text-sm text-brand-black truncate">
                {row.email}
              </span>
              <span className="font-body text-xs text-brand-red">
                {failReasonCopy(row.reason)}
              </span>
            </li>
          ))}
          {result.failed.length > 20 ? (
            <li className="px-3 py-2 font-body text-xs text-brand-grey-700">
              + {result.failed.length - 20} more failures hidden.
            </li>
          ) : null}
        </ul>
      ) : null}
    </div>
  );
}
