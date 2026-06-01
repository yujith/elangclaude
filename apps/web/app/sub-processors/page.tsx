import type { Metadata } from "next";
import { A, DataTable, H2, LegalShell, P } from "@/components/legal/legal-shell";
import { POLICIES } from "@/lib/legal/policies";

const meta = POLICIES["sub-processors"];

export const metadata: Metadata = { title: meta.title, description: meta.summary };

// Keep this list in lockstep with the actual vendors in use. Adding or
// removing a sub-processor is a material change — bump the version in
// lib/legal/policies.ts and, for organisation customers, give notice per the
// DPA. See docs/compliance/sub-processors.md for the canonical record.
const SUBPROCESSORS: Array<[string, string, string]> = [
  ["Vercel", "Application hosting and delivery", "United States / global edge"],
  ["Neon (Postgres)", "Primary database", "Sydney, Australia"],
  ["Clerk", "Authentication and identity", "United States"],
  ["Stripe", "Payments and billing", "United States / global"],
  ["Cloudflare R2", "Speaking recording storage", "Global object storage"],
  ["OpenAI", "Speaking realtime conversation, transcription, some grading", "United States"],
  ["Anthropic", "Writing and Speaking grading", "United States"],
  ["OpenRouter", "Reading/Listening/Writing test generation", "United States"],
  ["ElevenLabs", "Listening audio (text-to-speech)", "United States"],
  ["Resend", "Transactional and (opt-in) marketing email", "United States"],
  ["Sentry", "Error monitoring (consent-gated)", "United States"],
  ["PostHog", "Product analytics (consent-gated)", "European Union / United States"],
];

export default function SubProcessorsPage() {
  return (
    <LegalShell title={meta.title} effectiveDate={meta.effectiveDate} version={meta.version}>
      <P>
        To deliver eLanguage Center we rely on the trusted third parties below.
        Each processes personal data only on our instructions and under a data
        processing agreement with appropriate safeguards. Analytics and error
        monitoring run only where you have given consent.
      </P>

      <DataTable
        caption="Sub-processors and what they handle"
        head={["Sub-processor", "What they do", "Processing location"]}
        rows={SUBPROCESSORS.map((row) => [row[0], row[1], row[2]])}
      />

      <H2 id="notice">Changes and notice</H2>
      <P>
        When we add or replace a sub-processor we update this page and bump its
        version. Organisation customers receive advance notice as set out in our{" "}
        <A href="/dpa">Data Processing Addendum</A> and may object on reasonable
        data-protection grounds.
      </P>

      <H2 id="contact">Contact</H2>
      <P>
        For the safeguards covering any sub-processor, email{" "}
        <A href="mailto:privacy@elanguagecenter.com">privacy@elanguagecenter.com</A>.
      </P>
    </LegalShell>
  );
}
