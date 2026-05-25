import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { prisma } from "@elc/db/client";
import type { Role } from "@elc/db";
import { devLogin } from "./actions";

function defaultLandingFor(role: Role): string {
  switch (role) {
    case "SuperAdmin":
      // SuperAdmin home is /orgs since Phase 1 of the SuperAdmin console.
      return "/orgs";
    case "OrgAdmin":
      return "/admin";
    case "Learner":
    default:
      return "/home";
  }
}

export const metadata: Metadata = {
  title: "Dev login",
  robots: { index: false, follow: false },
};

export const dynamic = "force-dynamic";

export default async function DevLoginPage({
  searchParams,
}: {
  searchParams: Promise<{ to?: string }>;
}) {
  if (process.env.NODE_ENV === "production") notFound();

  const params = await searchParams;
  // Honor the middleware-supplied ?to= for everyone. When absent (someone
  // hit /dev/login directly), default each user to a role-appropriate
  // landing page so OrgAdmins don't get dumped into a learner page.
  const explicitRedirect = params.to;

  const users = await prisma.user.findMany({
    // Hide soft-deleted users from the dev switcher — they can't log in
    // anyway (loadOrgContext refuses them) and listing them is noise.
    where: { deleted_at: null },
    select: {
      id: true,
      email: true,
      name: true,
      role: true,
      ielts_track: true,
      org: { select: { id: true, name: true } },
    },
    orderBy: [{ org: { name: "asc" } }, { role: "asc" }, { email: "asc" }],
  });

  const byOrg = new Map<string, typeof users>();
  for (const u of users) {
    const list = byOrg.get(u.org.name) ?? [];
    list.push(u);
    byOrg.set(u.org.name, list);
  }

  return (
    <main className="min-h-screen bg-brand-grey-50 px-6 py-16">
      <div className="mx-auto max-w-3xl">
        <header className="mb-10">
          <p className="font-body text-sm uppercase tracking-widest text-brand-red">
            Dev only
          </p>
          <h1 className="mt-2 font-heading font-bold text-3xl text-brand-black">
            Pick a seeded user
          </h1>
          <p className="mt-3 font-body text-base text-brand-grey-700">
            This page is a temporary stand-in for Clerk. It sets a signed
            session cookie for one of the seeded users. Hidden in production.
          </p>
        </header>

        {users.length === 0 ? (
          <div className="rounded-lg bg-brand-white p-6 ring-1 ring-brand-grey-200">
            <p className="font-body text-base text-brand-grey-700">
              No users in the database yet. Run <code className="font-body font-bold">pnpm db:seed</code> first.
            </p>
          </div>
        ) : (
          <div className="space-y-8">
            {[...byOrg.entries()].map(([orgName, members]) => (
              <section key={orgName}>
                <h2 className="font-heading font-bold text-xl text-brand-black mb-4">
                  {orgName}
                </h2>
                <ul className="space-y-3">
                  {members.map((u) => (
                    <li
                      key={u.id}
                      className="rounded-lg bg-brand-white p-4 ring-1 ring-brand-grey-200 flex items-center justify-between gap-4"
                    >
                      <div>
                        <p className="font-heading font-bold text-base text-brand-black">
                          {u.name ?? u.email}
                        </p>
                        <p className="font-body text-sm text-brand-grey-700">
                          {u.email} · {u.role} · {u.ielts_track}
                        </p>
                      </div>
                      <form action={devLogin}>
                        <input type="hidden" name="userId" value={u.id} />
                        <input
                          type="hidden"
                          name="redirectTo"
                          value={explicitRedirect ?? defaultLandingFor(u.role)}
                        />
                        <button
                          type="submit"
                          className="inline-flex items-center rounded-pill bg-brand-red px-5 py-2 font-heading font-bold text-white border border-brand-red transition-colors hover:bg-brand-red-dark focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-red focus-visible:ring-offset-2"
                        >
                          Sign in as
                        </button>
                      </form>
                    </li>
                  ))}
                </ul>
              </section>
            ))}
          </div>
        )}
      </div>
    </main>
  );
}
