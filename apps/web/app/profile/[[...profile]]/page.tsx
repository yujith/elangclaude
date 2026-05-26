import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { hasInProgressWork, withOrg, type Role } from "@elc/db";
import { Logo } from "@/components/logo";
import { ProfilePasswordSection } from "@/components/profile-password-section";
import { ProfileTrackForm } from "@/components/profile-track-form";
import { SignOutControl } from "@/components/sign-out-control";
import {
  NoOrgMembershipError,
  OrgSuspendedError,
  UnauthenticatedError,
  devLoginReturnPath,
  requireOrgContext,
} from "@/lib/auth/context";

export const metadata: Metadata = {
  title: "Profile",
  description: "Manage your IELTS track preference and account sign-in.",
};

// Top-level route (not under (learner)/(admin)/(super)) — same shell renders
// for all three roles. The optional catch-all lets Clerk's path-based
// <UserProfile /> subpages such as /profile/security survive reloads.
// See docs/adr/0016-user-profile-management.md D2.
export const dynamic = "force-dynamic";

const SIGN_IN_PATH = "/sign-in";
const BLOCKED_CLERK_PROFILE_PAGES = new Set([
  "account",
  "connected-accounts",
  "delete",
  "delete-account",
]);

function homeHrefFor(role: Role): string {
  if (role === "SuperAdmin") return "/orgs";
  if (role === "OrgAdmin") return "/admin";
  return "/home";
}

function roleLabel(role: Role): string {
  if (role === "SuperAdmin") return "SuperAdmin";
  if (role === "OrgAdmin") return "Org admin";
  return "Learner";
}

export default async function ProfilePage({
  params,
}: {
  params: Promise<{ profile?: string[] }>;
}) {
  const profileSegments = (await params).profile ?? [];
  const profilePath =
    profileSegments.length > 0
      ? `/profile/${profileSegments.join("/")}`
      : "/profile";

  if (
    profileSegments.some((segment) => BLOCKED_CLERK_PROFILE_PAGES.has(segment))
  ) {
    redirect("/profile/security");
  }

  let ctx;
  try {
    ctx = await requireOrgContext();
  } catch (err) {
    if (err instanceof UnauthenticatedError) {
      const to = await devLoginReturnPath(profilePath);
      redirect(`${SIGN_IN_PATH}?to=${encodeURIComponent(to)}`);
    }
    if (err instanceof NoOrgMembershipError) redirect("/no-access");
    if (err instanceof OrgSuspendedError) {
      redirect(`/suspended?status=${err.orgStatus}`);
    }
    throw err;
  }

  const [me, inProgress] = await Promise.all([
    withOrg(ctx).user.findUnique({
      where: { id: ctx.user_id },
      select: {
        name: true,
        email: true,
        ielts_track: true,
        role: true,
        org: { select: { name: true } },
      },
    }),
    hasInProgressWork(ctx),
  ]);

  if (!me) redirect("/no-access");

  const homeHref = homeHrefFor(ctx.role);
  const displayName = me.name ?? me.email;
  const trackLabel =
    me.ielts_track === "Academic" ? "Academic" : "General Training";

  return (
    <div className="min-h-screen flex flex-col bg-brand-grey-50">
      <header className="bg-brand-black text-white">
        <div className="mx-auto max-w-7xl px-6 py-3 flex items-center gap-4 sm:gap-6">
          <Link
            href={homeHref}
            aria-label="eLanguage Center"
            className="flex items-center gap-3 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-red focus-visible:ring-offset-2 focus-visible:ring-offset-brand-black rounded-sm"
          >
            <Logo variant="on-dark" height={35} />
          </Link>
          <div className="ml-auto flex items-center gap-4">
            <div className="text-right hidden sm:block">
              <p className="font-heading font-bold text-sm leading-tight">
                {displayName}
              </p>
              <p className="font-body text-xs text-brand-grey-200 leading-tight">
                {me.org.name} · {trackLabel}
              </p>
            </div>
            <SignOutControl />
          </div>
        </div>
      </header>
      <main className="flex-1">
        <div className="mx-auto max-w-5xl px-6 py-10 space-y-10">
          <section className="max-w-3xl">
            <p className="font-body text-xs uppercase tracking-widest text-brand-grey-500">
              {roleLabel(ctx.role)} · {me.org.name}
            </p>
            <h1 className="font-display italic font-extrabold text-4xl sm:text-5xl text-brand-black mt-2">
              Your profile
            </h1>
            <p className="font-body text-brand-grey-500 mt-3">{me.email}</p>
          </section>

          <section
            aria-labelledby="profile-track-heading"
            className="bg-white rounded-lg ring-1 ring-brand-grey-200 p-6 sm:p-8"
          >
            <header className="mb-4">
              <h2
                id="profile-track-heading"
                className="font-heading font-bold text-xl text-brand-black"
              >
                IELTS preference
              </h2>
              <p className="font-body text-brand-grey-500 mt-1">
                Choose the track of practice tests we show you in section
                pickers and Full Mock.
              </p>
            </header>
            <ProfileTrackForm
              initialTrack={me.ielts_track}
              hasInProgressWork={inProgress}
            />
          </section>

          <section
            aria-labelledby="profile-password-heading"
            className="bg-white rounded-lg ring-1 ring-brand-grey-200 p-6 sm:p-8"
          >
            <header className="mb-4">
              <h2
                id="profile-password-heading"
                className="font-heading font-bold text-xl text-brand-black"
              >
                Password &amp; devices
              </h2>
              <p className="font-body text-brand-grey-500 mt-1">
                Change your password and manage active sign-in sessions.
              </p>
            </header>
            <ProfilePasswordSection />
          </section>
        </div>
      </main>
    </div>
  );
}
