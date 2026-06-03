import type { Metadata } from "next";
import { A, H2, LI, LegalShell, P, UL } from "@/components/legal/legal-shell";
import { POLICIES } from "@/lib/legal/policies";
import { OPERATING_ENTITY } from "@/lib/legal/entity";

const meta = POLICIES.dpa;

export const metadata: Metadata = { title: meta.title, description: meta.summary };

export default function DpaPage() {
  return (
    <LegalShell title={meta.title} effectiveDate={meta.effectiveDate} version={meta.version}>
      <P>
        This Data Processing Addendum (&ldquo;DPA&rdquo;) applies where an
        organisation (the &ldquo;Customer&rdquo;) uses eLanguage Center to
        process personal data of its learners. It forms part of the agreement
        between the Customer and {OPERATING_ENTITY.legalName} (ABN{" "}
        {OPERATING_ENTITY.abn}), a sole trader trading as{" "}
        {OPERATING_ENTITY.tradingAs}, which operates eLanguage Center. The
        Customer is the <strong>controller</strong>; eLanguage Center is the{" "}
        <strong>processor</strong>. Individual self-serve users are covered by
        the <A href="/privacy">Privacy Policy</A> instead, where eLanguage Center
        is the controller.
      </P>

      <H2 id="scope">1. Scope and roles</H2>
      <P>
        eLanguage Center processes Customer personal data only to provide the
        service and only on the Customer&rsquo;s documented instructions
        (including this DPA and the product configuration). The subject matter
        is IELTS preparation; the data subjects are the Customer&rsquo;s
        learners and administrators; the data types are listed in the Privacy
        Policy.
      </P>

      <H2 id="obligations">2. Our obligations as processor</H2>
      <UL>
        <LI>Process personal data only on the Customer&rsquo;s instructions.</LI>
        <LI>Ensure personnel are bound by confidentiality.</LI>
        <LI>Implement appropriate technical and organisational security measures.</LI>
        <LI>
          Assist the Customer with data-subject requests, security, breach
          notification, and impact assessments.
        </LI>
        <LI>
          Delete or return Customer personal data at the end of the service,
          subject to legal retention.
        </LI>
        <LI>Make available the information needed to demonstrate compliance.</LI>
      </UL>

      <H2 id="sub-processors">3. Sub-processors</H2>
      <P>
        The Customer authorises the sub-processors listed on our{" "}
        <A href="/sub-processors">Sub-processors</A> page. We impose data
        protection terms on each that are no less protective than this DPA, and
        we give notice of changes so the Customer can object on reasonable
        grounds.
      </P>

      <H2 id="transfers">4. International transfers</H2>
      <P>
        Customer personal data is hosted in Sydney, Australia. Where transfers
        are subject to the GDPR, UK GDPR, or similar rules, they are made under
        Standard Contractual Clauses, the UK Addendum, or an adequacy decision,
        as applicable.
      </P>

      <H2 id="breach">5. Breach notification</H2>
      <P>
        We notify the Customer without undue delay after becoming aware of a
        personal data breach affecting Customer data, with the information the
        Customer needs to meet its own notification duties (for example, the
        GDPR&rsquo;s 72-hour rule and Australia&rsquo;s Notifiable Data Breaches
        scheme).
      </P>

      <H2 id="dsr">6. Data-subject requests</H2>
      <P>
        Where a learner contacts us directly, we will refer the request to the
        Customer unless legally required to act, and assist the Customer in
        responding. Learners can also self-serve access, portability,
        rectification and erasure from their profile.
      </P>

      <H2 id="audit">7. Audit</H2>
      <P>
        On reasonable notice and subject to confidentiality, we make available
        records demonstrating compliance and allow audits as required by
        applicable law.
      </P>

      <H2 id="accept">8. Accepting this DPA</H2>
      <P>
        Organisation customers can accept this DPA as part of onboarding or
        request a countersigned copy by emailing{" "}
        <A href="mailto:privacy@elanguagecenter.com">privacy@elanguagecenter.com</A>.
      </P>
    </LegalShell>
  );
}
