type Props = {
  size?: number;
  className?: string;
};

export function BrandIcon({ size = 32, className }: Props) {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      viewBox="65 188 395 395"
      width={size}
      height={size}
      fill="currentColor"
      aria-hidden="true"
      className={className}
    >
      <rect x="72" y="194.68" width="140.4" height="140.4" rx="19.97" />
      <rect x="311.68" y="194.68" width="140.4" height="140.4" rx="19.97" />
      <rect x="195.79" y="315.4" width="140.4" height="140.4" rx="19.97" />
      <rect x="72" y="435.43" width="140.4" height="140.4" rx="19.97" />
    </svg>
  );
}
