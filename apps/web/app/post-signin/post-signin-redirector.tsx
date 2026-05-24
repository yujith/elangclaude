"use client";

// Hard-navigation redirect for the post-signin trampoline.
//
// Why not server-side `redirect()` or `useRouter().replace()`?
//   Clerk's <SignIn> finishes by client-side-navigating to /post-signin. On
//   Next 16 App Router, both Server-Component `redirect()` and Next-router
//   `replace()` return RSC-payload navigations that Clerk's client wrapper
//   doesn't reliably commit — the dev-server log shows /admin (or /orgs)
//   being fetched server-side, but the browser tab stays on /post-signin.
//   `window.location.replace()` triggers a real browser navigation that
//   Clerk has no hook into, so it always lands. The cost is one extra HTTP
//   round-trip per sign-in, which is invisible in practice.
//
// The splash itself uses the brand black hero so the brief flash reads
// as an intentional transition rather than a blank page.

import { useEffect } from "react";
import { Logo } from "@/components/logo";

export function PostSigninRedirector({ to }: { to: string }) {
  useEffect(() => {
    window.location.replace(to);
  }, [to]);

  return (
    <main className="flex min-h-screen flex-col items-center justify-center gap-6 bg-brand-black px-6 text-white">
      <Logo variant="on-dark" height={48} priority />
      <p className="font-body text-brand-grey-400">Signing you in…</p>
    </main>
  );
}
