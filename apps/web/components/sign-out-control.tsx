// Visually identical sign-out trigger across all three role layouts.
// Renders Clerk's <SignOutButton> for Clerk-authed sessions and falls
// back to the dev-session server action when only the dev cookie is in
// play. Both paths use the same styling so a layout header never shifts
// when the auth backend differs.
//
// Clerk v7 exposes a single `<Show when="signed-in" | "signed-out">`
// control component (the v6-era `<SignedIn>` / `<SignedOut>` shorthands
// were dropped).

import { Show, SignOutButton } from "@clerk/nextjs";
import { devLogout } from "@/app/dev/login/actions";

const BUTTON_CLASS =
  "font-body font-medium text-sm text-brand-grey-200 hover:text-white underline-offset-4 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-red focus-visible:ring-offset-2 focus-visible:ring-offset-brand-black rounded-sm";

export async function SignOutControl(): Promise<React.ReactElement> {
  const isDev = process.env.NODE_ENV !== "production";

  return (
    <>
      <Show when="signed-in">
        <SignOutButton redirectUrl="/">
          <button type="button" className={BUTTON_CLASS}>
            Sign out
          </button>
        </SignOutButton>
      </Show>
      {isDev && (
        <Show when="signed-out">
          <form action={devLogout}>
            <button type="submit" className={BUTTON_CLASS}>
              Sign out
            </button>
          </form>
        </Show>
      )}
    </>
  );
}
