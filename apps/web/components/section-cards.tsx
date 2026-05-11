type Card = {
  name: string;
  body: string;
  detail: string;
};

const cards: Card[] = [
  {
    name: "Reading",
    body: "Skim, scan, and tackle MCQ, T/F/NG, matching headings, and sentence completion across academic and everyday passages.",
    detail: "Auto-graded the moment you submit.",
  },
  {
    name: "Listening",
    body: "TTS-rendered passages across multiple native accents, with form completion and the question types you’ll see on test day.",
    detail: "Auto-graded.",
  },
  {
    name: "Writing",
    body: "Task 1 (chart for Academic, letter for General Training) and Task 2 essay, marked by Claude Sonnet on the four official criteria.",
    detail: "Criterion-level feedback per submission.",
  },
  {
    name: "Speaking",
    body: "A real conversation with an AI examiner across all three Speaking parts. Recorded, transcribed, and graded.",
    detail: "Fluency · Lexis · Grammar · Pronunciation.",
  },
];

export function SectionCards() {
  return (
    <section id="sections" className="bg-brand-grey-50">
      <div className="mx-auto max-w-7xl px-6 py-20 md:py-24">
        <div className="max-w-3xl">
          <p className="font-heading font-bold text-sm tracking-[0.2em] text-brand-red">
            FOUR SECTIONS
          </p>
          <h2 className="mt-3 font-heading font-bold text-3xl md:text-4xl text-brand-black">
            Practise the way you’ll be tested.
          </h2>
          <p className="mt-4 font-body text-base md:text-lg text-brand-grey-700">
            Section practice whenever you have ten minutes. Full timed mocks
            when you’re ready to simulate the exam. Same engine for both
            Academic and General Training.
          </p>
        </div>
        <ul className="mt-12 grid gap-6 sm:grid-cols-2 lg:grid-cols-4">
          {cards.map((card) => (
            <li
              key={card.name}
              className="flex flex-col gap-4 rounded-lg bg-brand-white p-6 ring-1 ring-brand-grey-200"
            >
              <h3 className="font-heading font-bold text-xl text-brand-black">
                {card.name}
              </h3>
              <p className="font-body text-base text-brand-grey-700">
                {card.body}
              </p>
              <p className="mt-auto font-body font-medium text-sm text-brand-grey-500">
                {card.detail}
              </p>
              <div className="flex flex-wrap gap-2 pt-2">
                <span className="rounded-pill border border-brand-grey-200 px-3 py-1 font-heading font-bold text-xs uppercase tracking-wider text-brand-grey-700">
                  Academic
                </span>
                <span className="rounded-pill border border-brand-grey-200 px-3 py-1 font-heading font-bold text-xs uppercase tracking-wider text-brand-grey-700">
                  General Training
                </span>
              </div>
            </li>
          ))}
        </ul>
      </div>
    </section>
  );
}
