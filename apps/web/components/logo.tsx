import Image from "next/image";

type Variant = "color" | "on-dark";

type Props = {
  variant?: Variant;
  height?: number;
  priority?: boolean;
  className?: string;
};

const ASPECT = 1762 / 685;

const sources: Record<Variant, string> = {
  color: "/brand/logo-color.svg",
  "on-dark": "/brand/logo-on-dark.svg",
};

export function Logo({ variant = "color", height = 36, priority = false, className }: Props) {
  const width = Math.round(height * ASPECT);
  return (
    <Image
      src={sources[variant]}
      alt="eLanguage Center"
      width={width}
      height={height}
      priority={priority}
      className={className}
    />
  );
}
