// Self-serve organisation creation. Renders Clerk's <CreateOrganization />.
// On submit, Clerk fires `organization.created` + `organizationMembership.created`
// (with role `org:admin`) at our webhook, which creates the matching
// Organization row and promotes the creator to OrgAdmin. After the form
// completes Clerk redirects to /post-signin, which forwards by role.
//
// Race note: the webhook can arrive milliseconds AFTER Clerk redirects.
// If you hit /no-access immediately after creation, the row hasn't synced
// yet — refresh once and you'll land on /admin. Phase 2 follow-up: poll
// in /post-signin until the row appears.

import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { CreateOrganization } from "@clerk/nextjs";
import { auth } from "@clerk/nextjs/server";
import { TopNav } from "@/components/top-nav";
import { SiteFooter } from "@/components/site-footer";

export const metadata: Metadata = {
  title: "Create organisation",
  description:
    "Set up a new eLanguage Center organisation. You become its administrator.",
  robots: { index: false, follow: false },
};

export const dynamic = "force-dynamic";

export default async function CreateOrgPage() {
  // Clerk session required — we render <CreateOrganization /> which only
  // works when signed in. Unauthenticated users get sent to Clerk first.
  const { userId } = await auth();
  if (!userId) redirect("/sign-in?to=%2Fcreate-org");

  return (
    <>
      <TopNav />
      <main className="flex-1 bg-brand-grey-50">
        <div className="mx-auto max-w-md px-6 py-16 md:py-24 flex items-center justify-center">
          <CreateOrganization
            routing="hash"
            afterCreateOrganizationUrl="/post-signin"
            skipInvitationScreen
          />
        </div>
      </main>
      <SiteFooter />
    </>
  );
}
