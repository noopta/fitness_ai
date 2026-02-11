interface BrandLogoProps {
  className?: string;
  height?: number;
}

export function BrandLogo({ className = "", height = 36 }: BrandLogoProps) {
  return (
    <img
      src="/liftoff-logo.png"
      alt="LiftOff"
      height={height}
      className={className}
    />
  );
}
