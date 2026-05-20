import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { SESSION_COOKIE } from "@/lib/auth/session-cookie";

const PROTECTED_PREFIXES = ["/content", "/practice", "/admin"] as const;

export function middleware(request: NextRequest) {
  const { pathname, search } = request.nextUrl;
  const fullPath = pathname + search;

  const requestHeaders = new Headers(request.headers);
  requestHeaders.set("x-elc-pathname", fullPath);

  // Dev auth only — production will use Clerk on these routes later.
  if (process.env.NODE_ENV !== "production") {
    const needsAuth = PROTECTED_PREFIXES.some(
      (prefix) => pathname === prefix || pathname.startsWith(`${prefix}/`),
    );
    const hasSession = Boolean(request.cookies.get(SESSION_COOKIE)?.value);

    if (needsAuth && !hasSession) {
      const login = new URL("/dev/login", request.url);
      login.searchParams.set("to", fullPath);
      return NextResponse.redirect(login, 307);
    }
  }

  return NextResponse.next({ request: { headers: requestHeaders } });
}

export const config = {
  matcher: ["/content/:path*", "/practice/:path*", "/admin/:path*"],
};
