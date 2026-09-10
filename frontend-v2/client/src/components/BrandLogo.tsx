interface BrandLogoProps {
  className?: string;
  height?: number;
}

/**
 * Axiom brand mark — the rounded app icon (layered-petal mark on near-black).
 * /axiom-icon.png is generated from the 1024 App Store icon, so the site and
 * the app stay on the same logo.
 */
export function BrandLogo({ className = "", height = 36 }: BrandLogoProps) {
  return (
    <img
      src="/axiom-icon.png"
      alt="Axiom"
      width={height}
      height={height}
      className={className}
    />
  );
}
