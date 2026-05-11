"use server";

// Server action for the dev learner-switcher. Sets the signed session
// cookie after verifying the user exists. Refuses to run when
// NODE_ENV === 'production' so this surface can't be exploited if it
// somehow ships.

import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { prisma } from "@elc/db/client";
import { SESSION_COOKIE, makeSessionToken } from "@/lib/auth/dev-session";

export async function devLogin(formData: FormData): Promise<void> {
  if (process.env.NODE_ENV === "production") {
    throw new Error("Dev login disabled in production.");
  }
  const userId = formData.get("userId");
  const redirectTo = (formData.get("redirectTo") ?? "/practice/writing") as string;
  if (typeof userId !== "string" || userId.length === 0) {
    throw new Error("Missing userId.");
  }
  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: { id: true },
  });
  if (!user) throw new Error("Unknown user.");

  const cookieStore = await cookies();
  cookieStore.set(SESSION_COOKIE, makeSessionToken(user.id), {
    httpOnly: true,
    sameSite: "lax",
    secure: false,
    path: "/",
    // 30 days is plenty for dev; production auth replaces this entirely.
    maxAge: 60 * 60 * 24 * 30,
  });
  redirect(redirectTo);
}

export async function devLogout(): Promise<void> {
  const cookieStore = await cookies();
  cookieStore.delete(SESSION_COOKIE);
  redirect("/dev/login");
}
