type Step = {
  number: string;
  title: string;
  body: string;
};

const steps: Step[] = [
  {
    number: "01",
    title: "Pick your track",
    body: "Academic if you're going to university or registering for a profession. General Training if you're migrating, working, or finishing secondary school.",
  },
  {
    number: "02",
    title: "Practise a section or take a full mock",
    body: "Drop into Reading whenever you have time. Run a timed four-section simulation when you're ready to feel exam-day pressure.",
  },
  {
    number: "03",
    title: "AI grades and explains",
    body: "Auto-grading on Reading and Listening. Criterion-by-criterion feedback on Writing and Speaking, calibrated to the official rubrics.",
  },
  {
    number: "04",
    title: "Watch your bands climb",
    body: "Trend per section, weak-area drilldowns, and the next test recommended for the criterion you're losing marks on.",
  },
];

export function HowItWorks() {
  return (
    <section id="how" className="bg-brand-black text-white">
      <div className="mx-auto max-w-7xl px-6 py-20 md:py-24">
        <div className="max-w-3xl">
          <p className="font-heading font-bold text-sm tracking-[0.2em] text-brand-red">
            HOW IT WORKS
          </p>
          <h2 className="mt-3 font-heading font-bold text-3xl md:text-4xl">
            From first practice to your target band.
          </h2>
        </div>
        <ol className="mt-12 grid gap-10 md:grid-cols-2 lg:grid-cols-4">
          {steps.map((step) => (
            <li key={step.number} className="flex flex-col gap-3">
              <span className="font-display italic font-bold text-5xl text-brand-red leading-none">
                {step.number}
              </span>
              <h3 className="font-heading font-bold text-xl">{step.title}</h3>
              <p className="font-body text-base text-brand-grey-200">
                {step.body}
              </p>
            </li>
          ))}
        </ol>
      </div>
    </section>
  );
}
