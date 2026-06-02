export const CLERK_INVITATION_BASE_URL = "https://www.elanguagecenter.com";

type ResolveOptions = {
  allowCustomBaseUrl?: boolean;
};

export function buildClerkInvitationRedirectUrl(
  rawAppUrl: string | undefined,
  options: ResolveOptions = {},
): string {
  const baseUrl = resolveClerkInvitationBaseUrl(rawAppUrl, options);
  return `${baseUrl}/sign-up`;
}

export function resolveClerkInvitationBaseUrl(
  rawAppUrl: string | undefined,
  options: ResolveOptions = {},
): string {
  const raw = rawAppUrl?.trim();
  if (!raw) return CLERK_INVITATION_BASE_URL;

  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    return CLERK_INVITATION_BASE_URL;
  }

  if (!options.allowCustomBaseUrl && !isCanonicalHost(url.hostname)) {
    return CLERK_INVITATION_BASE_URL;
  }

  if (url.hostname === "elanguagecenter.com") {
    url.hostname = "www.elanguagecenter.com";
  }
  if (isCanonicalHost(url.hostname)) {
    url.protocol = "https:";
  }

  url.search = "";
  url.hash = "";
  url.pathname = stripTrailingSlashes(url.pathname);
  return url.toString().replace(/\/$/, "");
}

function isCanonicalHost(hostname: string): boolean {
  return hostname === "www.elanguagecenter.com" || hostname === "elanguagecenter.com";
}

function stripTrailingSlashes(pathname: string): string {
  const stripped = pathname.replace(/\/+$/, "");
  return stripped.length === 0 ? "/" : stripped;
}
