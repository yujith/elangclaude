import { TopNav } from "@/components/top-nav";
import { Hero } from "@/components/hero";
import { IntroStrip } from "@/components/intro-strip";
import { SectionCards } from "@/components/section-cards";
import { WhyUs } from "@/components/why-us";
import { HowItWorks } from "@/components/how-it-works";
import { ForOrgs } from "@/components/for-orgs";
import { PricingTeaser } from "@/components/pricing-teaser";
import { Faq } from "@/components/faq";
import { CtaStrip } from "@/components/cta-strip";
import { SiteFooter } from "@/components/site-footer";

export default function Home() {
  return (
    <>
      <TopNav />
      <main id="main" className="flex-1">
        <Hero />
        <IntroStrip />
        <SectionCards />
        <WhyUs />
        <HowItWorks />
        <ForOrgs />
        <PricingTeaser />
        <Faq />
        <CtaStrip />
      </main>
      <SiteFooter />
    </>
  );
}
