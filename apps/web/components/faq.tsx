type Item = {
  q: string;
  a: string;
};

const items: Item[] = [
  {
    q: "What's the difference between Academic and General Training?",
    a: "Academic is for university admission and professional registration. General Training is for migration, working, and secondary education. Listening and Speaking are identical across both tracks. Reading sources differ (academic vs. workplace and everyday text), and Writing Task 1 is a chart description in Academic but a letter in General Training.",
  },
  {
    q: "Is everything AI-graded?",
    a: "Reading and Listening are auto-graded against the answer key — deterministic, no AI involved. Writing and Speaking are graded by Claude Sonnet against the four official IELTS criteria, with criterion-level feedback rather than a single number.",
  },
  {
    q: "Can a human review my Writing or Speaking?",
    a: "Human review is on the Phase 2 roadmap. Until it ships, your Speaking recordings are stored so a reviewer can later upgrade the AI grade if your organization opts in.",
  },
  {
    q: "Where are my Speaking recordings stored?",
    a: "In Cloudflare R2, scoped to your organization, accessible only via short-lived signed URLs. Default retention is 90 days; your organization admin can extend or shorten that.",
  },
  {
    q: "What happens if I hit my AI quota mid-test?",
    a: "You finish the current test — quotas don't yank work in progress. New tests are blocked until your quota resets at midnight UTC.",
  },
  {
    q: "Can I delete my data?",
    a: "Yes. The delete-user endpoint cascades to your recordings, attempts, grades, and quotas. GDPR-ready by default.",
  },
];

export function Faq() {
  return (
    <section id="faq" className="bg-brand-white">
      <div className="mx-auto max-w-4xl px-6 py-20 md:py-24">
        <div className="max-w-3xl">
          <p className="font-heading font-bold text-sm tracking-[0.2em] text-brand-red">
            FAQ
          </p>
          <h2 className="mt-3 font-heading font-bold text-3xl md:text-4xl text-brand-black">
            Quick answers.
          </h2>
        </div>
        <ul className="mt-10 divide-y divide-brand-grey-200 border-y border-brand-grey-200">
          {items.map((item) => (
            <li key={item.q}>
              <details className="group py-5">
                <summary className="flex cursor-pointer items-start justify-between gap-6 font-heading font-bold text-lg text-brand-black list-none [&::-webkit-details-marker]:hidden focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-red focus-visible:ring-offset-2 rounded-sm">
                  <span>{item.q}</span>
                  <span
                    aria-hidden
                    className="mt-1 block h-3 w-3 shrink-0 rounded-sm bg-brand-red transition-transform group-open:rotate-45"
                  />
                </summary>
                <p className="mt-3 font-body text-base text-brand-grey-700 max-w-3xl">
                  {item.a}
                </p>
              </details>
            </li>
          ))}
        </ul>
      </div>
    </section>
  );
}
