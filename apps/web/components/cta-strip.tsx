import { CtaLink } from "./cta-link";

export function CtaStrip() {
  return (
    <section className="bg-brand-black text-white">
      <div className="mx-auto max-w-7xl px-6 py-24 md:py-32 flex flex-col items-center text-center gap-8">
        <h2 className="font-display italic font-bold text-4xl sm:text-5xl md:text-6xl leading-[1.05] tracking-tight max-w-3xl">
          SKILLS THAT
          <br className="sm:hidden" /> OPEN DOORWAYS.
        </h2>
        <p className="font-heading font-bold text-base md:text-lg tracking-[0.25em]">
          FREE <span className="text-brand-red">.</span> FUN{" "}
          <span className="text-brand-red">.</span> EFFECTIVE
        </p>
        <CtaLink href="/sign-up" variant="solid">
          Register now
        </CtaLink>
      </div>
    </section>
  );
}
