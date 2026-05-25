// Pure render component. Each role's landing page derives the firstName
// via `firstNameFrom` from @elc/db and passes the role-specific tagline
// in directly — the component stays trivially snapshotable and free of
// any DB or auth concerns.
//
// Layout: a quiet two-line block above the existing page header. The
// "Welcome back, …" line is the personal hello; the tagline carries the
// brand voice so the page H1 ("Organisations." / "Pick a task." / etc.)
// can keep doing its own functional work without copy collision.

type RoleGreetingProps = {
  firstName: string;
  tagline: string;
};

export function RoleGreeting({ firstName, tagline }: RoleGreetingProps) {
  return (
    <div className="mb-6 md:mb-8">
      <p className="font-heading font-bold text-base md:text-lg text-brand-black">
        Welcome back, {firstName}.
      </p>
      <p className="mt-1 font-body text-sm text-brand-grey-700">{tagline}</p>
    </div>
  );
}
