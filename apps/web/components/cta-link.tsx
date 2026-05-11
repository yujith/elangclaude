import Link from "next/link";
import type { ComponentProps } from "react";

type Variant = "solid" | "outlined";

type Props = ComponentProps<typeof Link> & {
  variant?: Variant;
};

const base =
  "inline-flex items-center gap-2 px-6 py-3 rounded-pill font-heading font-bold transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-red focus-visible:ring-offset-2";

const solid =
  "bg-brand-red hover:bg-brand-red-dark text-white border border-brand-red focus-visible:ring-offset-white";

const outlined =
  "bg-transparent hover:bg-brand-red hover:text-white text-white border border-brand-red focus-visible:ring-offset-brand-black";

export function CtaLink({ variant = "solid", className, children, ...rest }: Props) {
  const variantClasses = variant === "outlined" ? outlined : solid;
  const merged = [base, variantClasses, className].filter(Boolean).join(" ");
  return (
    <Link {...rest} className={merged}>
      {children}
    </Link>
  );
}
