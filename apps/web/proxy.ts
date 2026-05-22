import { NextResponse } from "next/server";
import { clerkMiddleware, createRouteMatcher } from "@clerk/nextjs/server";
import { SESSION_COOKIE as DEV_SESSION_COOKIE } from "@/lib/auth/session-cookie";

// Surfaces that require an authenticated learner / admin / super-admin.
// Note: SuperAdmin role + Suspended-org gating happens inside the route
// group layouts via requireOrgContext — this matcher only decides
// "must be signed in at all".
const isProtectedRoute = createRouteMatcher([
  "/content(.*)",
  "/practice(.*)",
  "/admin(.*)",
  "/orgs(.*)",
  "/users(.*)",
  "/metrics(.*)",
  "/mock(.*)",
  "/results(.*)",
]);

// Routes that must stay reachable without an active Clerk session.
// The Clerk webhook authenticates via Svix signature, never a cookie;
// /dev/login is the non-production seeded-user switcher.
const isPublicRoute = createRouteMatcher([
  "/",
  "/sign-in(.*)",
  "/sign-up(.*)",
  "/suspended",
  "/no-access",
  "/create-org",
  "/post-signin",
  "/api/clerk/webhook",
  // Dev-only escape hatch. The page itself 404s when NODE_ENV === production,
  // so listing it here is safe.
  "/dev(.*)",
]);

export default clerkMiddleware(async (auth, request) => {
  const { pathname, search } = request.nextUrl;
  const fullPath = pathname + search;

  // requireOrgContext / devLoginReturnPath both read this header to know
  // the original target before any auth-redirect rewrite.
  const requestHeaders = new Headers(request.headers);
  requestHeaders.set("x-elc-pathname", fullPath);

  if (isProtectedRoute(request) && !isPublicRoute(request)) {
    const { userId } = await auth();

    // Dev escape hatch: a signed dev-session cookie counts as "signed in"
    // for the purpose of getting past middleware. requireOrgContext still
    // re-verifies the HMAC and loads the user. In production this cookie
    // is never trusted (loadOrgContext refuses to read it when
    // NODE_ENV === "production").
    const hasDevSession =
      process.env.NODE_ENV !== "production" &&
      Boolean(request.cookies.get(DEV_SESSION_COOKIE)?.value);

    if (!userId && !hasDevSession) {
      // Always send to Clerk's hosted sign-in. /dev/login is reachable by
      // typing it directly when you need the seeded-user switcher; we
      // don't redirect there automatically because it would block the
      // Clerk flow from being testable in dev.
      const signIn = new URL("/sign-in", request.url);
      signIn.searchParams.set("to", fullPath);
      return NextResponse.redirect(signIn, 307);
    }
  }

  return NextResponse.next({ request: { headers: requestHeaders } });
});

export const config = {
  // Run on everything except Next internals + static assets. Clerk's
  // recommended matcher; mirrors clerkMiddleware docs for App Router.
  matcher: [
    "/((?!_next|[^?]*\\.(?:html?|css|js(?!on)|jpe?g|webp|png|gif|svg|ttf|woff2?|ico|csv|docx?|xlsx?|zip|webmanifest)).*)",
    "/(api|trpc)(.*)",
  ],
};
