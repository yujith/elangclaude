import { CtaLink } from "./cta-link";

export function Hero() {
  return (
    <section id="top" className="bg-brand-black text-white">
      <div className="mx-auto max-w-7xl px-6 py-24 md:py-36 lg:py-44 flex flex-col items-start gap-10 md:gap-12">
        <h1 className="font-display italic font-bold text-5xl sm:text-6xl md:text-7xl lg:text-8xl leading-[1.05] tracking-tight max-w-4xl">
          SKILLS THAT
          <br />
          OPEN DOORWAYS
        </h1>
        <p className="font-heading font-bold text-base md:text-lg tracking-[0.25em]">
          FREE <span className="text-brand-red">.</span> FUN{" "}
          <span className="text-brand-red">.</span> EFFECTIVE
        </p>
        <CtaLink href="/sign-up" variant="outlined">
          REGISTER NOW
        </CtaLink>
      </div>
    </section>
  );
}
