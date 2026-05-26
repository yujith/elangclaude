"use client";

// Password & devices section on /profile.
//
// Mounts Clerk's <UserProfile /> widget, styled via the shared
// clerkAppearance map so it matches /sign-in and /sign-up. Default routing
// keeps subviews (password, sessions, MFA) under /profile/*; the route
// uses an optional catch-all so those Clerk subpages survive reloads.

import { UserProfile, Show } from "@clerk/nextjs";
import { clerkAppearance } from "@/lib/auth/clerk-appearance";

const profileClerkAppearance = {
  ...clerkAppearance,
  elements: {
    ...clerkAppearance.elements,
    rootBox: "w-full",
    card: "w-full bg-transparent shadow-none ring-0 rounded-none",
    navbar: "hidden",
    pageScrollBox: "p-0",
    page: "w-full",
    header: "hidden",
    profileSection:
      "border-t border-brand-grey-200 first:border-t-0 py-5 first:pt-0 last:pb-0",
    profileSectionTitle: "font-heading font-bold text-brand-black",
    profileSectionContent: "font-body text-brand-grey-700",
    profileSectionPrimaryButton:
      "text-brand-red hover:text-brand-red-dark font-heading font-bold",
    profileSection__connectedAccounts: "hidden",
    profileSection__emailAddresses: "hidden",
    profileSection__deleteAccount: "hidden",
    profileSection__danger: "hidden",
    navbarButton__account: "hidden",
    navbarButton__billing: "hidden",
    navbarButton__apiKeys: "hidden",
  },
} as const;

export function ProfilePasswordSection() {
  return (
    <>
      <Show when="signed-in">
        <div className="min-w-0 rounded-lg">
          <UserProfile
            appearance={profileClerkAppearance}
            routing="path"
            path="/profile"
          >
            <UserProfile.Page label="security" />
          </UserProfile>
        </div>
      </Show>
      <Show when="signed-out">
        <p className="font-body text-sm text-brand-grey-500 rounded-md bg-brand-grey-50 ring-1 ring-brand-grey-200 px-4 py-3">
          Password and device management are available after signing in with
          Clerk. (Dev sessions skip Clerk and don&apos;t see this widget.)
        </p>
      </Show>
    </>
  );
}
