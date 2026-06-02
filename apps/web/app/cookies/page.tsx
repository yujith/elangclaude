import type { Metadata } from "next";
import {
  A,
  DataTable,
  H2,
  LegalShell,
  P,
} from "@/components/legal/legal-shell";
import { CookiePreferencesButton } from "@/components/consent/cookie-preferences-button";
import { POLICIES } from "@/lib/legal/policies";

const meta = POLICIES.cookies;

export const metadata: Metadata = { title: meta.title, description: meta.summary };

export default function CookiesPage() {
  return (
    <LegalShell title={meta.title} effectiveDate={meta.effectiveDate} version={meta.version}>
      <P>
        Cookies and similar technologies let eLanguage Center sign you in,
        remember your choices, and &mdash; only with your consent &mdash;
        understand how the product is used. This policy explains the categories
        we use and how to control them.
      </P>

      <H2 id="categories">Categories we use</H2>
      <DataTable
        caption="Cookie categories"
        head={["Category", "Purpose", "Consent needed?"]}
        rows={[
          [
            "Strictly necessary",
            "Sign-in, session security, billing, load balancing. The service cannot work without these.",
            "No (exempt)",
          ],
          [
            "Functional",
            "Remember preferences such as your IELTS track and consent choices.",
            "Yes",
          ],
          [
            "Analytics",
            "Understand feature usage and errors so we can improve the product.",
            "Yes",
          ],
        ]}
      />

      <H2 id="control">Controlling cookies</H2>
      <P>
        When you first visit, we ask for your choice before setting any
        non-essential cookie. You can change your mind at any time:
      </P>
      <P>
        <CookiePreferencesButton />
      </P>
      <P>
        You can also block or delete cookies in your browser settings, though
        strictly necessary cookies are required to sign in. Withdrawing consent
        does not affect data already collected.
      </P>

      <H2 id="more">More information</H2>
      <P>
        For what we do with the data these technologies collect, see our{" "}
        <A href="/privacy">Privacy Policy</A>. The third parties that may set
        cookies are listed on our <A href="/sub-processors">Sub-processors</A>{" "}
        page.
      </P>
    </LegalShell>
  );
}
