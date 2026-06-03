"use client";

// Drop-in replacement for `<button type="submit">` inside a Server-Action
// `<form action={fn}>`. Reads React's useFormStatus, so it automatically shows
// a spinner + disables itself while the action is in flight — no client state
// plumbing required in the parent (which stays a Server Component).
//
// Usage: keep the existing button's className; just swap the tag and add an
// optional pendingLabel:
//
//   <SubmitButton className="…brand pill…" pendingLabel="Generating…">
//     Generate
//   </SubmitButton>
//
// useFormStatus only reports `pending` for the nearest enclosing <form>, so
// SubmitButton MUST be rendered inside that form (it is, by construction, since
// it replaces the form's own submit button).
//
// a11y: while pending the button is disabled and carries aria-busy so the
// busy state is announced on the control itself; the inline Spinner is
// decorative to avoid a double announcement. (We scope busy to the button
// rather than the whole form to keep the parent a Server Component.)

import * as React from "react";
import { useFormStatus } from "react-dom";
import { Spinner } from "./spinner";

type Props = React.ButtonHTMLAttributes<HTMLButtonElement> & {
  /** Label shown beside the spinner while the action runs. Defaults to children. */
  pendingLabel?: React.ReactNode;
  spinnerSize?: "sm" | "md";
};

export function SubmitButton({
  children,
  pendingLabel,
  spinnerSize = "sm",
  disabled,
  className,
  ...rest
}: Props) {
  const { pending } = useFormStatus();
  const isBusy = pending;

  return (
    <button
      {...rest}
      type="submit"
      disabled={disabled || isBusy}
      aria-busy={isBusy || undefined}
      className={className}
    >
      {isBusy ? (
        <span className="inline-flex items-center gap-2">
          <Spinner size={spinnerSize} decorative />
          {pendingLabel ?? children}
        </span>
      ) : (
        children
      )}
    </button>
  );
}
