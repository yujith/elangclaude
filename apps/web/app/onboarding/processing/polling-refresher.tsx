"use client";

// Client-side helper for the /onboarding/processing wait state.
//
// Stripe Checkout redirects the OrgAdmin back to /onboarding/processing
// with a session_id, but our Org row only transitions out of
// PendingPayment once the Phase-4 webhook applies the
// customer.subscription.created event. That round-trip is usually <1s
// but can stretch on a cold Vercel deploy. We poll the page (RSC
// refetch via router.refresh()) every 3 seconds; once the server-side
// render sees Trialing/Active/Internal it issues a redirect to
// /onboarding/welcome and this component unmounts.

import { useEffect } from "react";
import { useRouter } from "next/navigation";

export function PollingRefresher({
  intervalMs = 3000,
}: {
  intervalMs?: number;
}) {
  const router = useRouter();
  useEffect(() => {
    const timer = setInterval(() => router.refresh(), intervalMs);
    return () => clearInterval(timer);
  }, [router, intervalMs]);
  return null;
}
