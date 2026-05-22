type Props = {
  variant?: "light" | "dark";
};

/*
 * Text-only placeholder for the eLanguage Center wordmark. Real assets
 * (wordmark + checkered grid icon + red accent rectangle) live at
 * apps/web/public/brand/ once the design source files land.
 */
export function Wordmark({ variant = "light" }: Props) {
  const color = variant === "dark" ? "text-white" : "text-brand-black";
  return (
    <span className={`inline-flex items-center gap-2.5 ${color}`}>
      <span
        aria-hidden
        className="block h-5 w-2.5 rounded-sm bg-brand-red"
      />
      <span className="font-heading font-bold text-lg tracking-tight">
        eLanguage Center
      </span>
    </span>
  );
}
