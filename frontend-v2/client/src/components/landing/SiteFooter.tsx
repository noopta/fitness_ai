import { Link } from 'wouter';

/**
 * Homepage footer with the legal links. Washington's My Health My Data Act
 * requires a prominent link to the Consumer Health Data Privacy Policy on the
 * homepage — keep that link here.
 */
export const FOOTER_LINKS = [
  { href: '/privacy', label: 'Privacy Policy', testId: 'link-footer-privacy' },
  { href: '/health-data', label: 'Consumer Health Data Privacy Policy', testId: 'link-footer-health-data' },
  { href: '/terms', label: 'Terms of Service', testId: 'link-footer-terms' },
  { href: '/accessibility', label: 'Accessibility', testId: 'link-footer-accessibility' },
  { href: '/delete-account', label: 'Delete your account', testId: 'link-footer-delete-account' },
] as const;

export function SiteFooter() {
  return (
    <footer className="border-t bg-background" data-testid="site-footer">
      <div className="container-tight flex flex-col gap-4 py-8 text-sm text-muted-foreground sm:flex-row sm:items-center sm:justify-between">
        <p>© {new Date().getFullYear()} Axiom Training</p>
        <nav aria-label="Legal" className="flex flex-wrap gap-x-5 gap-y-2">
          {FOOTER_LINKS.map((l) => (
            <Link key={l.href} href={l.href} className="hover:text-foreground" data-testid={l.testId}>
              {l.label}
            </Link>
          ))}
          <Link href="/coaches" className="hover:text-foreground" data-testid="link-footer-coaches">For coaches</Link>
          <a href="mailto:hello@axiomtraining.io" className="hover:text-foreground">Contact</a>
        </nav>
      </div>
    </footer>
  );
}

export default SiteFooter;
