// Promote (or create) a SuperAdmin by email — an idempotent, DB-only ops
// script. Use it to grant SuperAdmin in environments the full seed should
// NOT touch (production), or to apply just one SuperAdmin locally without a
// full `pnpm db:seed` + Clerk re-mirror.
//
//   pnpm --filter @elc/db tsx prisma/promote-super.ts <email> \
//       [--org=<id|name>] [--create-internal-org="Name"] [--name="Full Name"]
//
// Examples:
//   # Local dev (defaults to the seeded Org A as the home org):
//   pnpm --filter @elc/db tsx prisma/promote-super.ts yujith@gmail.com
//
//   # Production — create a dedicated internal home org and promote in one shot:
//   DATABASE_URL="<prod-url>" NODE_ENV=production \
//     pnpm --filter @elc/db tsx prisma/promote-super.ts yujith@gmail.com \
//       --create-internal-org="eLanguage Center (internal)"
//
//   # Production — promote into an EXISTING org instead:
//   DATABASE_URL="<prod-url>" NODE_ENV=production \
//     pnpm --filter @elc/db tsx prisma/promote-super.ts yujith@gmail.com --org="Acme School"
//
// WHAT IT DOES NOT DO: it never touches Clerk. SuperAdmin is DB-controlled
// (see CLAUDE.md). Because the target is an existing Clerk account, the user
// is bound on first sign-in via requireOrgContext's lazy-link-by-email, which
// stamps clerk_user_id + name. If the email has no Clerk account in the target
// Clerk tenant, sign-in dead-ends at /no-access until that account exists.
//
// TENANCY NOTE: runs without an OrgContext, so it uses the raw `prisma`
// client (same sanctioned exception as clerk-seed.ts). Creating a SuperAdmin
// IS the cross-org escape hatch by definition. Must never be imported by app
// code.
//
// SAFETY: idempotent (upsert on the user_org_email composite). Rollback is a
// single `UPDATE "User" SET role='Learner'` or a row delete.

import { config as loadEnv } from "dotenv";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { PrismaClient } from "@prisma/client";
import { SYSTEM_ORG_ID } from "../src/system-org";

const here = dirname(fileURLToPath(import.meta.url));
loadEnv({ path: resolve(here, "../.env") });

const prisma = new PrismaClient();

// The well-known seeded Org A id. Used as the default home org in dev only;
// production must pass --org explicitly.
const DEV_DEFAULT_ORG_ID = "seed_org_demo_english_academy";

function parseArgs(argv: string[]): {
  email: string;
  org?: string;
  createInternalOrg?: string;
  name?: string;
} {
  const positional: string[] = [];
  let org: string | undefined;
  let createInternalOrg: string | undefined;
  let name: string | undefined;
  for (const arg of argv) {
    if (arg.startsWith("--org=")) org = arg.slice("--org=".length).trim();
    else if (arg.startsWith("--create-internal-org="))
      createInternalOrg = arg.slice("--create-internal-org=".length).trim();
    else if (arg.startsWith("--name=")) name = arg.slice("--name=".length).trim();
    else positional.push(arg);
  }
  const email = positional[0]?.trim().toLowerCase() ?? "";
  return { email, org, createInternalOrg, name };
}

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

// Mirror the seed's `internal` Plan limits onto the org row (org carries the
// live quota values — see seed.ts backfillOrgsToInternalPlan).
const INTERNAL_ORG_LIMITS = { seat_limit: 1000, quota_daily: 5000, quota_monthly: 100000 };

function slugify(name: string): string {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .slice(0, 48);
}

// Create (or reuse) a dedicated internal org. Idempotent via a deterministic
// id derived from the name. Attaches the `internal` Plan if one is seeded;
// otherwise leaves plan_id null but still marks subscription_status=Internal.
async function createInternalOrg(name: string): Promise<{ id: string; name: string }> {
  const id = `internal_${slugify(name)}`;
  const internalPlan = await prisma.plan.findFirst({
    where: { is_internal: true, is_active: true },
    select: { id: true },
    orderBy: { sort_order: "asc" },
  });
  const org = await prisma.organization.upsert({
    where: { id },
    update: { name, status: "Active", subscription_status: "Internal" },
    create: {
      id,
      name,
      ...INTERNAL_ORG_LIMITS,
      status: "Active",
      subscription_status: "Internal",
      provisioned_via: "seeded",
      ...(internalPlan ? { plan_id: internalPlan.id } : {}),
    },
    select: { id: true, name: true },
  });
  if (!internalPlan) {
    console.warn(
      `Note: no internal Plan found, created org "${name}" with plan_id=null. ` +
        "Attach a plan later from /plans if needed.",
    );
  }
  return org;
}

