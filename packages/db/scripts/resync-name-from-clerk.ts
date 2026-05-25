// One-off: re-pull the User.name field from Clerk for a single email.
// Useful when a row was lazy-linked before the lazy-link learned to sync
// names (pre apps/web/lib/auth/context.ts change), so the seeded
// placeholder "Super Admin" etc. is still in the DB.
//
// Usage:  pnpm exec tsx scripts/resync-name-from-clerk.ts <email>
//   e.g.  pnpm exec tsx scripts/resync-name-from-clerk.ts yujith@gmail.com

import { createClerkClient } from "@clerk/backend";
import { joinName } from "../src/clerk-sync";
import { prisma } from "../src/client";

async function main() {
  const email = process.argv[2];
  if (!email) {
    console.error("Usage: tsx scripts/resync-name-from-clerk.ts <email>");
    process.exit(1);
  }
  if (!process.env.CLERK_SECRET_KEY) {
    console.error("CLERK_SECRET_KEY is required.");
    process.exit(1);
  }

  const dbUser = await prisma.user.findUnique({
    where: { email: email.toLowerCase() },
    select: { id: true, name: true, clerk_user_id: true },
  });
  if (!dbUser) {
    console.error(`No DB row for ${email}.`);
    process.exit(1);
  }
  if (!dbUser.clerk_user_id) {
    console.error(
      `${email} has no clerk_user_id yet — sign in once to trigger the lazy-link.`,
    );
    process.exit(1);
  }

  const clerk = createClerkClient({ secretKey: process.env.CLERK_SECRET_KEY });
  const clerkUser = await clerk.users.getUser(dbUser.clerk_user_id);
  const newName = joinName(clerkUser.firstName, clerkUser.lastName);

  console.log(
    `Clerk profile: firstName=${JSON.stringify(clerkUser.firstName)} ` +
      `lastName=${JSON.stringify(clerkUser.lastName)} -> joined=${JSON.stringify(newName)}`,
  );
  console.log(`DB row before: name=${JSON.stringify(dbUser.name)}`);

  if (!newName) {
    console.log("Clerk has no name to copy — nothing to do.");
    await prisma.$disconnect();
    return;
  }
  if (newName === dbUser.name) {
    console.log("Already up to date — nothing to do.");
    await prisma.$disconnect();
    return;
  }

  await prisma.user.update({
    where: { id: dbUser.id },
    data: { name: newName },
  });
  console.log(`DB row after:  name=${JSON.stringify(newName)} (updated).`);
  await prisma.$disconnect();
}

main();
