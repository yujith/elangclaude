import type { Metadata } from "next";
import {
  A,
  DataTable,
  H2,
  H3,
  LI,
  LegalShell,
  P,
  UL,
} from "@/components/legal/legal-shell";
import { POLICIES } from "@/lib/legal/policies";
import { OPERATING_ENTITY } from "@/lib/legal/entity";

const meta = POLICIES.privacy;

export const metadata: Metadata = {
  title: meta.title,
  description: meta.summary,
};

export default function PrivacyPage() {
  return (
    <LegalShell title={meta.title} effectiveDate={meta.effectiveDate} version={meta.version}>
      <P>
        eLanguage Center (&ldquo;eLanguage Center&rdquo;, &ldquo;we&rdquo;,
        &ldquo;us&rdquo;) provides an online IELTS preparation platform. This
        Privacy Policy explains what personal data we collect, why we collect
        it, how long we keep it, who we share it with, and the rights you have.
        It is written to meet the EU and UK General Data Protection Regulations
        (GDPR), Australia&rsquo;s Privacy Act 1988 and Australian Privacy
        Principles (APPs), India&rsquo;s Digital Personal Data Protection Act
        2023 (DPDP), Sri Lanka&rsquo;s Personal Data Protection Act 2022, and
        the data protection laws of Singapore, Malaysia, Thailand, Indonesia,
        the Philippines and Vietnam.
      </P>

      <H2 id="controller">1. Who is responsible for your data</H2>
      <P>
        eLanguage Center is operated by{" "}
        <A href={OPERATING_ENTITY.tradingUrl}>{OPERATING_ENTITY.tradingAs}</A>{" "}
        (ABN {OPERATING_ENTITY.abn}), a sole trader based in{" "}
        {OPERATING_ENTITY.jurisdiction}. References to
        &ldquo;eLanguage Center&rdquo;, &ldquo;we&rdquo;, &ldquo;us&rdquo; and
        &ldquo;our&rdquo; mean that operator.
      </P>
      <P>
        If you signed up for eLanguage Center yourself (an individual account),
        eLanguage Center is the <strong>data controller</strong> of your
        personal data.
      </P>
      <P>
        If you access eLanguage Center through an organisation &mdash; a
        language school, migration agency, employer or institution that
        purchased seats &mdash; that organisation is the{" "}
        <strong>data controller</strong> and eLanguage Center acts as a{" "}
        <strong>data processor</strong> on its behalf. In that case your
        organisation&rsquo;s own privacy notice also applies, and requests about
        your data may be routed through them. The terms governing that
        relationship are in our <A href="/dpa">Data Processing Addendum</A>.
      </P>

      <H2 id="data-we-collect">2. What data we collect</H2>
      <UL>
        <LI>
          <strong>Account data</strong> &mdash; your name, email address, role,
          IELTS track preference, and (via our auth provider) sign-in
          credentials.
        </LI>
        <LI>
          <strong>Practice and performance data</strong> &mdash; your test
          attempts, answers, AI-generated band scores, and written feedback.
        </LI>
        <LI>
          <strong>Speaking recordings</strong> &mdash; audio of your responses
          during Speaking practice, and their transcripts. Voice recordings can
          identify you and are treated as sensitive data; we ask for your
          consent before recording.
        </LI>
        <LI>
          <strong>Usage and device data</strong> &mdash; pages viewed, features
          used, approximate location derived from IP, browser and device type.
          Non-essential analytics are only collected with your consent (see our{" "}
          <A href="/cookies">Cookie Policy</A>).
        </LI>
        <LI>
          <strong>Billing data</strong> &mdash; for organisations and
          individual subscribers, subscription status and payment metadata
          handled by our payment processor. We do not store full card numbers.
        </LI>
      </UL>
      <P>
        We do not knowingly collect more than we need. We store a coarse age
        band rather than your full date of birth, and a salted hash of your IP
        address rather than the address itself.
      </P>

      <H2 id="purposes">3. Why we use it and our legal basis</H2>
      <DataTable
        caption="Purposes and legal bases for processing"
        head={["Purpose", "Legal basis (GDPR Art. 6)"]}
        rows={[
          ["Provide the service, your account, and practice content", "Contract"],
          ["Generate and grade tests with AI; produce feedback", "Contract / legitimate interests"],
          ["Record and assess Speaking responses", "Consent"],
          ["Product analytics and improvement", "Consent"],
          ["Marketing emails (where you opt in)", "Consent"],
          ["Billing, fraud prevention, security, and legal compliance", "Legal obligation / legitimate interests"],
        ]}
      />
      <P>
        Where we rely on consent, you can withdraw it at any time without
        affecting prior processing. Where we rely on legitimate interests, we
        have balanced those against your rights and you may object.
      </P>

      <H2 id="ai">4. AI processing</H2>
      <P>
        We use AI to generate practice tests, grade your answers, transcribe
        Speaking audio, and produce a conversational Speaking examiner. Grading
        and feedback are automated. These outcomes are practice estimates, not
        official IELTS results, and you can contact us if you believe a score
        is wrong. We send only the data needed for each task to our AI
        sub-processors, who are contractually barred from training their models
        on it.
      </P>

      <H2 id="retention">5. How long we keep it</H2>
      <UL>
        <LI>Account data: for the life of your account, then deleted or anonymised.</LI>
        <LI>
          Speaking recordings: <strong>90 days by default</strong>, after which
          they are automatically purged. Organisations may configure a
          different period.
        </LI>
        <LI>Practice and performance data: while your account is active, to show your progress.</LI>
        <LI>Billing records: as required by tax and accounting law.</LI>
        <LI>Consent and erasure records: retained as proof that we honoured your choices.</LI>
      </UL>

      <H2 id="sharing">6. Who we share it with</H2>
      <P>
        We share data with the sub-processors that power the service &mdash;
        hosting, authentication, payments, AI, storage, email and analytics.
        Each is listed, with what they handle, on our{" "}
        <A href="/sub-processors">Sub-processors</A> page. We do not sell your
        personal data. We may disclose data where legally required.
      </P>

      <H2 id="transfers">7. International transfers</H2>
      <P>
        Your data is hosted in <strong>Sydney, Australia</strong>. If you are in
        the EEA, the UK, or another region with transfer rules, your data is
        transferred under appropriate safeguards &mdash; Standard Contractual
        Clauses (and the UK Addendum), or an adequacy decision where one
        applies. Some sub-processors may process data in other countries under
        the same safeguards. Contact us for a copy of the relevant safeguards.
      </P>

      <H2 id="your-rights">8. Your rights</H2>
      <P>Depending on where you live, you have the right to:</P>
      <UL>
        <LI><strong>Access</strong> a copy of the data we hold about you.</LI>
        <LI><strong>Portability</strong> &mdash; receive it in a machine-readable format.</LI>
        <LI><strong>Rectification</strong> &mdash; correct inaccurate data.</LI>
        <LI><strong>Erasure</strong> &mdash; have your data deleted (&ldquo;right to be forgotten&rdquo;).</LI>
        <LI><strong>Restriction and objection</strong> to certain processing.</LI>
        <LI><strong>Withdraw consent</strong> at any time.</LI>
        <LI><strong>Complain</strong> to your local data protection authority.</LI>
      </UL>
      <P>
        Signed-in learners can exercise access, portability, rectification and
        erasure directly from their <A href="/profile">profile</A>. You can also
        email <A href="mailto:privacy@elanguagecenter.com">privacy@elanguagecenter.com</A>.
        We respond within the timeframe your law requires (one month under the
        GDPR). If your account is provided by an organisation, we may ask that
        organisation to confirm or fulfil the request.
      </P>

      <H2 id="minors">9. Children and minors</H2>
      <P>
        Learners under the age of 18 may use eLanguage Center only with
        verifiable consent from a parent or guardian, as required by India&rsquo;s
        DPDP Act and the GDPR. Where a learner indicates they are a minor, we
        collect a guardian&rsquo;s email and require guardian consent before
        practice begins, and we do not direct marketing at them. If you believe
        a child has provided data without guardian consent, contact us and we
        will remove it.
      </P>

      <H2 id="security">10. Security</H2>
      <P>
        We protect your data with encryption in transit, access controls,
        strict tenant isolation between organisations, signed time-limited URLs
        for recordings, and least-privilege access for staff. No system is
        perfectly secure; if a breach affects your rights we will notify you and
        the relevant authority within the timeframes the law requires (for
        example, 72 hours under the GDPR and without undue delay under
        Australia&rsquo;s Notifiable Data Breaches scheme).
      </P>

      <H2 id="regional">11. Region-specific information</H2>
      <H3>EEA and UK</H3>
      <P>
        Our lead supervisory contact is{" "}
        <A href="mailto:privacy@elanguagecenter.com">privacy@elanguagecenter.com</A>.
        You may lodge a complaint with your national Data Protection Authority
        or the UK ICO.
      </P>
      <H3>Australia</H3>
      <P>
        We handle personal information in line with the Australian Privacy
        Principles. You may complain to the Office of the Australian Information
        Commissioner (OAIC).
      </P>
      <H3>India (DPDP Act 2023)</H3>
      <P>
        You may contact our Grievance Officer at{" "}
        <A href="mailto:privacy@elanguagecenter.com">privacy@elanguagecenter.com</A>{" "}
        to exercise your rights as a Data Principal, including nomination and
        grievance redressal.
      </P>
      <H3>Sri Lanka, Singapore, Malaysia, Thailand, Indonesia, Philippines, Vietnam</H3>
      <P>
        We comply with the applicable Personal Data Protection Act / law in each
        jurisdiction, including consent, purpose limitation, and your rights of
        access and correction. You may contact us, or your local data protection
        authority, with any concern.
      </P>

      <H2 id="changes">12. Changes to this policy</H2>
      <P>
        We may update this policy. We will change the version and effective date
        above and, for material changes, ask you to review and (where required)
        re-consent.
      </P>

      <H2 id="contact">13. Contact</H2>
      <P>
        Email <A href="mailto:privacy@elanguagecenter.com">privacy@elanguagecenter.com</A>{" "}
        for any privacy question or to exercise your rights.
      </P>
    </LegalShell>
  );
}
