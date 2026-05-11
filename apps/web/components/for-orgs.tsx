const ORG_EMAIL = "hello@elanguagecenter.com";

const features = [
  "Per-seat licensing with daily and monthly AI quotas you set per learner.",
  "Bulk learner invite by single email or CSV upload, with seat-usage tracking.",
  "An activity log of what each learner practised, when, and what band they hit.",
  "Built for language schools, migration agencies, universities, and corporate L&D.",
];

export function ForOrgs() {
  return (
    <section id="orgs" className="bg-brand-white">
      <div className="mx-auto max-w-7xl px-6 py-20 md:py-24 grid gap-12 md:grid-cols-[1.1fr_1fr] md:items-start">
        <div>
          <p className="font-heading font-bold text-sm tracking-[0.2em] text-brand-red">
            FOR ORGANIZATIONS
          </p>
          <h2 className="mt-3 font-heading font-bold text-3xl md:text-4xl text-brand-black">
            Run IELTS prep at scale.
          </h2>
          <p className="mt-4 font-body text-base md:text-lg text-brand-grey-700 max-w-xl">
            Buy a block of seats, set the AI quota each learner gets, invite
            them in bulk, and watch the activity log fill in. The admin
            dashboard is built for the people running the program, not for
            the people taking the test.
          </p>
          <a
            href={`mailto:${ORG_EMAIL}?subject=eLanguage%20Center%20for%20our%20organization`}
            className="mt-8 inline-flex items-center gap-2 rounded-pill border border-brand-black px-6 py-3 font-heading font-bold text-brand-black transition-colors hover:bg-brand-black hover:text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-red focus-visible:ring-offset-2"
          >
            Talk to us
          </a>
        </div>
        <ul className="grid gap-4">
          {features.map((feature) => (
            <li
              key={feature}
              className="flex gap-4 rounded-lg bg-brand-grey-50 p-5"
            >
              <span
                aria-hidden
                className="mt-1 block h-3 w-3 shrink-0 rounded-sm bg-brand-red"
              />
              <p className="font-body text-base text-brand-grey-900">
                {feature}
              </p>
            </li>
          ))}
        </ul>
      </div>
    </section>
  );
}
