"use client";

// Button for client-driven async work — useTransition, onClick handlers that
// await a Server Action, or manual fetch() flows — where useFormStatus doesn't
// apply (the work isn't a bare <form action> submit). The caller owns the
// `pending` boolean; this component just renders the spinner + disable + busy
// state consistently with SubmitButton.
//
//   const [pending, startTransition] = useTransition();
//   <PendingButton pending={pending} onClick={() => startTransition(run)}>
//     Invite learner
//   </PendingButton>
//
// For Server-Action <form action={fn}> submits, prefer SubmitButton instead —
// it derives `pending` automatically.

import * as React from "react";
import { Spinner } from "./spinner";

type Props = React.ButtonHTMLAttributes<HTMLButtonElement> & {
  pending: boolean;
  pendingLabel?: React.ReactNode;
  spinnerSize?: "sm" | "md";
};

export function PendingButton({
  pending,
  children,
  pendingLabel,
  spinnerSize = "sm",
  disabled,
  className,
  ...rest
}: Props) {
  return (
    <button
      {...rest}
      disabled={disabled || pending}
      aria-busy={pending || undefined}
      className={className}
    >
      {pending ? (
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