async function resolveOrg(orgArg: string | undefined): Promise<{ id: string; name: string }> {
  const isProd = process.env.NODE_ENV === "production";

  if (!orgArg) {
    if (isProd) {
      throw new Error(
        "Refusing to guess a home org in production. Pass --org=<id|name> " +
          "with an existing organization id or exact name.",
      );
    }
    const orgA = await prisma.organization.findUnique({
      where: { id: DEV_DEFAULT_ORG_ID },
      select: { id: true, name: true },
    });
    if (!orgA) {
      throw new Error(
        `Default dev org "${DEV_DEFAULT_ORG_ID}" not found. Run \`pnpm db:seed\` ` +
          "first, or pass --org=<id|name>.",
      );
    }
    return orgA;
  }

  // Try id first, then exact name.
  const byId = await prisma.organization.findUnique({
    where: { id: orgArg },
    select: { id: true, name: true },
  });
  if (byId) return byId;

  const byName = await prisma.organization.findMany({
    where: { name: orgArg },
    select: { id: true, name: true },
  });
  if (byName.length === 1) return byName[0]!;
  if (byName.length > 1) {
    throw new Error(
      `Multiple orgs named "${orgArg}". Pass --org=<id> to disambiguate.`,
    );
  }
  throw new Error(`No organization found by id or name "${orgArg}".`);
}

async function main() {
  const { email, org: orgArg, createInternalOrg: newOrgName, name } = parseArgs(
    process.argv.slice(2),
  );

  if (!email || !EMAIL_RE.test(email)) {
    throw new Error(
      "Usage: tsx prisma/promote-super.ts <email> " +
        '[--org=<id|name>] [--create-internal-org="Name"] [--name="Full Name"]',
    );
  }

  if (orgArg && newOrgName) {
    throw new Error("Pass either --org or --create-internal-org, not both.");
  }

  const org = newOrgName
    ? await createInternalOrg(newOrgName)
    : await resolveOrg(orgArg);
  if (org.id === SYSTEM_ORG_ID) {
    throw new Error(
      "Refusing to park a SuperAdmin in the system org. Pick a real org.",
    );
  }

  // If the email already exists in ANY org (multi-org is possible — ADR-0018),
  // promote that existing row in place rather than forking a second identity.
  const existingAnywhere = await prisma.user.findFirst({
    where: { email },
    select: { id: true, org_id: true, role: true, deleted_at: true },
  });

  if (existingAnywhere && existingAnywhere.org_id !== org.id) {
    // Promote the existing row where it already lives, to avoid creating a
    // duplicate identity in a different org.
    const updated = await prisma.user.update({
      where: { id: existingAnywhere.id },
      data: { role: "SuperAdmin", ...(name ? { name } : {}) },
      select: { id: true, email: true, org_id: true, role: true, deleted_at: true },
    });
    report("promoted-existing", updated, org.name);
    if (updated.deleted_at) warnSoftDeleted();
    return;
  }

  const user = await prisma.user.upsert({
    where: { user_org_email: { org_id: org.id, email } },
    update: { role: "SuperAdmin", ...(name ? { name } : {}) },
    create: { org_id: org.id, email, name: name ?? null, role: "SuperAdmin" },
    select: { id: true, email: true, org_id: true, role: true, deleted_at: true },
  });

  report(existingAnywhere ? "promoted" : "created", user, org.name);
  if (user.deleted_at) warnSoftDeleted();
}

function report(
  action: "created" | "promoted" | "promoted-existing",
  user: { id: string; email: string; org_id: string; role: string },
  orgName: string,
) {
  const verb =
    action === "created"
      ? "Created"
      : action === "promoted"
        ? "Promoted"
        : "Promoted existing";
  console.log(
    `${verb} ${user.email} -> ${user.role} in org "${orgName}" (${user.org_id}).\n` +
      "Next: sign in with this email's Clerk account. requireOrgContext will " +
      "lazy-link it (stamp clerk_user_id + name) on first sign-in.",
  );
}

function warnSoftDeleted() {
  console.warn(
    "\nWARNING: this user row is soft-deleted (deleted_at is set), which BLOCKS " +
      "sign-in. Clear deleted_at if you want them to be able to log in.",
  );
}

main()
  .catch((err) => {
    console.error(err instanceof Error ? err.message : err);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
