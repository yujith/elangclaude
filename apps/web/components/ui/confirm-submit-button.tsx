"use client";

// Like SubmitButton, but pops a native window.confirm() before letting the
// form submit. For deliberate / destructive actions (retire, delete) where a
// stray click should not flip live content. Cancelling the dialog prevents the
// submit; confirming lets the Server Action run and shows the usual spinner.
//
// Still inside a `<form action={fn}>` and still reads useFormStatus, so the
// parent stays a Server Component.

import * as React from "react";
import { useFormStatus } from "react-dom";
import { Spinner } from "./spinner";

type Props = React.ButtonHTMLAttributes<HTMLButtonElement> & {
  /** Text shown in the confirm dialog. */
  confirmMessage: string;
  /** Label shown beside the spinner while the action runs. Defaults to children. */
  pendingLabel?: React.ReactNode;
  spinnerSize?: "sm" | "md";
};

export function ConfirmSubmitButton({
  children,
  confirmMessage,
  pendingLabel,
  spinnerSize = "sm",
  disabled,
  className,
  onClick,
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
      onClick={(e) => {
        if (!window.confirm(confirmMessage)) {
          e.preventDefault();
          return;
        }
        onClick?.(e);
      }}
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
