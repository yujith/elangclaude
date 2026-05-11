import { BrandIcon } from "./brand-icon";

type Reason = {
  title: string;
  body: string;
};

const reasons: Reason[] = [
  {
    title: "Conversational Speaking, not record-and-grade",
    body: "Real back-and-forth with an AI examiner across all three Speaking parts. The way the actual exam works — not a one-way recording.",
  },
  {
    title: "Calibrated against the real rubrics",
    body: "Writing and Speaking are scored on the four official IELTS criteria. Feedback says exactly which criterion lost the band, not just a number.",
  },
  {
    title: "Academic and General Training, one engine",
    body: "Switch tracks any time. The right Task 1 for your goal, the right Reading sources, no second account, no second subscription.",
  },
];

export function WhyUs() {
  return (
    <section id="why" className="bg-brand-white">
      <div className="mx-auto max-w-7xl px-6 py-20 md:py-24">
        <div className="max-w-3xl">
          <p className="font-heading font-bold text-sm tracking-[0.2em] text-brand-red">
            WHY ELANGUAGE CENTER
          </p>
          <h2 className="mt-3 font-heading font-bold text-3xl md:text-4xl text-brand-black">
            Built specifically for IELTS, end to end.
          </h2>
        </div>
        <ul className="mt-12 grid gap-8 md:grid-cols-3">
          {reasons.map((reason) => (
            <li key={reason.title} className="flex flex-col gap-4">
              <BrandIcon size={36} className="text-brand-red" />
              <h3 className="font-heading font-bold text-xl text-brand-black">
                {reason.title}
              </h3>
              <p className="font-body text-base text-brand-grey-700">
                {reason.body}
              </p>
            </li>
          ))}
        </ul>
      </div>
    </section>
  );
}
