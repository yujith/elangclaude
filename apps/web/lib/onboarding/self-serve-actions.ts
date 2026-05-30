"use server";

// Self-serve org provisioning server action (ADR-0017 Phase 6).
//
// Called from /signup-org/continue's form. Pulls the authenticated
// Clerk user from the session, gathers org name + plan slug from the
// form, and hands off to packages/db/src/self-serve.ts. On success,
// redirects to /onboarding/plan?preselect={slug} where the existing
// Phase 5 wizard takes over.

import { createClerkClient } from "@clerk/backend";
import { auth, currentUser } from "@clerk/nextjs/server";
import { redirect } from "next/navigation";
import { provisionSelfServeOrg } from "@elc/db";

function clerkClient() {
  if (!process.env.CLERK_SECRET_KEY) {
    throw new Error(
      "CLERK_SECRET_KEY must be set for self-serve org provisioning.",
    );
  }
  return createClerkClient({ secretKey: process.env.CLERK_SECRET_KEY });
}

function primaryEmail(
  user: Awaited<ReturnType<typeof currentUser>>,
): string | null {
  if (!user) return null;
  const primaryId = user.primaryEmailAddressId;
  const primary = user.emailAddresses.find((e) => e.id === primaryId);
  const raw = primary?.emailAddress ?? user.emailAddresses[0]?.emailAddress;
  return raw ? raw.trim().toLowerCase() : null;
}

function displayName(
  user: Awaited<ReturnType<typeof currentUser>>,
): string | null {
  if (!user) return null;
  const joined = [user.firstName, user.lastName].filter(Boolean).join(" ").trim();
  return joined.length > 0 ? joined : null;
}

export async function selfServeProvisionFromForm(
  formData: FormData,
): Promise<void> {
  const { userId: clerkUserId } = await auth();
  if (!clerkUserId) redirect("/signup-org");

  const orgName = formData.get("org_name");
  const planSlugRaw = formData.get("plan_slug");
  const planSlug =
    typeof planSlugRaw === "string" && planSlugRaw.length > 0
      ? planSlugRaw
      : null;
  if (!planSlug) {
    redirect("/signup-org/continue?error=invalid_plan_slug");
  }

  const user = await currentUser();
  const email = primaryEmail(user);
  if (!email) {
    redirect(
      `/signup-org/continue?plan=${encodeURIComponent(planSlug)}&error=email_already_in_use`,
    );
  }

  const clerk = clerkClient();
  const result = await provisionSelfServeOrg(
    {
      clerk_user_id: clerkUserId,
      email,
      org_name: typeof orgName === "string" ? orgName : "",
      plan_slug: planSlug,
      user_name: displayName(user),
    },
    {
      createClerkOrg: async (params) => {
        const created = await clerk.organizations.createOrganization({
          name: params.name,
          createdBy: params.createdBy,
        });
        return { id: created.id };
      },
      createClerkOrgMembership: async (params) => {
        await clerk.organizations.createOrganizationMembership({
          organizationId: params.organizationId,
          userId: params.userId,
          role: params.role,
        });
      },
      deleteClerkOrg: async (id) => {
        await clerk.organizations.deleteOrganization(id);
      },
    },
  );

  if (!result.ok) {
    redirect(
      `/signup-org/continue?plan=${encodeURIComponent(planSlug)}&error=${result.reason}`,
    );
  }

  // Free / Internal plans skip Stripe entirely — straight to welcome.
  // Paid plans land on the wizard with the chosen tier pre-selected.
  if (result.subscription_status === "Internal") {
    redirect("/onboarding/welcome");
  }
  redirect(
    `/onboarding/plan?preselect=${encodeURIComponent(result.plan_slug)}`,
  );
}
