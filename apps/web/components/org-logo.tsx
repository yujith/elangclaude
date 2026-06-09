// Org-aware logo for the learner/admin chrome (ADR-0023).
//
// Falls back to the platform <Logo> when the org hasn't uploaded one.
// An uploaded logo always renders on a white plate: org logos arrive in
// arbitrary colours (including dark-on-transparent), and the plate is the
// only way to guarantee visibility on the dark header for every possible
// upload — the same rule docs/BRAND.md applies to our own wordmark on busy
// backgrounds.

import { Logo } from "@/components/logo";
import { getOrgLogoSrc } from "@/lib/branding/org-theme";

type Props = {
  height?: number;
};

export async function OrgLogo({ height = 40 }: Props) {
  const src = await getOrgLogoSrc();
  if (!src) return <Logo variant="on-dark" height={height} />;
  return (
    <span
      className="inline-flex items-center rounded-md bg-white px-2 py-1"
      style={{ height }}
    >
      {/* eslint-disable-next-line @next/next/no-img-element -- served via a
          signed-URL redirect with unknown intrinsic dimensions; next/image
          can't size or optimise it. */}
      <img
        src={src}
        alt="Organisation logo"
        className="h-full w-auto max-w-48 object-contain"
      />
    </span>
  );
}
