import type { Metadata } from "next";
import { A, H2, LI, LegalShell, P, UL } from "@/components/legal/legal-shell";
import { POLICIES } from "@/lib/legal/policies";
import { OPERATING_ENTITY } from "@/lib/legal/entity";

const meta = POLICIES.terms;

export const metadata: Metadata = { title: meta.title, description: meta.summary };

export default function TermsPage() {
  return (
    <LegalShell title={meta.title} effectiveDate={meta.effectiveDate} version={meta.version}>
      <P>
        These Terms of Service (&ldquo;Terms&rdquo;) govern your use of
        eLanguage Center, which is operated by{" "}
        <strong>{OPERATING_ENTITY.legalName}</strong> (ABN{" "}
        {OPERATING_ENTITY.abn}), a sole trader trading as{" "}
        <A href={OPERATING_ENTITY.tradingUrl}>{OPERATING_ENTITY.tradingAs}</A>{" "}
        (&ldquo;we&rdquo;, &ldquo;us&rdquo;). By creating an account or using
        the service you agree to these Terms and to our{" "}
        <A href="/privacy">Privacy Policy</A>. If you use eLanguage Center on
        behalf of an organisation, you accept these Terms for that organisation.
      </P>

      <H2 id="service">1. The service</H2>
      <P>
        eLanguage Center provides AI-generated IELTS practice across Reading,
        Listening, Writing and Speaking, with AI-generated grading and feedback.
        Scores and feedback are practice estimates to help you prepare. They are
        not official IELTS results and are not a guarantee of any examination
        outcome.
      </P>

      <H2 id="accounts">2. Your account</H2>
      <UL>
        <LI>You must provide accurate information and keep your credentials secure.</LI>
        <LI>You are responsible for activity under your account.</LI>
        <LI>
          Learners under 18 may use the service only with verifiable parent or
          guardian consent.
        </LI>
        <LI>
          Access may be provided and administered by an organisation, which may
          add or remove your access.
        </LI>
      </UL>

      <H2 id="acceptable-use">3. Acceptable use</H2>
      <P>You agree not to:</P>
      <UL>
        <LI>Copy, scrape, resell or redistribute test content or AI outputs.</LI>
        <LI>Attempt to access other users&rsquo; or organisations&rsquo; data.</LI>
        <LI>Reverse engineer, overload, or disrupt the service.</LI>
        <LI>Upload unlawful content or use the service to break any law.</LI>
        <LI>Misuse the Speaking feature to record people without their consent.</LI>
      </UL>

      <H2 id="ip">4. Intellectual property</H2>
      <P>
        eLanguage Center and its content, branding and software are owned by us
        or our licensors. You retain ownership of the content you submit (such
        as your written and spoken responses) and grant us a licence to process
        it to provide and improve the service, as described in the Privacy
        Policy.
      </P>

      <H2 id="billing">5. Subscriptions and billing</H2>
      <P>
        Paid plans are billed through our payment processor on the cycle shown
        at checkout, including any free-trial period. Organisations are billed
        per their plan. You can manage or cancel a subscription through the
        billing portal; charges already incurred are non-refundable except where
        required by law.
      </P>

      <H2 id="termination">6. Suspension and termination</H2>
      <P>
        We may suspend or terminate access for breach of these Terms, non-payment,
        or to comply with law. You may stop using the service at any time and may
        request erasure of your data from your <A href="/profile">profile</A>.
      </P>

      <H2 id="disclaimers">7. Disclaimers and liability</H2>
      <P>
        The service is provided &ldquo;as is&rdquo;. To the extent permitted by
        law, we exclude implied warranties and our liability is limited to the
        amount you paid us in the 12 months before the claim. Nothing in these
        Terms limits liability that cannot be limited by law, including your
        rights as a consumer.
      </P>

      <H2 id="law">8. Governing law and disputes</H2>
      <P>
        These Terms are governed by the laws of {OPERATING_ENTITY.jurisdiction},
        without affecting mandatory consumer protections in your country of
        residence. We aim to resolve disputes informally first &mdash; contact
        us.
      </P>

      <H2 id="changes">9. Changes</H2>
      <P>
        We may update these Terms; we will update the version and effective date
        above and, for material changes, notify you. Continued use after changes
        means you accept them.
      </P>

      <H2 id="contact">10. Contact</H2>
      <P>
        Questions? Email{" "}
        <A href="mailto:hello@elanguagecenter.com">hello@elanguagecenter.com</A>.
      </P>
    </LegalShell>
  );
}
