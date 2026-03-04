interface BrandLogoProps {
  className?: string;
  height?: number;
}

export function BrandLogo({ className = "", height = 36 }: BrandLogoProps) {
  return (
    <img
      src="/axiom-logo.png"
      alt="Axiom"
      height={height}
      className={className}
    />
  );
}
