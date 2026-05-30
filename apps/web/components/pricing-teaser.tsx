import { CtaLink } from "./cta-link";

const ORG_EMAIL = "hello@elanguagecenter.com";

export function PricingTeaser() {
  return (
    <section id="pricing" className="bg-brand-grey-50">
      <div className="mx-auto max-w-5xl px-6 py-20 md:py-24">
        <div className="rounded-lg bg-brand-white p-10 md:p-14 ring-1 ring-brand-grey-200 text-center">
          <p className="font-heading font-bold text-sm tracking-[0.2em] text-brand-red">
            PRICING
          </p>
          <h2 className="mt-3 font-heading font-bold text-3xl md:text-4xl text-brand-black">
            Free to start. Paid tiers when you're ready to scale.
          </h2>
          <p className="mt-4 mx-auto max-w-2xl font-body text-base md:text-lg text-brand-grey-700">
            Per-seat plans for organisations. AI quotas you control, no
            per-attempt billing surprises. Start free, upgrade any time —
            a 14-day trial on every paid tier.
          </p>
          <div className="mt-8 flex flex-col sm:flex-row items-center justify-center gap-4">
            <CtaLink href="/pricing" variant="solid">
              See plans
            </CtaLink>
            <a
              href={`mailto:${ORG_EMAIL}?subject=eLanguage%20Center%20pricing`}
              className="font-heading font-bold text-brand-black underline-offset-4 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-red focus-visible:ring-offset-2 rounded-sm px-1"
            >
              Talk to sales →
            </a>
          </div>
        </div>
      </div>
    </section>
  );
}
