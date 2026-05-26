import { Wordmark } from "./wordmark";

export function Footer() {
  return (
    <footer className="bg-brand-black text-white border-t-2 border-brand-red">
      <div className="mx-auto max-w-7xl px-6 py-12 flex flex-col md:flex-row items-start md:items-center justify-between gap-4">
        <Wordmark variant="dark" />
        <p className="font-body text-sm text-brand-grey-400">
          © {new Date().getFullYear()} eLanguage Center. All rights reserved.
        </p>
      </div>
    </footer>
  );
}
